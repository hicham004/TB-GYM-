import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, LOCALE_ID, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  ClientPersonalRecordsResult,
  FeatureAccessReason,
  MeasurementType,
} from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { previewAssetIds, type ProgressDashboard } from './progress-dashboard.models';
import type { ProgressViewModel } from './progress.models';
import { Button } from '../../ui/button';
import { addDays, deviceToday } from '../../ui/calendar';
import { TrendChart } from '../../ui/trend-chart';
import { BarChart } from '../../ui/bar-chart';
import { PhotoCompare } from '../../ui/photo-compare';
import { BeforeAfterButton } from '../share-cards/before-after-button';
import { EntrySheets } from './entry-sheets';
import { weighInRows, type Audience } from './progress-entries.models';

@Component({
  selector: 'app-progress-dashboard',
  imports: [
    BeforeAfterButton,
    Button,
    DatePipe,
    DecimalPipe,
    EntrySheets,
    RouterLink,
    TrendChart,
    BarChart,
    PhotoCompare,
  ],
  templateUrl: './progress-dashboard.html',
  styleUrl: './progress-dashboard.scss',
})
export class ProgressDashboardView {
  readonly clientId = input<string | null>(null);
  /** The client's first name, for the coach's sentences ("Maya has no weigh-ins in this period"). */
  readonly clientName = input<string | null>(null);
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;
  private loadGeneration = 0;

  protected readonly dashboard = signal<ProgressDashboard | null>(null);
  protected readonly progress = signal<ProgressViewModel | null>(null);
  protected readonly personalRecords = signal<ClientPersonalRecordsResult | null>(null);
  protected readonly range = signal<'4w' | '12w' | 'all'>('12w');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly coachMode = computed(() => this.clientId() !== null);
  /** The client logging their own weight; a coach records through the entries page. */
  protected readonly audience = computed<Audience>(() => ({
    coach: this.coachMode(),
    firstName: this.clientName(),
    locale: this.locale,
  }));
  protected readonly startUnit = this.auth.weightUnit;
  /** Today in the coaching space: the dashboard's window ends the day after it. */
  protected readonly today = computed(() => {
    const view = this.dashboard();
    return view ? addDays(view.toExclusive, -1) : deviceToday();
  });
  protected readonly weights = computed(() => weighInRows(this.progress(), this.audience()));
  protected readonly who = computed(() => this.clientName() ?? $localize`This client`);
  /** Only exact asset ids returned by the batch are eligible to bind protected image paths. */
  protected readonly grantedPreviewIds = signal<ReadonlySet<string>>(new Set());
  protected readonly chartPoints = computed(() =>
    (this.progress()?.days ?? []).map((day) => ({
      date: day.date,
      value: day.displayValue,
      estimate: day.trendEstimate,
    })),
  );
  protected readonly chartWeeks = computed(() =>
    (this.progress()?.weeks ?? []).map((week) => ({
      from: week.weekStart,
      toExclusive: week.weekEndExclusive,
      mean: week.displayMean,
      observedDays: week.observedDayCount,
    })),
  );
  protected readonly entries = computed(() =>
    (this.progress()?.days ?? []).filter((day) => day.observation !== null).reverse(),
  );
  protected readonly photoPair = computed(() => {
    const granted = this.grantedPreviewIds();
    for (const pose of this.dashboard()?.photos.poses ?? []) {
      const photos = pose.photos.filter(
        (photo) => photo.thumbnailUrl && granted.has(photo.mediaAssetId),
      );
      // The server sends a pose's previews oldest first: the first is the before.
      if (photos.length >= 2) return { before: photos[0], after: photos.at(-1)! };
    }
    return null;
  });
  /** A client with photos of one pose on two days can share a before-and-after of them (R6.1b). */
  protected readonly canMakeBeforeAfter = computed(
    () =>
      !this.coachMode() &&
      (this.dashboard()?.photos.poses ?? []).some((pose) => pose.photos.length >= 2),
  );
  protected readonly trainingBars = computed(() => {
    const training = this.dashboard()?.training.context;
    return training
      ? [
          {
            label: $localize`Last ${training.recentDayCount} days`,
            value: training.recentCompletedWorkoutCount,
            total: training.recentScheduledSessionCount,
          },
          {
            label: $localize`This period`,
            value: training.windowCompletedWorkoutCount,
            total: training.windowScheduledSessionCount,
          },
        ]
      : [];
  });
  protected readonly abs = Math.abs;

  protected measurementLabel(type: MeasurementType): string {
    return type === 'BodyFatPercentage' ? $localize`Body fat` : type;
  }

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.clientId();
      const key = tenantId ? `${tenantId}:${clientId ?? 'me'}` : null;
      if (key === this.loadedKey) {
        return;
      }

      this.loadedKey = key;
      ++this.loadGeneration;
      this.dashboard.set(null);
      this.progress.set(null);
      this.personalRecords.set(null);
      this.range.set('12w');
      this.grantedPreviewIds.set(new Set());
      this.error.set(null);
      this.loading.set(false);
      if (key !== null) {
        void this.load();
      }
    });
  }

  protected changeRange(value: '4w' | '12w' | 'all'): void {
    if (this.range() === value) return;
    this.range.set(value);
    void this.load();
  }

  /** A weight was logged, corrected or found stale: read the numbers again. */
  protected reload(): void {
    void this.load();
  }

  /**
   * Why a cross-domain section could not be shown. The dashboard says this out loud rather than
   * rendering an empty panel, because "you are not entitled to see this" and "nothing was recorded"
   * are different facts and must not look the same.
   */
  protected unavailableReason(reason: FeatureAccessReason): string {
    switch (reason) {
      case 'Expired':
        return $localize`This subscription has ended.`;
      case 'NotStarted':
        return $localize`This subscription has not started yet.`;
      case 'PaymentRequired':
        return $localize`This subscription is awaiting payment.`;
      case 'Paused':
        return $localize`This subscription is paused.`;
      case 'Cancelled':
        return $localize`This subscription was cancelled.`;
      case 'NoEntitlement':
        return $localize`This is not part of the current plan.`;
      default:
        return $localize`This section is not available.`;
    }
  }

  protected retry(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const key = this.loadedKey;
      const generation = ++this.loadGeneration;
      this.loading.set(true);
      this.error.set(null);
      this.grantedPreviewIds.set(new Set());
      try {
        const clientId = this.clientId();
        // A client reads their own numbers in the unit they saved in Me. A coach reading a client's
        // stays in kilograms, and the server converts from the canonical kilograms either way.
        const unit = this.auth.weightUnit();
        const to = this.dashboard()?.toExclusive ?? null;
        const from =
          to === null
            ? null
            : subtractDays(to, this.range() === '4w' ? 28 : this.range() === 'all' ? 366 : 84);
        const [dashboard, recentProgress, personalRecords] = await owner.wait(
          Promise.all([
            clientId
              ? firstValueFrom(this.api.getClientProgressDashboard(clientId, from, to))
              : firstValueFrom(this.api.getMyProgressDashboard(from, to, unit)),
            clientId
              ? firstValueFrom(this.api.getClientProgress(clientId, 'Kilogram', from, to))
              : firstValueFrom(this.api.getMyProgress(unit, from, to)),
            // The same list by the same rule (TRN-019); a refused or failed read leaves it blank
            // rather than the whole dashboard.
            (clientId
              ? firstValueFrom(this.api.getClientTrainingPersonalRecords(clientId))
              : firstValueFrom(this.api.getMyTrainingPersonalRecords())
            ).catch(() => null),
          ]),
        );
        if (!this.ownsLoad(key, generation)) {
          return;
        }

        let progress = recentProgress;
        if (this.range() === 'all' && to !== null && from !== null) {
          const span = clientId
            ? await owner.wait(firstValueFrom(this.api.getClientBodyweightSpan(clientId)))
            : await owner.wait(firstValueFrom(this.api.getMyBodyweightSpan()));
          let end = from;
          while (span.firstDate && end > span.firstDate && this.ownsLoad(key, generation)) {
            const start =
              subtractDays(end, 366) > span.firstDate ? subtractDays(end, 366) : span.firstDate;
            const older = clientId
              ? await owner.wait(
                  firstValueFrom(this.api.getClientProgress(clientId, 'Kilogram', start, end)),
                )
              : await owner.wait(firstValueFrom(this.api.getMyProgress(unit, start, end)));
            progress = {
              ...progress,
              from: start,
              days: [...older.days, ...progress.days],
              weeks: [...older.weeks, ...progress.weeks],
            };
            end = start;
          }
        }
        if (!this.ownsLoad(key, generation)) return;

        this.dashboard.set(dashboard);
        this.progress.set(progress);
        this.personalRecords.set(personalRecords);
        await owner.wait(this.grantPreviews(dashboard, key, generation));
      } catch (error) {
        if (!owner.current) return;
        if (!this.ownsLoad(key, generation)) {
          return;
        }

        this.dashboard.set(null);
        this.progress.set(null);
        this.error.set(
          apiErrorMessage(error, $localize`The progress dashboard could not be loaded.`),
        );
      } finally {
        if (owner.current) {
          if (this.ownsLoad(key, generation)) {
            this.loading.set(false);
          }
        }
      }
    });
  }

  /**
   * Asks for one grant per previewed photo, in a single bounded request.
   *
   * A thumbnail path is not a public URL: the content route requires a short-lived, HTTP-only,
   * path-scoped grant cookie, and the dashboard previously bound the paths straight to `img.src`
   * without ever asking for one. That worked only if some other screen had already granted those
   * exact assets in the same session, so a coach opening a client for the first time saw nothing.
   * The server bounds the timeline it returns, so this set is bounded too and needs no paging.
   *
   * A failure here leaves the tiles unbound rather than failing the whole dashboard: the figures
   * are still worth showing when the images are not available.
   */
  private async grantPreviews(
    dashboard: ProgressDashboard,
    key: string | null,
    generation: number,
  ): Promise<void> {
    return this.scope.run('grantPreviews', async (owner) => {
      const assetIds = previewAssetIds(dashboard);
      if (assetIds.length === 0) {
        return;
      }

      try {
        await owner.wait(this.csrf.refresh());
        if (!this.ownsLoad(key, generation)) {
          return;
        }

        const batch = await owner.wait(firstValueFrom(this.api.createMediaAccessBatch(assetIds)));
        if (this.ownsLoad(key, generation)) {
          this.grantedPreviewIds.set(new Set(batch.items.map((item) => item.assetId)));
        }
      } catch {
        if (!owner.current) return;
        if (this.ownsLoad(key, generation)) {
          this.grantedPreviewIds.set(new Set());
        }
      }
    });
  }

  private ownsLoad(key: string | null, generation: number): boolean {
    return this.loadedKey === key && this.loadGeneration === generation;
  }

  private resetTenantState(): void {
    this.loadedKey = null;
    ++this.loadGeneration;
    this.dashboard.set(null);
    this.progress.set(null);
    this.personalRecords.set(null);
    this.loading.set(false);
    this.error.set(null);
    this.grantedPreviewIds.set(new Set());
  }
}

function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
