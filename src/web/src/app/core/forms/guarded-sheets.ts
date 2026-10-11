import { protectSheetEdits } from './sheet-exit-protection';
import type { DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Directive, inject, signal, type TemplateRef } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UiDialog } from '../../ui/dialog';
import type { ModalSurface } from '../../ui/modal-surface';
import { UiSheet } from '../../ui/sheet';
import { UiToast } from '../../ui/toast';

/** The sheet a template is given as `let-sheet`. */
export interface Closable {
  close(result?: unknown): void;
}

/** What the confirmation asks before typed work is lost. */
export interface LeaveQuestion {
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
  readonly cancel: string;
}

/**
 * Opens a page's sheets one at a time and keeps the plan §9 promise (R5.3d): a sheet holding typed
 * work asks before it closes, whichever way it is closed (the close button, Escape, the backdrop or
 * its own Not now), and one that saved says so in a toast. Browser Back, a workspace switch, sign-out
 * and a reload ask the same question (R5.4c: every sheet host shares this one). A page's host component
 * extends this, holds the sheets' templates, and gives the template of its confirmation dialog.
 */
@Directive()
export abstract class GuardedSheets {
  private readonly sheets = inject(UiSheet);
  protected readonly dialogs = inject(UiDialog);
  private leaveDecision: Promise<boolean> | null = null;
  private activeConfirm: { close(): void } | null = null;
  protected readonly toast = inject(UiToast);

  /** The question the confirmation dialog is asking now; its template shows it. */
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );
  /** Whether the open sheet holds something typed that closing would lose. */
  protected dirty = false;
  private openedSheet: { close: () => void } | null = null;

  /** What closing with typed work asks; a host may word it its own way. */
  protected readonly leaveQuestion: LeaveQuestion = {
    title: $localize`Discard what you typed?`,
    message: $localize`Close without saving? What you typed will be lost.`,
    confirm: $localize`Close`,
    cancel: $localize`Keep editing`,
  };

  /** The host's `<ng-template>` that holds `<app-confirm>` for `asking()`. */
  protected abstract confirmDialog(): TemplateRef<unknown>;

  async canLeave(): Promise<boolean> {
    const allowed = await this.canClose();
    if (allowed) this.dirty = false;
    return allowed;
  }

  constructor() {
    protectSheetEdits(
      this,
      () => this.dirty,
      () => this.closeSheets(),
    );
    inject(DestroyRef).onDestroy(() => this.openedSheet?.close());
  }

  /** Opens a sheet in place of any open one; the host may follow its `closed` for the result. */
  protected show<R = unknown>(
    content: TemplateRef<unknown>,
    title: string,
  ): DialogRef<R, ModalSurface> {
    this.openedSheet?.close();
    this.dirty = false;
    const sheet = this.sheets.open<R>(content, {
      title,
      closeLabel: $localize`Close`,
      closeOnNavigation: false,
      canClose: () => this.canClose(),
    });
    this.openedSheet = sheet;
    sheet.closed.subscribe(() => {
      if (this.openedSheet === sheet) this.openedSheet = null;
      this.dirty = false;
    });
    return sheet;
  }

  /** Closes the open sheet and any question at once, without asking: the page is being reset. */
  protected closeSheets(): void {
    this.openedSheet?.close();
    this.activeConfirm?.close();
  }

  /** The close button, Escape, the backdrop and Not now all ask the same question. */
  protected canClose(): boolean | Promise<boolean> {
    const question = this.leaveQuestion;
    return (
      !this.dirty || this.ask(question.message, question.confirm, question.cancel, question.title)
    );
  }

  /** A sheet's own Not now: closes at once when nothing is typed, otherwise asks first. */
  protected async closeAsking(sheet: Closable): Promise<void> {
    if (await this.canClose()) sheet.close(null);
  }

  /** The sheet saved: it closes without asking, and a toast says what happened. */
  protected done(sheet: Closable, message: string): void {
    this.dirty = false;
    sheet.close(true);
    this.toast.show(message, { tone: 'success' });
  }

  protected async ask(
    message: string,
    confirm: string,
    cancel: string,
    title: string,
  ): Promise<boolean> {
    if (this.leaveDecision) return this.leaveDecision;
    this.asking.set({ message, confirm, cancel });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      closeOnNavigation: false,
      title,
      closeLabel: $localize`Close`,
    });
    this.activeConfirm = dialog;
    this.leaveDecision = firstValueFrom(dialog.closed).then((answer) => answer === true);
    const answer = await this.leaveDecision;
    this.leaveDecision = null;
    this.activeConfirm = null;
    this.asking.set(null);
    return answer === true;
  }
}
