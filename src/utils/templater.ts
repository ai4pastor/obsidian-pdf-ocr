import { App, Notice, TFile } from 'obsidian';

/** 지정 MD 파일에 Templater 템플릿을 적용 (모든 변환 엔진 공통) */
export async function applyTemplaterTemplate(
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
