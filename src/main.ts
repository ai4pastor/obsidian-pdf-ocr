import { Plugin, TFile, TFolder, TAbstractFile, Menu, Notice } from 'obsidian';
import { MarkerSettings, DEFAULT_SETTINGS, MarkerSettingTab } from './settings';
import {
  MarkerOkayCancelDialog,
  MarkerBatchOverwriteDialog,
  BatchOverwriteChoice,
} from './modals';
import { convertBibleReferences } from './utils/bibleLinks';
import { Converter, ConvertOptions } from './converter';
import { MistralAIConverter } from './converters/mistralaiConverter';
import {
  LEGACY_OFFICE_EXTENSIONS,
  LOCAL_DOCUMENT_EXTENSIONS,
  LOCAL_IMAGE_EXTENSIONS,
  LocalConverter,
} from './local/localConverter';

// Mistral OCR 이 받는 형식 (이 밖의 형식은 Mistral 엔진을 골라도 로컬로 변환)
const MISTRAL_EXTENSIONS = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'png', 'jpg', 'jpeg'];
// 메뉴·감시 폴더가 받는 전체 형식
const CONVERTIBLE_EXTENSIONS = [
  ...new Set([
    ...LOCAL_DOCUMENT_EXTENSIONS,
    ...LOCAL_IMAGE_EXTENSIONS,
    ...LEGACY_OFFICE_EXTENSIONS,
  ]),
];

export default class Marker extends Plugin {
  settings: MarkerSettings;
  // 변환기 두 가지 — 파일 형식과 설정(conversionEngine)에 따라 고른다
  localConverter: LocalConverter = new LocalConverter();
  mistralConverter: MistralAIConverter = new MistralAIConverter();

  // 플러그인이 변환 중 생성하는 파일(추출 이미지 등)을 감시 폴더가 다시 변환하지 않도록 추적
  private activeConversions = 0;

  async onload() {
    await this.loadSettings();
    this.addCommands();
    this.addSettingTab(new MarkerSettingTab(this.app, this));
    this.registerFileMenuEvents();
    this.registerWatchFolder();
  }

  private registerWatchFolder() {
    // onLayoutReady 이후 등록 — 볼트 초기 로딩 시 모든 파일에 대해 create가 발생하기 때문
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on('create', (file: TAbstractFile) => {
          this.handleWatchedFileCreate(file);
        })
      );
    });
  }

  private handleWatchedFileCreate(file: TAbstractFile) {
    const watchFolder = (this.settings.watchFolder || '')
      .trim()
      .replace(/^\/+|\/+$/g, '');
    if (!watchFolder) return;
    if (!(file instanceof TFile) || !this.isValidFile(file)) return;
    // 변환 작업이 만든 파일(추출 이미지 등)은 무시 — 무한 루프·중복 과금 방지
    if (this.activeConversions > 0) return;
    // 감시 폴더 직속 파일만 대상
    if (file.parent?.path !== watchFolder) return;

    // 외부 복사/동기화가 끝나기 전에 업로드하지 않도록 잠시 대기
    new Notice(`감시 폴더: ${file.name} 자동 변환을 시작합니다`);
    setTimeout(() => {
      // 대기 중 삭제·이동됐을 수 있으므로 다시 확인
      const current = this.app.vault.getAbstractFileByPath(file.path);
      if (current instanceof TFile) {
        this.convertFiles([current]);
      }
    }, 1500);
  }

  private registerFileMenuEvents() {
    // Register "Convert to MD" menu item for single files and folders
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFolder) {
          this.addFolderMenuItem(menu, file);
          return;
        }
        if (!(file instanceof TFile) || !this.isValidFile(file)) return;
        menu.addItem((item) => {
          item.setIcon('pdf-file');
          item.setTitle(this.getMenuItemTitle(file));
          item.setSection('action');
          item.onClick(async () => {
            await this.convertFile(file);
          });
        });
      })
    );

    // Register "Convert to MD" menu item for multiple selected files
    this.registerEvent(
      this.app.workspace.on('files-menu', (menu: Menu, files: TAbstractFile[]) => {
        const validFiles = files.filter(
          (file): file is TFile => file instanceof TFile && this.isValidFile(file)
        );
        if (validFiles.length === 0) return;

        menu.addItem((item) => {
          item.setIcon('files');
          item.setTitle(validFiles.length + '개 파일을 MD로 변환');
          item.setSection('action');
          item.onClick(async (): Promise<void> => {
            await this.convertFiles(validFiles);
          });
        });
      })
    );
  }

  private addFolderMenuItem(menu: Menu, folder: TFolder) {
    // 폴더 바로 아래의 변환 가능 파일만 대상 (하위 폴더 미포함)
    const targetFiles = folder.children.filter(
      (child): child is TFile => child instanceof TFile && this.isValidFile(child)
    );
    if (targetFiles.length === 0) return;

    menu.addItem((item) => {
      item.setIcon('folder-input');
      item.setTitle(`폴더 내 ${targetFiles.length}개 파일을 MD로 변환`);
      item.setSection('action');
      item.onClick(() => {
        const usesMistral = this.settings.conversionEngine === 'mistral';
        new MarkerOkayCancelDialog(
          this.app,
          '폴더 일괄 변환',
          usesMistral
            ? `${targetFiles.length}개 파일을 MD로 변환합니다. Mistral API 요금이 발생할 수 있습니다. 계속할까요?`
            : `${targetFiles.length}개 파일을 이 컴퓨터에서 MD로 변환합니다(무료). 계속할까요?`,
          async (confirmed) => {
            if (confirmed) await this.convertFiles(targetFiles);
          }
        ).open();
      });
    });
  }

  // 변환 결과 MD가 생성될 경로 (원본과 같은 폴더, 같은 basename)
  private getTargetMdPath(file: TFile): string {
    const parentPath = file.parent?.path;
    const folderPath =
      !parentPath || parentPath === '/' ? '' : parentPath + '/';
    return folderPath + file.basename + '.md';
  }

  private async convertFiles(files: TFile[]) {
    // 이미 같은 이름의 MD가 있는 파일은 다이얼로그 한 번으로 일괄 처리
    const collisions = new Set(
      files.filter(
        (f) =>
          this.app.vault.getAbstractFileByPath(this.getTargetMdPath(f)) instanceof
          TFile
      )
    );

    let targets = files;
    let overwriteExisting = false;
    let skipped = 0;

    if (collisions.size > 0) {
      const choice = await new Promise<BatchOverwriteChoice>((resolve) =>
        new MarkerBatchOverwriteDialog(this.app, collisions.size, resolve).open()
      );
      if (choice === 'cancel') return;
      if (choice === 'skip') {
        targets = files.filter((f) => !collisions.has(f));
        skipped = collisions.size;
      } else {
        overwriteExisting = true;
      }
    }

    if (targets.length === 0) {
      new Notice('변환할 파일이 없습니다 (모두 건너뜀)');
      return;
    }

    const isBatch = targets.length > 1;
    let succeeded = 0;
    let failed = 0;
    for (const [index, file] of targets.entries()) {
      if (isBatch) {
        new Notice(`(${index + 1}/${targets.length}) ${file.name} 변환 중…`);
      }
      const ok = await this.convertFile(file, {
        overwriteExisting,
        openAfterConversion: !isBatch,
      });
      if (ok) succeeded++;
      else failed++;
    }
    if (isBatch || skipped > 0) {
      new Notice(
        `일괄 변환 완료: 성공 ${succeeded}개` +
          (failed > 0 ? `, 실패 ${failed}개` : '') +
          (skipped > 0 ? `, 건너뜀 ${skipped}개` : '')
      );
    }
  }

  private isValidFile(file: TFile): boolean {
    // 확장자 게이트는 여기 한 곳 — 로컬(kordoc) 형식 + 이미지 + 옛 오피스(Mistral 전용·로컬은 안내)
    return CONVERTIBLE_EXTENSIONS.includes(file.extension.toLowerCase());
  }

  /** 설정 화면(감시 폴더 검증)에서 쓰는 공개 확인 함수 */
  public isConvertible(file: TFile): boolean {
    return this.isValidFile(file);
  }

  /** 파일마다 쓸 변환기 — Mistral 엔진을 골랐어도 Mistral 이 못 읽는 형식(HWP 등)은 로컬로 */
  private getConverterFor(file: TFile): Converter {
    const ext = file.extension.toLowerCase();
    if (this.settings.conversionEngine === 'mistral' && MISTRAL_EXTENSIONS.includes(ext)) {
      return this.mistralConverter;
    }
    return this.localConverter;
  }

  private getMenuItemTitle(file: TFile): string {
    const titles = {
      pdf: 'PDF를 MD로 변환',
      hwp: '한글(HWP)을 MD로 변환',
      hwpx: '한글(HWPX)을 MD로 변환',
      hml: '한글(HML)을 MD로 변환',
      docx: 'DOCX를 MD로 변환',
      pptx: 'PPTX를 MD로 변환',
      xlsx: '엑셀(XLSX)을 MD로 변환',
      xls: '엑셀(XLS)을 MD로 변환',
      ppt: 'PPT를 MD로 변환',
      doc: 'DOC를 MD로 변환',
      png: '이미지를 MD로 변환 (OCR)',
      jpg: '이미지를 MD로 변환 (OCR)',
      jpeg: '이미지를 MD로 변환 (OCR)',
    };
    return (
      titles[file.extension.toLowerCase() as keyof typeof titles] ||
      'MD로 변환'
    );
  }

  private async convertFile(
    file: TFile,
    options?: ConvertOptions
  ): Promise<boolean> {
    const converter = this.getConverterFor(file);
    this.activeConversions++;
    try {
      return await converter.convert(this.app, this.settings, file, options);
    } catch (error) {
      console.error(`Conversion failed for ${file.path}:`, error);
      return false;
    } finally {
      this.activeConversions--;
    }
  }

  private addCommands() {
    this.addCommand({
      id: 'marker-convert-to-md',
      name: 'MD로 변환',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || !this.isValidFile(activeFile)) return false;

        if (checking) return true;

        this.convertFile(activeFile);
      },
    });

    // 이미 존재하는 노트에도 성경 구절 wikilink 변환을 적용할 수 있는 명령
    this.addCommand({
      id: 'convert-bible-links-in-note',
      name: '현재 노트의 성경 구절을 wikilink로 변환',
      editorCallback: (editor) => {
        const before = editor.getValue();
        const after = convertBibleReferences(before);
        if (before === after) {
          new Notice('변환할 성경 구절이 없습니다');
          return;
        }
        const added =
          (after.match(/\[\[/g)?.length ?? 0) -
          (before.match(/\[\[/g)?.length ?? 0);
        editor.setValue(after);
        new Notice(`성경 구절 wikilink ${added}개 변환 완료`);
      },
    });
  }

  async onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** 설정 화면의 Mistral "연결 테스트" 단추 */
  public async testConnection(silent: boolean | undefined): Promise<boolean> {
    return this.mistralConverter.testConnection(this.settings, silent);
  }
}
