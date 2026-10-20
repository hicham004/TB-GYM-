import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { Sparkline } from '../../ui/sparkline';
import { SHEET_STYLES } from '../../ui/sheet-parts';
import { dayWords } from '../progress/progress-entries.models';
import { mapPerformance, summarize, valueWords, type Performance } from './client-strength.models';
import { ExercisePicker, type ExerciseChoice } from './exercise-picker';

/** One read is this many rows; "Show more" reads the next. */
const PAGE = 50;

/**
 * How a client has performed one exercise (R5.3d), read-only, in a sheet: the best estimated max, a
 * small chart of the estimates over time, and every completed set newest first. It starts on the lift
 * it was opened from, or on a choice of lifts when there is none, and can change lift without closing.
 */
@Component({
  selector: 'app-exercise-history',
  imports: [Button, ExercisePicker, Skeleton, Sparkline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      @if (exercise(); as lift) {
        <div class="head">
          <h3 class="lift" dir="auto">{{ lift.name }}</h3>
          <button
            appButton
            type="button"
            variant="text"
            (click)="exercise.set(null)"
            data-change
            i18n
          >
            Choose another exercise
          </button>
        </div>
        @if (state() === 'loading') {
          <app-skeleton [label]="loadingLabel" [lines]="4" />
        } @else if (state() === 'error') {
          <div class="problem-text" role="alert" data-error>
            <span>{{ failure() }}</span
            >&ngsp;<button appButton type="button" variant="text" (click)="load(false)" i18n>
              Try again
            </button>
          </div>
        } @else if (rows().length === 0) {
          <p class="about" data-empty i18n>
            {{ firstName() }} has no completed set of {{ lift.name }} yet.
          </p>
        } @else {
          @if (summary().best; as best) {
            <p class="about" data-best>
              <strong i18n>Best estimated max {{ bestWords() }}</strong
              >&ngsp;<span class="muted">{{ bestDay() }}</span>
            </p>
          }
          @if (summary().series; as series) {
            <app-sparkline [values]="series" [summary]="chartSummary()" class="chart" />
          }
          @if (summary().best) {
            <p class="how muted" data-how i18n>
              A set with an RPE is read on the RTS chart, as the Training maxes panel reads it. A
              set without one is read by Epley.
            </p>
          }
          <ul class="rows" data-rows>
            @for (row of rows(); track row.key) {
              <li class="row" data-performance>
                <div class="what">
                  <strong class="when">{{ dayOf(row) }}</strong
                  >&ngsp;<span class="set">{{ row.set }}</span>
                </div>
                &ngsp;
                <div class="meta">
                  @if (row.effort) {
                    <span>{{ row.effort }}</span
                    >&ngsp;
                  }
                  @if (estimateWords(row); as estimate) {
                    <span data-estimate>{{ estimate }}</span
                    >&ngsp;
                  }
                  @if (volumeWords(row); as volume) {
                    <span i18n>Volume {{ volume }}</span
                    >&ngsp;
                  }
                  @if (row.substituted) {
                    <span class="tag" i18n>Substituted</span>
                  }
                </div>
                @if (row.note) {
                  <p class="note" dir="auto">{{ row.note }}</p>
                }
              </li>
            }
          </ul>
          @if (more()) {
            <button
              appButton
              type="button"
              variant="outlined"
              [loading]="reading()"
              (click)="load(true)"
              data-more
              i18n
            >
              Show more
            </button>
          }
        }
      } @else {
        <app-exercise-picker [label]="pickLabel" [suggested]="suggested()" [(chosen)]="exercise" />
      }
      <div class="foot">
        <button appButton type="button" variant="text" (click)="closed.emit()" i18n>Close</button>
      </div>
    </div>
  `,
  styles: [
    SHEET_STYLES,
    `
      .head {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 0.75rem;
        justify-content: space-between;
      }

      .lift {
        color: var(--tb-ink);
        font-size: 1.125rem;
        margin: 0;
        overflow-wrap: anywhere;
      }

      .chart {
        block-size: 3rem;
        inline-size: 100%;
      }

      .how {
        font-size: 0.8125rem;
        margin: 0;
      }

      .rows {
        display: flex;
        flex-direction: column;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .row {
        border-block-start: 1px solid var(--tb-line);
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding-block: 0.625rem;
      }

      .what {
        align-items: baseline;
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 0.75rem;
      }

      .when {
        color: var(--tb-ink);
      }

      .set {
        color: var(--tb-ink);
        font-variant-numeric: tabular-nums;
      }

      .meta {
        color: var(--tb-muted);
        display: flex;
        flex-wrap: wrap;
        font-size: 0.875rem;
        gap: 0.125rem 0.75rem;
      }

      .tag {
        background: var(--tb-surface-2);
        border-radius: 999px;
        padding-inline: 0.5rem;
      }

      .note {
        color: var(--tb-muted);
        font-size: 0.875rem;
        margin: 0;
        overflow-wrap: anywhere;
      }

      .foot {
        display: flex;
        justify-content: flex-end;
      }
    `,
  ],
})
export class ExerciseHistory {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  readonly today = input.required<string>();
  readonly locale = input<string>('en');
  /** The lifts with something on record, offered before any search. */
  readonly suggested = input<readonly ExerciseChoice[]>([]);
  /** The lift to open on; null opens the choice of lifts. */
  readonly start = input<ExerciseChoice | null>(null);
  readonly closed = output<void>();

  protected readonly pickLabel = $localize`Which exercise?`;
  protected readonly loadingLabel = $localize`Reading their sets`;
  protected readonly exercise = linkedSignal<ExerciseChoice | null>(() => this.start());
  protected readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly failure = signal('');
  protected readonly reading = signal(false);
  private readonly read = signal<readonly Performance[]>([]);
  private readonly total = signal(0);
  private skip = 0;

  /** Newest first, whatever order the server read them in. */
  protected readonly rows = computed(() =>
    [...this.read()].sort((a, b) => b.date.localeCompare(a.date)),
  );
  protected readonly summary = computed(() => summarize(this.read()));
  protected readonly more = computed(() => this.read().length < this.total());
  protected readonly bestWords = computed(() => {
    const best = this.summary().best;
    return best ? valueWords(best.value, best.unit, this.locale()) : '';
  });
  protected readonly bestDay = computed(() => {
    const best = this.summary().best;
    return best ? dayWords(best.date, this.today(), this.locale()) : '';
  });
  protected readonly chartSummary = computed(() => {
    const summary = this.summary();
    const name = this.exercise()?.name ?? '';
    return $localize`Estimated max of ${name}:lift: over ${summary.count}:count: sets, best ${this.bestWords()}:best:.`;
  });

  constructor() {
    this.scope.onReset(() => {
      this.read.set([]);
      this.state.set('idle');
    });
    effect(() => {
      const lift = this.exercise();
      this.read.set([]);
      this.total.set(0);
      this.skip = 0;
      this.state.set(lift ? 'loading' : 'idle');
      if (lift) untracked(() => void this.load(false));
    });
  }

  protected dayOf(row: Performance): string {
    return dayWords(row.date, this.today(), this.locale());
  }

  /** "Estimated max 80.75 kg by the RTS chart": each estimate names the formula that read it (TRAIN-4). */
  protected estimateWords(row: Performance): string | null {
    if (row.estimate === null || !row.unit) return null;
    const value = valueWords(row.estimate, row.unit, this.locale());
    switch (row.formula) {
      case 'RpeChart':
        return $localize`Estimated max ${value}:estimate: by the RTS chart`;
      case 'Epley':
        return $localize`Estimated max ${value}:estimate: by Epley`;
      default:
        return $localize`Estimated max ${value}:estimate:`;
    }
  }

  protected volumeWords(row: Performance): string | null {
    return row.volume !== null && row.unit ? valueWords(row.volume, row.unit, this.locale()) : null;
  }

  /** Reads the first page, or the next one when `append`. */
  protected async load(append: boolean): Promise<void> {
    const lift = this.exercise();
    if (!lift) return;
    return this.scope.run('read', async (owner) => {
      if (append) this.reading.set(true);
      else this.state.set('loading');
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.getExerciseHistory(this.clientId(), lift.id, this.skip, PAGE)),
        );
        if (this.exercise()?.id !== lift.id) return;
        const rows = page.items.map((item, index) => mapPerformance(item, this.skip + index));
        this.read.update((current) => (append ? [...current, ...rows] : rows));
        this.skip += page.items.length;
        this.total.set(Number(page.total));
        this.state.set('ready');
      } catch (error) {
        if (!owner.current) return;
        this.failure.set(apiErrorMessage(error, $localize`Their sets could not be read.`));
        this.state.set('error');
      } finally {
        if (owner.current) this.reading.set(false);
      }
    });
  }
}
