import { KOREAN_CMAPS } from '../generated/koreanCMaps';

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * pdf.js 의 `CMapReaderFactory` 자리에 넣는 읽기 도구.
 * 네트워크·파일 경로 없이 플러그인에 내장한 한국어 CMap(.bcmap)을 돌려준다.
 * (pdf.js 4.10 계약: constructor({ baseUrl, isCompressed }) + fetch({ name }) → { cMapData, isCompressed })
 */
export class EmbeddedCMapReaderFactory {
  // pdf.js 가 { baseUrl, isCompressed } 를 넘기지만 내장 자료만 쓰므로 무시한다
  constructor(_options?: { baseUrl?: string | null; isCompressed?: boolean }) {}

  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    const data = KOREAN_CMAPS[name];
    if (!data) {
      throw new Error(`내장하지 않은 CMap 입니다: ${name}`);
    }
    return { cMapData: base64ToBytes(data), isCompressed: true };
  }
}
