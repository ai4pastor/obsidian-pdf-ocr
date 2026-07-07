import { App, Notice, TFile, MarkdownView } from 'obsidian';
import { Mistral } from '@mistralai/mistralai';
import { MarkerSettings } from '../settings';
import { BaseConverter, ConversionResult, ConvertOptions } from '../converter';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';
import { deleteOriginalFile, checkForExistingFiles } from '../utils/fileUtils';
import { OCRPageObject } from '@mistralai/mistralai/models/components';

// 지정 MD 파일에 Templater 템플릿을 적용
async function applyTemplaterTemplate(
  app: App,
  templatePath: string,
  targetPath: string
): Promise<void> {
  const templater = (app as any).plugins?.plugins?.['templater-obsidian'];
  if (!templater) {
    new Notice('Templater 플러그인이 설치돼 있지 않습니다');
    return;
  }

  const templateFile = app.vault.getAbstractFileByPath(templatePath);
  const targetFile = app.vault.getAbstractFileByPath(targetPath);
  if (!(templateFile instanceof TFile)) {
    new Notice(`템플릿 파일을 찾을 수 없습니다: ${templatePath}`);
    return;
  }
  if (!(targetFile instanceof TFile)) {
    new Notice(`대상 MD 파일을 찾을 수 없습니다: ${targetPath}`);
    return;
  }

  try {
    // 템플릿이 tp.file.content 등을 읽으려면 대상 파일이 활성 파일이어야 함
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(targetFile);

    const api = templater.templater;
    if (typeof api?.append_template_to_active_file === 'function') {
      await api.append_template_to_active_file(templateFile);
    } else if (typeof api?.write_template_to_file === 'function') {
      await api.write_template_to_file(templateFile, targetFile);
    } else {
      new Notice('Templater API 호출 방식을 찾을 수 없습니다');
    }
  } catch (error: any) {
    console.error('Templater 적용 오류:', error);
    new Notice(`템플릿 적용 실패: ${error?.message || error}`);
  }
}

// Mistral OCR 업로드 제한 (공식 문서: 50MB / 1,000페이지)
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// Mistral API 오류를 사용자용 한국어 메시지로 변환
function translateMistralError(error: any): string {
  const rawMessage: string = error?.message || '';
  const status: number | undefined =
    error?.statusCode ??
    error?.status ??
    (rawMessage.match(/Status (\d{3})/)
      ? parseInt(rawMessage.match(/Status (\d{3})/)![1])
      : undefined);

  switch (status) {
    case 401:
      return 'API 키가 올바르지 않습니다. 설정에서 MistralAI API 키를 확인해주세요.';
    case 402:
      return 'MistralAI 크레딧이 부족합니다. console.mistral.ai에서 결제 상태를 확인해주세요.';
    case 403:
      return 'API 접근이 거부되었습니다. 키 권한을 확인해주세요.';
    case 413:
      return '파일이 너무 큽니다 (최대 50MB).';
    case 422:
      return '파일 형식을 처리할 수 없습니다. 파일이 손상되지 않았는지 확인해주세요.';
    case 429:
      return '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
    case 500:
    case 502:
    case 503:
      return 'MistralAI 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.';
  }
  if (/fetch|network|ENOTFOUND|ECONN|timeout/i.test(rawMessage)) {
    return '네트워크 연결을 확인해주세요.';
  }
  return rawMessage || '네트워크 또는 서버 오류';
}

export class MistralAIConverter extends BaseConverter {
  async convert(
    app: App,
    settings: MarkerSettings,
    file: TFile,
    options?: ConvertOptions
  ): Promise<boolean> {
    const folderPath = await this.prepareConversion(settings, file);
    if (!folderPath) return false;

    // 일괄 변환에서 덮어쓰기를 이미 확인받았으면 파일별 다이얼로그 생략
    if (!options?.overwriteExisting) {
      if (!(await checkForExistingFiles(app, folderPath, file))) {
        return true;
      }
    }

    if (!settings.mistralaiApiKey) {
      new Notice('오류: MistralAI API 키가 설정되지 않았습니다');
      console.error('Missing MistralAI API key in settings');
      return false;
    }

    // 업로드 전에 크기 제한 확인 — API 오류보다 먼저 한국어로 안내
    if (file.stat.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (file.stat.size / 1024 / 1024).toFixed(1);
      new Notice(
        `변환 실패: ${file.name} — 파일이 50MB 제한을 초과합니다 (현재 ${sizeMB}MB)`
      );
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

      // 이미지 파일은 image_url, 문서(pdf/docx/pptx 등)는 document_url로 전달
      const isImageFile = ['png', 'jpg', 'jpeg'].includes(
        file.extension.toLowerCase()
      );

      // 오피스 문서는 이미지를 base64로만 반환 가능 —
      // base64 미포함 요청 시 imageLimit=0을 명시하지 않으면 API가 400을 반환함
      const isOfficeFile = ['docx', 'doc', 'pptx', 'ppt'].includes(
        file.extension.toLowerCase()
      );
      const effectiveImageLimit =
        isOfficeFile && !includeImages ? 0 : imageLimit;

      const ocrResponse = await client.ocr.process({
        model: 'mistral-ocr-latest',
        document: isImageFile
          ? {
              type: 'image_url',
              imageUrl: signedUrl.url,
            }
          : {
              type: 'document_url',
              documentUrl: signedUrl.url,
            },
        includeImageBase64: includeImages,
        imageLimit: effectiveImageLimit,
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
        file,
        options
      );

      if (!ok) return false;

      // 템플릿 자동 적용 (Templater 플러그인 사용)
      if (settings.templaterTemplate) {
        await applyTemplaterTemplate(
          app,
          settings.templaterTemplate,
          folderPath + file.basename + '.md'
        );
      }

      new Notice('MistralAI OCR 변환이 완료되었습니다');
      return true;
    } catch (error) {
      console.error('MistralAI conversion error:', error.message, error.stack);
      new Notice(`MistralAI 변환 실패: ${translateMistralError(error)}`);
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
        new Notice(`MistralAI API 연결 오류: ${translateMistralError(error)}`);
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
