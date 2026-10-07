import { formatDate } from '@angular/common';
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
  linkedSignal,
  LOCALE_ID,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  ApplyProgressionRequest,
  ProgressionPreviewRequest,
  ProgressionPreviewView,
  TrainingMesocycleView,
} from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control, Field } from '../../ui/field';
import { unitLabel } from '../training/training-program.models';
import type { BlockCard } from './client-program.models';
import {
  coverageText,
  copiesThatFit,
  hasProgressionProblems,
  nextBlockFormula,
  previewWeeks,
  programWriteError,
  progressionErrors,
  STARTING_STEPS,
  stepReach,
  type PreviewWeek,
  type ProgressionField,
  type ProgressionValues,
} from './client-program-forms.models';
import { addDays } from './client-overview.models';

/**
 * "Build next block": repeat the weeks the coach picks, each copy a further step on in effort, reps,
 * percentage and weight (the builder's four steps, TRN-025), and append them to the program (STR-006,
 * STR-009). The server works every weight out again from the program's training maxes by each set's own
 * formula. Nothing is added until the coach has seen the result: the preview has no side effect, and
 * adding the weeks sends back the preview's hash and the program's version, so the server refuses
 * anything that changed in between.
 */
@Component({
  selector: 'app-program-next-block',
  imports: [Button, Checkbox, Control, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      <p class="muted" dir="auto" i18n>
        Pick the weeks of {{ block().name }} to repeat. Each copy moves one more step from the week
        it builds on, and you see the new weeks before anything is added.
      </p>

      <fieldset
        class="weeks"
        [class.invalid]="shown('weeks') !== null"
        [attr.aria-describedby]="shown('weeks') ? 'next-block-weeks-error' : null"
      >
        <legend i18n>Weeks to build on</legend>
        @for (week of block().weeks; track week.id) {
          <app-checkbox [label]="week.title + ' · ' + week.range">
            <input
              type="checkbox"
              appControl
              [checked]="chosen().has(week.id)"
              (change)="toggle(week.id, $any($event.target).checked)"
            />
          </app-checkbox>
        }
        @if (shown('weeks'); as messages) {
          <p id="next-block-weeks-error" class="field-error">{{ messages[0] }}</p>
        }
      </fieldset>

      <div class="fields">
        <app-field
          [label]="copiesLabel"
          density="compact"
          [help]="help().copies"
          [errors]="shown('copies')"
        >
          <input
            appControl
            type="number"
            autocomplete="off"
            min="1"
            [max]="room()"
            step="1"
            inputmode="numeric"
            [value]="iterations() ?? ''"
            (input)="setIterations($any($event.target).valueAsNumber)"
            (blur)="attempt.touch('copies')"
          />
        </app-field>
        <!-- A step can be negative, and a phone's numeric and decimal keypads have no minus key, so
             the four steps take no inputmode. -->
        <app-field [label]="rpeLabel" density="compact" [help]="help().rpe" [errors]="shown('rpe')">
          <input
            appControl
            type="number"
            autocomplete="off"
            min="-2"
            max="2"
            step="0.5"
            [value]="rpe() ?? ''"
            (input)="setRpe($any($event.target).valueAsNumber)"
            (blur)="attempt.touch('rpe')"
          />
        </app-field>
        <app-field
          [label]="repsLabel"
          density="compact"
          [help]="help().reps"
          [errors]="shown('reps')"
        >
          <input
            appControl
            type="number"
            autocomplete="off"
            min="-20"
            max="20"
            step="1"
            [value]="reps() ?? ''"
            (input)="setReps($any($event.target).valueAsNumber)"
            (blur)="attempt.touch('reps')"
          />
        </app-field>
        <app-field
          [label]="percentageLabel"
          density="compact"
          [help]="help().percentage"
          [errors]="shown('percentage')"
        >
          <input
            appControl
            type="number"
            autocomplete="off"
            min="-50"
            max="50"
            step="0.5"
            [value]="percentage() ?? ''"
            (input)="setPercentage($any($event.target).valueAsNumber)"
            (blur)="attempt.touch('percentage')"
          />
        </app-field>
        <app-field
          [label]="weightLabel()"
          density="compact"
          [help]="help().load"
          [errors]="shown('load')"
        >
          <input
            appControl
            type="number"
            autocomplete="off"
            min="-500"
            max="500"
            step="0.25"
            [value]="load() ?? ''"
            (input)="setLoad($any($event.target).valueAsNumber)"
            (blur)="attempt.touch('load')"
          />
        </app-field>
      </div>

      @if (formulaLine(); as line) {
        <p class="muted small" dir="auto">{{ line }}</p>
      }

      @if (preview(); as result) {
        <section class="preview" aria-labelledby="preview-title" aria-live="polite">
          <h3 id="preview-title" i18n>The new weeks</h3>
          <p class="preview-line">{{ previewLine() }}</p>
          @if (!result.isInsideTrainingCoverage) {
            <p class="problem-text" role="alert">{{ coverage() }}</p>
          }
          @for (week of weeks(); track week.number) {
            <div class="preview-week">
              <p class="preview-title">{{ weekTitle(week) }}</p>
              @for (session of week.sessions; track $index) {
                <div class="preview-session">
                  <p class="preview-name" dir="auto">{{ session.name }}</p>
                  <ul>
                    @for (exercise of session.exercises; track $index) {
                      <li dir="auto">
                        <strong>{{ exercise.name }}</strong
                        >&ngsp;<span class="sets">
                          @for (set of exercise.sets; track $index) {
                            <span class="set" [class.changed]="set.changed">
                              {{ set.text }}
                              @if (set.changed) {
                                <span class="tb-visually-hidden"
                                  >, <ng-container i18n>changed</ng-container></span
                                >
                              }
                            </span>
                          }
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          }
        </section>
      }

      @if (error(); as message) {
        <p class="problem-text" role="alert">{{ message }}</p>
      }

      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Not now
        </button>
        @if (preview(); as result) {
          <button
            appButton
            type="button"
            [loading]="busy()"
            [disabled]="!result.isInsideTrainingCoverage"
            (click)="apply()"
          >
            @if (busy()) {
              <ng-container i18n>Adding…</ng-container>
            } @else {
              <ng-container i18n>Add these weeks</ng-container>
            }
          </button>
        } @else {
          <button appButton type="button" [loading]="busy()" (click)="previewIt()">
            @if (busy()) {
              <ng-container i18n>Working it out…</ng-container>
            } @else {
              <ng-container i18n>Preview the new weeks</ng-container>
            }
          </button>
        }
      </div>
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

    fieldset {
      border: 0;
      display: flex;
      flex-direction: column;
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    legend {
      color: var(--tb-ink);
      font-weight: 600;
      margin-block-end: 0.25rem;
      padding: 0;
    }

    // The action bar sticks over the end of the scrolling sheet: when focus scrolls a control into
    // view, leave room for the bar so it never covers it.
    input {
      scroll-margin-block-end: 5rem;
    }

    .field-error {
      color: var(--tb-danger);
      font-size: 0.8125rem;
      font-weight: 600;
      margin-block-start: 0.25rem;
    }

    .fields {
      display: grid;
      gap: 0.875rem 1rem;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
    }

    .problem-text {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-control);
      color: var(--tb-danger);
      font-weight: 600;
      padding: 0.625rem 0.875rem;
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
      gap: 0.75rem;
      padding: 1rem;
    }

    h3 {
      color: var(--tb-ink);
      font-size: 0.9375rem;
      font-weight: 600;
      margin: 0;
    }

    .preview-line {
      color: var(--tb-muted);
    }

    .preview-week {
      border-block-start: 1px solid var(--tb-line);
      padding-block-start: 0.625rem;
    }

    .preview-title {
      color: var(--tb-ink);
      font-weight: 600;
    }

    .preview-session {
      margin-block-start: 0.375rem;
    }

    .preview-name {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    // An exercise's name, then its set lines under it, as the builder's preview reads.
    ul {
      display: grid;
      font-size: 0.875rem;
      gap: 0.5rem;
      list-style: none;
      margin: 0.25rem 0 0;
      padding: 0;
    }

    li {
      display: grid;
      gap: 0.125rem;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .sets {
      display: grid;
      gap: 0.125rem;
    }

    .set {
      color: var(--tb-muted);
      font-variant-numeric: tabular-nums;
    }

    // A set that differs from the week it builds on reads in the ink colour and heavier, so the
    // difference is not carried by colour alone.
    .set.changed {
      color: var(--tb-ink);
      font-weight: 600;
    }
  `,
})
export class ProgramNextBlock {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  readonly block = input.required<BlockCard>();
  readonly firstName = input.required<string>();
  /** True when the weeks were added, so the page reloads the program. */
  readonly closed = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly copiesLabel = $localize`Copies of each week`;
  protected readonly rpeLabel = $localize`RPE a week`;
  protected readonly repsLabel = $localize`Reps a week`;
  protected readonly percentageLabel = $localize`% of training max a week`;

  /** Starts from the program's last week, the usual week to build on. */
  protected readonly chosen = linkedSignal<ReadonlySet<string>>(
    () =>
      new Set(
        this.block()
          .weeks.slice(-1)
          .map((week) => week.id),
      ),
  );
  protected readonly iterations = signal<number | null>(STARTING_STEPS.iterations);
  protected readonly rpe = signal<number | null>(STARTING_STEPS.rpe);
  protected readonly reps = signal<number | null>(STARTING_STEPS.reps);
  protected readonly percentage = signal<number | null>(STARTING_STEPS.percentage);
  protected readonly load = signal<number | null>(STARTING_STEPS.load);
  /** The program as it stands: its unit, and the sets the steps would move. */
  protected readonly view = signal<TrainingMesocycleView | null>(null);
  protected readonly preview = signal<ProgressionPreviewView | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly unit = computed(() => this.view()?.loadUnit ?? 'Kilogram');
  protected readonly weightLabel = computed(
    () => $localize`Weight a week (${this.reach()?.unit ?? unitLabel(this.unit())}:unit:)`,
  );

  private readonly weekIds = computed(() => [...this.chosen()]);
  protected readonly room = computed(() =>
    copiesThatFit(this.block().weekCount, this.chosen().size),
  );
  private readonly values = computed<ProgressionValues>(() => ({
    weekIds: this.weekIds(),
    iterations: this.iterations(),
    rpeStep: this.rpe(),
    repetitionsStep: this.reps(),
    percentageStep: this.percentage(),
    loadStep: this.load(),
  }));
  protected readonly problems = computed(() => progressionErrors(this.values(), this.room()));
  private readonly reach = computed(() => {
    const view = this.view();
    return view ? stepReach(view, this.weekIds()) : null;
  });

  /** What each field would move in the chosen weeks, so a step is never a guess. */
  protected readonly help = computed(() => {
    const reach = this.reach();
    const room = this.room();
    return {
      copies: $localize`Added after the last week. Up to ${room}:count: fit.`,
      rpe: !reach
        ? null
        : reach.rpe > 0
          ? $localize`Sets moved: ${reach.rpe}:count:. Warm-ups stay as they are.`
          : $localize`No set in these weeks has an RPE or RIR.`,
      reps: !reach
        ? null
        : reach.reps > 0
          ? $localize`Sets moved: ${reach.reps}:count:.`
          : $localize`No set in these weeks has reps.`,
      percentage: !reach
        ? null
        : reach.percentage > 0
          ? $localize`Sets moved: ${reach.percentage}:count:.`
          : $localize`No set in these weeks uses a % of training max.`,
      load: !reach
        ? null
        : reach.load > 0
          ? $localize`Sets moved: ${reach.load}:count:, fixed or typed weights.`
          : $localize`No set in these weeks has a fixed weight.`,
    };
  });

  /** Which formula the new weeks' weights follow: each set keeps the one it has. */
  protected readonly formulaLine = computed(() => {
    const view = this.view();
    const formula = view ? nextBlockFormula(view, this.weekIds()) : null;
    switch (formula) {
      case 'RpeChart':
        return $localize`Weights come from this program’s training maxes. Where a weight follows an RPE, it uses the RTS chart, as it does now.`;
      case 'RpeBasedEpley':
        return $localize`Weights come from this program’s training maxes. Where a weight follows an RPE, it uses the Epley curve, as it does now.`;
      case 'mixed':
        return $localize`Weights come from this program’s training maxes. Where a weight follows an RPE, it uses the RTS chart or the Epley curve, each as it does now.`;
      default:
        return null;
    }
  });

  protected readonly weeks = computed<PreviewWeek[]>(() => {
    const result = this.preview();
    return result
      ? previewWeeks(result, this.view(), this.weekIds(), this.unit(), this.locale)
      : [];
  });

  protected readonly previewLine = computed(() => {
    const result = this.preview();
    if (!result) return '';
    const added = result.generatedWeeks.length;
    const end = formatDate(
      addDays(result.resultingEndDateExclusive, -1),
      'EEE d MMM y',
      this.locale,
    );
    return added === 1
      ? $localize`1 new week. The program would end ${end}:date:.`
      : $localize`${added}:count: new weeks. The program would end ${end}:date:.`;
  });

  /**
   * Why the weeks cannot be added, and what to do: a program only grows inside the plan it was assigned
   * under, so past it the coach builds fewer weeks, or renews the plan and assigns the next program.
   */
  protected readonly coverage = computed(() => {
    const said = coverageText(this.preview()?.coverageMessage ?? null, this.firstName());
    return $localize`${said}:coverage: Choose fewer copies, or renew the plan and assign the next program.`;
  });

  constructor() {
    // The program as it stands: the unit its loads are in and the sets the steps would move. The
    // preview carries neither.
    effect(() => {
      this.scope.epoch();
      const id = this.block().id;
      void this.scope.run('program', async (owner) => {
        try {
          this.view.set(await owner.wait(firstValueFrom(this.api.getTrainingMesocycle(id))));
        } catch {
          // Loads then read in kilograms and the steps say nothing about what they move; the
          // preview itself does not depend on it.
        }
      });
    });
  }

  /** The messages due on screen for a field now: after the coach left it, or tried to preview. */
  protected shown(field: ProgressionField): readonly string[] | null {
    const messages = this.problems()[field];
    return this.attempt.shows(field, messages) ? messages : null;
  }

  protected weekTitle(week: PreviewWeek): string {
    return week.from === null
      ? $localize`Week ${week.number}:week:`
      : $localize`Week ${week.number}:week: · from week ${week.from}:source:`;
  }

  protected toggle(id: string, checked: boolean): void {
    const next = new Set(this.chosen());
    if (checked) next.add(id);
    else next.delete(id);
    this.chosen.set(next);
    this.attempt.touch('weeks');
    this.changed();
  }

  protected setIterations(value: number): void {
    this.iterations.set(Number.isNaN(value) ? null : value);
    this.changed();
  }

  protected setRpe(value: number): void {
    this.rpe.set(Number.isNaN(value) ? null : value);
    this.changed();
  }

  protected setReps(value: number): void {
    this.reps.set(Number.isNaN(value) ? null : value);
    this.changed();
  }

  protected setPercentage(value: number): void {
    this.percentage.set(Number.isNaN(value) ? null : value);
    this.changed();
  }

  protected setLoad(value: number): void {
    this.load.set(Number.isNaN(value) ? null : value);
    this.changed();
  }

  /** Any change to the inputs makes a preview out of date: the coach asks again. */
  private changed(): void {
    this.preview.set(null);
    this.error.set(null);
  }

  /** What the server previews and applies: the weeks, the copies and the four steps. */
  private request(): Omit<ApplyProgressionRequest, 'previewHash' | 'mesocycleVersion'> {
    return {
      sourceWeekIds: this.weekIds(),
      iterations: this.iterations()!,
      rpeIncrement: this.rpe()!,
      repetitionsStep: this.reps()!,
      percentageStep: this.percentage()!,
      loadStep: this.load()!,
    };
  }

  protected async previewIt(): Promise<void> {
    if (this.busy()) return;
    this.attempt.attempt();
    if (hasProgressionProblems(this.problems())) {
      // The first week box or field that is wrong, in the order they are on screen.
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>('fieldset.invalid input, [aria-invalid="true"]')
            ?.focus(),
        { injector: this.injector },
      );
      return;
    }
    const block = this.block();
    const request: ProgressionPreviewRequest = {
      ...this.request(),
      mesocycleVersion: block.version,
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      this.preview.set(
        await firstValueFrom(this.api.previewTrainingProgression(block.id, request)),
      );
    } catch (error) {
      this.error.set(
        programWriteError(
          error,
          $localize`The new weeks could not be worked out.`,
          this.firstName(),
        ),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async apply(): Promise<void> {
    const result = this.preview();
    if (this.busy() || !result || !result.isInsideTrainingCoverage) return;
    const block = this.block();
    const request: ApplyProgressionRequest = {
      ...this.request(),
      previewHash: result.previewHash,
      mesocycleVersion: block.version,
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.applyTrainingProgression(block.id, request));
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        programWriteError(error, $localize`The weeks could not be added.`, this.firstName()),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
