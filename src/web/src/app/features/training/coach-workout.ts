import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { firstValueFrom } from 'rxjs';
import type { WorkoutNoteView } from '../../core/api/generated';
import {
  trainingReadAccessLabel,
  workoutNoteTime,
  type CoachWorkoutDetail,
} from './training-read.models';

let nextReply = 0;

@Component({
  selector: 'app-coach-workout',
  imports: [Button, DatePipe],
  templateUrl: './coach-workout.html',
  styleUrl: './coach-workout.scss',
})
export class CoachWorkout {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private generation = 0;
  readonly clientId = input.required<string>();
  readonly workoutId = input.required<string>();
  /** The client's first name, for the reply's label; "the client" when it is not known. */
  readonly clientName = input('');
  /** False for a former client's record, which is read-only (ADR 0027); the server refuses either way. */
  readonly canReply = input(true);
  protected readonly result = signal<CoachWorkoutDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly accessLabel = trainingReadAccessLabel;
  protected readonly noteTime = workoutNoteTime;
  protected readonly replyId = `coach-note-${++nextReply}`;
  protected readonly note = signal('');
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);
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

  /** "6" when the target is one number, "6–8" for a range. */
  protected targetReps(minimum: null | number | string, maximum: null | number | string): string {
    return minimum !== null && Number(minimum) === Number(maximum)
      ? `${Number(minimum)}`
      : `${minimum ?? '—'}–${maximum ?? '—'}`;
  }

  protected async load(notesSkip = 0): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const generation = this.generation;
      this.loading.set(true);
      this.error.set(null);
      try {
        const result = await owner.wait(
          firstValueFrom(
            this.api.getCoachWorkoutDetail(this.clientId(), this.workoutId(), notesSkip),
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
          this.sendError.set(
            apiErrorMessage(error, $localize`The note could not be sent. Try again.`),
          );
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
