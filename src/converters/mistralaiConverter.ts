import { App, Notice, TFile } from 'obsidian';
import { Mistral } from '@mistralai/mistralai';
import { MarkerSettings } from '../settings';
import { BaseConverter, ConversionResult } from '../converter';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';
import { deleteOriginalFile, checkForExistingFiles } from '../utils/fileUtils';
import { OCRPageObject } from '@mistralai/mistralai/models/components';

export class MistralAIConverter extends BaseConverter {
  async convert(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<boolean> {
    const folderPath = await this.prepareConversion(settings, file);
    if (!folderPath) return false;

    if (!(await checkForExistingFiles(app, folderPath, file))) {
      return true;
    }

    if (!settings.mistralaiApiKey) {
      new Notice('오류: MistralAI API 키가 설정되지 않았습니다');
      console.error('Missing MistralAI API key in settings');
      return false;
    }

    new Notice('MistralAI OCR로 파일을 변환하는 중...', 4000);

    const client = new Mistral({ apiKey: settings.mistralaiApiKey });
    let uploadedFileId: string | undefined;

    try {
      // Read the file content
      const fileContent = await app.vault.readBinary(file);

      // Upload the file to MistralAI
      new Notice('MistralAI에 파일 업로드 중...', 2000);
      const fileUpload = await client.files.upload({
        file: {
          fileName: file.name,
          content: fileContent,
        },
        purpose: 'ocr',
      });

      if (!fileUpload || !fileUpload.id) {
        new Notice('MistralAI에 파일을 업로드하지 못했습니다');
        return false;
      }

      uploadedFileId = fileUpload.id;

      const signedUrl = await client.files.getSignedUrl({
        fileId: uploadedFileId,
      });

      // Set includeImageBase64 based on the extractContent setting
      const includeImages = settings.extractContent !== 'text';

      const imageLimit =
        (settings.imageLimit ?? 0) > 0 ? settings.imageLimit : undefined;

      // Add image min size if set
      const imageMinSize =
        (settings.imageMinSize ?? 0) > 0 ? settings.imageMinSize : undefined;

      const ocrResponse = await client.ocr.process({
        model: 'mistral-ocr-latest',
        document: {
          type: 'document_url',
          documentUrl: signedUrl.url,
        },
        includeImageBase64: includeImages,
        imageLimit: imageLimit,
        imageMinSize: imageMinSize,
      });

      if (!ocrResponse || !ocrResponse.pages) {
        new Notice('OCR 처리에 실패했습니다');
        return false;
      }

      // Parse OCR results
      const conversionResult = this.parseOCRResults(
        ocrResponse.pages,
        settings.extractContent
      );

      // Process the conversion result
      const ok = await this.processConversionResult(
        app,
        settings,
        conversionResult,
        folderPath,
        file
      );

      if (!ok) return false;

      new Notice('MistralAI OCR 변환이 완료되었습니다');
      return true;
    } catch (error) {
      console.error('MistralAI conversion error:', error.message, error.stack);
      new Notice(
        `MistralAI 변환 실패: ${
          error.message || '네트워크 또는 서버 오류'
        }`
      );
      return false;
    } finally {
      if (
        settings.deleteFileFromMistralaiAfterConversion &&
        uploadedFileId
      ) {
        try {
          const deleteResult = await client.files.delete({
            fileId: uploadedFileId,
          });

          if (!deleteResult?.deleted) {
            console.warn(
              `MistralAI file deletion returned non-deleted status for file ${uploadedFileId}`,
              deleteResult
            );
            new Notice(
              '경고: MistralAI에 업로드된 파일이 삭제되지 않았을 수 있습니다.'
            );
          }
        } catch (cleanupError) {
          console.error(
            `Failed to delete uploaded MistralAI file ${uploadedFileId}:`,
            cleanupError
          );
          new Notice(
            '경고: 변환 후 MistralAI에서 업로드 파일을 삭제하지 못했습니다.'
          );
        }
      }
    }
  }

  private parseOCRResults(
    pages: OCRPageObject[],
    extractContent = 'all'
  ): ConversionResult {
    try {
      // Combine all pages into a single markdown string
      let markdown = '';
      const images: { [key: string]: string } = {};

      // Process each page
      pages.forEach((page, index) => {
        // Add page separator if paginate is enabled (we'll check in processConversionResult)
        if (index > 0) {
          markdown += '\n\n---\n\n';
        }

        // Only include text content if extractContent isn't set to 'images'
        if (extractContent !== 'images') {
          // Add page content
          markdown += page.markdown || '';
        }

        // Only process images if extractContent isn't set to 'text'
        if (
          extractContent !== 'text' &&
          page.images &&
          page.images.length > 0
        ) {
          page.images.forEach((image) => {
            // Create unique image name with page number prefix
            const imageName = image.id;

            // Strip the data URL prefix if it exists
            let base64Data = image.imageBase64 || '';
            if (base64Data.startsWith('data:')) {
              // Remove the prefix (e.g., 'data:image/jpeg;base64,')
              base64Data = base64Data.split(',')[1];
            }

            images[imageName] = base64Data;
          });
        }
      });

      return {
        success: true,
        markdown,
        images,
        metadata: {
          page_count: pages.length,
          processor: 'mistralai-ocr',
        },
      };
    } catch (error) {
      console.error('Error parsing OCR results:', error);
      return {
        success: false,
        error: `Failed to parse OCR results: ${error.message}`,
      };
    }
  }

  async testConnection(
    settings: MarkerSettings,
    silent: boolean | undefined
  ): Promise<boolean> {
    if (!settings.mistralaiApiKey) {
      if (!silent) new Notice('오류: MistralAI API 키가 설정되지 않았습니다');
      return false;
    }

    try {
      // Initialize MistralAI client
      const client = new Mistral({ apiKey: settings.mistralaiApiKey });

      // Make a simple API call to test the connection
      // We'll just list the models to see if the API key is valid and the connection is successful
      const response = await client.files.list();

      if (response) {
        if (!silent) new Notice('MistralAI 연결 성공!');
        return true;
      }

      if (!silent) new Notice('MistralAI API 연결 오류');
      return false;
    } catch (error) {
      if (!silent) {
        new Notice(`MistralAI API 연결 오류: ${error.message}`);
      }
      console.error('Error connecting to MistralAI API:', error);
      return false;
    }
  }

  getConverterSettings(): ConverterSettingDefinition[] {
    return [
      {
        id: 'mistralaiApiKey',
        name: 'MistralAI API 키',
        description: 'MistralAI API 키를 입력하세요',
        type: 'text',
        placeholder: 'API 키',
        defaultValue: '',
        buttonText: '연결 테스트',
        buttonAction: async (app, settings) => {
          await this.testConnection(settings, false);
        },
      },
      {
        id: 'deleteFileFromMistralaiAfterConversion',
        name: '변환 후 MistralAI 파일 삭제',
        description:
          '변환이 끝난 뒤 MistralAI에 업로드된 파일을 삭제합니다.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        id: 'imageLimit',
        name: '이미지 개수 제한',
        description: '추출할 이미지 최대 개수 (0이면 제한 없음)',
        type: 'text',
        placeholder: '0',
        defaultValue: '0',
        onChange: async (value, settings) => {
          const numValue = value ? parseInt(value) : 0;
          settings.imageLimit = isNaN(numValue) ? 0 : numValue;
        },
      },
      {
        id: 'imageMinSize',
        name: '이미지 최소 크기',
        description:
          '추출할 이미지의 최소 가로·세로 크기 (0이면 제한 없음)',
        type: 'text',
        placeholder: '0',
        defaultValue: '0',
        onChange: async (value, settings) => {
          const numValue = value ? parseInt(value) : 0;
          settings.imageMinSize = isNaN(numValue) ? 0 : numValue;
        },
      },
      {
        id: 'paginate',
        name: '페이지 구분선',
        description: '각 페이지 사이에 가로줄을 추가합니다',
        type: 'toggle',
        defaultValue: false,
      },
    ];
  }
}
