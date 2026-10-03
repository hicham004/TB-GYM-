import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';

export interface ClientAction {
  label: string;
  /** A short line under the label, for an action whose name alone is not enough. */
  hint?: string;
  link: string;
  queryParams?: Record<string, string> | null;
}

let nextId = 0;

/**
 * The secondary actions of a page, behind one button (plan §2 rule 5: one primary action per
 * screen). A disclosure menu like the coach shell's: the button says whether it is open, focus
 * moves into the list, the arrow keys move through it, and Escape or leaving it closes it and
 * returns focus to the button. Each item is a real link, so it can be opened in a new tab.
 */
@Component({
  selector: 'app-client-actions',
  imports: [Button, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // On the host, not the list: a list is not focusable, so a handler there would be unreachable
  // by keyboard on its own (the keys arrive from the links and the button inside).
  host: { '(keydown.escape)': 'closeFromKeyboard($event)', '(keydown)': 'moveFocus($event)' },
  template: `
    <div class="menu" (focusout)="closeOnFocusOut($event)">
      <button
        #trigger
        appButton
        type="button"
        variant="outlined"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="panelId"
        (click)="toggle()"
      >
        <span>{{ label() }}</span>
        <app-icon name="chevron-down" />
      </button>
      @if (open()) {
        <ul class="panel" [id]="panelId">
          @for (item of items(); track item.link + item.label) {
            <li>
              <a
                class="item"
                [routerLink]="item.link"
                [queryParams]="item.queryParams ?? null"
                (click)="open.set(false)"
              >
                <span class="item-title">{{ item.label }}</span>
                @if (item.hint) {
                  <span class="item-hint">{{ item.hint }}</span>
                }
              </a>
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
      max-inline-size: min(20rem, calc(100vw - 2rem));
      min-inline-size: 14rem;
      padding: 0.375rem;
      position: absolute;
      z-index: 30;
    }

    .item {
      border-radius: 8px;
      color: var(--tb-ink);
      display: flex;
      flex-direction: column;
      padding: 0.5rem 0.75rem;
      text-decoration: none;
    }

    .item:hover {
      background: var(--tb-surface-2);
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
export class ClientActions {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  readonly label = input.required<string>();
  readonly items = input.required<readonly ClientAction[]>();
  protected readonly open = signal(false);
  protected readonly panelId = `client-actions-${nextId++}`;

  protected toggle(): void {
    const opening = !this.open();
    this.open.set(opening);
    if (opening) {
      // The list is drawn on the next render; focus then moves to its first item.
      afterNextRender(() => this.links()[0]?.focus(), { injector: this.injector });
    }
  }

  /** Escape closes the menu and gives focus back to the button that opened it. */
  protected closeFromKeyboard(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  protected closeOnFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    // Tabbing or clicking away closes it; a click on the button itself is handled by `toggle`.
    if (this.open() && !this.host.nativeElement.contains(next)) this.open.set(false);
  }

  protected moveFocus(event: KeyboardEvent): void {
    const links = this.links();
    if (!this.open() || links.length === 0) return;
    const current = links.indexOf(document.activeElement as HTMLElement);
    const target =
      event.key === 'ArrowDown'
        ? (current + 1) % links.length
        : event.key === 'ArrowUp'
          ? (current - 1 + links.length) % links.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? links.length - 1
              : -1;
    if (target < 0) return;
    event.preventDefault();
    links[target].focus();
  }

  private links(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('a.item'));
  }
}
