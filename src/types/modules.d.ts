// 타입 선언이 없는 모듈

// pdf.js 워커 본체 — 옵시디언 안에서는 별도 워커 없이 메인 스레드(fake worker)로 돌린다
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
