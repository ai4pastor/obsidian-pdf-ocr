import {
  AbstractInputSuggest,
  App,
  Notice,
  Platform,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
} from 'obsidian';
import Marker from './main';
import { renderConverterSettings } from './utils/converterSettingsUtils';
import { checkLocalOcr } from './local/localConverter';

// 텍스트 입력란에 볼트 폴더 경로 자동완성을 붙이는 서제스트
class FolderSuggest extends AbstractInputSuggest<TFolder> {
  private textInputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.textInputEl = inputEl;
    // AbstractInputSuggest 는 타이핑할 때만 목록을 띄운다 — 빈 칸을 클릭만 해도 전체 폴더가 보이도록 input 을 한 번 흘린다
    inputEl.addEventListener('focus', () => {
      inputEl.dispatchEvent(new Event('input'));
    });
  }

  getSuggestions(query: string): TFolder[] {
    const lowerQuery = query.toLowerCase();
    return this.app.vault
      .getAllLoadedFiles()
      .filter(
        (f): f is TFolder =>
          f instanceof TFolder && f.path !== '/' // 볼트 루트는 감시 대상에서 제외
      )
      .filter((f) => f.path.toLowerCase().includes(lowerQuery))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 50);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement) {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder) {
    this.textInputEl.value = folder.path;
    this.textInputEl.trigger('input'); // onChange 발화 → 설정 저장
    this.close();
  }
}

// Templater 플러그인이 설정한 템플릿 폴더 경로 반환 (없으면 null)
function getTemplaterFolder(app: App): string | null {
  const templater = (app as any).plugins?.plugins?.['templater-obsidian'];
  if (!templater) return null;
  const folder = templater.settings?.templates_folder;
  return folder && folder.trim() ? folder.trim() : null;
}

// 지정 폴더 안의 모든 .md 파일 경로 목록 (재귀)
function listMarkdownFiles(app: App, folderPath: string): string[] {
  const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
  return app.vault
    .getFiles()
    .filter((f: TFile) => f.extension === 'md' && f.path.startsWith(prefix))
    .map((f: TFile) => f.path)
    .sort();
}

export interface MarkerSettings {
  markerEndpoint: string;
  pythonEndpoint: string;
  createFolder: boolean;
  deleteOriginal: boolean;
  extractContent: string;
  writeMetadata: boolean;
  movePDFtoFolder: boolean;
  createAssetSubfolder: boolean;
  apiEndpoint: string;
  apiKey?: string; // Keep for backward compatibility and selfhosted/python-api
  datalabApiKey?: string; // Specific key for Datalab
  mistralaiApiKey?: string; // Specific key for MistralAI
  langs?: string;
  forceOCR?: boolean;
  paginate?: boolean;
  // New Datalab API parameters
  maxPages?: number;
  stripExistingOCR?: boolean;
  useLLM?: boolean;
  skipCache?: boolean;
  // MistralAI parameters
  imageLimit?: number;
  imageMinSize?: number; // Minimum height and width of images to extract
  deleteFileFromMistralaiAfterConversion?: boolean;
  // 변환 후 적용할 Templater 템플릿 (vault 상대 경로, 예: "Templates/WORD분류.md")
  templaterTemplate?: string;
  // 본문에서 성경 구절을 [[책장_절]] 위키링크로 자동 변환
  bibleLinkConvert?: boolean;
  // 감시 폴더 — 이 폴더에 새 파일이 들어오면 자동 변환 (빈 값이면 사용 안 함)
  watchFolder?: string;
  // 변환 엔진 — local: 컴퓨터 안에서 변환(kordoc, 무료·오프라인) / mistral: Mistral OCR API(유료)
  conversionEngine?: 'local' | 'mistral';
  // 로컬 엔진: 스캔본 쪽·그림 파일을 컴퓨터 내장 OCR(맥 Apple Vision·윈도우 OCR)로 읽기
  ocrEnabled?: boolean;
  // 로컬 엔진: PDF 쪽마다 반복되는 머리글·바닥글(쪽 번호 등) 지우기
  removeHeaderFooter?: boolean;
}

export const DEFAULT_SETTINGS: MarkerSettings = {
  markerEndpoint: 'localhost:8000',
  pythonEndpoint: 'localhost:8001',
  createFolder: false,
  deleteOriginal: false,
  extractContent: 'all',
  writeMetadata: false,
  movePDFtoFolder: false,
  createAssetSubfolder: true,
  apiEndpoint: 'mistralai',
  apiKey: '',
  datalabApiKey: '',
  mistralaiApiKey: '',
  langs: 'en',
  forceOCR: false,
  paginate: false,
  // Default values for new parameters
  maxPages: undefined,
  stripExistingOCR: false,
  useLLM: false,
  skipCache: false,
  imageLimit: 0,
  imageMinSize: 0, // Default to 0 (no minimum size)
  deleteFileFromMistralaiAfterConversion: false,
  templaterTemplate: '',
  bibleLinkConvert: true,
  watchFolder: '',
  conversionEngine: 'local',
  ocrEnabled: true,
  removeHeaderFooter: false,
};

export class MarkerSettingTab extends PluginSettingTab {
  plugin: Marker;
  constructor(app: App, plugin: Marker) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    const engine = this.plugin.settings.conversionEngine ?? 'local';

    // ── 변환 엔진 ──
    containerEl.createEl('h3', { text: '변환 엔진' });

    new Setting(containerEl)
      .setName('변환 엔진')
      .setDesc(
        '로컬: HWP·HWPX·PDF·DOCX·PPTX·XLSX를 이 컴퓨터 안에서 변환합니다. 무료이고 인터넷·API 키가 필요 없습니다. ' +
          'Mistral: 유료 API로 변환합니다(스캔본 품질이 가장 좋음, API 키 필요).'
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption('local', '로컬 (무료·오프라인, 추천)')
          .addOption('mistral', 'Mistral API (유료)')
          .setValue(engine)
          .onChange(async (value) => {
            this.plugin.settings.conversionEngine = value === 'mistral' ? 'mistral' : 'local';
            await this.plugin.saveSettings();
            this.display(); // 엔진별 설정 다시 그리기
          })
      );

    if (engine === 'local') {
      this.renderLocalEngineSettings(containerEl);
    } else {
      this.renderMistralSettings(containerEl);
    }

    this.renderGeneralSettings(containerEl);
  }

  // ── 로컬 엔진 설정 ──
  private renderLocalEngineSettings(containerEl: HTMLElement): void {
    if (!Platform.isDesktopApp) {
      containerEl.createEl('p', {
        text: '이 기기(휴대폰·태블릿)에서는 로컬 변환을 쓸 수 없습니다. PC에서 변환하거나 Mistral 엔진을 고르세요.',
        attr: { style: 'color: var(--text-error); font-size: 0.9em;' },
      });
    }

    const ocrLabel = Platform.isMacOS
      ? 'Apple Vision(맥 내장)'
      : Platform.isWin
      ? '윈도우 내장 OCR(베타)'
      : '내장 OCR 없음';

    new Setting(containerEl)
      .setName('스캔본·사진 글자 인식(OCR)')
      .setDesc(
        `글자층이 없는 PDF 쪽(스캔본)과 그림 파일(png·jpg)을 이 컴퓨터의 내장 OCR로 읽습니다. 이 컴퓨터: ${ocrLabel}. ` +
          '설치할 것은 없습니다. 윈도우는 한국어 "광학 문자 인식" 언어 기능이 있어야 합니다.'
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.ocrEnabled ?? true).onChange(async (value) => {
          this.plugin.settings.ocrEnabled = value;
          await this.plugin.saveSettings();
        })
      )
      .addButton((btn) =>
        btn.setButtonText('OCR 점검').onClick(async () => {
          if (!Platform.isDesktopApp) {
            new Notice('이 기기에서는 내장 OCR을 쓸 수 없습니다');
            return;
          }
          btn.setDisabled(true);
          btn.setButtonText('점검 중…');
          try {
            const support = await checkLocalOcr();
            new Notice(support.message, 10000);
          } catch (error) {
            new Notice(`OCR 점검 실패: ${error instanceof Error ? error.message : String(error)}`, 10000);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText('OCR 점검');
          }
        })
      );

    new Setting(containerEl)
      .setName('PDF 머리글·바닥글 지우기')
      .setDesc('PDF 쪽마다 반복되는 머리글·바닥글(쪽 번호, 문서 제목 등)을 빼고 본문만 남깁니다.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.removeHeaderFooter ?? false).onChange(async (value) => {
          this.plugin.settings.removeHeaderFooter = value;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl('p', {
      text: '옛 형식(.doc·.ppt)은 로컬로 변환할 수 없습니다 — 워드·파워포인트에서 .docx·.pptx로 다시 저장해 주세요.',
      attr: { style: 'color: var(--text-muted); font-size: 0.9em;' },
    });
  }

  // ── Mistral 설정 ──
  private renderMistralSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'MistralAI 설정' });
    containerEl.createEl('p', {
      text: 'HWP·HWPX·엑셀 파일은 Mistral이 지원하지 않아 항상 로컬로 변환합니다.',
      attr: { style: 'color: var(--text-muted); font-size: 0.9em;' },
    });

    // MistralAI API 키 입력 + 두 개 버튼 (연결 테스트 + 키 발급 링크)
    new Setting(containerEl)
      .setName('MistralAI API 키')
      .setDesc(
        'MistralAI API 키를 입력하세요. 유료 API입니다(console.mistral.ai에서 결제·발급).'
      )
      .addText((text) =>
        text
          .setPlaceholder('API 키')
          .setValue(this.plugin.settings.mistralaiApiKey || '')
          .onChange(async (value) => {
            this.plugin.settings.mistralaiApiKey = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText('연결 테스트')
          .onClick(async () => {
            await this.plugin.testConnection(false);
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText('API 키 발급')
          .setCta()
          .onClick(() => {
            window.open('https://console.mistral.ai/api-keys', '_blank');
          })
      );

    // Render the rest of converter settings (API 키는 위에서 직접 처리했으므로 중복 표시 회피)
    renderConverterSettings(
      containerEl,
      this.app,
      this.plugin.mistralConverter,
      this.plugin.settings,
      async () => await this.plugin.saveSettings(),
      ['mistralaiApiKey']
    );
  }

  // ── 일반 설정 · 템플릿 · 감시 폴더 (모든 엔진 공통) ──
  private renderGeneralSettings(containerEl: HTMLElement): void {
    const usesMistral = this.plugin.settings.conversionEngine === 'mistral';

    // Add a heading for general settings
    containerEl.createEl('h3', { text: '일반 설정' });

    // // setting for how to bundle the pdf (options are new folder for each pdf or everything in the current folder)
    // const createFolderSetting = new Setting(containerEl)
    // 	.setName('New folder for each PDF')
    // 	.setDesc('Create a new folder for each PDF that is converted.')
    // 	.addToggle((toggle) =>
    // 		toggle
    // 			.setValue(this.plugin.settings.createFolder)
    // 			.onChange(async (value) => {
    // 				this.plugin.settings.createFolder = value;
    // 				await this.plugin.saveSettings();
    // 				updateMovePDFSetting(value);
    // 			})
    // 	);

    // setting for whether to move the pdf to the folder
    const movePDFToggle = new Setting(containerEl)
      .setName('PDF를 폴더로 이동')
      .setDesc('변환 후 원본 PDF를 결과 폴더로 이동합니다')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.movePDFtoFolder)
          .onChange(async (value) => {
            this.plugin.settings.movePDFtoFolder = value;
            await this.plugin.saveSettings();
          })
      );

    // setting for whether to create an asset subfolder
    new Setting(containerEl)
      .setName('이미지 하위 폴더 생성')
      .setDesc('PDF와 같은 이름의 하위 폴더를 만들어 추출된 이미지를 모아둡니다')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createAssetSubfolder)
          .onChange(async (value) => {
            this.plugin.settings.createAssetSubfolder = value;
            await this.plugin.saveSettings();
          })
      );

    // setting for which content to extract from the pdf
    new Setting(containerEl)
      .setName('추출할 콘텐츠')
      .setDesc('PDF에서 어떤 내용을 추출할지 선택합니다')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('all', '전체 추출')
          .addOption('text', '텍스트만')
          .addOption('images', '이미지만')
          .setValue(this.plugin.settings.extractContent)
          .onChange(async (value) => {
            this.plugin.settings.extractContent = value;
            await this.plugin.saveSettings();
            updateWriteMetadataSetting(value);
          })
      );

    // setting for whether to write metadata as frontmatter in the markdown file
    const writeMetadataToggle = new Setting(containerEl)
      .setName('메타데이터 기록')
      .setDesc('마크다운 파일에 frontmatter로 메타데이터를 기록합니다')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.writeMetadata)
          .onChange(async (value) => {
            this.plugin.settings.writeMetadata = value;
            await this.plugin.saveSettings();
          })
      );

    // setting for whether the original file should be deleted after conversion
    new Setting(containerEl)
      .setName('원본 파일 삭제')
      .setDesc('변환 후 원본 파일(PDF·DOCX·이미지 등)을 삭제합니다.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deleteOriginal)
          .onChange(async (value) => {
            this.plugin.settings.deleteOriginal = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('성경 구절 자동 wikilink')
      .setDesc(
        '본문의 성경 구절을 [[책장_절]] 형식으로 자동 변환합니다. 예: "창세기 1장 1절" → [[창1_1]] (범위는 개별 절로 분해, 절이 없는 장 인용은 패스)'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.bibleLinkConvert ?? true)
          .onChange(async (value) => {
            this.plugin.settings.bibleLinkConvert = value;
            await this.plugin.saveSettings();
          })
      );

    // Helper function to update the state of the 'Move PDF to Folder' setting
    const updateMovePDFSetting = (createFolderEnabled: boolean) => {
      this.plugin.settings.movePDFtoFolder =
        this.plugin.settings.movePDFtoFolder && createFolderEnabled;
      movePDFToggle.settingEl.toggle(createFolderEnabled);
    };

    // Helper function to update the state of the 'Write Metadata' setting
    const updateWriteMetadataSetting = (extractContent: string) => {
      const canWriteMetadata =
        extractContent === 'all' || extractContent === 'text';
      this.plugin.settings.writeMetadata =
        this.plugin.settings.writeMetadata && canWriteMetadata;
      writeMetadataToggle.settingEl.toggle(canWriteMetadata);
    };

    // ── Templater 템플릿 자동 적용 ──
    containerEl.createEl('h3', { text: '변환 후 템플릿 적용' });

    const templaterFolder = getTemplaterFolder(this.app);
    if (!templaterFolder) {
      containerEl.createEl('p', {
        text: 'Templater 플러그인이 설치/활성화돼 있지 않거나 템플릿 폴더가 설정되지 않았습니다. Templater 플러그인 설정에서 "Template folder location"을 먼저 지정하세요.',
        attr: { style: 'color: var(--text-muted); font-size: 0.9em;' },
      });
    } else {
      const templates = listMarkdownFiles(this.app, templaterFolder);
      new Setting(containerEl)
        .setName('변환 후 적용할 템플릿')
        .setDesc(
          `변환이 끝난 MD 파일에 자동 적용할 Templater 템플릿. (폴더: ${templaterFolder})`
        )
        .addDropdown((dropdown) => {
          dropdown.addOption('', '사용 안 함');
          templates.forEach((path) => dropdown.addOption(path, path));
          dropdown
            .setValue(this.plugin.settings.templaterTemplate || '')
            .onChange(async (value) => {
              this.plugin.settings.templaterTemplate = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // ── 감시 폴더 자동 변환 ──
    containerEl.createEl('h3', { text: '감시 폴더 자동 변환' });

    new Setting(containerEl)
      .setName('감시 폴더')
      .setDesc(
        '이 폴더 바로 안에 새 파일(HWP·PDF·DOCX·이미지 등)이 들어오면 자동으로 MD 변환과 템플릿 적용까지 실행합니다. ' +
          (usesMistral
            ? 'Mistral 엔진은 파일을 넣는 즉시 API 요금이 발생하니 주의하세요. '
            : '') +
          '비워두면 사용하지 않습니다.'
      )
      .addText((text) => {
        text
          .setPlaceholder('예: inbox/ocr')
          .setValue(this.plugin.settings.watchFolder || '')
          .onChange(async (value) => {
            this.plugin.settings.watchFolder = value.trim();
            await this.plugin.saveSettings();
          });
        // 폴더 경로 자동완성 — 클릭/입력 시 볼트 폴더 목록 제안
        new FolderSuggest(this.app, text.inputEl);
      })
      .addButton((btn) =>
        btn.setButtonText('검증').onClick(() => {
          const folderPath = (this.plugin.settings.watchFolder || '')
            .trim()
            .replace(/^\/+|\/+$/g, '');
          if (!folderPath) {
            new Notice('감시 폴더가 비어 있습니다 (사용 안 함)');
            return;
          }
          const folder = this.app.vault.getAbstractFileByPath(folderPath);
          if (!(folder instanceof TFolder)) {
            new Notice(`폴더를 찾을 수 없습니다: ${folderPath}`);
            return;
          }
          const convertible = folder.children.filter(
            (child): child is TFile => child instanceof TFile && this.plugin.isConvertible(child)
          ).length;
          new Notice(
            `✓ 폴더 확인: ${folderPath} — 지금 들어 있는 변환 가능 파일 ${convertible}개 ` +
              '(이미 있던 파일은 자동 변환하지 않고, 새로 들어오는 파일만 변환합니다)',
            8000
          );
        })
      );

    // Initialize settings state
    updateMovePDFSetting(this.plugin.settings.createFolder);
    updateWriteMetadataSetting(this.plugin.settings.extractContent);
  }
}
