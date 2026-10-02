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
import { ApiClient } from '../../core/api/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Avatar } from '../../ui/avatar';
import { AvatarStack, type AvatarStackPerson } from '../../ui/avatar-stack';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { StatTile } from '../../ui/stat-tile';
import { mapCoachToday, type CoachToday as CoachTodayModel } from './coach-today.models';

/**
 * Coach Today (C1): who needs the coach now, what their clients did, and how the week is going.
 * One read, `GET /api/coach-today`, already ranked and limited to the clients this person coaches;
 * the screen phrases it and links every row to the place its action happens. A reply from a
 * workspace the coach has just switched away from is dropped.
 */
@Component({
  selector: 'app-coach-today',
  imports: [
    Avatar,
    AvatarStack,
    Button,
    ButtonLink,
    EmptyState,
    Icon,
    RouterLink,
    Skeleton,
    StatTile,
  ],
  templateUrl: './coach-today.html',
  styleUrls: ['./coach-today.scss', './coach-today-lists.scss'],
})
export class CoachToday {
  private readonly api = inject(ApiClient);
  private readonly locale = inject(LOCALE_ID);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly today = signal<CoachTodayModel | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  /** The feed starts with the newest few, so it never outgrows the queue beside it (§2 rule 7). */
  protected readonly feedOpen = signal(false);
  protected readonly feedPreview = 6;
  protected readonly activity = computed(() => {
    const rows = this.today()?.activity ?? [];
    return this.feedOpen() ? rows : rows.slice(0, this.feedPreview);
  });

  protected readonly firstName = computed(
    () => (this.auth.user()?.displayName ?? '').trim().split(/\s+/)[0] ?? '',
  );

  /** The people waiting, once each, for the faces on the Clients tile. */
  protected readonly waiting = computed<AvatarStackPerson[]>(() => {
    const seen = new Set<string>();
    return (this.today()?.attention ?? [])
      .filter((row) => !seen.has(row.clientId) && seen.add(row.clientId))
      .map((row) => ({ name: row.name, initials: row.initials }));
  });

  protected readonly clientsContext = computed(() => {
    const today = this.today();
    if (!today) return '';
    const needs = today.needsCount;
    if (needs === 0) return $localize`Everyone is on track today`;
    return needs === 1 ? $localize`1 needs you today` : $localize`${needs}:count: need you today`;
  });

  protected readonly sessionsValue = computed(() => {
    const week = this.today()?.week;
    return week ? $localize`${week.completed}:done: of ${week.scheduled}:scheduled:` : '';
  });

  protected readonly sessionsContext = computed(() => {
    const week = this.today()?.week;
    if (!week) return '';
    return week.scheduled === 0
      ? $localize`Nothing scheduled this week`
      : $localize`${week.dueSoFar}:due: were due by today`;
  });

  protected readonly endingContext = computed(() => {
    const today = this.today();
    if (!today) return '';
    if (today.renewalRequests === 1) return $localize`1 client asked to renew`;
    if (today.renewalRequests > 1) {
      return $localize`${today.renewalRequests}:count: clients asked to renew`;
    }
    return today.plansEndingSoon > 0
      ? $localize`Renew before they lapse`
      : $localize`None in the next two weeks`;
  });

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      if (this.tenants.selectedTenantId()) void this.load();
    });
    // The greeting takes focus on arrival, so a screen reader starts at the top of Today.
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected async load(): Promise<void> {
    return this.scope.run('today', async (owner) => {
      this.loading.set(true);
      this.failed.set(false);
      try {
        const view = await owner.wait(firstValueFrom(this.api.getCoachToday()));
        this.today.set(
          mapCoachToday(view, {
            locale: this.locale,
            now: new Date(),
            userId: this.auth.user()?.id ?? null,
          }),
        );
      } catch {
        if (owner.current) this.failed.set(true);
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  private reset(): void {
    this.feedOpen.set(false);
    this.today.set(null);
    this.loading.set(true);
    this.failed.set(false);
  }
}
