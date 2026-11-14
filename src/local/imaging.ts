import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** 너무 작은 그림은 키워서 읽어야 글자 인식률이 오른다 */
const SMALL_IMAGE_LONG_SIDE = 1200;
const SMALL_IMAGE_TARGET = 1600;

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('그림을 PNG로 만들지 못했습니다');
  return new Uint8Array(await blob.arrayBuffer());
}

function whiteCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('그림 그리기(canvas)를 쓸 수 없습니다');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/**
 * 그림 파일(png·jpg)을 OCR 에 알맞은 PNG 로 바꾼다.
 * 휴대폰 사진의 회전 정보(EXIF)를 반영하고, 긴 변을 maxSide 이하로 줄이거나 작은 그림은 키운다.
 */
export async function imageFileToPng(
  bytes: ArrayBuffer,
  extension: string,
  maxSide: number
): Promise<Uint8Array> {
  const blob = new Blob([bytes], { type: IMAGE_MIME[extension] ?? 'application/octet-stream' });
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const longSide = Math.max(bitmap.width, bitmap.height);
    let scale = Math.min(1, maxSide / longSide);
    if (longSide < SMALL_IMAGE_LONG_SIDE) {
      scale = Math.min(2, SMALL_IMAGE_TARGET / longSide);
    }
    const { canvas, ctx } = whiteCanvas(bitmap.width * scale, bitmap.height * scale);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    try {
      return await canvasToPng(canvas);
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    bitmap.close();
  }
}

/** PDF 쪽을 그림(PNG)으로 그리는 도구 — 스캔 쪽 OCR 용. withPdfGlobals 안에서 써야 한다. */
export class PdfPageRenderer {
  private constructor(private readonly doc: PDFDocumentProxy) {}

  static async open(bytes: ArrayBuffer): Promise<PdfPageRenderer> {
    const task = getDocument({
      data: new Uint8Array(bytes.slice(0)),
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
    });
    return new PdfPageRenderer(await task.promise);
  }

  get pageCount(): number {
    return this.doc.numPages;
  }

  async renderPng(pageNumber: number, maxSide: number): Promise<Uint8Array> {
    const page = await this.doc.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, maxSide / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const { canvas, ctx } = whiteCanvas(viewport.width, viewport.height);
      try {
        await page.render({ canvasContext: ctx, viewport }).promise;
        return await canvasToPng(canvas);
      } finally {
        releaseCanvas(canvas);
      }
    } finally {
      page.cleanup();
    }
  }

  async destroy(): Promise<void> {
    await this.doc.destroy();
  }
}
