import { execFile } from 'child_process';
import type { OcrPage } from './types';

/**
 * macOS 내장 Apple Vision 으로 OCR — 설치할 것 없음(파이썬·모델 다운로드 불필요).
 * osascript 의 JavaScript(JXA) ObjC 브리지로 VNRecognizeTextRequest 를 부른다.
 * 결과 좌표: Vision 은 왼쪽 아래 원점 → 여기서 왼쪽 위 원점으로 바꿔 돌려준다.
 */
const VISION_SCRIPT = `
ObjC.import('Foundation');
ObjC.import('Vision');
function makeRequest() {
  var r = $.VNRecognizeTextRequest.alloc.init;
  r.recognitionLevel = 0;
  r.usesLanguageCorrection = true;
  r.recognitionLanguages = $(['ko-KR', 'en-US']);
  return r;
}
function run(argv) {
  if (argv.length > 0 && argv[0] === 'A4P_CHECK_LANGUAGES') {
    var langs = [];
    try { langs = ObjC.deepUnwrap(makeRequest().supportedRecognitionLanguagesAndReturnError($())) || []; } catch (e) {}
    return JSON.stringify({ ok: true, languages: langs, korean: langs.indexOf('ko-KR') >= 0 });
  }
  var pages = [];
  for (var i = 0; i < argv.length; i++) {
    var req = makeRequest();
    var handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[i]), $({}));
    var ok = false;
    try { ok = handler.performRequestsError($([req]), $()); } catch (e) { ok = false; }
    if (!ok) { pages.push({ error: 'VISION_FAILED', lines: [] }); continue; }
    var results = req.results;
    var lines = [];
    var count = results ? results.count : 0;
    for (var j = 0; j < count; j++) {
      var obs = results.objectAtIndex(j);
      var cand = obs.topCandidates(1).firstObject;
      if (!cand) continue;
      var bb = obs.boundingBox;
      lines.push({
        text: ObjC.unwrap(cand.string),
        x: bb.origin.x,
        y: 1 - bb.origin.y - bb.size.height,
        w: bb.size.width,
        h: bb.size.height
      });
    }
    pages.push({ lines: lines });
  }
  return JSON.stringify({ ok: true, pages: pages });
}
`;

function runOsascript(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', VISION_SCRIPT, ...args],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Apple Vision 실행 실패: ${stderr?.trim() || error.message}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// osascript 는 '-' 로 시작하는 인자를 자기 옵션으로 읽으므로 점검 신호는 '-' 없이 넘긴다
const CHECK_SIGNAL = 'A4P_CHECK_LANGUAGES';

export async function checkMacVision(): Promise<{ korean: boolean; languages: string[] }> {
  const out = JSON.parse(await runOsascript([CHECK_SIGNAL], 30_000));
  return { korean: !!out.korean, languages: out.languages ?? [] };
}

export async function recognizeWithMacVision(imagePaths: string[]): Promise<OcrPage[]> {
  if (imagePaths.length === 0) return [];
  const out = JSON.parse(await runOsascript(imagePaths, 60_000 + imagePaths.length * 30_000));
  const pages: OcrPage[] = (out.pages ?? []).map((p: any) => ({
    lines: Array.isArray(p.lines) ? p.lines : [],
    error: p.error,
  }));
  return pages;
}
