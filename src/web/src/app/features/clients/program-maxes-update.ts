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
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  TrainingMaxChangeRequest,
  TrainingMaxesPreviewView,
  TrainingMaxesView,
} from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { Skeleton } from '../../ui/skeleton';
import { IntentIdempotencyKey } from '../training/training-assignment-state';
import { unitLabel } from '../training/training-program.models';
import { ClientProgramApi } from './client-program-api';
import { programWriteError } from './client-program-forms.models';
import {
  changesRequest,
  editErrors,
  editRows,
  previewSummary,
  REASON_LIMIT,
  reasonErrors,
  withValue,
  withWeekOneWeight,
  type MaxEditRow,
  type WeekOneSet,
} from './program-maxes.models';

/**
 * "Update maxes for the coming weeks" (P2, STR-002, STR-009). The coach changes a lift's training max,
 * by typing it or from the weight of week 1's first set, and sees every weight that would change
 * before anything is saved. Updating sends back the preview's hash, the version the preview was
 * worked out against and one idempotency key, so the server refuses anything that changed in between
 * and a retry saves once. Sessions that have started, or are in the past, keep what they had.
 */
@Component({
  selector: 'app-program-maxes-update',
  imports: [Button, Control, Field, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      @switch (load()) {
        @case ('loading') {
          <app-skeleton [label]="loadingLabel" [lines]="4" />
        }
        @case ('error') {
          <div class="problem-row">
            <p role="alert" i18n>The training maxes could not be loaded.</p>
            <button appButton type="button" variant="outlined" (click)="reload()" i18n>
              Try again
            </button>
          </div>
        }
        @default {
          @if (preview()) {
            @if (summary(); as shown) {
              <section class="preview" aria-labelledby="preview-title" aria-live="polite">
                <h3 id="preview-title" i18n>What changes</h3>
                <ul class="lift-changes">
                  @for (lift of shown.lifts; track lift.id) {
                    <li>
                      <span class="lift-name" dir="auto">{{ lift.name }}</span>
                      <span class="lift-move">{{ lift.change }}</span>
                      <span class="why" dir="auto">{{ lift.explanation }}</span>
                    </li>
                  }
                </ul>
                <p class="line strong">{{ shown.counts }}</p>
                <p class="line">{{ shown.appliesFrom }}</p>
                @if (shown.kept; as kept) {
                  <p class="line">{{ kept }}</p>
                }
                @if (reason().trim().length > 0) {
                  <p class="line" dir="auto">
                    <ng-container i18n>Reason:</ng-container> {{ reason().trim() }}
                  </p>
                }
                @for (week of shown.weeks; track week.number) {
                  <div class="week">
                    <p class="week-title">{{ week.title }}</p>
                    @for (session of week.sessions; track session.id) {
                      <div class="session">
                        <p class="session-title" dir="auto">{{ session.title }}</p>
                        @for (exercise of session.exercises; track exercise.name) {
                          <p class="exercise" dir="auto">{{ exercise.name }}</p>
                          <ul class="sets">
                            @for (set of exercise.sets; track set.id) {
                              <li>
                                <span class="set-label">{{ set.label }}</span>
                                <span class="set-now">
                                  <span class="to">{{ set.to }}</span>
                                  @if (set.from; as before) {
                                    <span class="was" i18n>was {{ before }}</span>
                                  }
                                  @if (set.delta; as delta) {
                                    <span class="delta">{{ delta }}</span>
                                  }
                                </span>
                                <details class="how">
                                  <summary i18n>How it is worked out</summary>
                                  <p dir="auto">{{ set.explanation }}</p>
                                </details>
                              </li>
                            }
                          </ul>
                        }
                      </div>
                    }
                  </div>
                }
              </section>
            }
          } @else {
            <p class="muted" dir="auto" i18n>
              Change a training max and the weights of the sessions still to come follow it.
              Sessions that have started, or are already past, keep what they had. You see every
              change before anything is saved.
            </p>
            @for (row of rows(); track row.exerciseId) {
              <fieldset class="lift">
                <legend dir="auto">
                  {{ row.name }}
                  <span class="now">{{ nowText(row) }}</span>
                </legend>
                <app-field
                  [label]="newLabel"
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
                      (input)="setValue(row, $any($event.target).valueAsNumber)"
                      (blur)="attempt.touch('max:' + row.exerciseId)"
                    />
                    <span class="unit">{{ unitName(row) }}</span>
                  </div>
                </app-field>
                @if (row.weekOneSet; as set) {
                  <app-field
                    [label]="weekOneLabel"
                    [help]="weekOneHelp(set, row)"
                    [errors]="
                      shows('week1:' + row.exerciseId) ? errors()['week1:' + row.exerciseId] : null
                    "
                  >
                    <div class="value-unit">
                      <input
                        appControl
                        type="number"
                        min="0.01"
                        step="0.25"
                        [value]="row.weekOneWeight ?? ''"
                        (input)="setWeekOneWeight(row, $any($event.target).valueAsNumber)"
                        (blur)="attempt.touch('week1:' + row.exerciseId)"
                      />
                      <span class="unit">{{ unitName(row) }}</span>
                    </div>
                  </app-field>
                } @else {
                  <p class="muted small" dir="auto" i18n>
                    Week 1 has no set the RTS chart covers for this lift, so type its max.
                  </p>
                }
              </fieldset>
            }
            <app-field
              [label]="reasonLabel"
              [help]="reasonHelp"
              [errors]="shows('reason') ? reasonProblems() : null"
            >
              <textarea
                appControl
                rows="2"
                [attr.maxlength]="reasonLimit"
                [value]="reason()"
                (input)="setReason($any($event.target).value)"
                (blur)="attempt.touch('reason')"
              ></textarea>
            </app-field>
            @if (attempt.wasTried() && errors()['form']; as problem) {
              <p class="problem-text" role="alert">{{ problem[0] }}</p>
            }
          }
          @if (error(); as message) {
            <p class="problem-text" role="alert">{{ message }}</p>
          }
          <div class="actions">
            @if (preview()) {
              <button appButton type="button" variant="text" (click)="back()" i18n>
                Change the numbers
              </button>
              <button appButton type="button" [loading]="busy()" (click)="apply()">
                @if (busy()) {
                  <ng-container i18n>Updating…</ng-container>
                } @else {
                  <ng-container i18n>Update maxes</ng-container>
                }
              </button>
            } @else {
              <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
                Not now
              </button>
              <button appButton type="button" [loading]="busy()" (click)="previewIt()">
                @if (busy()) {
                  <ng-container i18n>Working it out…</ng-container>
                } @else {
                  <ng-container i18n>Show the new weights</ng-container>
                }
              </button>
            }
          </div>
        }
      }
    </div>
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

    .small {
      font-size: 0.8125rem;
    }

    .problem-row {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
    }

    .problem-text {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-control);
      color: var(--tb-danger);
      font-weight: 600;
      padding: 0.625rem 0.875rem;
    }

    fieldset {
      border: 0;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    legend {
      color: var(--tb-ink);
      font-weight: 600;
      margin-block-end: 0.5rem;
      padding: 0;
    }

    .now {
      color: var(--tb-muted);
      font-size: 0.875rem;
      font-weight: 400;
      margin-inline-start: 0.5rem;
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

    .preview {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-card-small);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem;
    }

    h3 {
      color: var(--tb-ink);
      font-size: 0.9375rem;
      font-weight: 600;
      margin: 0;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .lift-changes li {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      padding-block: 0.375rem;
    }

    .lift-name {
      color: var(--tb-ink);
      font-weight: 600;
    }

    .lift-move {
      color: var(--tb-ink);
      font-variant-numeric: tabular-nums;
    }

    .why {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    .line {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }

    .strong {
      color: var(--tb-ink);
      font-weight: 600;
    }

    .week {
      border-block-start: 1px solid var(--tb-line);
      padding-block-start: 0.625rem;
    }

    .week-title {
      color: var(--tb-ink);
      font-weight: 600;
    }

    .session {
      margin-block-start: 0.375rem;
    }

    .session-title {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    .exercise {
      color: var(--tb-ink);
      font-size: 0.875rem;
      font-weight: 600;
      margin-block-start: 0.25rem;
    }

    .sets li {
      align-items: baseline;
      display: grid;
      gap: 0 0.75rem;
      grid-template-columns: minmax(0, 1fr) auto;
      padding-block: 0.25rem;
    }

    .set-label {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    .set-now {
      display: flex;
      flex-wrap: wrap;
      font-variant-numeric: tabular-nums;
      gap: 0 0.5rem;
      justify-content: flex-end;
    }

    .to {
      color: var(--tb-ink);
      font-weight: 700;
    }

    .was {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    .delta {
      color: var(--tb-accent-ink);
      font-size: 0.8125rem;
      font-weight: 600;
    }

    .how {
      grid-column: 1 / -1;
    }

    .how summary {
      color: var(--tb-accent-ink);
      cursor: pointer;
      font-size: 0.8125rem;
      min-block-size: 1.75rem;
    }

    .how summary:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .how p {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }
  `,
})
export class ProgramMaxesUpdate {
  private readonly programApi = inject(ClientProgramApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly intent = new IntentIdempotencyKey();

  readonly blockId = input.required<string>();
  readonly blockName = input.required<string>();
  readonly firstName = input.required<string>();
  /** True when the maxes were updated, so the page reads the program again. */
  readonly closed = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly loadingLabel = $localize`Loading the training maxes…`;
  protected readonly newLabel = $localize`New training max`;
  protected readonly weekOneLabel = $localize`Or the weight of week 1’s first set`;
  protected readonly reasonLabel = $localize`Why? (optional)`;
  protected readonly reasonHelp = $localize`Kept with the new max. ${REASON_LIMIT}:limit: characters at most.`;
  protected readonly reasonLimit = REASON_LIMIT;

  protected readonly load = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly rows = signal<MaxEditRow[]>([]);
  protected readonly reason = signal('');
  protected readonly preview = signal<TrainingMaxesPreviewView | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** What the preview was worked out from: the version of the program and the lifts it changes. */
  private previewed: { version: number; changes: TrainingMaxChangeRequest[] } | null = null;
  private version = 0;

  protected readonly errors = computed(() => editErrors(this.rows()));
  protected readonly reasonProblems = computed(() => reasonErrors(this.reason()));
  protected readonly summary = computed(() => {
    const result = this.preview();
    return result ? previewSummary(result, this.locale) : null;
  });

  constructor() {
    effect(() => {
      this.scope.epoch();
      this.blockId();
      void this.reload();
    });
  }

  protected shows(field: string): boolean {
    const messages = field === 'reason' ? this.reasonProblems() : (this.errors()[field] ?? []);
    return this.attempt.shows(field, messages);
  }

  protected unitName(row: MaxEditRow): string {
    return unitLabel(row.unit);
  }

  protected nowText(row: MaxEditRow): string {
    return $localize`now ${row.current}:value: ${unitLabel(row.unit)}:unit:`;
  }

  protected weekOneHelp(set: WeekOneSet, row: MaxEditRow): string {
    const reps = set.repetitions;
    const rpe = set.rpe;
    return set.load === null
      ? $localize`Its max is worked out from the RTS chart: ${reps}:reps: reps at RPE ${rpe}:rpe: in week 1.`
      : $localize`Its max is worked out from the RTS chart: ${reps}:reps: reps at RPE ${rpe}:rpe: in week 1, now ${set.load}:load: ${unitLabel(row.unit)}:unit:.`;
  }

  protected reload(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.load.set('loading');
      try {
        const view: TrainingMaxesView = await owner.wait(
          firstValueFrom(this.programApi.getTrainingMaxes(this.blockId())),
        );
        this.version = Number(view.version);
        this.rows.set(editRows(view));
        this.load.set('ready');
      } catch {
        if (owner.current) this.load.set('error');
      }
    });
  }

  private edit(id: string, change: (row: MaxEditRow) => MaxEditRow): void {
    this.rows.update((rows) => rows.map((row) => (row.exerciseId === id ? change(row) : row)));
    this.changed();
  }

  protected setValue(row: MaxEditRow, value: number): void {
    this.edit(row.exerciseId, (item) => withValue(item, Number.isNaN(value) ? null : value));
  }

  protected setWeekOneWeight(row: MaxEditRow, value: number): void {
    this.edit(row.exerciseId, (item) =>
      withWeekOneWeight(item, Number.isNaN(value) ? null : value),
    );
  }

  protected setReason(value: string): void {
    this.reason.set(value);
    this.changed();
  }

  /** Any change to what the preview was built from makes it out of date: the coach asks again. */
  private changed(): void {
    this.preview.set(null);
    this.previewed = null;
    this.error.set(null);
  }

  protected back(): void {
    this.changed();
  }

  protected async previewIt(): Promise<void> {
    if (this.busy()) return;
    this.attempt.attempt();
    if (Object.keys(this.errors()).length > 0 || this.reasonProblems().length > 0) {
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>('[aria-invalid="true"], input')
            ?.focus(),
        { injector: this.injector },
      );
      return;
    }
    const changes = changesRequest(this.rows());
    const version = this.version;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      const result = await firstValueFrom(
        this.programApi.previewTrainingMaxes(this.blockId(), {
          mesocycleVersion: version,
          changes,
        }),
      );
      this.previewed = { version, changes };
      this.preview.set(result);
    } catch (error) {
      this.error.set(
        programWriteError(
          error,
          $localize`The new weights could not be worked out.`,
          this.firstName(),
        ),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async apply(): Promise<void> {
    const result = this.preview();
    const previewed = this.previewed;
    if (this.busy() || !result || !previewed) return;
    const reason = this.reason().trim();
    const request = {
      mesocycleVersion: previewed.version,
      changes: previewed.changes,
      reason: reason.length > 0 ? reason : null,
      previewHash: result.previewHash,
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.programApi.applyTrainingMaxes(this.blockId(), {
          ...request,
          idempotencyKey: this.intent.forPayload({ blockId: this.blockId(), ...request }),
        }),
      );
      this.intent.complete();
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        programWriteError(
          error,
          $localize`The training maxes could not be updated.`,
          this.firstName(),
        ),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
