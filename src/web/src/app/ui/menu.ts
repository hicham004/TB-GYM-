import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Icon, type IconName } from './icon';

/** One choice in a menu; the page handles it when it is `chosen`. */
export interface UiMenuItem {
  label: string;
  /** A short line under the label, for a choice whose name alone is not enough. */
  hint?: string;
  action: string;
  /** Listed but not available right now; the hint says why. Choosing it does nothing. */
  disabled?: boolean;
  /** Removes something: drawn in the danger colour. */
  danger?: boolean;
}

let nextId = 0;

/**
 * Surfaces/Menu: the secondary actions of a card or a row behind one button (plan §2 rule 5). A
 * disclosure menu, as on the client's page: the button says whether it is open, focus moves into
 * the list, the arrow keys, Home and End move through it, and Escape or leaving it closes it and
 * gives focus back to the button. With `icon` the button shows only that glyph and `label` becomes
 * its accessible name, so name the thing it acts on ("More for week 2").
 */
@Component({
  selector: 'app-menu',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'closeFromKeyboard($event)', '(keydown)': 'moveFocus($event)' },
  template: `
    <div class="menu" (focusout)="closeOnFocusOut($event)">
      @if (icon(); as glyph) {
        <button
          #trigger
          class="tb-icon-button trigger-icon"
          type="button"
          [disabled]="disabled()"
          [attr.aria-label]="label()"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="panelId"
          (click)="toggle()"
        >
          <app-icon [name]="glyph" />
        </button>
      } @else {
        <button
          #trigger
          type="button"
          [class]="variant() === 'chip' ? 'chip' : 'tb-button tb-button--outlined'"
          [class.selected]="selected()"
          [disabled]="disabled()"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="panelId"
          (click)="toggle()"
        >
          <span>{{ label() }}</span>
          <app-icon name="chevron-down" />
        </button>
      }
      @if (open()) {
        <ul class="panel" [class.start]="(align() === 'start') !== flipped()" [id]="panelId">
          @for (item of items(); track item.action) {
            <li>
              <button
                class="item"
                type="button"
                [class.danger]="item.danger"
                [class.current]="current() === item.action"
                [attr.aria-current]="current() === item.action ? 'true' : null"
                [attr.aria-disabled]="item.disabled ? 'true' : null"
                (click)="choose(item)"
              >
                <span class="item-title">{{ item.label }}</span>
                @if (item.hint) {
                  <span class="item-hint">{{ item.hint }}</span>
                }
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-block;
    }

    .menu {
      position: relative;
    }

    .trigger-icon {
      block-size: 2.25rem;
      inline-size: 2.25rem;
    }

    .chip {
      align-items: center;
      background: var(--tb-surface);
      border: 1px solid var(--tb-line-strong);
      border-radius: 999px;
      color: var(--tb-ink);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-size: 0.875rem;
      font-weight: 500;
      gap: 0.25rem;
      min-block-size: 2.5rem;
      padding: 0.25rem 0.625rem 0.25rem 0.875rem;
    }

    .chip:hover {
      border-color: var(--tb-ink);
    }

    .chip:focus-visible {
      outline: 2px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .chip.selected {
      background: var(--tb-brand);
      border-color: var(--tb-brand);
      color: var(--tb-on-brand);
      font-weight: 700;
    }

    .chip:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .panel {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card-small);
      box-shadow: var(--tb-shadow-overlay);
      box-sizing: border-box;
      inline-size: max-content;
      inset-block-start: calc(100% + 0.25rem);
      inset-inline-end: 0;
      list-style: none;
      margin: 0;
      max-inline-size: min(18rem, calc(100vw - 2rem));
      min-inline-size: min(12rem, calc(100vw - 2rem));
      // A long list (fifteen muscles) scrolls inside the menu instead of off the screen.
      max-block-size: min(24rem, 70dvh);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0.375rem;
      position: absolute;
      z-index: 40;
    }

    .panel.start {
      inset-inline-end: auto;
      inset-inline-start: 0;
    }

    .item {
      background: none;
      border: 0;
      border-radius: 8px;
      box-sizing: border-box;
      color: var(--tb-ink);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      font: inherit;
      inline-size: 100%;
      min-block-size: 2.5rem;
      justify-content: center;
      padding: 0.5rem 0.75rem;
      text-align: start;
    }

    .item:hover {
      background: var(--tb-surface-2);
    }

    .item.danger .item-title {
      color: var(--tb-danger);
    }

    // The choice in effect, as a filter chip's menu marks it.
    .item.current {
      background: var(--tb-accent-soft);
    }

    .item[aria-disabled='true'] {
      cursor: not-allowed;
    }

    .item[aria-disabled='true']:hover {
      background: none;
    }

    .item[aria-disabled='true'] .item-title {
      color: var(--tb-muted);
    }

    .item:focus-visible {
      outline: 2px solid var(--tb-focus);
      outline-offset: -2px;
    }

    .item-title {
      font-size: 0.9375rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .item-hint {
      color: var(--tb-muted);
      font-size: 0.8125rem;
      overflow-wrap: anywhere;
    }
  `,
})
export class UiMenu {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  /** The button's text, or with `icon` its accessible name. */
  readonly label = input.required<string>();
  readonly items = input.required<readonly UiMenuItem[]>();
  readonly icon = input<IconName | null>(null);
  /** Which edge of the button the list lines up with; the end suits a button at a row's end. */
  readonly align = input<'start' | 'end'>('end');
  /** `chip` draws the button as a filter pill (the exercise library's filters), filled when `selected`. */
  readonly variant = input<'button' | 'chip'>('button');
  readonly selected = input(false);
  /** The button cannot open the menu, as while the change it offers is still being saved. */
  readonly disabled = input(false);
  /** The `action` of the item in effect, marked in the list. */
  readonly current = input<string | null>(null);
  /** The `action` of the item chosen, once the menu has closed and focus is back on the button. */
  readonly chosen = output<string>();
  protected readonly open = signal(false);
  /** The list opens from the button's other edge, because the usual one would leave the screen. */
  protected readonly flipped = signal(false);
  protected readonly panelId = `tb-menu-${nextId++}`;

  /** Puts focus back on the button, for a page whose chosen action removed what had focus. */
  focus(): void {
    this.trigger().nativeElement.focus();
  }

  protected toggle(): void {
    const opening = !this.open();
    this.flipped.set(false);
    this.open.set(opening);
    if (opening) {
      afterNextRender(
        () => {
          this.keepOnScreen();
          this.itemElements()[0]?.focus();
        },
        { injector: this.injector },
      );
    }
  }

  /**
   * A list that would run past the screen's edge opens from the button's other edge instead, as a
   * filter chip near the end of a row on a phone needs. Read once, when the list opens.
   */
  private keepOnScreen(): void {
    const panel = this.host.nativeElement.querySelector<HTMLElement>('.panel');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const width = this.host.nativeElement.ownerDocument.documentElement.clientWidth;
    if (rect.left < 0 || rect.right > width) this.flipped.set(true);
  }

  /**
   * Focus goes back to the button first, so whatever the page opens next (a sheet) returns focus to
   * a button that still exists once the menu has closed.
   */
  protected choose(item: UiMenuItem): void {
    if (item.disabled) return;
    this.open.set(false);
    this.trigger().nativeElement.focus();
    this.chosen.emit(item.action);
  }

  protected closeFromKeyboard(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  protected closeOnFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (this.open() && !this.host.nativeElement.contains(next)) this.open.set(false);
  }

  protected moveFocus(event: KeyboardEvent): void {
    const items = this.itemElements();
    if (!this.open() || items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const target =
      event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : event.key === 'ArrowUp'
          ? (current - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : -1;
    if (target < 0) return;
    event.preventDefault();
    items[target].focus();
  }

  private itemElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.item'));
  }
}
