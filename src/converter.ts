import { App, Notice, TFile, TFolder } from 'obsidian';
import { MarkerSettings } from './settings';
import { ConverterSettingDefinition } from './utils/converterSettingsUtils';

export interface ConversionResult {
  markdown?: string;
  images?: { [key: string]: string };
  metadata?: { [key: string]: any };
  success: boolean;
  error?: string;
}

// 일괄 변환 시 개별 파일 동작 제어
export interface ConvertOptions {
  // 덮어쓰기를 이미 일괄로 확인받았으면 true — 파일별 확인 다이얼로그 생략
  overwriteExisting?: boolean;
  // 변환 후 생성된 노트를 열지 여부 (일괄 변환에서는 false)
  openAfterConversion?: boolean;
}

export interface Converter {
  convert(
    app: App,
    settings: MarkerSettings,
    file: TFile,
    options?: ConvertOptions
  ): Promise<boolean>;
  testConnection(settings: MarkerSettings, silent?: boolean): Promise<boolean>;
  getConverterSettings(): ConverterSettingDefinition[]; // New method
}

import {
  addMetadataToMarkdownFile,
  createConversionFolder,
  createImageFiles,
  createMarkdownFile,
  deleteOriginalFile,
  getConversionFolderPath,
} from './utils/fileUtils';
import { checkSettings } from './utils/settingsUtils';

export abstract class BaseConverter implements Converter {
  abstract convert(
    app: App,
    settings: MarkerSettings,
    file: TFile,
    options?: ConvertOptions
  ): Promise<boolean>;

  abstract testConnection(
    settings: MarkerSettings,
    silent?: boolean
  ): Promise<boolean>;

  abstract getConverterSettings(): ConverterSettingDefinition[];

  protected async prepareConversion(
    settings: MarkerSettings,
    file: TFile
  ): Promise<string | null> {
    if (!checkSettings(settings)) {
      return null;
    }

    const connectionResult = await this.testConnection(settings, true);
    if (!connectionResult) {
      return null;
    }

    return getConversionFolderPath(file);
  }

  protected async processConversionResult(
    app: App,
    settings: MarkerSettings,
    data: ConversionResult,
    folderPath: string,
    originalFile: TFile,
    options?: ConvertOptions
  ): Promise<boolean> {
    try {
      if (!data || !data.success) {
        new Notice(`변환 실패: ${data?.error || '알 수 없는 오류'}`);
        return false;
      }

      await createConversionFolder(app, folderPath);

      // Process content based on settings
      if (settings.extractContent !== 'images' && data.markdown) {
        await createMarkdownFile(
          app,
          settings,
          data.markdown,
          folderPath,
          originalFile,
          options?.openAfterConversion ?? true
        );
      }

      if (
        settings.extractContent !== 'text' &&
        data.images &&
        Object.keys(data.images).length > 0
      ) {
        let imageFolderPath = folderPath;
        if (settings.createAssetSubfolder) {
          const subfolderPath = folderPath + originalFile.basename;
          if (
            !(app.vault.getAbstractFileByPath(subfolderPath) instanceof TFolder)
          ) {
            await app.vault.createFolder(subfolderPath);
          }
          imageFolderPath = subfolderPath + '/';
        }
        await createImageFiles(
          app,
          settings,
          data.images,
          imageFolderPath,
          originalFile
        );
      }

      // Process metadata if requested
      if (settings.writeMetadata && data.metadata) {
        await addMetadataToMarkdownFile(
          app,
          data.metadata,
          folderPath,
          originalFile
        );
      }

      // Handle original file based on settings
      if (settings.movePDFtoFolder) {
        try {
          const newFilePath = folderPath + originalFile.name;
          await app.vault.rename(originalFile, newFilePath);
        } catch (error) {
          console.error(
            `Failed to move original file to folder: ${error.message}`,
            error
          );
          new Notice('오류: 원본 파일을 대상 폴더로 이동하지 못했습니다');
        }
      }

      if (settings.deleteOriginal) {
        await deleteOriginalFile(app, originalFile);
      }
      return true;
    } catch (error) {
      console.error(
        'Failed to process conversion result:',
        error.message,
        error.stack
      );
      new Notice(
        `오류: 변환 결과 처리 실패 - ${
          error.message || '알 수 없는 오류'
        }`
      );
      return false;
    }
  }
}
