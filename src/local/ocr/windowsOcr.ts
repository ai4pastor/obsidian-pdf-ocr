import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import * as path from 'path';
import type { OcrPage } from './types';

/**
 * 윈도우 10·11 내장 OCR(Windows.Media.Ocr) — 설치할 것 없음. (베타: 실제 윈도우에서 확인 필요)
 * Windows PowerShell 5.1 의 WinRT 연결로 OcrEngine 을 부른다.
 * - 스크립트는 파일로 남기지 않고 -EncodedCommand 로 넘긴다(실행 정책 영향 없음).
 * - 결과는 같은 임시 폴더의 result.json(UTF-8)으로 받는다 — 콘솔 인코딩(cp949) 문제를 피하려고.
 * - 스크립트 본문은 ASCII 만 쓴다.
 */
const PS_TEMPLATE = String.raw`
$ErrorActionPreference = 'Stop'
$dir = '__DIR__'
$mode = '__MODE__'
$outPath = Join-Path $dir 'result.json'
function Save-Result($obj) {
  $json = ConvertTo-Json -InputObject $obj -Depth 8 -Compress
  [System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Foundation.IAsyncOperation` + '`' + String.raw`1, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $awaiter = [System.WindowsRuntimeSystemExtensions].GetMember('GetAwaiter') | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' } | Select-Object -First 1
  function Await($op, [Type]$type) { $awaiter.MakeGenericMethod($type).Invoke($null, @($op)).GetResult() }

  $langs = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
  $tags = @($langs | ForEach-Object { $_.LanguageTag })
  $ko = $langs | Where-Object { $_.LanguageTag -like 'ko*' } | Select-Object -First 1
  if ($mode -eq 'check') {
    Save-Result @{ ok = $true; korean = [bool]$ko; languages = $tags; maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension }
    exit 0
  }
  if (-not $ko) { Save-Result @{ ok = $false; code = 'NO_KOREAN'; languages = $tags }; exit 0 }
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($ko)
  if ($null -eq $engine) { Save-Result @{ ok = $false; code = 'ENGINE_FAILED' }; exit 0 }
  $max = [double][Windows.Media.Ocr.OcrEngine]::MaxImageDimension

  $pages = @()
  foreach ($img in (Get-ChildItem -LiteralPath $dir -Filter 'img-*.png' | Sort-Object Name)) {
    $stream = $null
    try {
      $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($img.FullName)) ([Windows.Storage.StorageFile])
      $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $w = [double]$bitmap.PixelWidth
      $h = [double]$bitmap.PixelHeight
      if ($max -gt 0 -and ($w -gt $max -or $h -gt $max)) {
        $pages += ,@{ name = $img.Name; error = 'TOO_LARGE'; lines = @() }
        continue
      }
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      $lines = @()
      foreach ($line in $result.Lines) {
        $x1 = [double]::MaxValue; $y1 = [double]::MaxValue; $x2 = 0.0; $y2 = 0.0
        foreach ($word in $line.Words) {
          $r = $word.BoundingRect
          if ($r.X -lt $x1) { $x1 = $r.X }
          if ($r.Y -lt $y1) { $y1 = $r.Y }
          if (($r.X + $r.Width) -gt $x2) { $x2 = $r.X + $r.Width }
          if (($r.Y + $r.Height) -gt $y2) { $y2 = $r.Y + $r.Height }
        }
        if ($x1 -eq [double]::MaxValue) { continue }
        $lines += ,@{ text = $line.Text; x = $x1 / $w; y = $y1 / $h; w = ($x2 - $x1) / $w; h = ($y2 - $y1) / $h }
      }
      $pages += ,@{ name = $img.Name; lines = $lines }
    } catch {
      $pages += ,@{ name = $img.Name; error = $_.Exception.Message; lines = @() }
    } finally {
      if ($null -ne $stream) { $stream.Dispose() }
    }
  }
  Save-Result @{ ok = $true; pages = $pages }
} catch {
  Save-Result @{ ok = $false; code = 'EXCEPTION'; message = $_.Exception.Message }
}
`;

function buildScript(dir: string, mode: 'check' | 'ocr'): string {
  // 작은따옴표 문자열 안에 넣으므로 ' 를 '' 로 이스케이프
  return PS_TEMPLATE.replace('__DIR__', dir.replace(/'/g, "''")).replace('__MODE__', mode);
}

function runPowerShell(script: string, timeoutMs: number): Promise<void> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`윈도우 OCR 실행 실패: ${stderr?.trim() || error.message}`));
          return;
        }
        resolve();
      }
    );
  });
}

async function readResult(dir: string): Promise<any> {
  const text = await fsp.readFile(path.join(dir, 'result.json'), 'utf8');
  return JSON.parse(text.replace(/^﻿/, ''));
}

export async function checkWindowsOcr(
  workDir: string
): Promise<{ korean: boolean; languages: string[]; maxDim: number }> {
  await runPowerShell(buildScript(workDir, 'check'), 60_000);
  const out = await readResult(workDir);
  if (!out.ok) throw new Error(out.message || out.code || '알 수 없는 오류');
  const languages = Array.isArray(out.languages) ? out.languages : out.languages ? [out.languages] : [];
  return { korean: !!out.korean, languages, maxDim: Number(out.maxDim) || 0 };
}

/** workDir 안의 img-000.png, img-001.png … 을 순서대로 읽는다 */
export async function recognizeWithWindowsOcr(workDir: string, count: number): Promise<OcrPage[]> {
  if (count === 0) return [];
  await runPowerShell(buildScript(workDir, 'ocr'), 60_000 + count * 30_000);
  const out = await readResult(workDir);
  if (!out.ok) {
    if (out.code === 'NO_KOREAN') {
      throw new Error(
        '윈도우에 한국어 OCR 언어가 없습니다. 설정 → 시간 및 언어 → 언어 및 지역 → 한국어 → 언어 옵션에서 "광학 문자 인식"을 설치해 주세요.'
      );
    }
    throw new Error(out.message || out.code || '윈도우 OCR 오류');
  }
  // PowerShell ConvertTo-Json 은 원소가 하나인 배열을 객체로 펴기도 하므로 배열로 맞춘다
  const rawPages = Array.isArray(out.pages) ? out.pages : out.pages ? [out.pages] : [];
  return rawPages.map((p: any) => ({
    lines: Array.isArray(p.lines) ? p.lines : p.lines ? [p.lines] : [],
    error: p.error,
  }));
}
