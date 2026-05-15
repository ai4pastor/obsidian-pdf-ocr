import { App, PluginSettingTab, Setting, TFile } from 'obsidian';
import Marker from './main';
import { renderConverterSettings } from './utils/converterSettingsUtils';

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
};

export class MarkerSettingTab extends PluginSettingTab {
  plugin: Marker;
  constructor(app: App, plugin: Marker) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Mistral 고정 (다른 엔드포인트는 비활성화)
    if (this.plugin.settings.apiEndpoint !== 'mistralai') {
      this.plugin.settings.apiEndpoint = 'mistralai';
      this.plugin.saveSettings();
    }

    containerEl.createEl('h3', { text: 'MistralAI 설정' });

    // MistralAI API 키 입력 + 두 개 버튼 (연결 테스트 + 키 발급 링크)
    new Setting(containerEl)
      .setName('MistralAI API 키')
      .setDesc(
        'MistralAI API 키를 입력하세요. 무료 발급 가능합니다.'
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
    if (this.plugin.converter) {
      renderConverterSettings(
        containerEl,
        this.app,
        this.plugin.converter,
        this.plugin.settings,
        async () => await this.plugin.saveSettings(),
        ['mistralaiApiKey']
      );
    }

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

    // setting for whether the original pdf should be deleted after conversion
    new Setting(containerEl)
      .setName('원본 PDF 삭제')
      .setDesc('변환 후 원본 PDF를 삭제합니다.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deleteOriginal)
          .onChange(async (value) => {
            this.plugin.settings.deleteOriginal = value;
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
          `OCR 변환이 끝난 MD 파일에 자동 적용할 Templater 템플릿. (폴더: ${templaterFolder})`
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

    // Initialize settings state
    updateMovePDFSetting(this.plugin.settings.createFolder);
    updateWriteMetadataSetting(this.plugin.settings.extractContent);
  }
}
