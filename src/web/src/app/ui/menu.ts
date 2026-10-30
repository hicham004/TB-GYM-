import type { Direction } from '@angular/cdk/bidi';
import { type ConnectedPosition, Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  TemplateRef,
  viewChild,
  ViewContainerRef,
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
  /**
   * An outside page (a video on YouTube): the item is a real link that opens it in a new tab, with no
   * opener and no referrer, and the menu closes as it opens. `chosen` still reports the `action`.
   */
  href?: string;
}

let nextId = 0;

const GAP = 4;
const BELOW_END: ConnectedPosition = {
  originX: 'end',
  originY: 'bottom',
  overlayX: 'end',
  overlayY: 'top',
  offsetY: GAP,
  panelClass: 'tb-menu-pane--below-end',
};
const BELOW_START: ConnectedPosition = {
  originX: 'start',
  originY: 'bottom',
  overlayX: 'start',
  overlayY: 'top',
  offsetY: GAP,
  panelClass: 'tb-menu-pane--below-start',
};
const ABOVE_END: ConnectedPosition = {
  originX: 'end',
  originY: 'top',
  overlayX: 'end',
  overlayY: 'bottom',
  offsetY: -GAP,
  panelClass: 'tb-menu-pane--above-end',
};
const ABOVE_START: ConnectedPosition = {
  originX: 'start',
  originY: 'top',
  overlayX: 'start',
  overlayY: 'bottom',
  offsetY: -GAP,
  panelClass: 'tb-menu-pane--above-start',
};

/** Where the list may open, in order: below on its own edge, below on the other, then the same above. */
function menuPositions(align: 'start' | 'end'): ConnectedPosition[] {
  return align === 'end'
    ? [BELOW_END, BELOW_START, ABOVE_END, ABOVE_START]
    : [BELOW_START, BELOW_END, ABOVE_START, ABOVE_END];
}

/** The writing direction the button sits in, from the nearest `dir` that sets one. */
function directionOf(element: Element): Direction {
  return element.closest('[dir]:not([dir="auto"])')?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
}

/** Whether a scroll has carried the element wholly out of the window or out of a box that clips it. */
function outOfSight(element: Element): boolean {
  const box = element.getBoundingClientRect();
  const view = element.ownerDocument.documentElement;
  const clips: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>[] = [
    { top: 0, left: 0, bottom: view.clientHeight, right: view.clientWidth },
  ];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflow !== 'visible') clips.push(parent.getBoundingClientRect());
  }
  return clips.some(
    (clip) =>
      box.bottom <= clip.top ||
      box.top >= clip.bottom ||
      box.right <= clip.left ||
      box.left >= clip.right,
  );
}

/**
 * Surfaces/Menu: the secondary actions of a card or a row behind one button (plan §2 rule 5). A
 * disclosure menu, as on the client's page: the button says whether it is open, focus moves into
 * the list, the arrow keys, Home and End move through it, Escape closes it and gives focus back to
 * the button, and leaving it or pressing outside it closes it. With `icon` the button shows only that
 * glyph and `label` becomes its accessible name, so name the thing it acts on ("More for week 2").
 *
 * The list is a CDK overlay anchored on the button (critique B2a): a popover in the top layer, placed
 * just after the button in the page so Tab and the page's mode carry on from it, which no scrolling
 * box, card or open sheet can clip. It opens below the button's `align` edge, else below its other
 * edge, else above, 8 px clear of the window's edges, pushed inside them only when nothing fits; it
 * follows the button when anything scrolls and closes once the button has scrolled out of sight.
 */
@Component({
  selector: 'app-menu',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="menu" (focusout)="closeOnFocusOut($event)">
      @if (icon(); as glyph) {
        <button
          #trigger
          class="tb-icon-button trigger-icon"
          [class.trigger-touch]="size() === 'touch'"
          type="button"
          [disabled]="disabled()"
          [attr.aria-label]="label()"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="panelId"
          (click)="toggle()"
          (keydown)="triggerKey($event)"
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
          (keydown)="triggerKey($event)"
        >
          <span>{{ label() }}</span>
          <app-icon name="chevron-down" />
        </button>
      }
    </div>
    <ng-template #panel>
      <ul class="panel" [id]="panelId">
        @for (item of items(); track item.action) {
          <li>
            @if (item.href) {
              <a
                class="item"
                [href]="item.href"
                target="_blank"
                rel="noopener noreferrer"
                (click)="follow(item)"
                (keydown)="itemKey($event)"
                (focusout)="closeOnFocusOut($event)"
              >
                <span class="item-title">{{ item.label }}</span>
                @if (item.hint) {
                  <span class="item-hint">{{ item.hint }}</span>
                }
              </a>
            } @else {
              <button
                class="item"
                type="button"
                [class.danger]="item.danger"
                [class.current]="current() === item.action"
                [attr.aria-current]="current() === item.action ? 'true' : null"
                [attr.aria-disabled]="item.disabled ? 'true' : null"
                (click)="choose(item)"
                (keydown)="itemKey($event)"
                (focusout)="closeOnFocusOut($event)"
              >
                <span class="item-title">{{ item.label }}</span>
                @if (item.hint) {
                  <span class="item-hint">{{ item.hint }}</span>
                }
              </button>
            }
          </li>
        }
      </ul>
    </ng-template>
  `,
  styles: `
    :host {
      display: inline-block;
    }

    .trigger-icon {
      block-size: 2.25rem;
      inline-size: 2.25rem;
    }

    .trigger-icon.trigger-touch {
      block-size: 2.75rem;
      inline-size: 2.75rem;
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

    // The list inherits from the row its button sits in, so it states its own type.
    .panel {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card-small);
      box-shadow: var(--tb-shadow-overlay);
      box-sizing: border-box;
      color: var(--tb-ink);
      font-family: var(--font-sans);
      font-size: var(--text-body-size);
      font-style: normal;
      font-weight: 400;
      inline-size: max-content;
      letter-spacing: normal;
      line-height: var(--text-body-line-height);
      list-style: none;
      margin: 0;
      max-inline-size: min(18rem, calc(100vw - 2rem));
      min-inline-size: min(12rem, calc(100vw - 2rem));
      // A long list (fifteen muscles) scrolls inside the menu instead of off the screen.
      max-block-size: min(24rem, 70dvh);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0.375rem;
      text-align: start;
      text-transform: none;
      white-space: normal;
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
      text-decoration: none;
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
  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild.required<TemplateRef<unknown>>('panel');

  /** The button's text, or with `icon` its accessible name. */
  readonly label = input.required<string>();
  readonly items = input.required<readonly UiMenuItem[]>();
  readonly icon = input<IconName | null>(null);
  /** Which edge of the button the list lines up with; the end suits a button at a row's end. */
  readonly align = input<'start' | 'end'>('end');
  /** `chip` draws the button as a filter pill (the exercise library's filters), filled when `selected`. */
  readonly variant = input<'button' | 'chip'>('button');
  /** `touch` makes an icon button the 44 px a client's thumb needs (plan §2 rule 6, CLIENT-7). */
  readonly size = input<'default' | 'touch'>('default');
  readonly selected = input(false);
  /** The button cannot open the menu, as while the change it offers is still being saved. */
  readonly disabled = input(false);
  /** The `action` of the item in effect, marked in the list. */
  readonly current = input<string | null>(null);
  /** The `action` of the item chosen, once the menu has closed and focus is back on the button. */
  readonly chosen = output<string>();
  protected readonly open = signal(false);
  protected readonly panelId = `tb-menu-${nextId++}`;
  /** The open list's overlay; null while the menu is closed. */
  private overlayRef: OverlayRef | null = null;
  private stopFollowing: (() => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close(false));
  }

  /** Puts focus back on the button, for a page whose chosen action removed what had focus. */
  focus(): void {
    this.trigger().nativeElement.focus();
  }

  protected toggle(): void {
    if (this.open()) this.close(false);
    else this.show();
  }

  private show(): void {
    const trigger = this.trigger().nativeElement;
    const position = this.overlay
      .position()
      .flexibleConnectedTo(trigger)
      .withPositions(menuPositions(this.align()))
      .withViewportMargin(8)
      .withFlexibleDimensions(false)
      .withPush(true)
      .withPopoverLocation('inline');
    const ref = this.overlay.create({
      positionStrategy: position,
      scrollStrategy: this.overlay.scrollStrategies.noop(),
      direction: directionOf(trigger),
      panelClass: 'tb-menu-pane',
    });
    // The page's light or dark scope, for a browser that draws the list away from the button.
    const mode = trigger.closest('[data-mode]')?.getAttribute('data-mode');
    if (mode) ref.overlayElement.dataset['mode'] = mode;
    ref.outsidePointerEvents().subscribe((event) => {
      // The button's own press toggles the menu itself.
      if (!trigger.contains(event.target as Node)) this.close(false);
    });
    ref.attach(new TemplatePortal(this.panel(), this.viewContainer));
    this.overlayRef = ref;
    this.stopFollowing = this.followScrolling(trigger, ref);
    this.open.set(true);
    afterNextRender(() => this.itemElements()[0]?.focus(), { injector: this.injector });
  }

  /**
   * Keeps the list on its button while the page or any box around the button scrolls, once a frame,
   * and closes it once the button has scrolled out of sight, its focus going back to the button.
   */
  private followScrolling(trigger: HTMLElement, ref: OverlayRef): () => void {
    const view = this.document.defaultView;
    let frame: number | null = null;
    const follow = () => {
      frame = null;
      if (outOfSight(trigger)) {
        const focused = ref.overlayElement.contains(this.document.activeElement);
        this.close(false);
        if (focused) trigger.focus({ preventScroll: true });
      } else {
        ref.updatePosition();
      }
    };
    const onScroll = (event: Event) => {
      if (frame !== null || ref.overlayElement.contains(event.target as Node)) return;
      frame = view?.requestAnimationFrame(follow) ?? null;
    };
    this.document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      this.document.removeEventListener('scroll', onScroll, { capture: true });
      if (frame !== null) view?.cancelAnimationFrame(frame);
    };
  }

  /**
   * Closed before the list is taken away: removing it blurs the item that had focus, and the browser's
   * focusout would otherwise close the menu a second time, halfway through the first.
   */
  private close(returnFocus: boolean): void {
    const ref = this.overlayRef;
    if (!ref) return;
    this.overlayRef = null;
    this.stopFollowing?.();
    this.stopFollowing = null;
    this.open.set(false);
    if (returnFocus) this.trigger().nativeElement.focus();
    ref.dispose();
  }

  /**
   * Focus goes back to the button first, so whatever the page opens next (a sheet) returns focus to
   * a button that still exists once the menu has closed.
   */
  protected choose(item: UiMenuItem): void {
    if (item.disabled) return;
    this.close(true);
    this.chosen.emit(item.action);
  }

  /** A link item: the browser opens its page in a new tab; the menu closes behind it. */
  protected follow(item: UiMenuItem): void {
    this.close(true);
    this.chosen.emit(item.action);
  }

  /** On the open menu's button: Escape closes it, an arrow, Home or End goes into the list. */
  protected triggerKey(event: KeyboardEvent): void {
    if (!this.open()) return;
    const items = this.itemElements();
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  /**
   * In the list: the arrows move through it and wrap round, Home and End go to either end, and
   * Escape closes it without reaching the sheet around it.
   */
  protected itemKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close(true);
      return;
    }
    const items = this.itemElements();
    const current = items.indexOf(this.document.activeElement as HTMLElement);
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
    if (target < 0 || items.length === 0) return;
    event.preventDefault();
    items[target].focus();
  }

  protected closeOnFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    const inside =
      !!next &&
      (this.host.nativeElement.contains(next) || !!this.overlayRef?.overlayElement.contains(next));
    if (this.open() && !inside) this.close(false);
  }

  private itemElements(): HTMLElement[] {
    return Array.from(this.overlayRef?.overlayElement.querySelectorAll<HTMLElement>('.item') ?? []);
  }
}
