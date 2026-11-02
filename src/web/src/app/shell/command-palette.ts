import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ClientOverviewRow } from '../core/api/generated';
import { MessageUnreadStore } from '../core/messaging/message-unread.store';
import { TenantStore } from '../core/tenancy/tenant.store';
import { ClientListApi } from '../features/clients/client-list-api';
import { Avatar } from '../ui/avatar';
import { Icon, type IconName } from '../ui/icon';
import { COACH_NAVIGATION, type CoachDestinationKey } from './coach-navigation';
import { initialsOf } from './initials';

/**
 * The coach's palette (docs/MOTION-PLAN-2026-11.md, W14): Ctrl+K (Cmd+K on a Mac) in the coach
 * shell opens it over the page, a CDK overlay as the kit's menu is. It lists the pages in the order
 * the plan names them and, once two letters are typed, the clients whose names begin with them,
 * from the same read the Clients page makes (CLI-013: the API already limits it to the clients this
 * person coaches). The arrow keys move through the list and wrap round, Enter opens the chosen one,
 * Escape closes it. No animation at all: a tool used many times a day. The shell loads this file
 * only on the first press, so the first download carries the listener alone.
 */

/** One line of the palette: a page, or a client. */
export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  /** The page it opens where that differs from its name ("Programs" under Training); searched too. */
  readonly hint: string | null;
  readonly link: string;
  readonly icon: IconName | null;
  /** A client's initials, drawn in place of an icon. */
  readonly initials: string | null;
}

/** How many clients the list shows at most; typing another letter narrows it. */
export const CLIENTS_SHOWN = 8;
/** Clients are searched from this many letters on. */
export const CLIENT_SEARCH_FROM = 2;

/** The page a destination opens, where its name alone does not say (the plan's "Programs"). */
const HINTS: Partial<Record<CoachDestinationKey, string>> = {
  training: $localize`Programs`,
  nutrition: $localize`Plans`,
  'check-ins': $localize`Review`,
};

/**
 * The pages, in the plan's order: the sidebar's destinations, then This month before Settings. A
 * coach's Settings and Team open where their sidebar sends them; the guards and the API still
 * decide what each page shows.
 */
export function pageItems(owner: boolean, messaging: boolean): PaletteItem[] {
  const pages: PaletteItem[] = [];
  for (const group of COACH_NAVIGATION) {
    for (const destination of group.destinations) {
      if (destination.messaging && !messaging) continue;
      pages.push({
        id: `tb-palette-${destination.key}`,
        label: destination.label,
        hint: HINTS[destination.key] ?? null,
        link: owner ? destination.link : (destination.coachLink ?? destination.link),
        icon: destination.icon,
        initials: null,
      });
    }
  }
  pages.splice(pages.length - 1, 0, {
    id: 'tb-palette-month',
    label: $localize`This month`,
    hint: null,
    link: '/month',
    icon: 'overview',
    initials: null,
  });
  return pages;
}

/** Lower-cased and without accents, so "Elie" finds Élie and "fakh" finds Fakhoury. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every word typed begins some word of the text: "ma fa" finds Maya Fakhoury, "prog" finds Training. */
export function matchesQuery(text: string, query: string): boolean {
  const words = normalizeText(text)
    .split(/[\s·,.-]+/)
    .filter(Boolean);
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

function clientItem(row: ClientOverviewRow): PaletteItem {
  const name = `${row.client.firstName} ${row.client.lastName}`.trim();
  return {
    id: `tb-palette-client-${row.client.clientProfileId}`,
    label: name,
    hint: null,
    link: `/clients/${row.client.clientProfileId}`,
    icon: null,
    initials: initialsOf(name),
  };
}

/** The last list read, shown at once on the next opening while a fresh read lands. */
let cache: { tenantId: string | null; rows: readonly ClientOverviewRow[] } | null = null;

@Component({
  selector: 'app-command-palette',
  imports: [Avatar, Icon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tb-theme',
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': 'title',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <div class="field">
      <app-icon name="search" />
      <input
        #input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="tb-palette-list"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        [attr.aria-activedescendant]="active()"
        [attr.aria-label]="placeholder"
        [placeholder]="placeholder"
        [value]="query()"
        (input)="query.set(input.value)"
      />
      <kbd class="key" aria-hidden="true">Esc</kbd>
    </div>
    <div id="tb-palette-list" class="list" role="listbox" [attr.aria-label]="title">
      @if (pages().length > 0) {
        <div role="group" [attr.aria-label]="pagesLabel">
          <p class="group-label" aria-hidden="true">{{ pagesLabel }}</p>
          @for (item of pages(); track item.id) {
            <ng-container *ngTemplateOutlet="option; context: { $implicit: item }" />
          }
        </div>
      }
      @if (people().length > 0) {
        <div role="group" [attr.aria-label]="clientsLabel">
          <p class="group-label" aria-hidden="true">{{ clientsLabel }}</p>
          @for (item of people(); track item.id) {
            <ng-container *ngTemplateOutlet="option; context: { $implicit: item }" />
          }
        </div>
      }
    </div>
    @if (items().length === 0) {
      <p class="none" role="status">{{ searching() ? loadingText : nothingText }}</p>
    }
    <p class="foot" aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd> <ng-container i18n>move</ng-container></span>
      <span><kbd>↵</kbd> <ng-container i18n>open</ng-container></span>
      <span><kbd>Esc</kbd> <ng-container i18n>close</ng-container></span>
    </p>
    <ng-template #option let-item>
      <button
        type="button"
        role="option"
        tabindex="-1"
        class="option"
        [id]="item.id"
        [class.active]="active() === item.id"
        [attr.aria-selected]="active() === item.id"
        (pointermove)="active.set(item.id)"
        (click)="choose(item)"
      >
        @if (item.initials !== null) {
          <app-avatar [initials]="item.initials" presentation="client" />
        } @else if (item.icon) {
          <app-icon [name]="item.icon" />
        }
        <span class="label" dir="auto">{{ item.label }}</span>
        @if (item.hint) {
          <span class="hint">{{ item.hint }}</span>
        }
      </button>
    </ng-template>
  `,
  styles: `
    :host {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card);
      box-shadow: var(--tb-shadow-overlay);
      box-sizing: border-box;
      color: var(--tb-ink);
      display: block;
      inline-size: min(36rem, calc(100vw - 2rem));
      overflow: hidden;
    }

    .field {
      align-items: center;
      border-block-end: 1px solid var(--tb-line);
      color: var(--tb-muted);
      display: flex;
      gap: 0.625rem;
      padding-inline: 0.875rem;
    }

    .field:focus-within {
      border-block-end-color: var(--tb-focus);
    }

    input {
      background: none;
      border: 0;
      color: var(--tb-ink);
      flex: 1 1 auto;
      font: inherit;
      font-size: 1.0625rem;
      min-block-size: 3.25rem;
      min-inline-size: 0;
      outline: none;
      padding: 0;
    }

    input::placeholder {
      color: var(--tb-muted);
      opacity: 1;
    }

    kbd {
      border: 1px solid var(--tb-line-strong);
      border-radius: 6px;
      color: var(--tb-muted);
      font-family: inherit;
      font-size: 0.6875rem;
      line-height: 1;
      padding: 0.2rem 0.4rem;
    }

    .list {
      max-block-size: min(24rem, 60vh);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0.375rem;
    }

    .group-label {
      color: var(--tb-muted);
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      margin: 0;
      padding: 0.5rem 0.75rem 0.25rem;
      text-transform: uppercase;
    }

    .group-label:lang(ar) {
      letter-spacing: 0;
      text-transform: none;
    }

    .option {
      align-items: center;
      background: none;
      border: 0;
      border-radius: 8px;
      color: var(--tb-ink);
      cursor: pointer;
      display: flex;
      font: inherit;
      gap: 0.75rem;
      inline-size: 100%;
      min-block-size: 2.75rem;
      padding: 0.375rem 0.75rem;
      text-align: start;
    }

    .option app-icon {
      color: var(--tb-muted);
    }

    .option.active {
      background: var(--tb-accent-soft);
    }

    .label {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .hint {
      color: var(--tb-muted);
      font-size: 0.8125rem;
      margin-inline-start: auto;
    }

    .none {
      color: var(--tb-muted);
      margin: 0;
      padding: 0.75rem 1.125rem 1rem;
    }

    .foot {
      border-block-start: 1px solid var(--tb-line);
      color: var(--tb-muted);
      display: flex;
      font-size: 0.75rem;
      gap: 1rem;
      margin: 0;
      padding: 0.5rem 0.875rem;
    }

    .foot span {
      align-items: center;
      display: inline-flex;
      gap: 0.25rem;
    }
  `,
})
export class CommandPalette {
  private readonly router = inject(Router);
  private readonly tenants = inject(TenantStore);
  private readonly messaging = inject(MessageUnreadStore);
  private readonly clientsApi = inject(ClientListApi);
  private readonly document = inject(DOCUMENT);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  /** The palette wants to close: Escape or Tab, or a choice made, which it has navigated to. */
  readonly closed = output<void>();

  protected readonly title = $localize`Go to a page or a client`;
  protected readonly placeholder = $localize`Type a page or a client's name…`;
  protected readonly pagesLabel = $localize`Pages`;
  protected readonly clientsLabel = $localize`Clients`;
  protected readonly nothingText = $localize`Nothing matches`;
  protected readonly loadingText = $localize`Looking up clients…`;
  protected readonly query = signal('');
  private readonly clients = signal<readonly ClientOverviewRow[] | null>(
    cache?.tenantId === this.tenants.selectedTenantId() ? cache.rows : null,
  );

  protected readonly pages = computed(() => {
    const query = this.query().trim();
    const all = pageItems(this.tenants.isOwner(), this.messaging.isAvailable());
    return query === ''
      ? all
      : all.filter((page) => matchesQuery(`${page.label} ${page.hint ?? ''}`, query));
  });

  protected readonly people = computed(() => {
    const query = this.query().trim();
    if (query.length < CLIENT_SEARCH_FROM) return [];
    return (this.clients() ?? [])
      .filter((row) => matchesQuery(`${row.client.firstName} ${row.client.lastName}`, query))
      .slice(0, CLIENTS_SHOWN)
      .map(clientItem);
  });

  protected readonly items = computed(() => [...this.pages(), ...this.people()]);
  /** The line Enter opens: the first, until the arrows or the pointer move it. */
  protected readonly active = linkedSignal<string | null>(() => this.items()[0]?.id ?? null);
  protected readonly searching = computed(
    () => this.query().trim().length >= CLIENT_SEARCH_FROM && this.clients() === null,
  );

  constructor() {
    afterNextRender(() => this.input().nativeElement.focus());
    void this.readClients();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit();
      return;
    }
    const items = this.items();
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = items.find((item) => item.id === this.active());
      if (chosen) this.choose(chosen);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (items.length === 0) return;
    const current = items.findIndex((item) => item.id === this.active());
    const next =
      event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length;
    this.active.set(items[next].id);
    this.document.getElementById(items[next].id)?.scrollIntoView?.({ block: 'nearest' });
  }

  protected choose(item: PaletteItem): void {
    this.closed.emit();
    void this.router.navigateByUrl(item.link);
  }

  /** One read per opening; a failed one leaves the pages working and shows no client. */
  private async readClients(): Promise<void> {
    const tenantId = this.tenants.selectedTenantId();
    try {
      const view = await firstValueFrom(this.clientsApi.getOverview());
      if (this.tenants.selectedTenantId() !== tenantId) return;
      cache = { tenantId, rows: view.clients };
      this.clients.set(view.clients);
    } catch {
      this.clients.set(cache?.tenantId === tenantId ? cache.rows : []);
    }
  }
}

/** The open palette, as the shell holds it. */
export interface PaletteHandle {
  close(): void;
}

/**
 * Opens the palette over the page in a CDK overlay with a backdrop, and puts focus back where it
 * was when it closes (a page the palette opened then takes it to its heading, as every page does).
 * `onClosed` tells the shell, whichever way it closed.
 */
export function openCommandPalette(injector: Injector, onClosed: () => void): PaletteHandle {
  const overlay = injector.get(Overlay);
  const document = injector.get(DOCUMENT);
  const before = document.activeElement as HTMLElement | null;
  const ref = overlay.create({
    positionStrategy: overlay.position().global().centerHorizontally().top('12vh'),
    scrollStrategy: overlay.scrollStrategies.block(),
    hasBackdrop: true,
    backdropClass: 'tb-palette-backdrop',
    panelClass: 'tb-palette-pane',
    direction: document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr',
  });
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    ref.dispose();
    if (before?.isConnected) before.focus({ preventScroll: true });
    onClosed();
  };
  ref.backdropClick().subscribe(close);
  const palette = ref.attach(new ComponentPortal(CommandPalette, null, injector));
  palette.instance.closed.subscribe(close);
  return { close };
}
