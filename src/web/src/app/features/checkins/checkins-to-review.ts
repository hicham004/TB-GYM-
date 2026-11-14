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
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { CheckInToReviewList } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { SectionNav } from '../../ui/section-nav';
import { Skeleton } from '../../ui/skeleton';
import { CHECK_IN_SECTIONS } from './checkin-sections';
import { CheckInsToReviewApi } from './checkins-to-review-api';
import { limitNote, matchesName, reviewCount, toReviewRow } from './checkins-to-review.models';

/**
 * Check-ins to review (critique B3b), where Check-ins opens: one row per sent check-in waiting for its
 * review, oldest first, each opening its review on the client's record. Every reader, the owner too,
 * reads only the clients they coach (CHK-014, since notes plan N9d1a); a row's coach line stays as a
 * guard for a client someone else coaches, which the server never sends today.
 */
@Component({
  selector: 'app-checkins-to-review',
  imports: [Avatar, Button, Control, EmptyState, Field, Icon, RouterLink, SectionNav, Skeleton],
  templateUrl: './checkins-to-review.html',
  styleUrl: './checkins-to-review.scss',
})
export class CheckInsToReview {
  private readonly api = inject(CheckInsToReviewApi);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenantId: string | null = null;

  protected readonly sections = CHECK_IN_SECTIONS;
  protected readonly loadingLabel = $localize`Loading the check-ins to review…`;
  protected readonly searchLabel = $localize`Search by client name`;
  protected readonly searchPlaceholder = $localize`Search by client name…`;

  private readonly list = signal<CheckInToReviewList | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly search = signal('');

  private readonly rows = computed(() => {
    const context = {
      today: this.calendar.today(),
      locale: this.locale,
      userId: this.auth.user()?.id ?? null,
    };
    return (this.list()?.items ?? []).map((item) => toReviewRow(item, context));
  });
  protected readonly hasAny = computed(() => this.rows().length > 0);
  protected readonly shown = computed(() => {
    const search = this.search();
    return this.rows().filter((row) => matchesName(row, search));
  });
  /** The ones read: every one waiting, or the oldest when more wait than one read brings. */
  protected readonly read = computed(() => this.rows().length);
  /** More wait than were read, so a search looks through the oldest only, and says so. */
  protected readonly capped = computed(() => Number(this.list()?.total ?? 0) > this.read());
  protected readonly count = computed(() =>
    reviewCount(
      this.shown().length,
      this.read(),
      Number(this.list()?.total ?? 0),
      this.search().trim() !== '',
    ),
  );
  protected readonly note = computed(() => {
    const list = this.list();
    return list ? limitNote(list) : null;
  });

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.list.set(null);
      this.search.set('');
      this.state.set('loading');
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
    // The heading takes focus on arrival, so a screen reader starts at the top of the page.
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        // The workspace's day comes with the list, so a sent day of another year says its year.
        const [list] = await owner.wait(
          Promise.all([firstValueFrom(this.api.list()), this.calendar.resolveToday()]),
        );
        this.list.set(list);
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }

  protected typed(value: string): void {
    this.search.set(value);
  }

  protected clearSearch(): void {
    this.search.set('');
  }
}
