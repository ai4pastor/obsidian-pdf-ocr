import { App, Notice, TFile, TFolder, base64ToArrayBuffer } from 'obsidian';
import { MarkerSettings } from '../settings';
import { MarkerOkayCancelDialog } from '../modals';
import { convertBibleReferences } from './bibleLinks';

export async function getConversionFolderPath(
  file: TFile,
  existingPath?: string
): Promise<string> {
  // If a path is provided, use it directly
  const folderPath = existingPath || calculateFolderPath(file);

  return folderPath;
}

// MD 파일을 PDF가 있던 곳(부모 폴더)에 생성하기 위해 부모 디렉터리 경로 반환
function calculateFolderPath(file: TFile): string {
  const parentPath = file.parent?.path;
  if (!parentPath || parentPath === '/') return '';
  return parentPath + '/';
}

export async function createConversionFolder(
  app: App,
  folderPath: string
): Promise<string> {
  const cleanPath = folderPath.replace(/\/+$/, '');
  if (!cleanPath) return folderPath; // 볼트 루트 — 별도 폴더 필요 없음
  const folder = app.vault.getAbstractFileByPath(cleanPath);
  if (!(folder instanceof TFolder)) {
    await app.vault.createFolder(cleanPath);
  }
  return folderPath;
}

export async function checkForExistingFiles(
  app: App,
  folderPath: string,
  originalFile?: TFile
): Promise<boolean> {
  // PDF와 같은 이름의 MD 파일이 이미 있을 때만 덮어쓰기 확인
  if (originalFile) {
    const targetMdPath =
      folderPath + originalFile.name.split('.').slice(0, -1).join('.') + '.md';
    const existing = app.vault.getAbstractFileByPath(targetMdPath);
    if (existing instanceof TFile) {
      return new Promise((resolve) => {
        new MarkerOkayCancelDialog(
          app,
          '동일한 이름의 마크다운 파일 존재',
          `${targetMdPath} 파일이 이미 존재합니다. 덮어쓰시겠습니까?`,
          resolve
        ).open();
      });
    }
    return true;
  }

  const existingFiles = app.vault
    .getFiles()
    .filter((file: { path: string }) => file.path.startsWith(folderPath));
  if (existingFiles.length > 0) {
    return new Promise((resolve) => {
      new MarkerOkayCancelDialog(
        app,
        '기존 파일 발견',
        '대상 폴더에 일부 파일이 이미 있습니다. 덮어쓰거나 통합하시겠습니까?',
        resolve
      ).open();
    });
  }
  return true;
}

// 이미지 데이터(base64 문자열 또는 바이트)를 정확한 길이의 ArrayBuffer 로
function toImageArrayBuffer(data: string | Uint8Array): ArrayBuffer {
  if (typeof data === 'string') return base64ToArrayBuffer(data);
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

export async function createImageFiles(
  app: App,
  settings: MarkerSettings,
  images: { [key: string]: string | Uint8Array },
  folderPath: string,
  originalFile: TFile
) {
  const totalImages = Object.keys(images).length;
  let processedImages = 0;

  for (const [imageName, imageData] of Object.entries(images)) {
    try {
      // PDF 이름 폴더 안에 들어가므로 파일명에 PDF prefix 불필요
      const newImageName = imageName;
      const imageArrayBuffer = toImageArrayBuffer(imageData);
      // check if image already exists, if so, overwrite it
      if (
        app.vault.getAbstractFileByPath(folderPath + newImageName) instanceof
        TFile
      ) {
        const file = app.vault.getAbstractFileByPath(folderPath + newImageName);
        if (!(file instanceof TFile)) {
          console.error(
            `Invalid file reference for image: ${newImageName}`,
            file
          );
          continue;
        }
        await app.vault.modifyBinary(file, imageArrayBuffer);
      } else {
        await app.vault.createBinary(
          folderPath + newImageName,
          imageArrayBuffer
        );
      }
      processedImages++;
    } catch (error) {
      console.error(
        `Failed to process image ${imageName}:`,
        error.message,
        error.stack
      );
    }
  }

  if (processedImages === totalImages) {
    new Notice(`이미지 ${totalImages}개 생성 완료`);
  } else {
    new Notice(
      `이미지 ${totalImages}개 중 ${processedImages}개 생성 (일부 실패)`
    );
  }
}

export async function createMarkdownFile(
  app: App,
  settings: MarkerSettings,
  markdown: string,
  folderPath: string,
  originalFile: TFile,
  openAfterConversion = true
) {
  // basename 사용 — 파일명에 점이 있어도(예: "2026.07.07 설교.pdf") 이름이 잘리지 않음
  const fileName = originalFile.basename + '.md';
  const filePath = folderPath + fileName;
  let file: TFile;

  // 이미지 하위 폴더 사용 시: 마크다운 이미지 링크를 "원본이름/이미지파일명" 형식으로 교체
  // (한 줄에 그림이 여럿이어도 각각 바꾸고, 웹 주소·data URI·이미 경로가 붙은 링크는 그대로 둔다)
  if (settings.createAssetSubfolder) {
    // 공백·괄호는 마크다운 링크를 끊으므로 퍼센트 인코딩 (한글은 그대로 둬 읽기 쉽게)
    const folderName = originalFile.basename
      .replace(/\s+/g, '%20')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
    markdown = markdown.replace(
      /!\[[^\]\n]*\]\(([^)\s]+)\)/g,
      (match: string, target: string) =>
        /^(https?:|data:|app:|file:)/i.test(target) || target.includes('/')
          ? match
          : `![${target}](${folderName}/${target})`
    );
  }
  // remove images when only text is extracted
  if (settings.extractContent === 'text') {
    markdown = markdown.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '');
  }

  // 성경 구절 자동 wikilink 변환
  if (settings.bibleLinkConvert ?? true) {
    markdown = convertBibleReferences(markdown);
  }

  const existingFile = app.vault.getAbstractFileByPath(filePath);
  if (existingFile instanceof TFile) {
    file = existingFile;
    await app.vault.modify(file, markdown);
  } else {
    file = await app.vault.create(filePath, markdown);
  }
  new Notice(`마크다운 파일 생성: ${fileName}`);
  // 일괄 변환 시에는 파일마다 새 탭을 열지 않음
  if (openAfterConversion) {
    app.workspace.openLinkText(file.path, '', true);
  }
}

export async function addMetadataToMarkdownFile(
  app: App,
  metadata: { [key: string]: any },
  folderPath: string,
  originalFile: TFile
) {
  const fileName = originalFile.basename + '.md';
  const filePath = folderPath + fileName;
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    // use the processFrontMatter function to add the metadata to the markdown file
    const frontmatter = generateFrontmatter(metadata);
    await app.fileManager
      .processFrontMatter(file, (fm: any) => {
        return frontmatter + fm;
      })
      .catch((error: any) => {
        console.error('Error adding metadata to markdown file:', error);
      });
  }
}

function generateFrontmatter(metadata: { [key: string]: any }): string {
  let frontmatter = '---\n';
  const frontmatterKeys = ['languages', 'filetype', 'ocr_stats', 'block_stats'];
  for (const [key, value] of Object.entries(metadata)) {
    if (frontmatterKeys.includes(key)) {
      if (key === 'ocr_stats' || key === 'block_stats') {
        for (const [k, v] of Object.entries(value)) {
          frontmatter += `${k}: ${
            k === 'equations'
              ? JSON.stringify(v).slice(1, -1).replace(/"/g, '')
              : v
          }\n`;
        }
      } else {
        frontmatter += `${key}: ${value}\n`;
      }
    }
  }
  frontmatter += '---\n';
  return frontmatter;
}

export async function deleteOriginalFile(app: App, file: TFile) {
  try {
    await app.fileManager.trashFile(file);
    new Notice('원본 파일 삭제 완료');
  } catch (error) {
    console.error('Error deleting original file:', error);
  }
}
