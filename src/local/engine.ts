// 로컬 변환 엔진(무거운 부분) — localConverter.ts 가 처음 변환할 때만 불러온다(데스크톱 전용).
import { parse, VERSION as KORDOC_VERSION } from 'kordoc';
import type { ParseFailure, ParseSuccess } from 'kordoc';
import type { ConversionResult } from '../converter';
import type { MarkerSettings } from '../settings';
import { PdfPageRenderer, imageFileToPng } from './imaging';
import { getOcrSupport, recognizePngs } from './ocr';
import { linesToMarkdown } from './ocr/layout';
import { withPdfGlobals } from './pdfGlobals';

export { getOcrSupport } from './ocr';
export const ENGINE_VERSION = KORDOC_VERSION;

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg'];

/** OCR 을 한 번에 몇 쪽씩 묶어 돌릴지 — 진행 표시를 위해 나눈다 */
const OCR_CHUNK = 4;

export interface LocalConvertOptions {
  extension: string;
  settings: MarkerSettings;
  onStatus?: (message: string) => void;
}

export interface LocalConversionResult extends ConversionResult {
  /** 변환은 됐지만 사용자에게 알릴 것(OCR 꺼짐 등) */
  notes: string[];
}

export async function convertLocally(
  bytes: ArrayBuffer,
  options: LocalConvertOptions
): Promise<LocalConversionResult> {
  if (IMAGE_EXTENSIONS.includes(options.extension)) {
    return convertImage(bytes, options);
  }
  return convertDocument(bytes, options);
}

// ── 문서(HWP·HWPX·PDF·DOCX·PPTX·XLSX) ─────────────────────────────

async function convertDocument(
  bytes: ArrayBuffer,
  options: LocalConvertOptions
): Promise<LocalConversionResult> {
  const status = options.onStatus ?? (() => undefined);
  const notes: string[] = [];

  status('문서를 읽는 중…');
  const result = await withPdfGlobals(() =>
    parse(bytes.slice(0), {
      ocr: false, // kordoc 내장 OCR(네이티브 모듈 필요)은 쓰지 않는다 — 스캔 쪽은 아래에서 컴퓨터 내장 OCR 로
      removeHeaderFooter: !!options.settings.removeHeaderFooter,
      onProgress: (current: number, total: number) => {
        if (total > 1) status(`문서를 읽는 중… (${current}/${total})`);
      },
    })
  );

  if (!result.success) {
    return { success: false, error: describeFailure(result), notes };
  }

  let markdown = result.markdown ?? '';

  if (result.fileType === 'pdf') {
    const need = pagesNeedingOcr(result);
    const total = need.all ? result.pageCount ?? 0 : need.pages.length;
    if (need.all || need.pages.length > 0) {
      if (!options.settings.ocrEnabled) {
        notes.push(
          `스캔된 것으로 보이는 쪽 ${total || '여러'}개는 OCR이 꺼져 있어 글자를 읽지 않았습니다. (설정에서 OCR을 켜 주세요)`
        );
      } else {
        const support = await getOcrSupport();
        if (!support.ok) {
          notes.push(support.message);
        } else {
          const ocrPages = await ocrPdfPages(bytes, need.all ? null : need.pages, support.maxSide, status);
          markdown = mergeOcrPages(result, ocrPages, need.all);
          notes.push(`스캔 쪽 ${ocrPages.size}개를 ${support.label}로 읽었습니다.`);
        }
      }
    }
  }

  // 마크다운에서 실제로 가리키는 그림만 저장한다(OCR 로 바꾼 스캔 쪽의 통째 그림은 버림)
  const images: Record<string, Uint8Array> = {};
  for (const image of result.images ?? []) {
    if (markdown.includes(image.filename)) {
      images[image.filename] = image.data;
    }
  }

  return {
    success: true,
    markdown,
    images,
    metadata: {
      filetype: result.fileType,
      page_count: result.pageCount,
      processor: `kordoc ${KORDOC_VERSION}`,
    },
    notes,
  };
}

function pagesNeedingOcr(result: ParseSuccess): { all: boolean; pages: number[] } {
  const warnings = result.warnings ?? [];
  const all =
    result.isImageBased === true ||
    warnings.some((w) => w.code === 'NEEDS_OCR' && typeof w.page !== 'number');
  const pages = [
    ...new Set(
      warnings
        .filter((w) => w.code === 'NEEDS_OCR' && typeof w.page === 'number')
        .map((w) => w.page as number)
    ),
  ].sort((a, b) => a - b);
  return { all, pages };
}

/** 스캔 쪽을 그림으로 그려 OCR → 쪽 번호별 마크다운 */
async function ocrPdfPages(
  bytes: ArrayBuffer,
  pages: number[] | null,
  maxSide: number,
  status: (message: string) => void
): Promise<Map<number, string>> {
  return withPdfGlobals(async () => {
    const out = new Map<number, string>();
    const renderer = await PdfPageRenderer.open(bytes);
    try {
      const targets = (pages ?? range(1, renderer.pageCount)).filter(
        (p) => p >= 1 && p <= renderer.pageCount
      );
      for (let i = 0; i < targets.length; i += OCR_CHUNK) {
        const chunk = targets.slice(i, i + OCR_CHUNK);
        status(`스캔 쪽 글자 인식 중… (${i + chunk.length}/${targets.length}쪽)`);
        const pngs: Uint8Array[] = [];
        for (const page of chunk) pngs.push(await renderer.renderPng(page, maxSide));
        const recognized = await recognizePngs(pngs);
        chunk.forEach((page, idx) => out.set(page, linesToMarkdown(recognized[idx]?.lines ?? [])));
      }
    } finally {
      await renderer.destroy();
    }
    return out;
  });
}

function mergeOcrPages(result: ParseSuccess, ocr: Map<number, string>, all: boolean): string {
  const ocrInOrder = () =>
    [...ocr.entries()].sort((a, b) => a[0] - b[0]).map(([, md]) => md);

  if (all) {
    return ocrInOrder().filter((md) => md.trim()).join('\n\n');
  }
  if (result.pages && result.pages.length > 0) {
    const byPage = new Map(result.pages.map((p) => [p.pageNumber, p.markdown]));
    const pageNumbers = [...new Set([...byPage.keys(), ...ocr.keys()])].sort((a, b) => a - b);
    return pageNumbers
      .map((n) => (ocr.has(n) ? ocr.get(n) ?? '' : byPage.get(n) ?? ''))
      .filter((md) => md.trim())
      .join('\n\n');
  }
  // 쪽 정보가 없으면 OCR 결과를 끝에 붙인다
  return [result.markdown ?? '', ...ocrInOrder()].filter((md) => md.trim()).join('\n\n');
}

// ── 그림 파일(png·jpg) ───────────────────────────────────────────

async function convertImage(
  bytes: ArrayBuffer,
  options: LocalConvertOptions
): Promise<LocalConversionResult> {
  const status = options.onStatus ?? (() => undefined);
  if (!options.settings.ocrEnabled) {
    return {
      success: false,
      error: '그림 파일은 OCR로만 변환할 수 있습니다. 설정에서 "스캔본·사진 글자 인식(OCR)"을 켜 주세요.',
      notes: [],
    };
  }
  const support = await getOcrSupport();
  if (!support.ok) {
    return { success: false, error: support.message, notes: [] };
  }
  status('그림에서 글자를 읽는 중…');
  const png = await imageFileToPng(bytes, options.extension, support.maxSide);
  const [page] = await recognizePngs([png]);
  const markdown = linesToMarkdown(page?.lines ?? []);
  if (!markdown.trim()) {
    return { success: false, error: '그림에서 글자를 찾지 못했습니다.', notes: [] };
  }
  return {
    success: true,
    markdown,
    images: {},
    metadata: { filetype: options.extension, processor: support.label },
    notes: [],
  };
}

// ── 도우미 ─────────────────────────────────────────────────────

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function describeFailure(result: ParseFailure): string {
  switch (result.code) {
    case 'ENCRYPTED':
      return '암호가 걸린 문서입니다. 원래 프로그램에서 암호를 풀고 다시 저장한 뒤 변환해 주세요.';
    case 'DRM_PROTECTED':
      return '문서 보안(DRM)이 걸린 파일이라 변환할 수 없습니다.';
    case 'CORRUPTED':
      return '파일이 손상되었거나 끝까지 저장되지 않았습니다.';
    case 'UNSUPPORTED_FORMAT':
      return '지원하지 않는 파일 형식입니다.';
    case 'EMPTY_INPUT':
      return '빈 파일입니다.';
    case 'DECOMPRESSION_BOMB':
    case 'ZIP_BOMB':
      return '압축이 비정상적으로 큰 파일이라 안전을 위해 변환하지 않았습니다.';
    default:
      return result.error || '알 수 없는 오류';
  }
}
