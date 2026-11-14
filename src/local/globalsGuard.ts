/**
 * 전역 `pdfjsLib`·`pdfjsWorker` 보관·복원 (가벼운 모듈 — pdf.js 를 불러오지 않는다).
 *
 * 번들한 pdf.js(4.10.38)는 불러오는 순간 이 두 전역을 덮어쓴다.
 * 옵시디언 자체 PDF 뷰어도 같은 이름을 쓰므로(다른 판), 그대로 두면 변환 뒤 PDF 보기가 깨질 수 있다.
 */
type GlobalBag = Record<string, unknown>;

export interface SavedPdfGlobals {
  hadLib: boolean;
  lib: unknown;
  hadWorker: boolean;
  worker: unknown;
}

const g = globalThis as unknown as GlobalBag;
const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(g, key);

export function captureGlobals(): SavedPdfGlobals {
  return {
    hadLib: hasOwn('pdfjsLib'),
    lib: g.pdfjsLib,
    hadWorker: hasOwn('pdfjsWorker'),
    worker: g.pdfjsWorker,
  };
}

export function restoreGlobals(saved: SavedPdfGlobals): void {
  if (saved.hadLib) g.pdfjsLib = saved.lib;
  else delete g.pdfjsLib;
  if (saved.hadWorker) g.pdfjsWorker = saved.worker;
  else delete g.pdfjsWorker;
}

export function setPdfWorkerGlobal(worker: unknown): void {
  g.pdfjsWorker = worker;
}
