import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  LOCALE_ID,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { GuardedSheets, type Closable } from '../../core/forms/guarded-sheets';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Button } from '../../ui/button';
import { isoWeekdayOfName } from '../../ui/calendar';
import { UiConfirm } from '../../ui/confirm';
import { Skeleton } from '../../ui/skeleton';
import { Sparkline } from '../../ui/sparkline';
import { dayWords } from '../progress/progress-entries.models';
import {
  changeWords,
  groupLifts,
  liftSummary,
  mapMax,
  valueWords,
  type Lift,
  type MaxEntry,
} from './client-strength.models';
import { ClientWorkspaceContext } from './client-workspace.context';
import { ExerciseHistory } from './exercise-history-sheet';
import type { ExerciseChoice } from './exercise-picker';
import { RecordMax } from './record-max-sheet';

type PageState = 'loading' | 'ready' | 'error';

/** The most maxes read for one client: ten pages of the server's largest, far beyond a real history. */
const PAGES = 10;
const PAGE = 100;

/**
 * A client's strength history for their coach (C3; R5.3d): every max on record grouped by lift, each
 * with how it has moved, and how they have performed an exercise. It replaces the older training
 * tools. The server lists a program's training maxes beside the recorded ones (STR-015); this only
 * groups and words them, and records a new one in a sheet.
 */
@Component({
  selector: 'app-client-strength',
  imports: [Button, ExerciseHistory, RecordMax, Skeleton, Sparkline, UiConfirm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-strength.html',
  styleUrl: './client-strength.scss',
})
export class ClientStrength extends GuardedSheets {
  private readonly context = inject(ClientWorkspaceContext);
  private readonly api = inject(ApiClient);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly tenants = inject(TenantStore);
  protected readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  /**
   * How many changes the program page above has made (applied maxes, an assignment, a rename). Each new
   * one may have added or renamed a program's training max (STR-015), so the list reads again, quietly.
   */
  readonly changes = input(0);

  private readonly recordSheet = viewChild.required<TemplateRef<unknown>>('recordSheet');
  private readonly historySheet = viewChild.required<TemplateRef<unknown>>('historySheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmTemplate');

  protected readonly loadingLabel = $localize`Reading their maxes`;
  protected readonly state = signal<PageState>('loading');
  protected readonly failure = signal('');
  protected readonly truncated = signal(false);
  protected readonly today = signal('');
  private readonly entries = signal<readonly MaxEntry[]>([]);

  protected readonly clientId = computed(() => this.context.clientId());
  protected readonly name = computed(
    () => this.context.profile()?.firstName || $localize`This client`,
  );
  protected readonly firstDay = computed(() =>
    isoWeekdayOfName(this.context.workspace()?.weekStartsOn),
  );
  protected readonly lifts = computed(() => groupLifts(this.entries()));
  /** The lifts that already have a max, offered first when a lift is chosen. */
  protected readonly choices = computed<ExerciseChoice[]>(() =>
    [...this.lifts()]
      .map((lift) => ({ id: lift.exerciseId, name: lift.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  /** Everything the template says about a lift, worked out once. */
  protected readonly views = computed(() =>
    this.lifts().map((lift) => ({
      lift,
      value: valueWords(lift.latest.value, lift.latest.unit, this.locale),
      summary: liftSummary(lift, this.today(), this.locale),
      line: this.lineOf(lift),
      also: lift.also.map((item) => ({
        kind: item.kindLabel,
        value: valueWords(item.value, item.unit, this.locale),
        day: dayWords(item.date, this.today(), this.locale),
      })),
      history: lift.entries.map((entry) => ({
        entry,
        value: valueWords(entry.value, entry.unit, this.locale),
        day: dayWords(entry.date, this.today(), this.locale),
      })),
    })),
  );

  /** The workspace and client the list on screen was read for. */
  private loadedKey: string | null = null;
  /** The program page's count of changes the list on screen has caught up with. */
  private readAfter = 0;

  constructor() {
    super();
    this.scope.onReset(() => {
      this.loadedKey = null;
      this.entries.set([]);
      this.today.set('');
      this.state.set('loading');
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const changes = this.changes();
      const key = tenantId && clientId ? `${tenantId}:${clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        this.readAfter = changes;
        untracked(() => void this.load());
      } else if (key && changes !== this.readAfter) {
        // A newer read replaces one still on its way (one lane), so the list ends on what the change wrote.
        this.readAfter = changes;
        untracked(() => void this.load(true));
      }
    });
  }

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  /** Reads every max; after a save it reads quietly, so the list does not flash. */
  protected async load(quiet = false): Promise<void> {
    return this.scope.run('load', async (owner) => {
      if (!quiet) this.state.set('loading');
      try {
        const clientId = this.context.clientId();
        const [today] = await owner.wait(Promise.all([this.calendar.resolveToday()]));
        this.today.set(today);
        const all: MaxEntry[] = [];
        let total = 0;
        for (let page = 0; page < PAGES; page++) {
          const read = await owner.wait(
            firstValueFrom(
              this.api.listStrengthMaxes(clientId, undefined, page * PAGE, PAGE, true),
            ),
          );
          total = Number(read.total);
          all.push(...read.items.map(mapMax));
          if (all.length >= total || read.items.length === 0) break;
        }
        this.truncated.set(all.length < total);
        this.entries.set(all);
        this.state.set('ready');
      } catch (error) {
        if (!owner.current) return;
        this.failure.set(apiErrorMessage(error, $localize`Their maxes could not be loaded.`));
        this.state.set('error');
      }
    });
  }

  /** "Set Tue 15 Sep · +2.5 kg since Wed 5 Aug". */
  private lineOf(lift: Lift): string {
    const day = dayWords(lift.latest.date, this.today(), this.locale);
    const set = $localize`Set ${day}:day:`;
    const change = changeWords(lift, this.today(), this.locale);
    return change ? `${set} · ${change}` : set;
  }

  protected record(lift: Lift | null): void {
    this.start = lift ? { id: lift.exerciseId, name: lift.name } : null;
    this.startUnit = lift?.latest.unit ?? 'Kilogram';
    this.show(
      this.recordSheet(),
      lift
        ? $localize`Record a max for ${lift.name}:lift:`
        : $localize`Record a max for ${this.name()}:name:`,
    );
  }

  protected performance(lift: Lift | null): void {
    this.start = lift ? { id: lift.exerciseId, name: lift.name } : null;
    this.show(
      this.historySheet(),
      lift
        ? $localize`How ${this.name()}:name: has done on ${lift.name}:lift:`
        : $localize`How ${this.name()}:name: has done on an exercise`,
    );
  }

  protected recorded(saved: MaxEntry | null, sheet: Closable): void {
    if (saved === null) return void this.closeAsking(sheet);
    this.done(
      sheet,
      $localize`${saved.exerciseName}:lift: — ${saved.kindLabel}:kind: ${valueWords(saved.value, saved.unit, this.locale)}:value: recorded.`,
    );
    void this.load(true);
  }

  /** What the open sheet starts from; a sheet reads it once, when it opens. */
  protected start: ExerciseChoice | null = null;
  protected startUnit: 'Kilogram' | 'Pound' = 'Kilogram';
}
