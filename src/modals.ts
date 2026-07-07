import { App, Modal } from 'obsidian';

export class MarkerOkayCancelDialog extends Modal {
  result: boolean;
  title: string;
  message: string;
  onSubmit: (result: boolean) => void;

  constructor(
    app: App,
    title: string,
    message: string,
    onSubmit: (result: boolean) => void
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.title = title;
    this.message = message;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', {
      text: this.message,
    });

    const buttonContainer = contentEl.createEl('div', {
      attr: { class: 'modal-button-container' },
    });
    const yesButton = buttonContainer.createEl('button', {
      text: '확인',
      attr: { class: 'mod-cta' },
    });
    yesButton.addEventListener('click', () => {
      this.result = true;
      this.onSubmit(true);
      this.close();
    });
    const noButton = buttonContainer.createEl('button', {
      text: '취소',
    });
    noButton.addEventListener('click', () => {
      this.result = false;
      this.onSubmit(false);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export type BatchOverwriteChoice = 'overwrite' | 'skip' | 'cancel';

// 일괄 변환 시 이미 존재하는 MD 파일 처리를 한 번에 확인
export class MarkerBatchOverwriteDialog extends Modal {
  collisionCount: number;
  onSubmit: (choice: BatchOverwriteChoice) => void;
  private submitted = false;

  constructor(
    app: App,
    collisionCount: number,
    onSubmit: (choice: BatchOverwriteChoice) => void
  ) {
    super(app);
    this.collisionCount = collisionCount;
    this.onSubmit = onSubmit;
  }

  private submit(choice: BatchOverwriteChoice) {
    if (this.submitted) return;
    this.submitted = true;
    this.onSubmit(choice);
    this.close();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: '이미 존재하는 마크다운 파일' });
    contentEl.createEl('p', {
      text: `${this.collisionCount}개 파일은 같은 이름의 MD 파일이 이미 있습니다. 어떻게 처리할까요?`,
    });

    const buttonContainer = contentEl.createEl('div', {
      attr: { class: 'modal-button-container' },
    });
    buttonContainer
      .createEl('button', { text: '모두 덮어쓰기', attr: { class: 'mod-cta' } })
      .addEventListener('click', () => this.submit('overwrite'));
    buttonContainer
      .createEl('button', { text: '해당 파일 건너뛰기' })
      .addEventListener('click', () => this.submit('skip'));
    buttonContainer
      .createEl('button', { text: '취소' })
      .addEventListener('click', () => this.submit('cancel'));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    // 버튼 없이 닫으면(X·ESC) 취소로 처리
    if (!this.submitted) {
      this.submitted = true;
      this.onSubmit('cancel');
    }
  }
}

export class MarkerSupportedLangsDialog extends Modal {
  title: string;
  message: string;
  link: string;
  linkText: string;

  constructor(app: App) {
    super(app);
    this.title = '지원 언어';
    this.message = '지원 언어 목록은 아래 링크에서 확인하세요:';
    this.link =
      'https://github.com/VikParuchuri/surya/blob/master/surya/languages.py';
    this.linkText = '지원 언어 목록 (VikParuchuri/surya)';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', {
      text: this.message,
    });
    contentEl.createEl('a', {
      text: this.linkText,
      attr: { href: this.link },
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
