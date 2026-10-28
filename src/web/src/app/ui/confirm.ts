import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Button } from './button';
import { ModalFooter } from './modal-footer';

/**
 * A yes-or-no question inside a kit Dialog: one sentence of what will happen, the safe answer as
 * text and the one that acts filled, as the program dialogs already do ("Keep program" beside
 * "Cancel program"). It is the kit's leave confirmation (plan §9) and serves
 * any other "are you sure" a page asks. The page opens it in its own dialog template and passes
 * `answer` to the dialog's `close`, so the dialog resolves to true, false, or nothing when the
 * coach closes it, which counts as the safe answer. The answers sit in the dialog's footer.
 */
@Component({
  selector: 'app-confirm',
  imports: [Button, ModalFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="message" dir="auto">{{ message() }}</p>
    <ng-template appModalFooter>
      <div class="actions">
        <button appButton type="button" variant="text" (click)="answer.emit(false)">
          {{ cancelLabel() }}
        </button>
        <button appButton type="button" (click)="answer.emit(true)">{{ confirmLabel() }}</button>
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .message {
      color: var(--tb-ink);
      margin: 0;
      overflow-wrap: anywhere;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: flex-end;
    }
  `,
})
export class UiConfirm {
  readonly message = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly cancelLabel = input.required<string>();
  readonly answer = output<boolean>();
}
