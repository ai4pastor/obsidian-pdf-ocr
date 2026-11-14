import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkMacVision, recognizeWithMacVision } from './macVision';
import { checkWindowsOcr, recognizeWithWindowsOcr } from './windowsOcr';
import type { OcrEngineKind, OcrPage, OcrSupport } from './types';

export type { OcrLine, OcrPage, OcrSupport } from './types';

/** 엔진에 넘길 그림의 긴 변(픽셀) — A4 한 쪽이 약 300dpi 가 되는 크기 */
const DEFAULT_MAX_SIDE = 3000;
const WINDOWS_MAX_SIDE = 2600;

export function detectOcrEngine(): OcrEngineKind {
  if (process.platform === 'darwin') return 'mac-vision';
  if (process.platform === 'win32') return 'windows';
  return 'none';
}

export function ocrEngineLabel(kind: OcrEngineKind): string {
  switch (kind) {
    case 'mac-vision':
      return 'Apple Vision(맥 내장 OCR)';
    case 'windows':
      return '윈도우 내장 OCR(베타)';
    default:
      return '내장 OCR 없음';
  }
}

/**
 * OCR 이 끝나면 지울 임시 폴더를 만든다(운영체제 임시 폴더 안).
 * 이 폴더에는 이 플러그인이 만든 그림·결과 파일만 들어간다.
 */
async function makeWorkDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'a4p-doc-ocr-'));
}

async function removeWorkDir(dir: string): Promise<void> {
  // 우리가 만든 임시 폴더만 지운다 — 다른 경로는 건드리지 않도록 이름을 확인
  if (!path.basename(dir).startsWith('a4p-doc-ocr-')) return;
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

let cachedSupport: OcrSupport | null = null;

/** 이 컴퓨터에서 한국어 OCR 을 쓸 수 있는지 점검(결과는 기억해 둔다. force=true 면 다시 점검) */
export async function getOcrSupport(force = false): Promise<OcrSupport> {
  if (cachedSupport && !force) return cachedSupport;
  const engine = detectOcrEngine();
  const label = ocrEngineLabel(engine);
  let support: OcrSupport;
  try {
    if (engine === 'mac-vision') {
      const { korean } = await checkMacVision();
      support = korean
        ? { ok: true, engine, label, maxSide: DEFAULT_MAX_SIDE, message: `${label}을 쓸 수 있습니다 (한국어 지원)` }
        : {
            ok: false,
            engine,
            label,
            maxSide: DEFAULT_MAX_SIDE,
            message: '이 맥의 Apple Vision은 한국어를 지원하지 않습니다. macOS 13(Ventura) 이상으로 업데이트해 주세요.',
          };
    } else if (engine === 'windows') {
      const dir = await makeWorkDir();
      try {
        const { korean, maxDim } = await checkWindowsOcr(dir);
        const maxSide = maxDim > 0 ? Math.min(WINDOWS_MAX_SIDE, maxDim) : WINDOWS_MAX_SIDE;
        support = korean
          ? { ok: true, engine, label, maxSide, message: `${label}을 쓸 수 있습니다 (한국어 지원)` }
          : {
              ok: false,
              engine,
              label,
              maxSide,
              message:
                '윈도우에 한국어 OCR 언어가 없습니다. 설정 → 시간 및 언어 → 언어 및 지역 → 한국어 → 언어 옵션에서 "광학 문자 인식"을 설치한 뒤 다시 시도해 주세요.',
            };
      } finally {
        await removeWorkDir(dir);
      }
    } else {
      support = {
        ok: false,
        engine,
        label,
        maxSide: DEFAULT_MAX_SIDE,
        message: '이 운영체제에는 내장 OCR이 없습니다. 스캔본·사진은 설정에서 Mistral 엔진을 쓰면 읽을 수 있습니다.',
      };
    }
  } catch (error) {
    support = {
      ok: false,
      engine,
      label,
      maxSide: DEFAULT_MAX_SIDE,
      message: `${label} 점검 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // 실패는 기억하지 않는다 — 언어 팩 설치 뒤 바로 다시 시도할 수 있게
  cachedSupport = support.ok ? support : null;
  return support;
}

/** PNG 여러 장을 OCR — 들어온 순서대로 결과를 돌려준다 */
export async function recognizePngs(pngs: Uint8Array[]): Promise<OcrPage[]> {
  if (pngs.length === 0) return [];
  const engine = detectOcrEngine();
  if (engine === 'none') throw new Error(ocrEngineLabel(engine));

  const dir = await makeWorkDir();
  try {
    const files: string[] = [];
    for (let i = 0; i < pngs.length; i++) {
      const file = path.join(dir, `img-${String(i).padStart(3, '0')}.png`);
      await fsp.writeFile(file, pngs[i]);
      files.push(file);
    }
    const pages =
      engine === 'mac-vision'
        ? await recognizeWithMacVision(files)
        : await recognizeWithWindowsOcr(dir, files.length);
    // 결과 수가 모자라면 빈 쪽으로 채워 순서를 지킨다
    return pngs.map((_, i) => pages[i] ?? { lines: [], error: 'NO_RESULT' });
  } finally {
    await removeWorkDir(dir);
  }
}
