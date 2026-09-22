import { ChangeDetectionStrategy, Component, contentChild, input } from '@angular/core';
import { Control } from './field';

/**
 * Form/Checkbox: a projected native `<input type="checkbox" appControl>` followed by its visible
 * label. The label is associated through `for`/`id` and spans the rest of the row, so the text and
 * the space around it toggle the box. The box sits in a 32px first-line slot: a one-line row is
 * exactly 32px with the text centred, and a wrapped label grows downward with the box on line one.
 * Space toggles; Enter does not. A group of related checkboxes belongs in a fieldset with a legend.
 */
@Component({
  selector: 'app-checkbox',
  template: `<ng-content /><label
      class="tb-checkbox__label"
      [attr.for]="control()?.controlId() ?? null"
      >{{ label() }}</label
    >`,
  host: { class: 'tb-checkbox' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checkbox {
  readonly label = input.required<string>();

  protected readonly control = contentChild(Control);
}
