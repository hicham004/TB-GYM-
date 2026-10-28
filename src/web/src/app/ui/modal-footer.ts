import {
  DestroyRef,
  Directive,
  inject,
  InjectionToken,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';

/** Where a modal draws the actions its content hands it: its footer, below the body that scrolls. */
export interface ModalFooterSlot {
  show(actions: TemplateRef<unknown>): void;
  hide(actions: TemplateRef<unknown>): void;
}

/** Given by `ModalSurface` to its content alone, so nothing outside a modal finds a footer. */
export const MODAL_FOOTER_SLOT = new InjectionToken<ModalFooterSlot>('MODAL_FOOTER_SLOT');

let nextFormId = 0;

/**
 * A sheet's or dialog's actions (critique B2a): written once at the end of its content as
 * `<ng-template appModalFooter>` and drawn by the modal in its footer, outside the body that scrolls,
 * so they stay in view and never cover the body's last line. Write it after the form, not inside it:
 * a submit button there names its form (`[attr.form]="formId"`, the form `[id]="formId"`, from
 * `modalFormId`), as it must in the footer. Outside a modal (a component's own spec, the UI lab) the
 * actions stay where they are written. A modal shows one footer, the one drawn last.
 */
@Directive({ selector: 'ng-template[appModalFooter]' })
export class ModalFooter {
  constructor() {
    const actions = inject<TemplateRef<unknown>>(TemplateRef);
    const slot = inject(MODAL_FOOTER_SLOT, { optional: true });
    if (!slot) {
      inject(ViewContainerRef).createEmbeddedView(actions);
      return;
    }
    slot.show(actions);
    inject(DestroyRef).onDestroy(() => slot.hide(actions));
  }
}

/** An id no other form on the page has, for the submit button a modal's footer holds. */
export function modalFormId(name: string): string {
  return `${name}-${++nextFormId}`;
}
