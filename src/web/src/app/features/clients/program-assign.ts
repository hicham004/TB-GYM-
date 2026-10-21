import { formatDate, formatNumber } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ClientEnrollment } from '../../core/api/api.models';
import type {
  PreviousProgramMaxesView,
  ProgramTemplateSummary,
  ProgramTemplateVersionView,
  StrengthMaxView,
  TrainingLoadRoundingMode,
  TrainingLoadUnit,
  TrainingMesocycleView,
} from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import { IntentIdempotencyKey } from '../training/training-assignment-state';
import { unitLabel } from '../training/training-program.models';
import { ClientProgramApi } from './client-program-api';
import {
  assignmentErrors,
  assignmentRequest,
  defaultStartDate,
  exercisesNeedingMax,
  maxRow,
  planChoices,
  PROGRAM_NAME_LIMIT,
  programChoices,
  programWriteError,
  runSummary,
  serverCode,
  withMaxMode,
  withSuggestedMax,
  withTypedMax,
  type AssignmentValues,
  type MaxRow,
} from './client-program-forms.models';

/**
 * Assign program: a plan, one of the coach's published programs, a start date and, when the program
 * works its loads out from training maxes, those maxes. Each max starts where the client's latest
 * program left it, and that program's logged-set suggestion is one tap away (STR-014). Assigning
 * copies the program to the client (TRN-001); later edits to the original never reach it. The load settings that most coaches never
 * touch sit behind one line that says what they are. Everything is checked again by the server:
 * the plan must cover every week, and the dates must not overlap another program (TRN-011).
 */
@Component({
  selector: 'app-program-assign',
  imports: [Button, Control, Field, FormSummary, RouterLink, SegmentedControl, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      @switch (load()) {
        @case ('loading') {
          <app-skeleton [label]="loadingLabel" [lines]="4" />
        }
        @case ('error') {
          <div class="problem-row">
            <p role="alert" i18n>The programs could not be loaded.</p>
            <button appButton type="button" variant="outlined" (click)="reload()" i18n>
              Try again
            </button>
          </div>
        }
        @default {
          @if (plans().length === 0) {
            <p class="notice" dir="auto" i18n>
              {{ firstName() }} has no plan that includes training, so there is nothing to assign
              yet. Add one under Service &amp; access.
            </p>
          } @else {
            @if (plans().length > 1) {
              <app-field
                [label]="planLabel"
                [errors]="shows('enrollmentId') ? errors()['enrollmentId'] : null"
              >
                <select
                  appControl
                  (change)="choosePlan($any($event.target).value)"
                  (blur)="attempt.touch('enrollmentId')"
                >
                  <option value="" i18n>Choose a plan…</option>
                  @for (plan of plans(); track plan.id) {
                    <option [value]="plan.id" [selected]="plan.id === enrollmentId()">
                      {{ plan.label }}
                    </option>
                  }
                </select>
              </app-field>
            } @else {
              <p class="plan-line">
                <span class="plan-caption" i18n>Plan</span>
                <span dir="auto">{{ plans()[0].label }}</span>
              </p>
            }

            <app-field
              [label]="programLabel"
              [errors]="shows('templateVersionId') ? errors()['templateVersionId'] : null"
            >
              <select
                appControl
                (change)="chooseProgram($any($event.target).value)"
                (blur)="attempt.touch('templateVersionId')"
              >
                <option value="" i18n>Choose a program…</option>
                @for (program of programs(); track program.versionId) {
                  <option
                    [value]="program.versionId"
                    [selected]="program.versionId === versionId()"
                  >
                    {{ program.label }}
                  </option>
                }
              </select>
            </app-field>
            @if (templates().length < templateTotal()) {
              <button
                appButton
                type="button"
                variant="text"
                class="more"
                [loading]="loadingMore()"
                (click)="loadMore()"
                i18n
              >
                Show more programs
              </button>
            }
            @if (programs().length === 0 && templateTotal() === 0) {
              <p class="notice" i18n>
                You have no published programs yet.
                <a [routerLink]="['/training', 'programs']">Build and publish one</a>
                to assign it.
              </p>
            }

            <app-field
              [label]="startLabel"
              [errors]="shows('startDate') ? errors()['startDate'] : null"
            >
              <input
                appControl
                type="date"
                [value]="startDate()"
                (input)="startDate.set($any($event.target).value)"
                (blur)="attempt.touch('startDate')"
              />
            </app-field>
            @if (run(); as summary) {
              <p class="run" [class.warn]="summary.pastPlanEnd" aria-live="polite">
                {{ summary.text }}
              </p>
              @if (summary.pastPlanEnd) {
                <p class="warn-text" dir="auto" role="status">{{ pastEnd() }}</p>
              }
            }

            <app-field
              [label]="nameLabel"
              [help]="nameHelp()"
              [errors]="shows('name') ? errors()['name'] : null"
            >
              <input
                appControl
                type="text"
                [attr.maxlength]="nameLimit"
                [attr.placeholder]="chosen()?.name ?? null"
                [value]="name()"
                (input)="name.set($any($event.target).value)"
                (blur)="attempt.touch('name')"
              />
            </app-field>

            <details class="loads">
              <summary>
                <span class="loads-title" i18n>Load settings</span>
                <span class="loads-now">{{ loadSummary() }}</span>
              </summary>
              <div class="loads-body">
                <app-segmented-control
                  [label]="unitText"
                  [options]="unitOptions"
                  [selected]="unit()"
                  (selectedChange)="chooseUnit($event)"
                />
                <app-field
                  [label]="incrementLabel"
                  [help]="incrementHelp"
                  [errors]="shows('loadIncrement') ? errors()['loadIncrement'] : null"
                >
                  <input
                    appControl
                    type="number"
                    min="0.01"
                    step="0.25"
                    [value]="increment() ?? ''"
                    (input)="setIncrement($any($event.target).valueAsNumber)"
                    (blur)="attempt.touch('loadIncrement')"
                  />
                </app-field>
                <app-segmented-control
                  [label]="roundingText"
                  [options]="roundingOptions"
                  [selected]="rounding()"
                  (selectedChange)="rounding.set($any($event))"
                />
              </div>
            </details>

            @if (maxes().length > 0) {
              <fieldset class="maxes">
                <legend i18n>Training maxes</legend>
                <p class="muted" i18n>
                  This program works its loads out from these. They are kept with the program, and
                  changing a max later never changes it.
                </p>
                @for (row of maxes(); track row.exerciseId; let index = $index) {
                  <div class="max">
                    @if (row.anchor) {
                      <app-segmented-control
                        [label]="howLabel(row)"
                        [options]="howOptions"
                        [selected]="row.mode"
                        (selectedChange)="chooseMode(index, $event)"
                      />
                    }
                    @if (row.mode === 'weekOne') {
                      <app-field
                        [label]="weekOneLabel(row)"
                        [help]="weekOneHelp(row)"
                        [errors]="
                          shows('max:' + row.exerciseId) ? errors()['max:' + row.exerciseId] : null
                        "
                      >
                        <div class="value-unit">
                          <input
                            appControl
                            type="number"
                            min="0.01"
                            step="0.25"
                            [value]="row.weekOneWeight ?? ''"
                            (input)="setWeekOneWeight(index, $any($event.target).valueAsNumber)"
                            (change)="estimate(index)"
                            (blur)="attempt.touch('max:' + row.exerciseId)"
                          />
                          <span class="unit">{{ unitName(row.unit) }}</span>
                        </div>
                      </app-field>
                      @if (estimates()[row.exerciseId]; as worked) {
                        <p class="estimate" dir="auto" aria-live="polite">{{ worked }}</p>
                      }
                    } @else {
                      <app-field
                        [label]="row.name"
                        [help]="maxHelp(row)"
                        [errors]="
                          shows('max:' + row.exerciseId) ? errors()['max:' + row.exerciseId] : null
                        "
                      >
                        <div class="value-unit">
                          <input
                            appControl
                            type="number"
                            min="0.01"
                            step="0.25"
                            [value]="row.value ?? ''"
                            (input)="setMax(index, $any($event.target).valueAsNumber)"
                            (blur)="attempt.touch('max:' + row.exerciseId)"
                          />
                          <span class="unit">{{ unitName(row.unit) }}</span>
                        </div>
                      </app-field>
                      @if (suggestionFor(row); as suggested) {
                        <div class="suggested">
                          <p dir="auto">{{ suggested.text }}</p>
                          <button
                            appButton
                            type="button"
                            variant="outlined"
                            (click)="useSuggestion(index)"
                          >
                            {{ suggested.action }}
                          </button>
                        </div>
                      }
                    }
                  </div>
                }
              </fieldset>
            } @else if (versionLoading()) {
              <app-skeleton [label]="loadingLabel" [lines]="2" />
            }
          }

          <app-form-summary>
            @if (error(); as message) {
              {{ message }}
            } @else if (attempt.wasTried() && problemCount() > 0) {
              <ng-container i18n>Check the fields marked above.</ng-container>
            }
          </app-form-summary>
          <div class="actions">
            <button appButton type="button" variant="text" (click)="closed.emit(null)" i18n>
              Not now
            </button>
            @if (plans().length > 0) {
              <button appButton type="submit" [loading]="busy()">
                @if (busy()) {
                  <ng-container i18n>Assigning…</ng-container>
                } @else {
                  <ng-container i18n>Assign program</ng-container>
                }
              </button>
            }
          </div>
        }
      }
    </form>
  `,
  styles: `
    :host {
      display: block;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    p {
      color: var(--tb-ink);
      margin: 0;
      overflow-wrap: anywhere;
    }

    .muted {
      color: var(--tb-muted);
    }

    .plan-line {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .plan-caption {
      color: var(--tb-muted);
      font-size: 0.8125rem;
      font-weight: 600;
    }

    .more {
      align-self: flex-start;
    }

    .run {
      font-weight: 600;
      margin-block-start: -0.5rem;
    }

    .suggested {
      align-items: center;
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 0.75rem;
      justify-content: space-between;
      margin-block-start: 0.5rem;
      padding: 0.625rem 0.75rem;
    }

    .suggested p {
      flex: 1 1 14rem;
      font-size: 0.875rem;
      text-wrap: pretty;
    }

    .warn,
    .warn-text {
      color: var(--tb-warning);
    }

    .warn-text {
      font-size: 0.875rem;
      margin-block-start: -0.5rem;
    }

    .notice {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      padding: 0.75rem 0.875rem;
    }

    .notice a {
      color: var(--tb-accent-ink);
      font-weight: 600;
    }

    .loads {
      border-block: 1px solid var(--tb-line);
      padding-block: 0.25rem;
    }

    .loads summary {
      align-items: baseline;
      cursor: pointer;
      display: flex;
      flex-wrap: wrap;
      gap: 0.125rem 0.75rem;
      min-block-size: 2.75rem;
      padding-block: 0.5rem;
    }

    .loads summary:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .loads-title {
      color: var(--tb-ink);
      font-weight: 600;
    }

    .loads-now {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }

    .loads-body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding-block: 0.5rem 0.75rem;
    }

    .maxes {
      border: 0;
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    .maxes legend {
      color: var(--tb-ink);
      font-weight: 600;
      padding: 0;
    }

    .max {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .estimate {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      color: var(--tb-muted);
      font-size: 0.8125rem;
      padding: 0.5rem 0.75rem;
    }

    .value-unit {
      align-items: center;
      display: grid;
      gap: 0.5rem;
      grid-template-columns: minmax(0, 1fr) 2rem;
    }

    .unit {
      color: var(--tb-muted);
      font-weight: 600;
    }

    .problem-row {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
    }

    // The buttons stay in view while a long sheet scrolls under them. The sheet pads its body by
    // 1.5rem, which the bar cancels so it spans the sheet edge to edge.
    .actions {
      background: var(--tb-surface);
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      inset-block-end: 0;
      justify-content: flex-end;
      margin-block-end: -1.5rem;
      margin-inline: -1.5rem;
      padding: 0.75rem 1.5rem;
      position: sticky;
    }
  `,
})
export class ProgramAssign {
  private readonly api = inject(ApiClient);
  private readonly programApi = inject(ClientProgramApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly summary = viewChild(FormSummary);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly intent = new IntentIdempotencyKey();
  private needs: { exerciseId: string; name: string }[] = [];

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** The workspace's own date: a program cannot start before it. */
  readonly today = input.required<string>();
  readonly enrollments = input.required<readonly ClientEnrollment[]>();
  /** The program assigned, or null when the coach closed it without assigning. */
  readonly closed = output<TrainingMesocycleView | null>();

  protected readonly attempt = new FormAttempt();
  protected readonly loadingLabel = $localize`Loading…`;
  protected readonly planLabel = $localize`Plan`;
  protected readonly programLabel = $localize`Program`;
  protected readonly startLabel = $localize`Start date`;
  protected readonly unitText = $localize`Unit`;
  protected readonly roundingText = $localize`Rounding`;
  protected readonly incrementLabel = $localize`Round loads to`;
  protected readonly incrementHelp = $localize`Every weight is rounded to a multiple of this.`;
  protected readonly maxRecorded = $localize`Your recorded training max`;
  protected readonly maxTyped = $localize`Entered now`;
  protected readonly maxNone = $localize`Nothing recorded yet`;
  protected readonly nameLabel = $localize`Program name (optional)`;
  protected readonly nameLimit = PROGRAM_NAME_LIMIT;
  protected readonly howOptions: SegmentOption[] = [
    { value: 'number', label: $localize`Type it` },
    { value: 'weekOne', label: $localize`From week 1’s weight` },
  ];
  protected readonly unitOptions: SegmentOption[] = [
    { value: 'Kilogram', label: 'kg' },
    { value: 'Pound', label: 'lb' },
  ];
  protected readonly roundingOptions: SegmentOption[] = [
    { value: 'Nearest', label: $localize`Nearest` },
    { value: 'Down', label: $localize`Down` },
    { value: 'Up', label: $localize`Up` },
  ];

  protected readonly load = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly templates = signal<ProgramTemplateSummary[]>([]);
  protected readonly templateTotal = signal(0);
  protected readonly loadingMore = signal(false);
  protected readonly history = signal<StrengthMaxView[]>([]);
  /** The client's latest program and where it left each lift (STR-014); null when it could not be read. */
  private readonly previous = signal<PreviousProgramMaxesView | null>(null);
  protected readonly versionLoading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly enrollmentId = signal('');
  protected readonly versionId = signal('');
  protected readonly startDate = signal('');
  protected readonly unit = signal<TrainingLoadUnit>('Kilogram');
  protected readonly increment = signal<number | null>(2.5);
  protected readonly rounding = signal<TrainingLoadRoundingMode>('Nearest');
  protected readonly maxes = signal<MaxRow[]>([]);
  /** What the program's own name is replaced by in the client's copy; empty keeps it (TRN-002). */
  protected readonly name = signal('');
  /** The server's words for each lift worked out from week 1's weight, by exercise (STR-011). */
  protected readonly estimates = signal<Record<string, string>>({});

  protected readonly plans = computed(() => planChoices(this.enrollments(), this.locale));
  protected readonly programs = computed(() => programChoices(this.templates()));

  private readonly values = computed<AssignmentValues>(() => ({
    enrollmentId: this.enrollmentId(),
    templateVersionId: this.versionId(),
    startDate: this.startDate(),
    loadUnit: this.unit(),
    loadIncrement: this.increment(),
    loadRoundingMode: this.rounding(),
    maxes: this.maxes(),
    name: this.name(),
  }));

  protected readonly errors = computed(() => assignmentErrors(this.values()));
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  private readonly plan = computed(() =>
    this.plans().find((item) => item.id === this.enrollmentId()),
  );
  protected readonly chosen = computed(() =>
    this.programs().find((item) => item.versionId === this.versionId()),
  );

  protected readonly nameHelp = computed(() => {
    const own = this.chosen()?.name;
    return own
      ? $localize`Leave it empty to keep “${own}:name:”. You can rename it later.`
      : $localize`Leave it empty to keep the program’s own name. You can rename it later.`;
  });

  protected readonly run = computed(() => {
    const program = this.chosen();
    return program
      ? runSummary(this.startDate(), program.weekCount, this.plan()?.lastDay ?? null, this.locale)
      : null;
  });

  protected readonly pastEnd = computed(() => {
    const last = this.plan()?.lastDay;
    return last
      ? $localize`That is past the end of ${this.firstName()}:name:’s plan on ${formatDate(last, 'EEE d MMM y', this.locale)}:date:. Start earlier, or choose a plan that covers it.`
      : '';
  });

  /** "kg · rounded to the nearest 2.5": what the collapsed settings currently mean. */
  protected readonly loadSummary = computed(() => {
    const step = this.increment();
    const unit = unitLabel(this.unit());
    if (step === null) return unit;
    const mode =
      this.rounding() === 'Down'
        ? $localize`down`
        : this.rounding() === 'Up'
          ? $localize`up`
          : $localize`to the nearest`;
    return $localize`${unit}:unit: · rounded ${mode}:mode: ${step}:step:`;
  });

  constructor() {
    effect(() => {
      this.scope.epoch();
      void this.reload();
    });
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  /** Where a training max came from: the last program, its logged sets, the one recorded, typed here, or none yet. */
  protected maxHelp(row: MaxRow): string {
    const last = row.previous;
    const suggestion = last?.suggestion;
    if (row.loggedSetId && last && suggestion) {
      return $localize`Estimated from ${last.programName}:program:’s logged sets: ${this.weight(suggestion.load, row.unit)}:weight: for ${suggestion.repetitions}:reps: reps at RPE ${suggestion.rpe}:rpe:`;
    }
    if (row.carriedFromMaxId && last) {
      return $localize`Where ${last.programName}:program: left it, set ${formatDate(last.setOn, 'EEE d MMM', this.locale)}:date:`;
    }
    return row.sourceRecordId
      ? this.maxRecorded
      : row.value !== null
        ? this.maxTyped
        : this.maxNone;
  }

  /** What the latest program's logged sets suggest for this lift, while the row does not use it yet. */
  protected suggestionFor(row: MaxRow): { text: string; action: string } | null {
    const last = row.previous;
    const suggestion = last?.suggestion;
    if (!last || !suggestion || row.loggedSetId) return null;
    const value = this.weight(suggestion.value, row.unit);
    return {
      text: $localize`${last.programName}:program:’s logged sets suggest ${value}:value: (${this.weight(suggestion.load, row.unit)}:weight: for ${suggestion.repetitions}:reps: reps at RPE ${suggestion.rpe}:rpe:).`,
      action: $localize`Use ${value}:value:`,
    };
  }

  protected useSuggestion(index: number): void {
    this.maxes.update((rows) =>
      rows.map((row, position) => (position === index ? withSuggestedMax(row) : row)),
    );
  }

  /** A no-break space keeps "70 kg" on one line in the narrow sheet. */
  private weight(value: number, unit: TrainingLoadUnit): string {
    return `${formatNumber(value, this.locale, '1.0-2')}\u00a0${unitLabel(unit)}`;
  }

  protected unitName(unit: TrainingLoadUnit): string {
    return unitLabel(unit);
  }

  protected reload(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.load.set('loading');
      try {
        const [page, maxes, previous] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.listProgramTemplates()),
            firstValueFrom(this.api.listStrengthMaxes(this.clientId())),
            // Only a head start: without it the maxes start from the recorded ones, as before.
            firstValueFrom(this.programApi.getPreviousMaxes(this.clientId())).catch(() => null),
          ]),
        );
        this.templates.set(page.items);
        this.templateTotal.set(Number(page.total));
        this.history.set(maxes.items);
        this.previous.set(previous);
        // The plan running today, else the first that includes training.
        const today = this.today();
        const plan =
          this.plans().find((item) => item.startDate <= today && today <= item.lastDay) ??
          this.plans()[0];
        if (plan && !this.enrollmentId()) {
          this.enrollmentId.set(plan.id);
          this.startDate.set(defaultStartDate(today, plan));
        }
        this.load.set('ready');
      } catch {
        if (owner.current) this.load.set('error');
      }
    });
  }

  protected loadMore(): Promise<void> {
    return this.scope.run('more', async (owner) => {
      this.loadingMore.set(true);
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.listProgramTemplates(this.templates().length)),
        );
        this.templates.update((items) => [...items, ...page.items]);
      } catch {
        if (owner.current) this.error.set($localize`More programs could not be loaded.`);
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  protected choosePlan(id: string): void {
    this.enrollmentId.set(id);
    const plan = this.plans().find((item) => item.id === id);
    if (plan && !this.startDate()) this.startDate.set(defaultStartDate(this.today(), plan));
  }

  /** Choosing a program reads it, to find which exercises need a training max. */
  protected chooseProgram(versionId: string): void {
    this.versionId.set(versionId);
    this.needs = [];
    this.maxes.set([]);
    this.estimates.set({});
    if (!versionId) return;
    void this.scope.run('version', async (owner) => {
      this.versionLoading.set(true);
      try {
        const version: ProgramTemplateVersionView = await owner.wait(
          firstValueFrom(this.api.getProgramTemplateVersion(versionId)),
        );
        this.needs = exercisesNeedingMax(version);
        this.maxes.set(
          this.needs.map((need) => maxRow(need, this.history(), this.unit(), this.previous())),
        );
      } catch (error) {
        if (owner.current) {
          this.error.set(
            programWriteError(
              error,
              $localize`That program could not be opened.`,
              this.firstName(),
            ),
          );
        }
      } finally {
        if (owner.current) this.versionLoading.set(false);
      }
    });
  }

  /** Kilograms and pounds are never converted: a new unit starts from what was recorded in it. */
  protected chooseUnit(value: string): void {
    const unit: TrainingLoadUnit = value === 'Pound' ? 'Pound' : 'Kilogram';
    this.unit.set(unit);
    this.maxes.set(this.needs.map((need) => maxRow(need, this.history(), unit, this.previous())));
    this.estimates.set({});
  }

  protected setIncrement(value: number): void {
    this.increment.set(Number.isNaN(value) ? null : value);
  }

  protected setMax(index: number, value: number): void {
    this.maxes.update((rows) =>
      rows.map((row, position) =>
        position === index ? withTypedMax(row, Number.isNaN(value) ? null : value) : row,
      ),
    );
  }

  // ---------- a max from week 1's weight (P2, STR-011) ----------

  protected howLabel(row: MaxRow): string {
    return $localize`How to set the max for ${row.name}:exercise:`;
  }

  protected weekOneLabel(row: MaxRow): string {
    return $localize`${row.name}:exercise: in week 1`;
  }

  /** Which set the weight is for, so the coach types the weight of the right one. */
  protected weekOneHelp(row: MaxRow): string {
    const anchor = row.anchor;
    return anchor
      ? $localize`The weight of its first working set: ${anchor.repetitions}:reps: reps at RPE ${anchor.rpe}:rpe:. The max is worked out from the RTS chart.`
      : '';
  }

  protected chooseMode(index: number, mode: string): void {
    const next = mode === 'weekOne' ? 'weekOne' : 'number';
    this.maxes.update((rows) =>
      rows.map((row, position) => (position === index ? withMaxMode(row, next) : row)),
    );
    const row = this.maxes()[index];
    this.estimates.update((now) => ({ ...now, [row.exerciseId]: '' }));
  }

  protected setWeekOneWeight(index: number, value: number): void {
    const row = this.maxes()[index];
    this.maxes.update((rows) =>
      rows.map((item, position) =>
        position === index ? { ...item, weekOneWeight: Number.isNaN(value) ? null : value } : item,
      ),
    );
    // What was worked out belongs to the weight it was worked out from.
    this.estimates.update((now) => ({ ...now, [row.exerciseId]: '' }));
  }

  /** Reads the weight backwards on the chart and shows the server's own sentence for it. */
  protected estimate(index: number): Promise<void> {
    const row = this.maxes()[index];
    const anchor = row?.anchor;
    const load = row?.weekOneWeight;
    if (!row || !anchor || load === null || load === undefined || !(load > 0)) {
      return Promise.resolve();
    }
    return this.scope.run(`estimate:${row.exerciseId}`, async (owner) => {
      try {
        // The calculator is a POST like every other and checks the token (audit SEC-4).
        await owner.wait(this.csrf.refresh());
        const worked = await owner.wait(
          firstValueFrom(
            this.programApi.estimateMaxFromRpeChart({
              load,
              repetitions: anchor.repetitions,
              rpe: anchor.rpe,
              unit: row.unit,
            }),
          ),
        );
        this.estimates.update((now) => ({ ...now, [row.exerciseId]: worked.explanation }));
      } catch {
        // The weight is checked again when the program is assigned, with the reason in plain words.
        if (owner.current) this.estimates.update((now) => ({ ...now, [row.exerciseId]: '' }));
      }
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.attempt.attempt();
    if (this.problemCount() > 0) {
      this.error.set(null);
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        { injector: this.injector },
      );
      return;
    }
    const request = assignmentRequest(this.values());
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      const block = await firstValueFrom(
        this.api.assignClientMesocycle(this.clientId(), {
          ...request,
          idempotencyKey: this.intent.forPayload(request),
        }),
      );
      this.intent.complete();
      this.closed.emit(block);
    } catch (error) {
      this.error.set(
        programWriteError(error, $localize`The program could not be assigned.`, this.firstName()),
      );
      this.summary()?.focus();
      // A newer best set was logged since the sheet opened: read the suggestion again (STR-014).
      if (serverCode(error) === 'training_max_suggestion_changed') await this.readPreviousAgain();
    } finally {
      this.busy.set(false);
    }
  }

  private async readPreviousAgain(): Promise<void> {
    try {
      const previous = await firstValueFrom(this.programApi.getPreviousMaxes(this.clientId()));
      this.previous.set(previous);
      const needs = new Map(this.needs.map((need) => [need.exerciseId, need]));
      this.maxes.update((rows) =>
        rows.map((row) => {
          const need = needs.get(row.exerciseId);
          return row.loggedSetId && need
            ? maxRow(need, this.history(), row.unit, previous)
            : {
                ...row,
                previous: maxRow(need ?? row, this.history(), row.unit, previous).previous,
              };
        }),
      );
    } catch {
      // The message already says to look again; the sheet keeps what it had.
    }
  }
}
