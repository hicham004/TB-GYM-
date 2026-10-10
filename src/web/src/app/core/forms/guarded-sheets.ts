import { DestroyRef, Directive, inject, signal, type TemplateRef } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UiDialog } from '../../ui/dialog';
import { UiSheet } from '../../ui/sheet';
import { UiToast } from '../../ui/toast';

/** The sheet a template is given as `let-sheet`. */
export interface Closable {
  close(result?: unknown): void;
}

/**
 * Opens a page's sheets one at a time and keeps the plan §9 promise (R5.3d): a sheet holding typed
 * work asks before it closes, whichever way it is closed (the close button, Escape, the backdrop or
 * its own Not now), and one that saved says so in a toast. A page's host component extends this, holds
 * the sheets' templates, and gives the template of its confirmation dialog.
 */
@Directive()
export abstract class GuardedSheets {
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  protected readonly toast = inject(UiToast);

  /** The question the confirmation dialog is asking now; its template shows it. */
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );
  /** Whether the open sheet holds something typed that closing would lose. */
  protected dirty = false;
  private open: { close: () => void } | null = null;

  /** The host's `<ng-template>` that holds `<app-confirm>` for `asking()`. */
  protected abstract confirmDialog(): TemplateRef<unknown>;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.open?.close());
  }

  protected show(content: TemplateRef<unknown>, title: string): void {
    this.open?.close();
    this.dirty = false;
    const sheet = this.sheets.open<unknown>(content, {
      title,
      closeLabel: $localize`Close`,
      canClose: () => this.canClose(),
    });
    this.open = sheet;
    sheet.closed.subscribe(() => {
      if (this.open === sheet) this.open = null;
      this.dirty = false;
    });
  }

  /** The close button, Escape, the backdrop and Not now all ask the same question. */
  protected canClose(): boolean | Promise<boolean> {
    return (
      !this.dirty ||
      this.ask(
        $localize`Close without saving? What you typed will be lost.`,
        $localize`Close`,
        $localize`Keep editing`,
        $localize`Discard what you typed?`,
      )
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
    this.asking.set({ message, confirm, cancel });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title,
      closeLabel: $localize`Close`,
    });
    const answer = await firstValueFrom(dialog.closed);
    this.asking.set(null);
    return answer === true;
  }
}
