import { App, Notice, Platform, TFile } from 'obsidian';
import { BaseConverter, ConvertOptions } from '../converter';
import { MarkerSettings } from '../settings';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';
import { checkForExistingFiles, getConversionFolderPath } from '../utils/fileUtils';
import { checkSettings } from '../utils/settingsUtils';
import { applyTemplaterTemplate } from '../utils/templater';
import { captureGlobals, restoreGlobals } from './globalsGuard';
import type { OcrSupport } from './ocr/types';

/** 로컬 엔진이 변환하는 형식 */
export const LOCAL_DOCUMENT_EXTENSIONS = ['pdf', 'hwp', 'hwpx', 'hml', 'docx', 'pptx', 'xlsx', 'xls'];
export const LOCAL_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg'];
/** 옛 오피스 형식 — 로컬 변환 불가, 다시 저장 안내 */
export const LEGACY_OFFICE_EXTENSIONS = ['doc', 'ppt'];
/** 이보다 큰 파일은 변환 전에 "시간이 걸린다"고 알린다 */
const LARGE_FILE_MB = 30;

type EngineModule = typeof import('./engine');
let enginePromise: Promise<EngineModule> | null = null;

/**
 * 무거운 엔진(kordoc·pdf.js·OCR)은 처음 변환할 때 한 번만 불러온다.
 * 번들한 pdf.js 가 불러오는 순간 덮어쓰는 전역(pdfjsLib·pdfjsWorker)은 곧바로 원래대로 돌려놓는다.
 */
export function loadLocalEngine(): Promise<EngineModule> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const saved = captureGlobals();
      try {
        return await import('./engine');
      } finally {
        restoreGlobals(saved);
      }
    })();
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

/** 설정 화면의 "OCR 점검" 단추용 */
export async function checkLocalOcr(): Promise<OcrSupport> {
  const engine = await loadLocalEngine();
  return engine.getOcrSupport(true);
}

const nextFrame = () => new Promise<void>((resolve) => window.setTimeout(resolve, 30));

export class LocalConverter extends BaseConverter {
  async convert(
    app: App,
    settings: MarkerSettings,
    file: TFile,
    options?: ConvertOptions
  ): Promise<boolean> {
    if (!Platform.isDesktopApp) {
      new Notice(
        '로컬 변환은 PC(맥·윈도우)에서만 됩니다. 휴대폰·태블릿에서는 설정에서 Mistral 엔진을 고르거나 PC에서 변환해 주세요.'
      );
      return false;
    }

    const extension = file.extension.toLowerCase();
    if (LEGACY_OFFICE_EXTENSIONS.includes(extension)) {
      new Notice(
        `${file.name}: 옛 형식(.${extension})은 로컬 변환을 지원하지 않습니다. ` +
          `${extension === 'doc' ? '워드' : '파워포인트'}에서 .${extension}x 로 다시 저장한 뒤 변환해 주세요.`,
        8000
      );
      return false;
    }

    if (!checkSettings(settings)) return false;
    const folderPath = await getConversionFolderPath(file);

    // 일괄 변환에서 덮어쓰기를 이미 확인받았으면 파일별 다이얼로그 생략
    if (!options?.overwriteExisting) {
      if (!(await checkForExistingFiles(app, folderPath, file))) {
        return true;
      }
    }

    // 큰 파일은 컴퓨터 안에서 처리하는 동안 옵시디언이 잠깐씩 멈출 수 있다(225쪽·144MB 책 PDF 실측 약 20초)
    const sizeMB = file.stat.size / 1024 / 1024;
    if (sizeMB > LARGE_FILE_MB) {
      new Notice(
        `${file.name}: 큰 파일(${Math.round(sizeMB)}MB)이라 변환에 시간이 걸리고, 그동안 옵시디언이 잠깐씩 멈출 수 있습니다.`,
        8000
      );
    }

    const status = new Notice(`${file.name} 변환 준비 중…`, 0);
    const setStatus = (message: string) => status.setMessage(`${file.name} — ${message}`);
    try {
      await nextFrame(); // 안내 문구가 먼저 그려지게
      const engine = await loadLocalEngine();
      const bytes = await app.vault.readBinary(file);
      const result = await engine.convertLocally(bytes, {
        extension,
        settings,
        onStatus: setStatus,
      });

      if (!result.success) {
        new Notice(`변환 실패: ${file.name} — ${result.error || '알 수 없는 오류'}`, 8000);
        return false;
      }

      const ok = await this.processConversionResult(app, settings, result, folderPath, file, options);
      if (!ok) return false;

      for (const note of result.notes) new Notice(note, 8000);

      if (settings.templaterTemplate) {
        await applyTemplaterTemplate(app, settings.templaterTemplate, folderPath + file.basename + '.md');
      }
      return true;
    } catch (error) {
      console.error(`[A4P 문서 변환] ${file.path} 로컬 변환 오류:`, error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`변환 실패: ${file.name} — ${message}`, 8000);
      return false;
    } finally {
      status.hide();
    }
  }

  async testConnection(): Promise<boolean> {
    return true; // 로컬 엔진은 연결할 서버가 없다
  }

  getConverterSettings(): ConverterSettingDefinition[] {
    return [];
  }
}
