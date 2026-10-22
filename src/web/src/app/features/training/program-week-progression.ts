import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { WeekProgressionPreviewView } from '../../core/api/generated';
import { apiErrorMessage } from '../../core/api/api-error';
import { trainingSetTypeLabel } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { UiSelect, type SelectOption } from '../../ui/select';
import { ProgramBuilderApi } from './program-builder-api';
import {
  copiesThatFit,
  findWeek,
  MAX_COPIES,
  progressionReach,
  progressionRequest,
  setSummary,
  type ProgressionSteps,
} from './program-builder.models';
import { type DraftExercise, type ProgramDraft, weekFromRequest } from './training-builder.models';

interface PreviewExercise {
  key: string;
  name: string;
  sets: { text: string; changed: boolean }[];
}

interface PreviewSession {
  key: string;
  name: string;
  exercises: PreviewExercise[];
}

interface PreviewWeek {
  key: string;
  title: string;
  sessions: PreviewSession[];
}

/** RPE moves from -2 to +2 a week in half steps, the same range the server accepts. */
const RPE_STEPS = Array.from({ length: 9 }, (_, index) => -2 + index * 0.5);

/**
 * "Duplicate with progression" (TRN-025): the coach chooses how many copies of a week and how each
 * moves, reads the weeks the server calculates, and only then adds them to the draft. The arithmetic
 * and every limit are the server's; this form only asks, warns early and shows.
 */
@Component({
  selector: 'app-program-week-progression',
  imports: [Button, Control, Field, FormSummary, FormsModule, UiSelect],
  templateUrl: './program-week-progression.html',
  styleUrl: './program-week-progression.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramWeekProgression {
  readonly draft = input.required<ProgramDraft>();
  readonly weekKey = input.required<string>();
  readonly added = output<WeekProgressionPreviewView>();
  readonly cancelled = output<void>();

  private readonly api = inject(ProgramBuilderApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly summary = viewChild.required(FormSummary);

  protected readonly maxCopies = MAX_COPIES;
  protected readonly rpeOptions: SelectOption[] = RPE_STEPS.map((value) => ({
    value: String(value),
    label:
      value === 0
        ? $localize`No change`
        : `${value > 0 ? '+' : '−'}${Math.abs(value)} ${$localize`a week`}`,
  }));

  protected readonly copies = signal(3);
  protected readonly rpe = signal(0.5);
  protected readonly reps = signal(0);
  protected readonly percentage = signal(0);
  protected readonly load = signal(0);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly shown = signal<{ result: WeekProgressionPreviewView; key: string } | null>(null);

  protected readonly week = computed(() => findWeek(this.draft(), this.weekKey()));
  protected readonly weekNumber = computed(
    () => this.draft().weeks.findIndex((week) => week.key === this.weekKey()) + 1,
  );
  protected readonly room = computed(() => copiesThatFit(this.draft()));
  protected readonly reach = computed(() => {
    const week = this.week();
    return week ? progressionReach(week) : null;
  });
  protected readonly weightLabel = computed(
    () => $localize`Weight a week (${this.reach()?.unit ?? 'kg'}:unit:)`,
  );

  /** What each field would move in this week, so a step is never a guess. */
  protected readonly help = computed(() => {
    const reach = this.reach();
    return {
      copies: $localize`Added right after week ${this.weekNumber()}:number:. Up to ${this.room()}:count: fit.`,
      rpe: reach?.rpe
        ? $localize`Sets moved: ${reach.rpe}:count:. Warm-ups stay as they are.`
        : $localize`No set in this week has an RPE or RIR.`,
      reps: reach?.reps
        ? $localize`Sets moved: ${reach.reps}:count:.`
        : $localize`No set in this week has reps.`,
      percentage: reach?.percentage
        ? $localize`Sets moved: ${reach.percentage}:count:.`
        : $localize`No set in this week uses a % of training max.`,
      load: reach?.load
        ? $localize`Sets moved: ${reach.load}:count:, fixed or typed weights.`
        : $localize`No set in this week has a fixed weight.`,
    };
  });

  private readonly steps = computed<ProgressionSteps>(() => ({
    rpe: this.rpe(),
    reps: this.reps(),
    percentage: this.percentage(),
    load: this.load(),
  }));
  private readonly inputKey = computed(() => JSON.stringify([this.copies(), this.steps()]));

  /** What the form says is wrong, field by field, before anything is sent. */
  protected readonly problems = computed(() => {
    const found: Record<'copies' | 'reps' | 'percentage' | 'load', string[]> = {
      copies: [],
      reps: [],
      percentage: [],
      load: [],
    };
    const copies = this.copies();
    if (!Number.isInteger(copies) || copies < 1 || copies > this.room()) {
      found.copies.push(
        this.room() === 0
          ? $localize`A program holds up to 52 weeks, and this one is full.`
          : $localize`Choose 1 to ${this.room()}:count: copies.`,
      );
    }
    if (!Number.isInteger(this.reps()) || Math.abs(this.reps()) > 20) {
      found.reps.push($localize`Use a whole number from -20 to 20.`);
    }
    if (Math.abs(this.percentage()) > 50 || !hasAtMostTwoDecimals(this.percentage())) {
      found.percentage.push($localize`Use -50 to 50 points, with at most two decimals.`);
    }
    if (Math.abs(this.load()) > 500 || !hasAtMostTwoDecimals(this.load())) {
      found.load.push($localize`Use -500 to 500, with at most two decimals.`);
    }
    return found;
  });

  /** The previewed weeks, only while the form still says what they were made from. */
  protected readonly current = computed(() => {
    const shown = this.shown();
    return shown && shown.key === this.inputKey() ? shown.result : null;
  });
  protected readonly stale = computed(() => this.shown() !== null && this.current() === null);
  protected readonly resultHeading = computed(() => {
    const count = this.current()?.weeks.length ?? 0;
    return count === 1
      ? $localize`1 new week after week ${this.weekNumber()}:number:`
      : $localize`${count}:count: new weeks after week ${this.weekNumber()}:number:`;
  });
  protected readonly addLabel = computed(() => {
    const count = this.current()?.weeks.length ?? 0;
    if (count === 0) return $localize`Add the weeks`;
    return count === 1 ? $localize`Add 1 week` : $localize`Add ${count}:count: weeks`;
  });

  protected readonly previewWeeks = computed<PreviewWeek[]>(() => {
    const result = this.current();
    const source = this.week();
    if (!result || !source) return [];
    const names = new Map(
      this.draft().weeks.flatMap((week) =>
        week.sessions.flatMap((session) =>
          session.exercises.map(
            (exercise) => [exercise.exerciseId, exercise.exerciseName] as const,
          ),
        ),
      ),
    );
    let before = source.sessions.map((session) =>
      session.exercises.map((exercise) => exerciseLines(exercise).join('\n')),
    );
    return result.weeks.map((requested, index) => {
      const made = weekFromRequest(requested, names);
      const sessions = made.sessions.map((session, sessionIndex) => ({
        key: session.key,
        name: session.name,
        exercises: session.exercises.map((exercise, exerciseIndex) => {
          const lines = exerciseLines(exercise);
          const unchanged = before[sessionIndex]?.[exerciseIndex] === lines.join('\n');
          return {
            key: exercise.key,
            name: exercise.exerciseName || $localize`An exercise`,
            sets: lines.map((text) => ({ text, changed: !unchanged })),
          };
        }),
      }));
      before = made.sessions.map((session) =>
        session.exercises.map((exercise) => exerciseLines(exercise).join('\n')),
      );
      return {
        key: made.key,
        title: $localize`Week ${this.weekNumber() + index + 1}:number:`,
        sessions,
      };
    });
  });

  /** A number field's value; an emptied field is NaN, which the form then calls out. */
  protected numberFrom(value: number | string | null): number {
    return value === null || value === '' ? Number.NaN : Number(value);
  }

  protected async show(): Promise<void> {
    if (this.busy()) return;
    const found = Object.values(this.problems()).flat();
    if (found.length > 0) {
      this.error.set(found[0]);
      this.focusFeedback();
      return;
    }
    const request = progressionRequest(this.draft(), this.weekKey(), this.copies(), this.steps());
    if (!request) return;
    const key = this.inputKey();
    return this.scope.run('preview', async (owner) => {
      this.busy.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const result = await owner.wait(firstValueFrom(this.api.previewWeekProgression(request)));
        this.shown.set({ result, key });
      } catch (error) {
        if (!owner.current) return;
        this.shown.set(null);
        this.error.set(
          apiErrorMessage(error, $localize`The weeks could not be calculated. Try again.`),
        );
        this.focusFeedback();
      } finally {
        if (owner.current) this.busy.set(false);
      }
    });
  }

  protected add(): void {
    const result = this.current();
    if (result) this.added.emit(result);
  }

  private focusFeedback(): void {
    this.summary().focus();
  }
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/** One line per run of equal sets: "3 × 5 · 72.5% of training max · RPE 6.5". */
function exerciseLines(exercise: DraftExercise): string[] {
  const lines: { text: string; count: number }[] = [];
  for (const set of exercise.sets) {
    const prefix = set.setType === 'Normal' ? '' : `${trainingSetTypeLabel(set.setType)} · `;
    const text = prefix + setSummary(set);
    const last = lines.at(-1);
    if (last?.text === text) last.count += 1;
    else lines.push({ text, count: 1 });
  }
  return lines.map((line) => (line.count > 1 ? `${line.count} × ${line.text}` : line.text));
}
