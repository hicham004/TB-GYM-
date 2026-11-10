import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
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
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { FormSummary } from '../../ui/form-summary';
import { Skeleton } from '../../ui/skeleton';
import { StatusLabel } from '../../ui/status-label';
import { firstValueFrom } from 'rxjs';
import type { ClientSetView, LiftStandingView, WorkoutNoteView } from '../../core/api/generated';
import { applyError, applyLabel, applyName, canApply } from '../clients/lift-weights';
import {
  standingBelongsTo,
  standingLine,
  standingsByExercise,
  type StandingLine,
} from './standing-words';
import {
  coachWorkoutAccessLabel,
  mapCoachWorkoutDetail,
  setActualText,
  setTargetText,
  workoutNoteTime,
  type CoachWorkoutDetail,
} from './training-read.models';

let nextReply = 0;

@Component({
  selector: 'app-coach-workout',
  imports: [Button, DatePipe, FormSummary, Skeleton, StatusLabel],
  templateUrl: './coach-workout.html',
  styleUrl: './coach-workout.scss',
})
export class CoachWorkout {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private generation = 0;
  readonly clientId = input.required<string>();
  readonly workoutId = input.required<string>();
  /** The client's first name, for the reply's label; "the client" when it is not known. */
  readonly clientName = input('');
  /** False for a former client's record, which is read-only (ADR 0027); the server refuses either way. */
  readonly canReply = input(true);
  /**
   * The page's apply (N6c), given by the session sheet for a current client's record; null where nothing may be
   * applied. It resolves with what to say once the page has read the program again.
   */
  readonly apply = input<((views: readonly LiftStandingView[]) => Promise<string>) | null>(null);
  /** A lift's weight was applied from here: the sheet says so and reads its prescription again. */
  readonly applied = output<string>();
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly applying = signal<string | null>(null);
  protected readonly applyProblem = signal<string | null>(null);
  protected readonly result = signal<CoachWorkoutDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly accessLabel = coachWorkoutAccessLabel;
  protected readonly noteTime = workoutNoteTime;
  protected readonly replyId = `coach-note-${++nextReply}`;
  protected readonly note = signal('');
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);
  /** Where a refused note is said; it takes focus, and what was typed stays. */
  private readonly summary = viewChild(FormSummary);
  protected readonly replyLabel = computed(() =>
    this.clientName()
      ? $localize`Note for ${this.clientName()}:name: on this workout`
      : $localize`Note for the client on this workout`,
  );

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      this.tenants.selectedTenantId();
      this.clientId();
      this.workoutId();
      ++this.generation;
      this.result.set(null);
      void this.load();
    });
  }

  protected readonly separator = ' · ';

  /**
   * Where each lift done here stands for its coming session (STR-019), under the lift: the coach's read alone
   * carries it, a lift with no step set coming has none, and an older workout than the one the answer read
   * says nothing, since the line would describe another workout's sets.
   */
  protected readonly standings = computed(() => {
    const result = this.result();
    const found = new Map<
      string,
      { line: StandingLine; view: LiftStandingView; applies: boolean; label: string; name: string }
    >();
    const detail = result?.detail;
    if (!detail) return found;
    for (const [id, standing] of standingsByExercise(
      detail.workout.exercises,
      result.liftStandings,
    )) {
      if (standingBelongsTo(standing, detail.workout)) {
        found.set(id, {
          line: standingLine(standing, this.locale),
          view: standing,
          applies: canApply(standing),
          label: applyLabel(standing, this.locale),
          name: applyName(standing, this.locale),
        });
      }
    }
    return found;
  });

  /**
   * Applies where a lift done here stands to its next workout (N6c, STR-020); the server judges it again and
   * writes only what it still says. Either way this read is taken again, so the line is the latest.
   */
  protected async applyWeight(id: string, view: LiftStandingView): Promise<void> {
    if (this.applying() !== null) return;
    this.applying.set(id);
    this.applyProblem.set(null);
    try {
      const notice = await this.apply()!([view]);
      // Read again before the button can be pressed again: it goes with the weight it applied.
      await this.load();
      this.applied.emit(notice);
    } catch (error) {
      this.applyProblem.set(applyError(error, this.clientName()));
      await this.load();
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('.apply-problem')?.focus(),
        { injector: this.injector },
      );
    } finally {
      this.applying.set(null);
    }
  }

  protected target(set: ClientSetView): string {
    return setTargetText(set, this.locale);
  }

  protected actual(set: ClientSetView): string {
    return setActualText(set, this.locale);
  }

  /** The client by first name when it is known, since a note is read beside their sets. */
  protected noteAuthor(role: WorkoutNoteView['authorRole']): string {
    return role === 'Client' ? this.clientName() || $localize`Client` : $localize`Coach`;
  }

  protected async load(notesSkip = 0): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const generation = this.generation;
      this.loading.set(true);
      this.error.set(null);
      try {
        const result = mapCoachWorkoutDetail(
          await owner.wait(
            firstValueFrom(
              this.api.getCoachWorkoutDetail(this.clientId(), this.workoutId(), notesSkip),
            ),
          ),
        );
        if (generation !== this.generation) return;
        const current = this.result();
        const currentDetail = current?.detail;
        if (
          notesSkip > 0 &&
          current?.isAllowed &&
          currentDetail !== null &&
          currentDetail !== undefined &&
          currentDetail.workout.workoutExecutionId === result.detail?.workout.workoutExecutionId &&
          result.isAllowed &&
          result.detail
        ) {
          this.result.set({
            ...result,
            detail: {
              ...result.detail,
              workout: {
                ...result.detail.workout,
                notes: appendNotes(currentDetail.workout.notes, result.detail.workout.notes),
              },
            },
          });
        } else {
          this.result.set(result);
        }
      } catch (error) {
        if (!owner.current) return;
        if (generation === this.generation)
          this.error.set(apiErrorMessage(error, $localize`Couldn’t load this workout. Retry.`));
      } finally {
        if (owner.current) {
          if (generation === this.generation) this.loading.set(false);
        }
      }
    });
  }

  /**
   * A coach's note on the workout (TRN-009): kept with the workout, never overwritten, and read by the
   * client beside what they logged. The server checks the coach, the client and the plan again.
   */
  protected async sendNote(workoutExecutionId: string | null): Promise<void> {
    const text = this.note().trim();
    if (!workoutExecutionId || !text || this.sending()) return;
    return this.scope.run('note', async (owner) => {
      this.sending.set(true);
      this.sendError.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(
          firstValueFrom(
            this.api.addWorkoutNote(workoutExecutionId, { text, exercisePerformanceId: null }),
          ),
        );
        this.note.set('');
        await this.load();
      } catch (error) {
        if (owner.current) {
          // A plan paused or blocked since the page opened refuses the note (audit BEA-8); what was
          // typed stays, since trying again cannot work until the plan opens.
          this.sendError.set(
            error instanceof HttpErrorResponse && error.status === 403
              ? $localize`This client’s training is closed now, so the note can’t be sent.`
              : apiErrorMessage(error, $localize`The note could not be sent. Try again.`),
          );
          this.summary()?.focus();
        }
      } finally {
        if (owner.current) this.sending.set(false);
      }
    });
  }

  private resetTenantState(): void {
    ++this.generation;
    this.result.set(null);
    this.loading.set(false);
    this.error.set(null);
    this.note.set('');
    this.sending.set(false);
    this.sendError.set(null);
  }
}

function appendNotes(
  current: readonly WorkoutNoteView[],
  incoming: readonly WorkoutNoteView[],
): WorkoutNoteView[] {
  const existingIds = new Set(current.map((note) => note.id));
  return [...current, ...incoming.filter((note) => !existingIds.has(note.id))];
}
