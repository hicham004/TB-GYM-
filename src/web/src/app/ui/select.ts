import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import type { FieldDensity } from './field';
import { Icon } from './icon';

/** One choice in the kit's select. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** A second line under the label, for a choice its name alone does not tell apart. */
  readonly hint?: string;
  /** Listed but not available now; choosing it does nothing. */
  readonly disabled?: boolean;
}

/** A select's options from a fixed list of values and the words for each. */
export function selectOptions<T extends string>(
  values: readonly T[],
  label: (value: T) => string,
): SelectOption[] {
  return values.map((value) => ({ value, label: label(value) }));
}

/** How long typed letters keep adding up before the next one starts a new search. */
export const TYPEAHEAD_PAUSE_MS = 500;
/** How far Page Up and Page Down move. */
const PAGE_STEP = 10;

let nextId = 0;

/**
 * Form/Select (plan §2 rule 8, audit A14a: no browser-drawn picker on a screen). A field whose button
 * names the choice and opens the options under it as a list. The list sits in the flow of the page,
 * as the date field's calendar does, so a sheet can never clip it and it never runs off a phone.
 *
 * The value is the chosen option's `value`, or `''` for none (the button then says `placeholder`).
 * Bind it either as a signal, `[(value)]`, or with `formControlName` / `[formControl]` / `ngModel`,
 * which it serves as a control value accessor, not both. The page labels it like any field and shows
 * its own messages through `errors`, as `app-field` does. With nothing to choose the button stays in
 * the tab order, marked unavailable, so a refused form can still bring focus to it.
 *
 * Keyboard, as in the W3C select-only combobox: on the button, Down or Up open the list on the chosen
 * option, Home and End on the first or last, and a typed letter on the next option it begins; in the
 * list the arrow keys, Home, End, Page Up and Page Down move, typed letters jump, Enter or Space
 * chooses, Escape closes and puts focus back on the button, and Tab moves on with nothing changed.
 * A press outside the field closes the list; a press on its own button or label closes it too and
 * never opens it again in the same gesture, whatever the browser does with focus.
 */
@Component({
  selector: 'app-select',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiSelect), multi: true }],
  host: {
    class: 'tb-field',
    '[class.tb-field--compact]': "density() === 'compact'",
    '(keydown.escape)': 'closeFromKeyboard($event)',
    '(focusout)': 'closeOnFocusOut($event)',
  },
  template: `
    <label
      class="tb-field__label"
      [id]="labelId"
      [attr.for]="triggerId"
      (mousedown)="holdFocus($event)"
      >{{ label() }}</label
    >
    <button
      #trigger
      type="button"
      class="tb-control trigger"
      [class.tb-control--compact]="density() === 'compact'"
      [class.touch]="size() === 'touch'"
      [id]="triggerId"
      [disabled]="isDisabled()"
      aria-haspopup="listbox"
      [attr.aria-disabled]="isEmpty() && !isDisabled() ? 'true' : null"
      [attr.aria-labelledby]="labelId + ' ' + valueId"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-invalid]="showsError() ? 'true' : null"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? listId : null"
      (mousedown)="holdFocus($event)"
      (click)="toggle()"
      (keydown)="openWithKeys($event)"
    >
      <span class="value" [id]="valueId" [class.empty]="!chosen()">{{
        chosen()?.label ?? placeholder()
      }}</span>
      <app-icon class="chevron" name="chevron-down" />
    </button>
    @if (showsError()) {
      <p class="tb-field__support tb-field__support--error" [id]="errorId">
        @for (message of errors() ?? []; track $index) {
          <span class="tb-field__message">{{ message }}</span>
        }
      </p>
    } @else if (help()) {
      <p class="tb-field__support" [id]="helpId">{{ help() }}</p>
    }
    @if (open()) {
      <!-- Focusable itself, so a press in its padding keeps focus inside the field. -->
      <ul
        class="panel"
        role="listbox"
        tabindex="-1"
        [id]="listId"
        [attr.aria-labelledby]="labelId"
        (keydown)="listKeys($event)"
      >
        @for (option of options(); track option.value; let index = $index) {
          <li
            role="option"
            class="option"
            [id]="listId + '-' + index"
            [attr.data-value]="option.value"
            [attr.aria-selected]="option.value === value() ? 'true' : 'false'"
            [attr.aria-disabled]="option.disabled ? 'true' : null"
            [attr.tabindex]="index === activeIndex() ? 0 : -1"
            (click)="choose(index)"
            (keydown)="moveWithKeys($event, index)"
          >
            <span class="option-text">
              <span class="option-label">{{ option.label }}</span>
              @if (option.hint) {
                <span class="option-hint">{{ option.hint }}</span>
              }
            </span>
            @if (option.value === value()) {
              <app-icon name="check" />
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    // The chevron is an icon in the text colour, not the native select's fixed-colour background
    // image, so it follows dark mode and forced colours with the words beside it.
    .trigger {
      align-items: center;
      cursor: pointer;
      display: flex;
      gap: var(--space-8);
      justify-content: space-between;
      // A long choice wraps instead of hiding its end; the chevron stays at the inline end.
      padding-block: var(--space-8);
      padding-inline-end: var(--space-8);
      // A focused select scrolls clear of the sticky action bar a sheet keeps at its foot; a sheet
      // with a taller bar sets the property on the field.
      scroll-margin-block: 0.5rem var(--tb-field-scroll-margin-end, 5.5rem);
      text-align: start;
    }

    .trigger:disabled {
      cursor: not-allowed;
    }

    // Nothing to choose: drawn as unavailable, still focusable.
    .trigger[aria-disabled='true'] {
      background-color: var(--color-surface-subtle);
      border-color: var(--color-border-subtle);
      color: var(--color-text-secondary);
      cursor: not-allowed;
    }

    .chevron {
      transition: transform var(--tb-duration-fast) var(--tb-ease);
    }

    .trigger[aria-expanded='true'] .chevron {
      transform: rotate(180deg);
    }

    @media (prefers-reduced-motion: reduce) {
      .chevron {
        transition: none;
      }
    }

    .trigger.tb-control--compact {
      padding-block: var(--space-4);
      padding-inline-end: var(--space-4);
    }

    // A client's screen: a finger's target, as tall as the fields beside it (plan §2 rule 6).
    .trigger.touch {
      min-block-size: 2.75rem;
    }

    .value {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .value.empty {
      color: var(--tb-muted);
    }

    .panel {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card-small);
      box-shadow: var(--tb-shadow-card);
      box-sizing: border-box;
      display: grid;
      gap: 2px;
      list-style: none;
      margin: 0;
      // A long list (fifteen muscles, a coach's programs) scrolls inside itself.
      max-block-size: min(20rem, 60dvh);
      outline: none;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: var(--space-4);
    }

    .option {
      align-items: center;
      border-radius: 8px;
      color: var(--tb-ink);
      cursor: pointer;
      display: flex;
      gap: var(--space-8);
      justify-content: space-between;
      // A finger's target (plan §2 rule 6), whatever the field's own density.
      min-block-size: 2.75rem;
      padding: var(--space-8) var(--space-12);
      // A focused option scrolls clear of the sticky action bar a sheet keeps at its foot.
      scroll-margin-block: 0.5rem var(--tb-field-scroll-margin-end, 5.5rem);
      touch-action: manipulation;
    }

    .option:hover {
      background: var(--tb-surface-2);
    }

    .option:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: -3px;
    }

    .option[aria-selected='true'] {
      font-weight: 600;
    }

    .option[aria-selected='true'] app-icon {
      color: var(--tb-accent-ink);
    }

    .option[aria-disabled='true'] {
      color: var(--tb-muted);
      cursor: not-allowed;
    }

    .option[aria-disabled='true']:hover {
      background: none;
    }

    .option-text {
      display: grid;
      gap: 2px;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .option-hint {
      color: var(--tb-muted);
      font-size: var(--text-compact-size);
      font-weight: 400;
      line-height: var(--text-compact-line-height);
    }

    @media (forced-colors: active) {
      .option[aria-selected='true'] {
        outline: 2px solid Highlight;
        outline-offset: -2px;
      }
    }
  `,
})
export class UiSelect implements ControlValueAccessor {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  private readonly id = `tb-select-${++nextId}`;
  protected readonly labelId = `${this.id}-label`;
  protected readonly triggerId = `${this.id}-button`;
  protected readonly valueId = `${this.id}-value`;
  protected readonly listId = `${this.id}-list`;
  protected readonly helpId = `${this.id}-help`;
  protected readonly errorId = `${this.id}-error`;

  readonly label = input.required<string>();
  readonly options = input<readonly SelectOption[]>([]);
  /** The chosen option's value, or `''` for none. */
  readonly value = model<string>('');
  /** What the button says while nothing is chosen. */
  readonly placeholder = input($localize`Choose…`);
  readonly help = input<string | null>(null);
  /** Messages due on screen now, as `app-field` takes them. */
  readonly errors = input<readonly string[] | null>(null);
  readonly density = input<FieldDensity>('standard');
  /** `touch` makes the button a finger's target, for the client's own screens. */
  readonly size = input<'standard' | 'touch'>('standard');
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The list was closed or focus left the field: the moment a page may show its messages. */
  readonly touched = output<void>();

  protected readonly open = signal(false);
  /** The option the keyboard is on; the only one in the tab order. */
  protected readonly activeIndex = signal(0);
  private readonly disabledByForm = signal(false);
  private typed = '';
  private typedAt = 0;
  // What a bound form is told; nothing until a form registers.
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected readonly chosen = computed(
    () => this.options().find((option) => option.value === this.value()) ?? null,
  );
  protected readonly isDisabled = computed(() => this.disabled() || this.disabledByForm());
  /** Nothing to open when there is nothing to choose. */
  protected readonly isEmpty = computed(() => this.options().length === 0);
  protected readonly showsError = computed(() => (this.errors()?.length ?? 0) > 0);
  protected readonly describedBy = computed(() =>
    this.showsError() ? this.errorId : this.help() ? this.helpId : null,
  );

  constructor() {
    // While the list is open, a press anywhere outside the field closes it. Listened for only then.
    effect((onCleanup) => {
      if (!this.open()) return;
      const page = this.host.nativeElement.ownerDocument;
      const pressed = (event: Event) => {
        if (event.target instanceof Node && this.host.nativeElement.contains(event.target)) return;
        if (!this.open()) return;
        this.open.set(false);
        this.markTouched();
      };
      page.addEventListener('pointerdown', pressed, true);
      onCleanup(() => page.removeEventListener('pointerdown', pressed, true));
    });
  }

  writeValue(value: unknown): void {
    this.value.set(typeof value === 'string' ? value : value == null ? '' : String(value));
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabledByForm.set(disabled);
    if (disabled) this.open.set(false);
  }

  /** Puts focus on the button, as a page does with the first wrong box. */
  focus(): void {
    this.trigger().nativeElement.focus();
  }

  /**
   * A press on the field's own button or label while the list is open keeps focus where it is, so
   * the browser cannot move it to nothing or to a sheet around the field (WebKit focuses no button
   * on a press) and close the list before the press's click closes it.
   */
  protected holdFocus(event: MouseEvent): void {
    if (this.open()) event.preventDefault();
  }

  protected toggle(): void {
    if (this.open()) {
      this.close(true);
      return;
    }
    if (this.isEmpty()) return;
    const chosen = this.chosenIndex();
    this.show(chosen >= 0 ? chosen : 0);
  }

  /** Keys on the button: the arrows, Home, End and typed letters open the list where they say. */
  protected openWithKeys(event: KeyboardEvent): void {
    if (this.isDisabled() || this.isEmpty() || event.key === ' ' || event.key === 'Enter') return;
    const last = this.options().length - 1;
    const chosen = this.chosenIndex();
    let index: number | null;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        // Back on the button with the list still open (Shift+Tab): the arrows step into it again.
        index = this.open()
          ? this.activeIndex()
          : chosen >= 0
            ? chosen
            : event.key === 'ArrowUp' && !event.altKey
              ? last
              : 0;
        break;
      case 'Home':
        index = 0;
        break;
      case 'End':
        index = last;
        break;
      default:
        index = this.typeahead(event, this.open() ? this.activeIndex() : chosen);
    }
    if (index === null) return;
    event.preventDefault();
    if (this.open()) this.moveTo(index);
    else this.show(index);
  }

  protected choose(index: number): void {
    const option = this.options()[index];
    if (!option || option.disabled) return;
    if (option.value !== this.value()) {
      this.value.set(option.value);
      this.onChange(option.value);
    }
    this.close(true);
  }

  /** Keys that reach the list itself, after a press in its padding: as if on the active option. */
  protected listKeys(event: KeyboardEvent): void {
    if (event.target === event.currentTarget) this.moveWithKeys(event, this.activeIndex());
  }

  protected moveWithKeys(event: KeyboardEvent, index: number): void {
    const last = this.options().length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(index + 1, last);
        break;
      case 'ArrowUp':
        next = Math.max(index - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      case 'PageDown':
        next = Math.min(index + PAGE_STEP, last);
        break;
      case 'PageUp':
        next = Math.max(index - PAGE_STEP, 0);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.choose(index);
        return;
      default: {
        const found = this.typeahead(event, index);
        if (found === null) return;
        next = found;
      }
    }
    event.preventDefault();
    this.moveTo(next);
  }

  protected closeFromKeyboard(event: Event): void {
    if (!this.open()) return;
    // The sheet around the field closes on Escape too; this Escape only closes the list.
    event.stopPropagation();
    event.preventDefault();
    this.close(true);
  }

  /**
   * Focus going to another control closes the list and marks the field left. Focus going to nothing
   * while the list is open is a press, which the press itself settles: inside the field it chooses or
   * closes, outside it the document listener closes the list.
   */
  protected closeOnFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && this.host.nativeElement.contains(next)) return;
    if (!next && this.open()) return;
    this.open.set(false);
    this.markTouched();
  }

  private chosenIndex(): number {
    return this.options().findIndex((option) => option.value === this.value());
  }

  private show(index: number): void {
    this.activeIndex.set(index);
    this.open.set(true);
    afterNextRender(() => this.focusOption(index), { injector: this.injector });
  }

  /**
   * The list is drawn, so the option is there: it takes focus at once, so a key pressed before the
   * next render already starts from it.
   */
  private moveTo(index: number): void {
    this.activeIndex.set(index);
    this.focusOption(index);
  }

  /**
   * The option whose label begins with what was typed in this burst, from the one after `index` (or
   * the first when `index` is -1); a letter pressed again and again steps through the options it
   * begins, as a native select's does. Null when the key is not a letter or nothing begins so.
   */
  private typeahead(event: KeyboardEvent, index: number): number | null {
    const options = this.options();
    if (options.length === 0) return null;
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return null;
    const now = Date.now();
    this.typed = now - this.typedAt > TYPEAHEAD_PAUSE_MS ? event.key : this.typed + event.key;
    this.typedAt = now;
    const typed = this.typed.toLocaleLowerCase();
    const repeated = [...typed].every((letter) => letter === typed[0]);
    const wanted = repeated ? typed[0] : typed;
    const origin = Math.max(index, -1);
    for (let step = repeated || origin < 0 ? 1 : 0; step <= options.length; step++) {
      const candidate = (origin + step) % options.length;
      if (options[candidate].label.toLocaleLowerCase().startsWith(wanted)) return candidate;
    }
    return null;
  }

  private close(refocus: boolean): void {
    this.open.set(false);
    if (refocus) this.trigger().nativeElement.focus();
    this.markTouched();
  }

  private markTouched(): void {
    this.onTouched();
    this.touched.emit();
  }

  private focusOption(index: number): void {
    this.host.nativeElement.querySelector<HTMLElement>(`#${this.listId}-${index}`)?.focus();
  }
}
