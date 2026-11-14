// esbuild 가 'pdfjs-dist/legacy/build/pdf.mjs' 를 이 파일로 돌린다(esbuild.config.mjs 의 a4p-pdfjs-shim).
// getDocument 에 내장 한국어 CMap 을 끼워 넣고, 나머지는 원본 pdf.js 를 그대로 내보낸다.
// (번들 안의 pdf.js 는 node_modules 의 cmaps 폴더를 찾지 못해 한글 CID 글꼴 글자를 잃기 때문)
import { getDocument as originalGetDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EmbeddedCMapReaderFactory } from './embeddedCMaps';

export * from 'pdfjs-dist/legacy/build/pdf.mjs';

export function getDocument(src) {
	const isParamsObject =
		src !== null &&
		typeof src === 'object' &&
		!ArrayBuffer.isView(src) &&
		!(src instanceof ArrayBuffer) &&
		!(typeof URL !== 'undefined' && src instanceof URL);
	if (isParamsObject && !src.CMapReaderFactory) {
		src = {
			...src,
			CMapReaderFactory: EmbeddedCMapReaderFactory,
			cMapUrl: 'a4p-embedded-cmaps/',
			cMapPacked: true,
		};
	}
	return originalGetDocument(src);
}
