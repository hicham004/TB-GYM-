import { formatDate } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { WorkspaceDetails } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import type { GirthUnit, MassUnit } from '../../core/units/body-units';
import { Button } from '../../ui/button';
import { addDays, deviceToday, isoWeekdayOfName } from '../../ui/calendar';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import { UiTabPane, UiTabs } from '../../ui/tabs';
import { BeforeAfterButton } from '../share-cards/before-after-button';
import { posesToCompare } from '../share-cards/before-after.models';
import { EntrySheets, type EntryKind } from './entry-sheets';
import { ProgressEntriesApi } from './progress-entries-api';
import {
  dayWords,
  entryTab,
  measurementDays,
  photoLists,
  tabName,
  trendFacts,
  weighInRows,
  type Audience,
  type EntryTab,
  type MeasurementRow,
  type PhotoTile,
  type WeighInRow,
} from './progress-entries.models';
import type { BodyMeasurements, ProgressPhoto, ProgressViewModel } from './progress.models';

/** One read covers up to a year; "Show earlier" reads the year before the oldest one loaded. */
const WINDOW_DAYS = 366;
/** The server grants at most this many protected images in one request. */
const GRANT_CHUNK = 32;

interface Range {
  readonly from: string;
  readonly to: string;
}

type FeedState = 'idle' | 'loading' | 'ready' | 'error';

const MASS_UNITS: readonly SegmentOption[] = [
  { value: 'Kilogram' satisfies MassUnit, label: 'kg' },
  { value: 'Pound' satisfies MassUnit, label: 'lb' },
];

const GIRTH_UNITS: readonly SegmentOption[] = [
  { value: 'Centimetre' satisfies GirthUnit, label: 'cm' },
  { value: 'Inch' satisfies GirthUnit, label: 'in' },
];

/**
 * Weight, measurements and photos in one place (R5.3c): the client's own entries, and, for a coach, a
 * client's. Each tab lists what was logged, newest first, one row for each, with a way to put a wrong
 * one right; logging and correcting happen in sheets. Every list reads the last year and can read the
 * year before. A tab is read the first time it is opened.
 */
@Component({
  selector: 'app-progress-entries',
  imports: [
    BeforeAfterButton,
    Button,
    EmptyState,
    EntrySheets,
    Icon,
    RouterLink,
    SegmentedControl,
    Skeleton,
    UiMenu,
    UiTabPane,
    UiTabs,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './progress-entries.html',
  styleUrl: './progress-entries.scss',
})
export class ProgressEntries {
  /** A coach reads one client's entries; the client's own page leaves it empty. */
  readonly clientId = input<string | null>(null);
  /** The client's first name, for a coach's sentences. */
  readonly clientName = input<string | null>(null);

  private readonly api = inject(ApiClient);
  private readonly entries = inject(ProgressEntriesApi);
  private readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedKey: string | null = null;

  protected readonly names = {
    weight: tabName('weight'),
    measurements: tabName('measurements'),
    photos: tabName('photos'),
  };
  protected readonly weightUnitLabel = $localize`Show weights in`;
  protected readonly girthUnitLabel = $localize`Show measurements in`;
  protected readonly loadingWeights = $localize`Loading weights…`;
  protected readonly loadingMeasurements = $localize`Loading measurements…`;
  protected readonly loadingPhotos = $localize`Loading photos…`;
  /** Read after a tile's visible pose, so a screen reader hears "Front photo, Fri 9 Oct". */
  protected readonly photoWord = $localize`photo,`;
  protected readonly noWeightsClient = $localize`No weights yet`;
  protected readonly noWeightsClientHelp = $localize`Log your first weight. A few a week is plenty to see where you are heading.`;
  protected readonly noWeightsCoachHelp = $localize`Log one for them, or ask them to log their own.`;
  protected readonly noMeasurementsClient = $localize`No measurements yet`;
  protected readonly noMeasurementsClientHelp = $localize`Log your first measurements the next time you measure. Every few weeks is enough.`;
  protected readonly noMeasurementsCoachHelp = $localize`Log them for the client, or ask them to log their own.`;
  protected readonly noPhotosClient = $localize`No photos yet`;
  protected readonly noPhotosClientHelp = $localize`Add a front, side and back photo to see the change over time.`;
  protected readonly noPhotosCoachHelp = $localize`Add them for the client, or ask them to add their own.`;
  protected readonly massUnits = MASS_UNITS;
  protected readonly girthUnits = GIRTH_UNITS;
  protected readonly weighInMenu: readonly UiMenuItem[] = [
    { label: $localize`Correct the weight`, action: 'correct' },
    {
      label: $localize`Wrong day`,
      hint: $localize`Move it to the day it was taken`,
      action: 'move',
    },
    { label: $localize`See changes`, action: 'changes' },
  ];
  protected readonly measurementMenu: readonly UiMenuItem[] = [
    { label: $localize`Correct the measurement`, action: 'correct' },
    { label: $localize`See changes`, action: 'changes' },
  ];

  protected readonly coachMode = computed(() => this.clientId() !== null);
  protected readonly audience = computed<Audience>(() => ({
    coach: this.coachMode(),
    firstName: this.clientName(),
    locale: this.locale,
  }));
  private readonly workspace = signal<WorkspaceDetails | null>(null);
  /** Today in the coaching space, never the browser's. */
  protected readonly today = computed(() => this.workspace()?.currentDate ?? deviceToday());
  protected readonly firstDay = computed(() => isoWeekdayOfName(this.workspace()?.weekStartsOn));
  protected readonly tab = signal<EntryTab>('weight');
  /** The unit the log sheet begins on: the saved weight unit for a client, kilograms for a coach. */
  protected readonly startUnit = computed<MassUnit>(() =>
    this.coachMode() ? 'Kilogram' : this.auth.weightUnit(),
  );
  protected readonly who = computed(() => this.clientName() ?? $localize`The client`);
  protected readonly noWeightsCoach = computed(
    () => $localize`${this.who()}:name: has no weights yet`,
  );
  protected readonly noMeasurementsCoach = computed(
    () => $localize`${this.who()}:name: has no measurements yet`,
  );
  protected readonly noPhotosCoach = computed(
    () => $localize`${this.who()}:name: has no photos yet`,
  );

  // ---- weight ----
  protected readonly unit = signal<MassUnit>('Kilogram');
  protected readonly weightState = signal<FeedState>('idle');
  private readonly weightWindows = signal<readonly ProgressViewModel[]>([]);
  private weightRanges: Range[] = [];
  private earlierMeasurementDate: string | null = null;
  private earlierPhotoDate: string | null = null;
  private firstWeighIn: string | null = null;
  protected readonly weightMore = signal(false);
  protected readonly weightEarlierBusy = signal(false);
  protected readonly weightRows = computed(() =>
    this.weightWindows().flatMap((window) => weighInRows(window, this.audience())),
  );
  protected readonly trend = computed(() => {
    const newest = this.weightWindows()[0];
    return newest && this.coachMode() ? trendFacts(newest.trend, this.today(), this.locale) : null;
  });

  // ---- measurements ----
  protected readonly girth = signal<GirthUnit>('Centimetre');
  protected readonly measurementState = signal<FeedState>('idle');
  private readonly measurementWindows = signal<readonly BodyMeasurements[]>([]);
  private measurementRanges: Range[] = [];
  protected readonly measurementMore = signal(false);
  protected readonly measurementEarlierBusy = signal(false);
  protected readonly measurementList = computed(() =>
    this.measurementWindows().flatMap((window) => measurementDays(window, this.audience())),
  );

  // ---- photos ----
  protected readonly photoState = signal<FeedState>('idle');
  private readonly photoWindows = signal<readonly (readonly ProgressPhoto[])[]>([]);
  private photoRanges: Range[] = [];
  protected readonly photoMore = signal(false);
  protected readonly photoEarlierBusy = signal(false);
  private readonly thumbnails = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly photoLists = computed(() =>
    photoLists(this.photoWindows().flat(), this.audience()),
  );
  /** The client's own photos of one pose on two days can make a before-and-after (R6.1b). */
  protected readonly canMakeBeforeAfter = computed(
    () => !this.coachMode() && posesToCompare(this.photoWindows().flat()).length > 0,
  );

  constructor() {
    this.scope.onReset(() => this.reset());
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    // On the client's own page the tab lives in the address, so a link from Progress lands on the right one.
    this.route.queryParamMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((params) => {
      if (this.clientId() !== null) return;
      this.tab.set(entryTab(params.get('tab')));
      this.ensure(this.tab());
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.clientId();
      const key = tenantId ? `${tenantId}:${clientId ?? 'me'}` : null;
      if (key === this.loadedKey) return;
      this.loadedKey = key;
      this.reset();
      this.unit.set(clientId === null ? this.auth.weightUnit() : 'Kilogram');
      if (key !== null) void this.start();
    });
  }

  private reset(): void {
    this.workspace.set(null);
    this.weightState.set('idle');
    this.weightWindows.set([]);
    this.weightRanges = [];
    this.firstWeighIn = null;
    this.weightMore.set(false);
    this.measurementState.set('idle');
    this.measurementWindows.set([]);
    this.measurementRanges = [];
    this.measurementMore.set(false);
    this.photoState.set('idle');
    this.photoWindows.set([]);
    this.photoRanges = [];
    this.photoMore.set(false);
    this.thumbnails.set(new Map());
  }

  private async start(): Promise<void> {
    await this.scope.run('workspace', async (owner) => {
      try {
        this.workspace.set(await owner.wait(firstValueFrom(this.api.getWorkspace())));
      } catch {
        // The browser's own day stands in: the server still judges every date.
        if (!owner.current) return;
      }
    });
    await this.loadWeight();
    this.ensure(this.tab());
  }

  // ---- tabs ----

  protected selectTab(value: string | undefined): void {
    const tab = entryTab(value);
    if (tab === this.tab()) return;
    this.tab.set(tab);
    this.ensure(tab);
    if (this.clientId() === null) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: tab === 'weight' ? null : tab },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  /** A tab other than the first is read when it is first opened. */
  private ensure(tab: EntryTab): void {
    if (this.loadedKey === null) return;
    if (tab === 'measurements' && this.measurementState() === 'idle') void this.loadMeasurements();
    if (tab === 'photos' && this.photoState() === 'idle') void this.loadPhotos();
  }

  protected day(date: string): string {
    return dayWords(date, this.today(), this.locale);
  }

  protected dayLong(date: string): string {
    return formatDate(date, 'EEEE d MMMM', this.locale);
  }

  protected moreFor(date: string): string {
    return $localize`More for ${this.day(date)}:day:`;
  }

  protected moreForMeasurement(row: MeasurementRow): string {
    return $localize`More for ${row.name}:name:, ${this.day(row.measurement.measurementDate)}:day:`;
  }

  // ---- reading ----

  private historyRange(ranges: readonly Range[], earlierDate: string | null): Range {
    const previous = this.earlierRange(ranges);
    if (!earlierDate || earlierDate >= previous.from) return previous;
    const to = addDays(earlierDate, 1);
    return { from: addDays(to, -WINDOW_DAYS), to };
  }

  private firstRange(): Range {
    const to = addDays(this.today(), 1);
    return { from: addDays(to, -WINDOW_DAYS), to };
  }

  private earlierRange(ranges: readonly Range[]): Range {
    const to = ranges[ranges.length - 1].from;
    return { from: addDays(to, -WINDOW_DAYS), to };
  }

  protected loadWeight(): Promise<void> {
    return this.scope.run('weight', async (owner) => {
      this.weightState.set('loading');
      try {
        const range = this.firstRange();
        const [window, span] = await owner.wait(
          Promise.all([
            firstValueFrom(
              this.entries.weighIns(this.clientId(), this.unit(), range.from, range.to),
            ),
            firstValueFrom(this.entries.weightSpan(this.clientId())),
          ]),
        );
        this.weightRanges = [range];
        this.weightWindows.set([window]);
        this.firstWeighIn = span.firstDate;
        this.weightMore.set(span.firstDate !== null && span.firstDate < range.from);
        this.weightState.set('ready');
      } catch {
        if (!owner.current) return;
        this.weightState.set('error');
      }
    });
  }

  protected showEarlierWeight(): Promise<void> {
    return this.scope.run('weight-earlier', async (owner) => {
      this.weightEarlierBusy.set(true);
      try {
        const range = this.earlierRange(this.weightRanges);
        const window = await owner.wait(
          firstValueFrom(this.entries.weighIns(this.clientId(), this.unit(), range.from, range.to)),
        );
        this.weightRanges = [...this.weightRanges, range];
        this.weightWindows.update((windows) => [...windows, window]);
        this.weightMore.set(this.firstWeighIn !== null && this.firstWeighIn < range.from);
      } catch {
        if (!owner.current) return;
      } finally {
        if (owner.current) this.weightEarlierBusy.set(false);
      }
    });
  }

  /** The same years again, after a write or a change of unit. */
  private refreshWeight(): Promise<void> {
    if (this.weightState() !== 'ready') return this.loadWeight();
    return this.scope.run('weight', async (owner) => {
      try {
        const ranges = this.weightRanges;
        const [windows, span] = await owner.wait(
          Promise.all([
            Promise.all(
              ranges.map((range) =>
                firstValueFrom(
                  this.entries.weighIns(this.clientId(), this.unit(), range.from, range.to),
                ),
              ),
            ),
            // A weight logged for a day before the years shown moves the first day back: say so.
            firstValueFrom(this.entries.weightSpan(this.clientId())),
          ]),
        );
        this.weightWindows.set(windows);
        this.firstWeighIn = span.firstDate;
        this.weightMore.set(
          span.firstDate !== null && span.firstDate < ranges[ranges.length - 1].from,
        );
      } catch {
        if (!owner.current) return;
        this.weightState.set('error');
      }
    });
  }

  protected changeUnit(unit: MassUnit): void {
    this.unit.set(unit);
    void this.refreshWeight();
  }

  protected loadMeasurements(): Promise<void> {
    return this.scope.run('measurements', async (owner) => {
      this.measurementState.set('loading');
      try {
        const range = this.firstRange();
        const window = await owner.wait(
          firstValueFrom(
            this.entries.measurements(this.clientId(), this.girth(), range.from, range.to),
          ),
        );
        this.measurementRanges = [range];
        this.measurementWindows.set([window]);
        this.earlierMeasurementDate = window.earlierDate ?? null;
        this.measurementMore.set(this.earlierMeasurementDate !== null);
        this.measurementState.set('ready');
      } catch {
        if (!owner.current) return;
        this.measurementState.set('error');
      }
    });
  }

  protected showEarlierMeasurements(): Promise<void> {
    return this.scope.run('measurements-earlier', async (owner) => {
      this.measurementEarlierBusy.set(true);
      try {
        const range = this.historyRange(this.measurementRanges, this.earlierMeasurementDate);
        const window = await owner.wait(
          firstValueFrom(
            this.entries.measurements(this.clientId(), this.girth(), range.from, range.to),
          ),
        );
        this.measurementRanges = [...this.measurementRanges, range];
        this.measurementWindows.update((windows) => [...windows, window]);
        // The server boundary crosses empty years without guessing from this window.
        this.earlierMeasurementDate = window.earlierDate ?? null;
        this.measurementMore.set(this.earlierMeasurementDate !== null);
      } catch {
        if (!owner.current) return;
      } finally {
        if (owner.current) this.measurementEarlierBusy.set(false);
      }
    });
  }

  private refreshMeasurements(): Promise<void> {
    if (this.measurementState() !== 'ready') return this.loadMeasurements();
    return this.scope.run('measurements', async (owner) => {
      try {
        const windows = await owner.wait(
          Promise.all(
            this.measurementRanges.map((range) =>
              firstValueFrom(
                this.entries.measurements(this.clientId(), this.girth(), range.from, range.to),
              ),
            ),
          ),
        );
        this.measurementWindows.set(windows);
        this.earlierMeasurementDate = windows.at(-1)?.earlierDate ?? null;
        this.measurementMore.set(this.earlierMeasurementDate !== null);
      } catch {
        if (!owner.current) return;
        this.measurementState.set('error');
      }
    });
  }

  protected changeGirth(unit: GirthUnit): void {
    this.girth.set(unit);
    void this.refreshMeasurements();
  }

  protected loadPhotos(): Promise<void> {
    return this.scope.run('photos', async (owner) => {
      this.photoState.set('loading');
      try {
        const range = this.firstRange();
        const window = await owner.wait(
          firstValueFrom(this.entries.photos(this.clientId(), range.from, range.to)),
        );
        this.photoRanges = [range];
        this.photoWindows.set([window.photos]);
        this.earlierPhotoDate = window.earlierDate ?? null;
        this.photoMore.set(this.earlierPhotoDate !== null);
        this.photoState.set('ready');
        await owner.wait(this.grantThumbnails(window.photos, owner));
      } catch {
        if (!owner.current) return;
        if (this.photoState() !== 'ready') this.photoState.set('error');
      }
    });
  }

  protected showEarlierPhotos(): Promise<void> {
    return this.scope.run('photos-earlier', async (owner) => {
      this.photoEarlierBusy.set(true);
      try {
        const range = this.historyRange(this.photoRanges, this.earlierPhotoDate);
        const window = await owner.wait(
          firstValueFrom(this.entries.photos(this.clientId(), range.from, range.to)),
        );
        this.photoRanges = [...this.photoRanges, range];
        this.photoWindows.update((windows) => [...windows, window.photos]);
        this.earlierPhotoDate = window.earlierDate ?? null;
        this.photoMore.set(this.earlierPhotoDate !== null);
        await owner.wait(this.grantThumbnails(window.photos, owner));
      } catch {
        if (!owner.current) return;
      } finally {
        if (owner.current) this.photoEarlierBusy.set(false);
      }
    });
  }

  private refreshPhotos(): Promise<void> {
    if (this.photoState() !== 'ready') return this.loadPhotos();
    return this.scope.run('photos', async (owner) => {
      try {
        const windows = await owner.wait(
          Promise.all(
            this.photoRanges.map((range) =>
              firstValueFrom(this.entries.photos(this.clientId(), range.from, range.to)),
            ),
          ),
        );
        this.photoWindows.set(windows.map((window) => window.photos));
        this.earlierPhotoDate = windows.at(-1)?.earlierDate ?? null;
        this.photoMore.set(this.earlierPhotoDate !== null);
        await owner.wait(
          this.grantThumbnails(
            windows.flatMap((window) => window.photos),
            owner,
          ),
        );
      } catch {
        if (!owner.current) return;
        this.photoState.set('error');
      }
    });
  }

  /**
   * A thumbnail path is not a public address: it needs a short-lived grant. One grant covers a screenful
   * of tiles, and a failure leaves the tiles saying so rather than failing the page.
   */
  private async grantThumbnails(
    photos: readonly ProgressPhoto[],
    owner: TenantOperation,
  ): Promise<void> {
    const wanted = photos
      .filter((photo) => photo.status === 'Active' && !this.thumbnails().has(photo.mediaAssetId))
      .map((photo) => photo.mediaAssetId);
    for (let start = 0; start < wanted.length; start += GRANT_CHUNK) {
      try {
        await owner.wait(this.csrf.refresh());
        const granted = await owner.wait(
          firstValueFrom(this.entries.thumbnails(wanted.slice(start, start + GRANT_CHUNK))),
        );
        this.thumbnails.update((known) => new Map([...known, ...granted]));
      } catch {
        return;
      }
    }
  }

  protected thumbnail(tile: PhotoTile): string | null {
    return this.thumbnails().get(tile.photo.mediaAssetId) ?? null;
  }

  // ---- what the sheets changed ----

  protected changed(kind: EntryKind): void {
    switch (kind) {
      case 'weight':
        void this.refreshWeight();
        break;
      case 'measurements':
        void this.refreshMeasurements();
        break;
      default:
        void this.refreshPhotos();
        break;
    }
  }

  protected weighInAction(action: string, row: WeighInRow, sheets: EntrySheets): void {
    if (action === 'correct') sheets.correctWeight(row);
    else if (action === 'move') sheets.moveWeighIn(row);
    else sheets.weighInChanges(row);
  }

  protected measurementAction(action: string, row: MeasurementRow, sheets: EntrySheets): void {
    if (action === 'correct') sheets.correctMeasurement(row);
    else sheets.measurementChanges(row);
  }
}
