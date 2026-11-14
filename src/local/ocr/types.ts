/** OCR 이 읽은 한 줄. 좌표는 그림 크기에 대한 비율(0~1), 원점은 왼쪽 위. */
export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrPage {
  lines: OcrLine[];
  error?: string;
}

export type OcrEngineKind = 'mac-vision' | 'windows' | 'none';

export interface OcrSupport {
  ok: boolean;
  engine: OcrEngineKind;
  /** 사용자에게 보여 줄 엔진 이름 */
  label: string;
  /** 점검 결과 안내(한국어) */
  message: string;
  /** 엔진에 넘길 그림의 긴 변 최대 픽셀 */
  maxSide: number;
}
