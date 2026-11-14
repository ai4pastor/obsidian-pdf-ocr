import type { OcrLine } from './types';

/**
 * OCR 줄 목록 → 마크다운.
 * - 두 단(column) 조판이면 왼쪽 단 → 오른쪽 단 순서로 읽는다.
 * - 같은 높이에 나란히 놓인 조각(표의 칸 등)은 한 줄로 모아 " | " 로 잇는다.
 * - 줄 간격·들여쓰기·짧은 줄로 문단을 나누고, 유난히 큰 글씨의 짧은 줄은 소제목(##)으로 둔다.
 */
export function linesToMarkdown(input: OcrLine[]): string {
  const lines = input
    .map((l) => ({ ...l, text: (l.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0 && l.w > 0 && l.h > 0);
  if (lines.length === 0) return '';

  const medianH = median(lines.map((l) => l.h));
  const blocks: string[] = [];
  for (const group of orderByColumns(lines)) {
    blocks.push(...toBlocks(group, medianH));
  }
  return blocks.join('\n\n').trim();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const byReadingOrder = (a: OcrLine, b: OcrLine) => a.y - b.y || a.x - b.x;

function orderByColumns(lines: OcrLine[]): OcrLine[][] {
  const gutter = findGutter(lines);
  if (gutter === null) return [lines.slice().sort(byReadingOrder)];

  const left: OcrLine[] = [];
  const right: OcrLine[] = [];
  const spanning: OcrLine[] = [];
  for (const l of lines) {
    if (l.x + l.w <= gutter) left.push(l);
    else if (l.x >= gutter) right.push(l);
    else spanning.push(l);
  }
  const columnTop = Math.min(...[...left, ...right].map((l) => l.y));
  const before = spanning.filter((l) => l.y < columnTop).sort(byReadingOrder);
  const after = spanning.filter((l) => l.y >= columnTop).sort(byReadingOrder);
  return [before, left.sort(byReadingOrder), right.sort(byReadingOrder), after].filter(
    (group) => group.length > 0
  );
}

/** 쪽 가운데(30~70%)에 세로로 빈 띠가 있고 양쪽에 긴 글줄이 충분하면 두 단으로 본다 */
function findGutter(lines: OcrLine[]): number | null {
  if (lines.length < 8) return null;
  const BINS = 200;
  const cover = new Array<number>(BINS).fill(0);
  for (const l of lines) {
    const from = Math.max(0, Math.floor(l.x * BINS));
    const to = Math.min(BINS - 1, Math.floor((l.x + l.w) * BINS));
    for (let i = from; i <= to; i++) cover[i]++;
  }
  // 두 단에 걸친 제목 몇 줄은 허용
  const allowed = Math.max(1, Math.floor(lines.length * 0.08));
  const lo = Math.floor(BINS * 0.3);
  const hi = Math.floor(BINS * 0.7);
  let best: { start: number; end: number } | null = null;
  let runStart = -1;
  for (let i = lo; i <= hi + 1; i++) {
    const empty = i <= hi && cover[i] <= allowed;
    if (empty && runStart < 0) runStart = i;
    if (!empty && runStart >= 0) {
      if (!best || i - runStart > best.end - best.start) best = { start: runStart, end: i };
      runStart = -1;
    }
  }
  if (!best || best.end - best.start < 3) return null;

  const gutter = (best.start + best.end) / 2 / BINS;
  const left = lines.filter((l) => l.x + l.w <= gutter);
  const right = lines.filter((l) => l.x >= gutter);
  const minLines = Math.max(3, lines.length * 0.2);
  if (left.length < minLines || right.length < minLines) return null;

  // 글 단은 줄이 단 폭을 대부분 채운다 — 짧은 칸이 늘어선 표는 단으로 보지 않는다
  const leftStart = Math.min(...left.map((l) => l.x));
  const rightEnd = Math.max(...right.map((l) => l.x + l.w));
  const leftFill = median(left.map((l) => l.w)) / Math.max(1e-6, gutter - leftStart);
  const rightFill = median(right.map((l) => l.w)) / Math.max(1e-6, rightEnd - gutter);
  if (leftFill < 0.5 || rightFill < 0.5) return null;
  return gutter;
}

interface Row extends OcrLine {
  cells: number;
}

/** 같은 높이에 나란히 놓인 조각을 한 줄(Row)로 모은다 */
function toRows(sorted: OcrLine[], medianH: number): Row[] {
  const rows: Row[] = [];
  for (const l of sorted) {
    const last = rows[rows.length - 1];
    if (last) {
      const centerGap = Math.abs(l.y + l.h / 2 - (last.y + last.h / 2));
      const sameRow = centerGap < Math.min(l.h, last.h) * 0.5;
      const apart =
        l.x >= last.x + last.w - medianH * 0.2 || l.x + l.w <= last.x + medianH * 0.2;
      if (sameRow && apart) {
        const texts = l.x < last.x ? [l.text, last.text] : [last.text, l.text];
        const x = Math.min(l.x, last.x);
        const right = Math.max(l.x + l.w, last.x + last.w);
        const y = Math.min(l.y, last.y);
        const bottom = Math.max(l.y + l.h, last.y + last.h);
        rows[rows.length - 1] = {
          text: texts.join(' | '),
          x,
          y,
          w: right - x,
          h: bottom - y,
          cells: last.cells + 1,
        };
        continue;
      }
    }
    rows.push({ ...l, cells: 1 });
  }
  return rows;
}

const BULLET = /^[•●○◦▪■□◆◇▶▷►‣⁃∙·※➢✓✔-]\s*/;
const NUMBERED = /^(\d{1,3}[.)]|\(\d{1,3}\)|[①-⑳]|[가-하][.)])\s*/;

type BlockKind = 'para' | 'list' | 'rows';

function joinLines(prev: string, next: string): string {
  // 영어 낱말이 줄 끝에서 하이픈으로 끊긴 경우만 붙여 쓴다
  if (/[A-Za-z]-$/.test(prev) && /^[a-z]/.test(next)) return prev.slice(0, -1) + next;
  return `${prev} ${next}`;
}

function toBlocks(group: OcrLine[], medianH: number): string[] {
  const rows = toRows(group, medianH);
  const right = Math.max(...rows.map((r) => r.x + r.w));
  const blocks: string[] = [];
  let kind: BlockKind | null = null;
  let parts: string[] = [];

  const flush = () => {
    if (parts.length > 0) {
      blocks.push(kind === 'para' ? parts.join('') : parts.join('\n'));
    }
    parts = [];
    kind = null;
  };

  let prev: Row | null = null;
  let listItemX = 0;
  for (const row of rows) {
    const gap = prev ? row.y - (prev.y + prev.h) : Number.POSITIVE_INFINITY;
    const isBullet = row.cells === 1 && BULLET.test(row.text);
    const isNumbered = row.cells === 1 && NUMBERED.test(row.text);
    const isRow = row.cells > 1;
    const indented = prev !== null && row.x > prev.x + medianH * 1.0;
    const prevEndedShort = prev !== null && prev.x + prev.w < right - medianH * 3;

    // 글자 높이로 소제목 판단 — 아주 크면 ##, 조금 크고 앞에 여백이 있으면 ###
    // (OCR 줄 높이는 본문에서도 ±20% 흔들리므로 중간 크기는 앞 여백까지 함께 본다)
    const ratio = row.h / medianH;
    const shortSingle = row.cells === 1 && !isBullet && row.text.length <= 60;
    const headingLevel =
      shortSingle && ratio >= 1.45
        ? 2
        : shortSingle && ratio >= 1.18 && gap >= medianH * 0.9
        ? 3
        : 0;
    if (headingLevel > 0) {
      flush();
      blocks.push(`${'#'.repeat(headingLevel)} ${row.text}`);
      prev = row;
      continue;
    }

    // 글머리표 항목이 다음 줄로 넘어간 경우(들여쓰기·좁은 줄 간격) — 앞 항목에 이어 붙인다
    const continuesListItem =
      kind === 'list' &&
      !isBullet &&
      !isNumbered &&
      !isRow &&
      gap <= medianH * 0.75 &&
      row.x >= listItemX + medianH * 0.3;
    if (continuesListItem) {
      parts[parts.length - 1] = joinLines(parts[parts.length - 1], row.text);
      prev = row;
      continue;
    }

    const rowKind: BlockKind = isRow ? 'rows' : isBullet || isNumbered ? 'list' : 'para';
    const breakHere =
      prev === null ||
      gap > medianH * 0.75 ||
      rowKind !== kind ||
      (rowKind === 'para' && (indented || prevEndedShort));
    if (breakHere) flush();

    if (rowKind === 'list') {
      kind = 'list';
      listItemX = row.x;
      parts.push(isBullet ? `- ${row.text.replace(BULLET, '')}` : row.text);
    } else if (rowKind === 'rows') {
      kind = 'rows';
      parts.push(row.text);
    } else {
      kind = 'para';
      if (parts.length === 0) parts.push(row.text);
      else parts[0] = joinLines(parts[0], row.text);
    }
    prev = row;
  }
  flush();
  return blocks;
}
