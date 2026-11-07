import { DOCUMENT, formatDate, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { Motion } from '../../core/motion/motion';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { UiMenu } from '../../ui/menu';
import { SectionLink, SectionNav } from '../../ui/section-nav';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { Tag } from '../../ui/tag';
import { ClientHoverCard } from './client-hover-card';
import { ClientListApi } from './client-list-api';
import {
  CLIENT_FILTERS,
  coachChip,
  emptyList,
  filterCounts,
  formerClientRow,
  listSummary,
  mapClientList,
  matches,
  type ClientFilter,
  type ClientList,
  type FormerClientRow,
} from './clients.models';
import { DayMarkView } from './day-mark';
import { FormerClientsApi } from './former-clients-api';
import { swapRows } from './rows-moment';
import { StatusesHelp } from './statuses-help';

const FILTER_LABELS: Record<ClientFilter, string> = {
  all: $localize`All`,
  attention: $localize`Needs attention`,
  ending: $localize`Ending soon`,
  paused: $localize`Paused`,
  new: $localize`New`,
};

/**
 * Clients (C2, critique B4a): how everyone is doing and who is slipping, as a table of columns on a
 * wide screen and a card per client on a phone. One read, `GET /api/clients/overview`, already limited
 * to the clients this person coaches (CLI-013) and carrying each one's status, reasons and plan
 * (CLI-018); the screen phrases it, filters and searches it, and links every row to the client and
 * every reason to where it is handled. The owner's `/clients/former` shows released clients (ADR 0027).
 */
@Component({
  selector: 'app-clients',
  imports: [
    Avatar,
    Button,
    ButtonLink,
    ClientHoverCard,
    DayMarkView,
    EmptyState,
    Icon,
    NgTemplateOutlet,
    RouterLink,
    SectionNav,
    Skeleton,
    StatusesHelp,
    StatusPill,
    Tag,
    UiMenu,
  ],
  templateUrl: './clients.html',
  // The status cell's sheet first, so the wide layout's rules in clients.scss come after it.
  styleUrls: [
    './clients-status.scss',
    './clients.scss',
    './clients-toolbar.scss',
    './client-hover-card.scss',
  ],
})
export class Clients {
  private readonly listApi = inject(ClientListApi);
  private readonly formerApi = inject(FormerClientsApi);
  private readonly auth = inject(AuthStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly document = inject(DOCUMENT);
  private readonly motion = inject(Motion);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  /** `/clients/former`: the owner's released clients (ADR 0027). Otherwise the current ones. */
  protected readonly showingFormer = this.route.snapshot.data['view'] === 'former';
  /** Presentation only: the API decides who may list former clients. */
  protected readonly isOwner = this.tenants.isOwner;
  protected readonly sections: SectionLink[] = [
    { label: $localize`Current clients`, link: '/clients' },
    { label: $localize`Former clients`, link: '/clients/former' },
  ];
  protected readonly list = signal<ClientList | null>(null);
  protected readonly former = signal<FormerClientRow[] | null>(null);
  /** Why the list could not be read: the server's own words where it gave any. */
  protected readonly failed = signal<string | null>(null);
  /** A coach who opened Former clients by its address: no Try again, a way back instead. */
  protected readonly formerRefused = signal(false);
  protected readonly loadingLabel = $localize`Loading clients…`;
  /**
   * The chip is kept in the address (`?show=attention`), so Back returns to the same list. An old
   * `?show=maxes` opens on All: Maxes to review went on the owner's word (notes plan N10a).
   */
  protected readonly filter = signal<ClientFilter>(initialFilter(this.route));
  protected readonly search = signal('');
  /** The owner's Coach filter (critique B3a), kept in the address too (`?coach=<user id>`). */
  protected readonly coach = signal(this.route.snapshot.queryParamMap.get('coach') ?? '');
  // The owner's alone: a coach's list holds only their own clients (CLI-013).
  protected readonly coachChip = computed(() =>
    this.isOwner()
      ? coachChip(this.list()?.rows ?? [], this.coach(), this.auth.user()?.id ?? null, this.locale)
      : null,
  );
  /** The chosen coach while the list still has them; an address naming anyone else narrows nothing. */
  private readonly chosenCoach = computed(() => (this.coachChip()?.active ? this.coach() : ''));

  /** What each chip holds: narrowed to one coach, that coach's clients (critique B3a). */
  private readonly counts = computed(() => {
    const coach = this.chosenCoach();
    return coach === ''
      ? this.list()?.counts
      : filterCounts((this.list()?.rows ?? []).filter((row) => row.coachId === coach));
  });

  protected readonly chips = computed(() => {
    const counts = this.counts();
    return CLIENT_FILTERS.map((value) => ({
      value,
      label: FILTER_LABELS[value],
      count: counts?.[value] ?? 0,
    }));
  });

  protected readonly visible = computed(() => {
    const filter = this.filter();
    const search = this.search();
    const coach = this.chosenCoach();
    return (this.list()?.rows ?? []).filter((row) => matches(row, filter, search, coach));
  });

  /** Announced politely as the list narrows, since the rows change without a page load. */
  protected readonly resultSummary = computed(() => {
    const total = this.list()?.rows.length ?? 0;
    const shown = this.visible().length;
    const narrowed =
      this.filter() !== 'all' || this.search().trim() !== '' || this.chosenCoach() !== '';
    if (total === 0 || !narrowed) return '';
    return shown === 1
      ? $localize`Showing 1 of ${total}:total: clients`
      : $localize`Showing ${shown}:shown: of ${total}:total: clients`;
  });

  /** "12 clients · 9 need attention · 1 plan ends soon": what the chips count, for the chosen coach too. */
  protected readonly summary = computed(() => {
    const counts = this.counts();
    return counts ? listSummary(counts) : '';
  });

  /**
   * What an empty filtered list says, and the one action that brings rows back: for the chosen coach's
   * clients while one is chosen, whose choice the action keeps (review of B3a).
   */
  protected readonly emptyFilter = computed(() =>
    emptyList(
      this.filter(),
      this.search(),
      this.chosenCoach() === '' ? null : (this.coachChip()?.chosen ?? null),
    ),
  );

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      // Untracked: a read the load makes on its way (the workspace's calendar) must not load it again.
      if (this.tenants.selectedTenantId()) untracked(() => void this.load());
    });
    // The heading takes focus on arrival, so a screen reader starts at the top of the list.
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.failed.set(null);
      this.formerRefused.set(false);
      try {
        if (this.showingFormer) {
          // The workspace's zone comes with the list, so each day reads on its calendar at once.
          const [former] = await owner.wait(
            Promise.all([
              firstValueFrom(this.formerApi.getFormerClients()),
              this.calendar.resolveToday(),
            ]),
          );
          const timeZone = this.calendar.timeZone();
          this.former.set(former.map((client) => formerClientRow(client, this.locale, timeZone)));
        } else {
          const view = await owner.wait(firstValueFrom(this.listApi.getOverview()));
          this.list.set(
            mapClientList(view, {
              locale: this.locale,
              now: new Date(),
              userId: this.auth.user()?.id ?? null,
            }),
          );
        }
      } catch (error) {
        if (!owner.current) return;
        // The list is the owner's (ADR 0027): a coach is told so, not to check a connection that is
        // fine (audit UIQ-2).
        if (this.showingFormer && error instanceof HttpErrorResponse && error.status === 403) {
          this.formerRefused.set(true);
          this.failed.set($localize`Only the owner sees former clients.`);
          return;
        }
        this.failed.set(apiErrorMessage(error, $localize`Clients could not be loaded. Try again.`));
      }
    });
  }

  /** The rows crossfade from one set to the next (motion plan W14) where the browser and motion allow. */
  protected setFilter(filter: ClientFilter): void {
    swapRows(() => this.filter.set(filter), this.document, this.motion, this.injector);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { show: filter === 'all' ? null : filter },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected setCoach(coachId: string): void {
    swapRows(() => this.coach.set(coachId), this.document, this.motion, this.injector);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { coach: coachId === '' ? null : coachId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /** "Mon", for a day of the hover card's week (W14); the row's dates are workspace days. */
  protected weekday(date: string): string {
    return formatDate(date, 'EEE', this.locale);
  }

  protected clearFilter(): void {
    if (this.search().trim() !== '') {
      this.search.set('');
    } else {
      this.setFilter('all');
    }
  }

  private reset(): void {
    this.list.set(null);
    this.former.set(null);
    this.failed.set(null);
    this.search.set('');
  }
}

function initialFilter(route: ActivatedRoute): ClientFilter {
  const show = route.snapshot.queryParamMap.get('show');
  return CLIENT_FILTERS.find((filter) => filter === show) ?? 'all';
}
