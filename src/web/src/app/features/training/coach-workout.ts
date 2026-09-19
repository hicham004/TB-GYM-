import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { firstValueFrom } from 'rxjs';
import type { WorkoutNoteView } from '../../core/api/generated';
import {
  trainingReadAccessLabel,
  workoutNoteTime,
  type CoachWorkoutDetail,
} from './training-read.models';

@Component({
  selector: 'app-coach-workout',
  imports: [DatePipe],
  templateUrl: './coach-workout.html',
  styleUrl: './coach-workout.scss',
})
export class CoachWorkout {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private generation = 0;
  readonly clientId = input.required<string>();
  readonly workoutId = input.required<string>();
  protected readonly result = signal<CoachWorkoutDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly accessLabel = trainingReadAccessLabel;
  protected readonly noteTime = workoutNoteTime;

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

  private resetTenantState(): void {
    ++this.generation;
    this.result.set(null);
    this.loading.set(false);
    this.error.set(null);
  }
}

function appendNotes(
  current: readonly WorkoutNoteView[],
  incoming: readonly WorkoutNoteView[],
): WorkoutNoteView[] {
  const existingIds = new Set(current.map((note) => note.id));
  return [...current, ...incoming.filter((note) => !existingIds.has(note.id))];
}
