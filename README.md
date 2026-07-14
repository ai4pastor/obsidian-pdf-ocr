# obsidian-pdf-ocr

Obsidian plugin for PDF OCR.

PDF·DOCX·PPTX·이미지를 Mistral OCR로 마크다운 노트로 변환하는 옵시디언 플러그인입니다. 변환 결과는 항상 **원본 파일명 그대로** 생성됩니다 (예: `강의안.pdf` → `강의안.md`).

## ⚠️ 알려진 충돌: Paste Image Rename 플러그인

**증상**: 서로 다른 PDF·DOCX를 변환했는데 결과 노트 제목이 전부 똑같고 `-1, -2, -3, -4` 연번만 붙어서 생성됨.

**원인**: 이 플러그인의 문제가 아니라, **Paste Image Rename** 플러그인의 **"Handle all attachments"** 옵션 때문입니다. 이 옵션이 켜져 있으면 볼트에 새로 들어오는 모든 파일(PDF·DOCX 포함)이 변환되기 전에 "현재 열려 있는 노트 이름 + 연번"으로 즉시 리네임되고, OCR 변환은 그 바뀐 이름을 그대로 따라갑니다.

**해결**: Paste Image Rename 설정에서 둘 중 하나를 적용하세요.

1. **Handle all attachments** 옵션 끄기 (이미지 붙여넣기 리네임은 계속 동작), 또는
2. **Exclude extension pattern**에 다음을 입력해 문서 파일을 리네임 대상에서 제외:

   ```
   pdf|docx|doc|pptx|ppt|hwp
   ```
