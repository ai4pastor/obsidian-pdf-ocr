import { App, Notice, TFile, TFolder, base64ToArrayBuffer } from 'obsidian';
import { MarkerSettings } from '../settings';
import { MarkerOkayCancelDialog } from '../modals';

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
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) {
    await app.vault.createFolder(folderPath);
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

export async function createImageFiles(
  app: App,
  settings: MarkerSettings,
  images: { [key: string]: string },
  folderPath: string,
  originalFile: TFile
) {
  const totalImages = Object.keys(images).length;
  let processedImages = 0;

  for (const [imageName, imageBase64] of Object.entries(images)) {
    try {
      let newImageName = imageName;
      if (settings.createAssetSubfolder) {
        newImageName =
          originalFile.name.replace(/\.pdf(?=[^.]*$)/, '_') + imageName;
      }
      const imageArrayBuffer = base64ToArrayBuffer(imageBase64);
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
  originalFile: TFile
) {
  const fileName = originalFile.name.split('.')[0] + '.md';
  const filePath = folderPath + fileName;
  let file: TFile;

  // change markdown image links when asset subfolder is created
  if (settings.createAssetSubfolder) {
    const cleanImagePath = originalFile.name
      .replace(/\.pdf(?=[^.]*$)/, '_')
      .replace(/\s+/g, '%20');

    markdown = markdown.replace(
      /!\[.*\]\((.*)\)/g,
      `![$1](assets/${cleanImagePath}$1)`
    );
  }
  // remove images when only text is extracted
  if (settings.extractContent === 'text') {
    markdown = markdown.replace(/!\[.*\]\(.*\)/g, '');
  }

  const existingFile = app.vault.getAbstractFileByPath(filePath);
  if (existingFile instanceof TFile) {
    file = existingFile;
    await app.vault.modify(file, markdown);
  } else {
    file = await app.vault.create(filePath, markdown);
  }
  new Notice(`마크다운 파일 생성: ${fileName}`);
  app.workspace.openLinkText(file.path, '', true);
}

export async function addMetadataToMarkdownFile(
  app: App,
  metadata: { [key: string]: any },
  folderPath: string,
  originalFile: TFile
) {
  const fileName = originalFile.name.split('.')[0] + '.md';
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
    new Notice('원본 PDF 파일 삭제 완료');
  } catch (error) {
    console.error('Error deleting original file:', error);
  }
}
