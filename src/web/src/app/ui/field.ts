import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  Directive,
  ElementRef,
  inject,
  input,
} from '@angular/core';

/** Standard / 40 for forms, dialogs and toolbars; Compact / 32 only in dense editors and grids. */
export type FieldDensity = 'standard' | 'compact';

let nextControlId = 0;

/** Merges space-separated id lists in order, without duplicates; null when nothing is left. */
function mergeIdLists(...lists: (string | null | undefined)[]): string | null {
  const ids = lists.flatMap((list) => (list ?? '').split(/\s+/)).filter((id) => id.length > 0);
  return ids.length > 0 ? [...new Set(ids)].join(' ') : null;
}

/**
 * Styles a native `<input>`, `<select>` or `<textarea>` (or a checkbox inside `<app-checkbox>`) and
 * wires it to the surrounding `<app-field>`. It adds no value accessor: `formControlName`,
 * `[formControl]` and `ngModel` keep binding to the native element exactly as before.
 *
 * The directive owns `id`, `aria-invalid` and `aria-describedby`, so do not bind
 * `[attr.aria-describedby]` or `[attr.aria-invalid]` on the same element. Pass extra descriptions
 * (a character counter, a row-level message) through `aria-describedby="…"` or
 * `[aria-describedby]="…"`: they are merged after the field's help or error, never overwritten or
 * duplicated.
 */
@Directive({
  selector: 'input[appControl], select[appControl], textarea[appControl]',
  host: {
    '[id]': 'controlId()',
    '[class.tb-control]': '!isCheckbox',
    '[class.tb-select]': "kind === 'select'",
    '[class.tb-textarea]': "kind === 'textarea'",
    '[class.tb-control--compact]': "!isCheckbox && resolvedDensity() === 'compact'",
    '[class.tb-checkbox-input]': 'isCheckbox',
    '[attr.aria-invalid]': "invalid() ? 'true' : null",
    '[attr.aria-describedby]': 'describedBy()',
  },
})
export class Control {
  private readonly field = inject(Field, { optional: true });
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly generatedId = `tb-control-${++nextControlId}`;

  protected readonly kind = this.element.tagName.toLowerCase();
  // Read once: a checkbox's type is a static attribute, set before any directive is created.
  protected readonly isCheckbox =
    this.element instanceof HTMLInputElement && this.element.type === 'checkbox';

  /** The consumer's id wins; otherwise a unique generated id that labels and messages point at. */
  readonly id = input<string>();
  /** Overrides the field's density, for a standalone control. */
  readonly density = input<FieldDensity>();
  /** The consumer's own descriptions, kept alongside the field's help or error. */
  readonly ariaDescribedby = input<string | null>(null, { alias: 'aria-describedby' });

  readonly controlId = computed(() => this.id() || this.generatedId);
  protected readonly resolvedDensity = computed(
    () => this.density() ?? this.field?.density() ?? 'standard',
  );
  protected readonly invalid = computed(() => this.field?.showsError() ?? false);
  protected readonly describedBy = computed(() =>
    mergeIdLists(this.field?.descriptionId(), this.ariaDescribedby()),
  );
}

/**
 * Label → native control → supporting text, stacked on the block axis (Form/Text field, Select and
 * Text area). The label is a real `<label for>`; help and error share one slot, and an error
 * replaces the help, so the error sentence must restate any constraint the help gave.
 *
 * The field does not decide when a message is due. Pass only the messages that should show now —
 * `attempt.shows(field, messages)` from core/forms/form-attempt.ts — so the text, `aria-invalid`
 * and `aria-describedby` all follow one expression. Messages render as plain text, never
 * `role="alert"`: the form's single submit summary is the only assertive region.
 */
@Component({
  selector: 'app-field',
  template: `
    <label
      class="tb-field__label"
      [class.tb-visually-hidden]="hideLabel()"
      [attr.for]="control()?.controlId() ?? null"
      >{{ label() }}</label
    >
    <ng-content />
    @if (showsError()) {
      <p class="tb-field__support tb-field__support--error" [id]="errorId()">
        @for (message of errors() ?? []; track $index) {
          <span class="tb-field__message">{{ message }}</span>
        }
      </p>
    } @else if (help()) {
      <p class="tb-field__support" [id]="helpId()">{{ help() }}</p>
    }
  `,
  host: {
    class: 'tb-field',
    '[class.tb-field--compact]': "density() === 'compact'",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Field {
  readonly label = input.required<string>();
  readonly help = input<string | null>(null);
  /** Messages due on screen now; empty or null means the field is not showing an error. */
  readonly errors = input<readonly string[] | null>(null);
  readonly density = input<FieldDensity>('standard');
  /** Only where a column header or toolbar already names the control; it stays programmatic. */
  readonly hideLabel = input(false, { transform: booleanAttribute });

  protected readonly control = contentChild(Control);

  readonly showsError = computed(() => (this.errors()?.length ?? 0) > 0);
  protected readonly helpId = computed(() => `${this.control()?.controlId() ?? 'tb-field'}-help`);
  protected readonly errorId = computed(() => `${this.control()?.controlId() ?? 'tb-field'}-error`);
  /** The one description the control currently points at: the error if showing, else the help. */
  readonly descriptionId = computed(() =>
    this.showsError() ? this.errorId() : this.help() ? this.helpId() : null,
  );
}
