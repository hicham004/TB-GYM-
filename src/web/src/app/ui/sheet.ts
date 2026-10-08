import { DOCUMENT } from '@angular/common';
import { Dialog as CdkDialog, DialogRef } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { inject, Injectable, TemplateRef } from '@angular/core';
import {
  guardClose,
  guardedConfig,
  ModalData,
  modalDirection,
  modalPaneClasses,
  ModalOptions,
  ModalSurface,
} from './modal-surface';

let nextSheetId = 0;

/** Opens a bottom anchored sheet with the same keyboard and focus contract as a dialog. */
@Injectable({ providedIn: 'root' })
export class UiSheet {
  private readonly cdkDialog = inject(CdkDialog);
  private readonly overlay = inject(Overlay);
  private readonly document = inject(DOCUMENT);

  open<R = unknown>(
    content: TemplateRef<unknown>,
    options: ModalOptions,
  ): DialogRef<R, ModalSurface> {
    const id = `tb-sheet-${++nextSheetId}`;
    const data: ModalData = {
      content,
      title: options.title,
      titleId: `${id}-title`,
      closeLabel: options.closeLabel ?? 'Close',
    };

    const ref = this.cdkDialog.open<R, ModalData, ModalSurface>(ModalSurface, {
      id,
      data,
      role: 'dialog',
      ariaModal: true,
      ariaLabelledBy: data.titleId,
      autoFocus: options.initialFocus ?? 'first-heading',
      restoreFocus: true,
      hasBackdrop: true,
      backdropClass: 'tb-modal-backdrop',
      panelClass: modalPaneClasses('sheet', options),
      direction: modalDirection(this.document, options.direction),
      positionStrategy: this.overlay.position().global().centerHorizontally().bottom('0'),
      width: '100vw',
      maxWidth: '40rem',
      maxHeight: '90dvh',
      closeOnNavigation: true,
      ...guardedConfig(options),
    });
    guardClose(ref, data, options.canClose);
    return ref;
  }
}
