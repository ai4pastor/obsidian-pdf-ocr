// pdf.js 한국어 CMap(.bcmap)을 base64 로 플러그인에 내장한다.
// 옵시디언 번들 안에서는 pdf.js 가 node_modules 의 cmaps 폴더를 찾을 수 없어서,
// 미리 정의된 CMap(UniKS-UCS2-H 등)을 쓰는 한글 PDF 의 글자가 통째로 빠진다.
// 출처: pdfjs-dist/cmaps (Adobe CMap 자료, BSD-3-Clause — THIRD_PARTY_NOTICES.md 참고)
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const cmapDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps');

const names = readdirSync(cmapDir)
	.filter((f) => f.endsWith('.bcmap'))
	.map((f) => f.slice(0, -'.bcmap'.length))
	.filter((name) => /^(Adobe-Korea1|KSC|UniKS)/.test(name))
	.sort();

if (names.length === 0) {
	throw new Error(`한국어 CMap 을 찾지 못했습니다: ${cmapDir}`);
}

let out =
	'// 자동 생성 파일 — scripts/gen-cmaps.mjs 가 만든다. 직접 고치지 마세요.\n' +
	'// pdfjs-dist 한국어 CMap (Adobe, BSD-3-Clause)\n' +
	'export const KOREAN_CMAPS: Record<string, string> = {\n';
for (const name of names) {
	const base64 = readFileSync(join(cmapDir, `${name}.bcmap`)).toString('base64');
	out += `\t${JSON.stringify(name)}: ${JSON.stringify(base64)},\n`;
}
out += '};\n';

mkdirSync('src/generated', { recursive: true });
writeFileSync('src/generated/koreanCMaps.ts', out);
console.log(`한국어 CMap ${names.length}개를 src/generated/koreanCMaps.ts 에 내장했습니다`);
