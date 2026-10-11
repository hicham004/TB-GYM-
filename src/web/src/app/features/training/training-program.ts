import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { trainingReadAccessLabel } from './training-read.models';
import {
  focusWeek,
  mapTrainingProgram,
  mapWorkoutHistory,
  programAction,
  unitLabel,
  weekFill,
  type HistoryWorkout,
  type ProgramWeek,
  type TrainingProgramRead,
} from './training-program.models';

/** Finished workouts shown before "Show more": history is collapsed by default (§2 rule 7). */
const HISTORY_PREVIEW = 4;

/**
 * The client's Training tab (M3): the program with "week x of y", this week's sessions done,
 * missed and still to come, every week behind a disclosure, and finished workouts with their
 * records. Session states and records come from the server (TRN-019, TRN-020); the workout
 * itself still happens in `TodayTraining`.
 */
@Component({
  selector: 'app-training-program',
  imports: [
    DatePipe,
    DecimalPipe,
    NgTemplateOutlet,
    RouterLink,
    Button,
    ButtonLink,
    EmptyState,
    Icon,
    Skeleton,
  ],
  templateUrl: './training-program.html',
  styleUrls: ['./training-program.scss', './training-program-lists.scss'],
})
export class TrainingProgram {
  private readonly api = inject(ApiClient);
  private readonly access = inject(ClientAccessStore);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private loadedTenantId: string | null = null;
  /**
   * A notice's link (R5.1c): `?week=3` opens that week, `?workout=<id>` shows that finished workout.
   * Each is followed once, the first time its part of the page has loaded.
   */
  private readonly linkedProgram = this.route?.snapshot.queryParamMap.get('program');
  private linkedWeek = Number(this.route?.snapshot.queryParamMap.get('week') ?? NaN);
  protected readonly linkedWorkout = signal(
    this.route?.snapshot.queryParamMap.get('workout') ?? null,
  );

  protected readonly read = signal<TrainingProgramRead | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly history = signal<readonly HistoryWorkout[]>([]);
  protected readonly historyNextSkip = signal<number | null>(null);
  protected readonly historyLoading = signal(true);
  protected readonly historyError = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly showAllHistory = signal(false);
  /** Weeks the client opened below the one in focus, which is always shown; all start closed. */
  protected readonly openWeeks = signal<ReadonlySet<number>>(new Set());

  protected readonly accessLabel = trainingReadAccessLabel;
  protected readonly unitLabel = unitLabel;
  protected readonly weekFill = weekFill;
  protected readonly canMessage = computed(
    () => this.access.decision('Messaging')?.isAllowed ?? false,
  );
  protected readonly program = computed(() => this.read()?.program ?? null);
  protected readonly action = computed(() => {
    const read = this.read();
    return read?.program ? programAction(read.program, read.localDate) : { kind: 'none' as const };
  });
  protected readonly focus = computed(() => {
    const program = this.program();
    return program ? focusWeek(program) : null;
  });
  protected readonly otherWeeks = computed(() =>
    (this.program()?.weeks ?? []).filter((week) => week !== this.focus()),
  );
  protected readonly historyShown = computed(() =>
    this.showAllHistory() ? this.history() : this.history().slice(0, HISTORY_PREVIEW),
  );
  protected readonly canShowMoreHistory = computed(
    () =>
      (!this.showAllHistory() && this.history().length > HISTORY_PREVIEW) ||
      (this.showAllHistory() && this.historyNextSkip() !== null),
  );

  constructor() {
    // A new workspace or session starts from nothing, and the effect below reloads it.
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.reset();
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId === this.loadedTenantId) return;
      this.loadedTenantId = tenantId;
      untracked(() => {
        this.reset();
        if (tenantId !== null) {
          void this.loadProgram();
          void this.loadHistory();
        }
      });
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected isOpen(week: ProgramWeek): boolean {
    return this.openWeeks().has(week.number);
  }

  protected toggleWeek(week: ProgramWeek): void {
    this.openWeeks.update((open) => {
      const next = new Set(open);
      if (!next.delete(week.number)) next.add(week.number);
      return next;
    });
  }

  protected retryProgram(): void {
    void this.loadProgram();
  }

  protected retryHistory(): void {
    void this.loadHistory();
  }

  protected async moreHistory(): Promise<void> {
    if (!this.showAllHistory()) {
      this.showAllHistory.set(true);
      return;
    }
    const skip = this.historyNextSkip();
    if (skip === null || this.loadingMore()) return;
    return this.scope.run('history-more', async (owner) => {
      this.loadingMore.set(true);
      this.historyError.set(null);
      try {
        const page = mapWorkoutHistory(
          await owner.wait(firstValueFrom(this.api.getMyWorkoutHistory(skip))),
        );
        const known = new Set(this.history().map((item) => item.id));
        this.history.update((items) => [
          ...items,
          ...page.items.filter((item) => !known.has(item.id)),
        ]);
        this.historyNextSkip.set(page.nextSkip);
      } catch (error) {
        if (owner.current) {
          this.historyError.set(
            apiErrorMessage(error, $localize`Older workouts could not be loaded.`),
          );
        }
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  private async loadProgram(): Promise<void> {
    return this.scope.run('program', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        const read = mapTrainingProgram(
          await owner.wait(firstValueFrom(this.api.getMyTrainingProgram())),
        );
        this.read.set(read);
        this.openWeeks.set(new Set());
        this.followWeekLink();
      } catch (error) {
        if (owner.current) {
          this.error.set(apiErrorMessage(error, $localize`Your program could not be loaded.`));
        }
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  private async loadHistory(): Promise<void> {
    return this.scope.run('history', async (owner) => {
      this.historyLoading.set(true);
      this.historyError.set(null);
      try {
        const page = mapWorkoutHistory(
          await owner.wait(firstValueFrom(this.api.getMyWorkoutHistory(0))),
        );
        this.history.set(page.isAllowed ? page.items : []);
        this.historyNextSkip.set(page.isAllowed ? page.nextSkip : null);
        this.followWorkoutLink();
      } catch (error) {
        if (owner.current) {
          this.historyError.set(
            apiErrorMessage(error, $localize`Your finished workouts could not be loaded.`),
          );
        }
      } finally {
        if (owner.current) this.historyLoading.set(false);
      }
    });
  }

  /** Opens the week a notice named, or its part of the page if it is the week in focus, and brings it into view. */
  private followWeekLink(): void {
    const number = this.linkedWeek;
    this.linkedWeek = NaN;
    const week = this.program()?.weeks.find((item) => item.number === number);
    if (!week || !week.visible || (this.linkedProgram && this.program()?.id !== this.linkedProgram))
      return;
    const inFocus = week === this.focus();
    if (!inFocus && week.visible && week.sessions.length > 0 && !this.isOpen(week)) {
      this.toggleWeek(week);
    }

    this.bringIntoView(inFocus ? 'focus-heading' : `week-row-${week.number}`);
  }

  /** Shows the finished workout a coach's note is on, beyond the first few if need be. */
  private followWorkoutLink(): void {
    const id = this.linkedWorkout();
    const index = id === null ? -1 : this.history().findIndex((item) => item.id === id);
    if (index < 0) return;
    if (index >= HISTORY_PREVIEW) this.showAllHistory.set(true);
    this.bringIntoView(`workout-${id}`);
  }

  private bringIntoView(id: string): void {
    afterNextRender(
      () => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      { injector: this.injector },
    );
  }

  private reset(): void {
    this.read.set(null);
    this.loading.set(true);
    this.error.set(null);
    this.history.set([]);
    this.historyNextSkip.set(null);
    this.historyLoading.set(true);
    this.historyError.set(null);
    this.loadingMore.set(false);
    this.showAllHistory.set(false);
    this.openWeeks.set(new Set());
  }
}
