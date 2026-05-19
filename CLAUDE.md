# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요
옵시디언 플러그인. Mistral OCR로 PDF→마크다운 변환.

- **레포**: https://github.com/ai4pastor/obsidian-pdf-ocr (PUBLIC, 수강생 BRAT 배포용)
- **로컬 경로**: `~/Projects/obsidian-pdf-ocr/`
- **베이스**: L3-N0X/obsidian-marker (MIT) 포크 기반
- **사용자**: 한국어 사용 목사·전도사 (성현님 + 수강생)
- **dev vault**: `~/obsidian_dev_vault/.obsidian/plugins/a4p-pdf-ocr/`

## 명령어
- `npm install` — 의존성 설치 (`@mistralai/mistralai` 외 obsidian/typescript dev deps)
- `npm run dev` — watch 모드 빌드 (esbuild)
- `npm run build` — 프로덕션 빌드 (`tsc -noEmit -skipLibCheck` + esbuild) → `main.js` 생성
- `npm run version` — `version-bump.mjs` 실행 (manifest/versions 동기화, 보통 수동 bump 후 사용)
- 테스트 스위트 없음 — 검증은 dev vault에서 수동 동작 확인

## 워크플로우 (모든 변경 시 엄수)
1. 코드 수정
2. `manifest.json` + `package.json` version 동시 bump (semver)
3. `npm run build` 통과 확인
4. dev vault로 복사:
   ```bash
   cp main.js manifest.json styles.css \
      ~/obsidian_dev_vault/.obsidian/plugins/a4p-pdf-ocr/
   ```
5. 사용자가 옵시디언 재시작 → 동작 확인 (필수)
6. `git add -A && git commit -m "..."` → `git push`
7. `gh release create <ver> main.js manifest.json styles.css --title "..." --notes "..."`

## 핵심 결정 사항 (변경 금지)
- **Mistral 단일 백엔드** — Datalab/Marker API/Python 등 다른 OCR 추가 안 함 (단순화 정책)
- **UI 100% 한국어** — 수강생 한국인 한정
- **MD 출력 위치** — PDF가 있던 폴더에 직접 (래핑 폴더 없음)
- **이미지 폴더명** — PDF 파일명과 동일 (예: `강의안.pdf` → `강의안/img-1.jpeg`)
- **플러그인 id** — `a4p-pdf-ocr` 변경 금지 (기존 사용자 설정 유실 방지)
- **원본 PDF 삭제** — 설정 토글로 사용자 선택 (기본 OFF)

## 외부 의존성 추가 시
- 수강생들이 추가 설정 없이 동작해야 함
- API 키 필요한 기능은 설정 UI에서 직접 입력 받기
- **절대 코드에 키 하드코딩 X**
- 키 발급 사이트는 설정 화면에 바로가기 버튼으로 제공

## 코드 구조
| 파일 | 역할 |
|---|---|
| `src/main.ts` | 메뉴, 명령어 등록, 다중 파일 처리 |
| `src/settings.ts` | 설정 화면 (Mistral 키, 템플릿, 일반 옵션) |
| `src/converters/mistralaiConverter.ts` | Mistral OCR API 호출 |
| `src/converter.ts` | BaseConverter 추상 클래스, 결과 처리 |
| `src/utils/fileUtils.ts` | MD/이미지 파일 생성, 폴더 경로 계산 |
| `src/utils/bibleLinks.ts` | 성경 구절 → `[[책장_절]]` 자동 변환 (regex, 66권) |
| `src/modals.ts` | 확인 다이얼로그 |

## 통합 기능
- **Templater 연동** — 변환 후 사용자 지정 템플릿 자동 실행 (frontmatter 자동 분류 등)
- **성경 wikilink** — OCR 본문의 성경 구절 자동 감지 → 사용자 PKM 노트와 연결
  - 단일 구절: `창세기 1장 1절` → `[[창1_1]]`
  - 범위: `고전 13:4-7` → `[[고전13_4]] [[고전13_5]] [[고전13_6]] [[고전13_7]]`
  - 절 없는 장 인용은 패스
  - LLM 사용 안 함 (offline, 무료, 결정적)

## 절대 안 하는 것
- API 엔드포인트 드롭다운 부활 (이미 단순화 결정)
- 영어 UI로 되돌리기
- 새 폴더 생성 방식(PDF명 폴더 wrap) 부활
- BRAT 호환성 깨는 id 변경
- 키 하드코딩

## 버전 정책
- semver 따름
- patch (0.x.0 → 0.x.1): 버그 수정
- minor (0.x.0 → 0.y.0): 기능 추가, 호환성 유지
- major: 비호환 변경 (id 변경 등) — 신중히 결정

## 수강생 시나리오 검증 체크리스트
새 기능 추가 시 항상 확인:
- [ ] 수강생이 BRAT만으로 설치 가능한가? (수동 빌드 X)
- [ ] 추가 설정 없이 즉시 동작하는가?
- [ ] 에러 메시지가 한국어인가?
- [ ] API 키가 코드에 하드코딩되지 않았는가?
- [ ] 기존 설정이 유실되지 않는가? (id, 설정 키 호환성)
