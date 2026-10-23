import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { GuardedSheets, type Closable } from '../../core/forms/guarded-sheets';
import { UiConfirm } from '../../ui/confirm';
import { CookingConversionSheet } from './cooking-conversion-sheet';
import type { Conversion } from './cooking-conversion.models';
import type { EditorLine } from './recipe.models';

/** The conversion a line is to be weighed cooked through, for the editor to apply. */
export interface CookingChoice {
  readonly lineKey: string;
  readonly conversion: Conversion;
}

/**
 * The recipe editor's sheet for weighing a raw food cooked (audit INV-6). It asks before it closes with
 * a conversion half typed, however it is closed, and hands the editor the conversion chosen or saved.
 */
@Component({
  selector: 'app-recipe-cooking-sheets',
  imports: [CookingConversionSheet, UiConfirm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: none' },
  template: `
    <ng-template #conversionSheet let-sheet>
      @if (line(); as current) {
        @if (current.food; as food) {
          <app-cooking-conversion-sheet
            [food]="food"
            [current]="current.cooked"
            [locale]="locale()"
            (dirtyChange)="dirty = $event"
            (closed)="closedWith($event, sheet)"
          />
        }
      }
    </ng-template>

    <ng-template #confirmTemplate let-dialog>
      @if (asking(); as question) {
        <app-confirm
          [message]="question.message"
          [confirmLabel]="question.confirm"
          [cancelLabel]="question.cancel"
          (answer)="dialog.close($event)"
        />
      }
    </ng-template>
  `,
})
export class RecipeCookingSheets extends GuardedSheets {
  readonly locale = input<string>('en');
  /** A conversion was chosen or saved for a line. */
  readonly chosen = output<CookingChoice>();

  private readonly conversionSheet = viewChild.required<TemplateRef<unknown>>('conversionSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmTemplate');
  protected readonly line = signal<EditorLine | null>(null);

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  /**
   * Opens the sheet for a line whose raw food is to be weighed cooked, or weighed through another conversion,
   * titled as the button that opened it; the sheet names the food first.
   */
  weighCooked(line: EditorLine): void {
    if (!line.food) return;
    this.line.set(line);
    this.show(
      this.conversionSheet(),
      line.cooked ? $localize`Change conversion` : $localize`Weigh it cooked`,
    );
  }

  /** Closes the sheet at once, asking nothing: the recipe it was opened over is no longer on screen. */
  close(): void {
    this.closeSheets();
  }

  protected closedWith(conversion: Conversion | null, sheet: Closable): void {
    if (conversion === null) return void this.closeAsking(sheet);
    const line = this.line();
    this.dirty = false;
    sheet.close(true);
    if (line) this.chosen.emit({ lineKey: line.key, conversion });
  }
}
