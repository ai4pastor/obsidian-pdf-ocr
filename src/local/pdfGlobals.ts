import * as pdfjsWorkerModule from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import {
  captureGlobals,
  restoreGlobals,
  setPdfWorkerGlobal,
  type SavedPdfGlobals,
} from './globalsGuard';

/**
 * pdf.js 작업(kordoc 파싱·쪽 그리기) 동안에만 `pdfjsWorker` 를 우리 판으로 맞춰 둔다
 * (옵시디언 안에서는 별도 워커 없이 메인 스레드에서 pdf.js 를 돌리는데, 이때 이 전역이 필요하다).
 * 작업이 끝나면 `pdfjsLib`·`pdfjsWorker` 를 원래대로 되돌린다. 작업이 겹치면 마지막 작업이 끝날 때 되돌린다.
 */
let depth = 0;
let saved: SavedPdfGlobals | null = null;

export async function withPdfGlobals<T>(task: () => Promise<T>): Promise<T> {
  if (depth === 0) saved = captureGlobals();
  depth++;
  setPdfWorkerGlobal(pdfjsWorkerModule);
  try {
    return await task();
  } finally {
    depth--;
    if (depth === 0 && saved) {
      restoreGlobals(saved);
      saved = null;
    }
  }
}
