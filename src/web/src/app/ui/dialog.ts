import { DOCUMENT } from '@angular/common';
import { Dialog as CdkDialog, DialogRef } from '@angular/cdk/dialog';
import { inject, Injectable, TemplateRef } from '@angular/core';
import { ModalData, modalDirection, ModalOptions, ModalSurface } from './modal-surface';

let nextDialogId = 0;

/** Opens a centred modal. The template receives its `DialogRef` as `let-dialog`. */
@Injectable({ providedIn: 'root' })
export class UiDialog {
  private readonly cdkDialog = inject(CdkDialog);
  private readonly document = inject(DOCUMENT);

  open<R = unknown>(
    content: TemplateRef<unknown>,
    options: ModalOptions,
  ): DialogRef<R, ModalSurface> {
    const id = `tb-dialog-${++nextDialogId}`;
    const data: ModalData = {
      content,
      title: options.title,
      titleId: `${id}-title`,
      closeLabel: options.closeLabel ?? 'Close',
    };

    return this.cdkDialog.open<R, ModalData, ModalSurface>(ModalSurface, {
      id,
      data,
      role: 'dialog',
      ariaModal: true,
      ariaLabelledBy: data.titleId,
      autoFocus: 'first-heading',
      restoreFocus: true,
      hasBackdrop: true,
      backdropClass: 'tb-modal-backdrop',
      panelClass: ['tb-modal-pane', 'tb-modal-pane--dialog'],
      direction: modalDirection(this.document, options.direction),
      width: 'min(28rem, calc(100vw - 2rem))',
      maxHeight: 'calc(100dvh - 2rem)',
      closeOnNavigation: true,
    });
  }
}
