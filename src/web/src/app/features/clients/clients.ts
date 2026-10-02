import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { SectionLink, SectionNav } from '../../ui/section-nav';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { ClientListApi } from './client-list-api';
import {
  CLIENT_FILTERS,
  formerClientRow,
  mapClientList,
  matches,
  type ClientFilter,
  type ClientList,
  type FormerClientRow,
} from './clients.models';
import { FormerClientsApi } from './former-clients-api';

const FILTER_LABELS: Record<ClientFilter, string> = {
  all: $localize`All`,
  attention: $localize`Needs attention`,
  ending: $localize`Ending soon`,
  paused: $localize`Paused`,
  new: $localize`New`,
};

/**
 * Clients (C2): how everyone is doing and who is slipping. One read, `GET /api/clients/overview`,
 * already limited to the clients this person coaches (CLI-013) and carrying each one's status
 * (CLI-018); the screen phrases it, filters and searches it, and links every row to the client.
 * The owner's `/clients/former` shows released clients (ADR 0027) in the same layout.
 */
@Component({
  selector: 'app-clients',
  imports: [
    Avatar,
    Button,
    ButtonLink,
    EmptyState,
    Icon,
    RouterLink,
    SectionNav,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './clients.html',
  styleUrls: ['./clients.scss', './clients-toolbar.scss'],
})
export class Clients {
  private readonly listApi = inject(ClientListApi);
  private readonly formerApi = inject(FormerClientsApi);
  private readonly auth = inject(AuthStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly tenants = inject(TenantStore);
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
  protected readonly loadingLabel = $localize`Loading clients…`;
  /** The chip is kept in the address (`?show=attention`), so Back returns to the same list. */
  protected readonly filter = signal<ClientFilter>(initialFilter(this.route));
  protected readonly search = signal('');

  protected readonly chips = computed(() => {
    const counts = this.list()?.counts;
    return CLIENT_FILTERS.map((value) => ({
      value,
      label: FILTER_LABELS[value],
      count: counts?.[value] ?? 0,
    }));
  });

  protected readonly visible = computed(() => {
    const filter = this.filter();
    const search = this.search();
    return (this.list()?.rows ?? []).filter((row) => matches(row, filter, search));
  });

  /** Announced politely as the list narrows, since the rows change without a page load. */
  protected readonly resultSummary = computed(() => {
    const total = this.list()?.rows.length ?? 0;
    const shown = this.visible().length;
    if (total === 0 || (this.filter() === 'all' && this.search().trim() === '')) return '';
    return shown === 1
      ? $localize`Showing 1 of ${total}:total: clients`
      : $localize`Showing ${shown}:shown: of ${total}:total: clients`;
  });

  protected readonly summary = computed(() => {
    const counts = this.list()?.counts;
    if (!counts || counts.all === 0) return '';
    const clients =
      counts.all === 1 ? $localize`1 client` : $localize`${counts.all}:count: clients`;
    if (counts.attention === 0) return $localize`${clients}:clients: · nobody needs attention`;
    return counts.attention === 1
      ? $localize`${clients}:clients: · 1 needs attention`
      : $localize`${clients}:clients: · ${counts.attention}:count: need attention`;
  });

  /** What an empty filtered list says, and the one action that brings rows back. */
  protected readonly emptyFilter = computed(() => {
    if (this.search().trim() !== '') {
      return {
        heading: $localize`No client matches “${this.search().trim()}:search:”`,
        description: $localize`Search looks at names and goals.`,
        action: $localize`Clear search`,
      };
    }
    const headings: Record<ClientFilter, string> = {
      all: '',
      attention: $localize`Nobody needs attention right now`,
      ending: $localize`No plan ends in the next 14 days`,
      paused: $localize`No plan is paused`,
      new: $localize`No new clients in the last 14 days`,
    };
    return {
      heading: headings[this.filter()],
      description: $localize`Clients will show up here when this changes.`,
      action: $localize`Show all clients`,
    };
  });

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      if (this.tenants.selectedTenantId()) void this.load();
    });
    // The heading takes focus on arrival, so a screen reader starts at the top of the list.
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.failed.set(null);
      try {
        if (this.showingFormer) {
          const former = await owner.wait(firstValueFrom(this.formerApi.getFormerClients()));
          this.former.set(former.map((client) => formerClientRow(client, this.locale)));
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
        this.failed.set(
          apiErrorMessage(
            error,
            $localize`Clients could not be loaded. Check your connection and try again.`,
          ),
        );
      }
    });
  }

  protected setFilter(filter: ClientFilter): void {
    this.filter.set(filter);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { show: filter === 'all' ? null : filter },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
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
