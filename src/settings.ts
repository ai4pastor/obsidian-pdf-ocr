import { App, PluginSettingTab, Setting } from 'obsidian';
import Marker from './main';
import { renderConverterSettings } from './utils/converterSettingsUtils';

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
  apiEndpoint: 'selfhosted',
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
};

export class MarkerSettingTab extends PluginSettingTab {
  plugin: Marker;
  constructor(app: App, plugin: Marker) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // API endpoint selection (global setting)
    new Setting(containerEl)
      .setName('API 엔드포인트')
      .setDesc('사용할 API 엔드포인트를 선택하세요')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('datalab', 'Datalab')
          .addOption('selfhosted', 'Self-hosted')
          .addOption('python-api', 'Python API')
          .addOption('mistralai', 'MistralAI')
          .setValue(this.plugin.settings.apiEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.apiEndpoint = value;
            await this.plugin.saveSettings();
            this.display(); // Refresh the settings to show appropriate converter settings
          })
      );

    // Add a heading for converter-specific settings
    containerEl.createEl('h3', { text: '변환기 설정' });

    // Render the settings for the current converter
    if (this.plugin.converter) {
      renderConverterSettings(
        containerEl,
        this.app,
        this.plugin.converter,
        this.plugin.settings,
        async () => await this.plugin.saveSettings()
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
      .setDesc('추출된 이미지를 위한 하위 폴더를 만듭니다')
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

    // Initialize settings state
    updateMovePDFSetting(this.plugin.settings.createFolder);
    updateWriteMetadataSetting(this.plugin.settings.extractContent);
  }
}
