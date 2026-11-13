import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ClientWorkoutView, OwnWorkoutView, PoolExerciseView } from '../../core/api/generated';
import { exerciseEquipmentLabel, muscleGroupLabel } from '../../core/i18n/display-labels';

/**
 * A workout of one's own in the player (notes plan N9b3, TRN-033): the player's own workout shape with
 * nothing prescribed, so logging, last time, records and the finish summary run as for a program's
 * workout. Its session key is its own id, which no program session shares.
 */
export type OwnPlayedWorkout = ClientWorkoutView & { readonly own: true };

/** The server's limits (TRN-024, TRN-033), so the buttons say so before the server refuses. */
export const OWN_EXERCISE_LIMIT = 40;
export const OWN_SET_LIMIT = 20;

export function ownWorkoutAsPlayed(view: OwnWorkoutView): OwnPlayedWorkout {
  return {
    own: true,
    sessionId: view.workoutExecutionId,
    mesocycleId: '',
    workoutExecutionId: view.workoutExecutionId,
    name: view.name,
    coachNotes: null,
    status: view.status,
    executionVersion: view.version,
    startedAtUtc: view.startedAtUtc,
    durationSeconds: null,
    notes: view.notes,
    exercises: [...view.exercises]
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((exercise) => ({
        prescriptionId: exercise.performanceId,
        performanceId: exercise.performanceId,
        prescribedExerciseId: exercise.exerciseId,
        prescribedExerciseName: exercise.exerciseName,
        actualExerciseId: exercise.exerciseId,
        actualExerciseName: exercise.exerciseName,
        wasSubstituted: false,
        modificationPolicy: 'Locked',
        alternatives: [],
        coachNotes: null,
        mediaAssetIds: exercise.mediaAssetIds,
        previousPerformance: exercise.previousPerformance,
        weightNote: null,
        sets: [...exercise.sets]
          .sort((a, b) => Number(a.position) - Number(b.position))
          .map((set) => ({
            prescriptionId: set.performanceId,
            performanceId: set.performanceId,
            position: set.position,
            setType: 'Normal',
            prescribedRepetitionsMinimum: null,
            prescribedRepetitionsMaximum: null,
            prescribedLoad: null,
            prescribedLoadUnit: null,
            loadStrategy: null,
            loadStep: null,
            prescribedTargetRpe: null,
            prescribedTargetRir: null,
            restSeconds: null,
            tempo: null,
            coachNotes: null,
            actualRepetitions: set.actualRepetitions,
            actualLoad: set.actualLoad,
            actualLoadUnit: set.actualLoadUnit,
            actualRpe: set.actualRpe,
            actualRir: set.actualRir,
            isCompleted: set.isCompleted,
            clientNote: set.clientNote,
          })),
      })),
  };
}

export function isOwnWorkout(
  workout: ClientWorkoutView | null | undefined,
): workout is OwnPlayedWorkout {
  return (workout as Partial<OwnPlayedWorkout> | null | undefined)?.own === true;
}

/** Whether a note on the workout names this exercise, which then stays in it (TRN-033). */
export function exerciseHasNote(
  workout: ClientWorkoutView,
  exercisePerformanceId: string,
): boolean {
  return workout.notes.some((note) => note.exercisePerformanceId === exercisePerformanceId);
}

/** The refusals of N9b2's routes that a screen answers in its own way. */
export type OwnRefusal =
  | 'in-progress'
  | 'daily-limit'
  | 'nothing-to-copy'
  | 'has-note'
  | 'limit'
  | 'not-last-set'
  | 'finished'
  | 'changed'
  | 'closed'
  | 'gone';

export function ownRefusal(error: unknown): OwnRefusal | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  if (error.status === 403) return 'closed';
  if (error.status === 404) return 'gone';
  if (error.status !== 409) return null;
  switch ((error.error as { code?: string } | null)?.code) {
    case 'own_workout_in_progress':
      return 'in-progress';
    case 'own_workout_daily_limit':
      return 'daily-limit';
    case 'own_workout_nothing_to_copy':
      return 'nothing-to-copy';
    case 'own_exercise_has_note':
      return 'has-note';
    case 'own_workout_limit':
      return 'limit';
    case 'own_workout_not_last_set':
      return 'not-last-set';
    case 'workout_immutable':
      return 'finished';
    case 'concurrency_conflict':
      return 'changed';
    default:
      return null;
  }
}

/** A refused start, from Today, Training or the player, in words the trainee can act on. */
export function startRefusalWords(error: unknown): string {
  switch (ownRefusal(error)) {
    case 'in-progress':
      return $localize`You have a workout you haven’t finished. Carry on with it, or finish it first.`;
    case 'daily-limit':
      return $localize`You’ve started 10 workouts today, the most one day holds. Start the next one tomorrow.`;
    case 'closed':
      return $localize`Training isn’t open for you right now, so a workout can’t be started.`;
    case 'gone':
      return $localize`Workouts of your own are for people training with TB Gym’s own space.`;
    default:
      // A start from a past workout says which of its two reasons applies, in the server's words.
      return apiErrorMessage(error, $localize`The workout couldn’t be started. Try again.`);
  }
}

/** A refused change to a workout of one's own: an exercise or a set added or taken away. */
export function changeRefusalWords(error: unknown, fallback: string): string {
  switch (ownRefusal(error)) {
    case 'has-note':
      return $localize`This exercise has a note, so it stays in this workout.`;
    case 'not-last-set':
      return $localize`Only an exercise’s last set can be removed.`;
    case 'finished':
      return $localize`This workout was finished on another phone or tab, so it can’t change now.`;
    case 'changed':
      return $localize`This workout changed on another phone or tab. It’s up to date now, so try again.`;
    case 'closed':
      return $localize`Training isn’t open for you right now, so this workout can’t change.`;
    case 'gone':
      return $localize`That isn’t in this workout or in the exercise pool anymore.`;
    default:
      return apiErrorMessage(error, fallback);
  }
}

/**
 * Why Training is closed, to someone training in TB Gym's own space, who has no coach to contact (CLI-026):
 * the coaching words of `trainingReadAccessLabel`, said as the house would. Free never ends, so a plan
 * that does not grant is one of the house's paid plans.
 */
export function ownTrainingClosedWords(reason: string): string {
  switch (reason) {
    case 'RelationshipBlocked':
      return $localize`TB Gym has paused your access.`;
    case 'MembershipInactive':
      return $localize`You no longer train with TB Gym, so training is closed.`;
    case 'PlatformBlocked':
      return $localize`Your account is blocked. Contact support.`;
    default:
      return $localize`Training isn’t open for you right now.`;
  }
}

/** A pool exercise's second line in the picker: its equipment and its main muscle, as the library reads them. */
export function poolExerciseDetail(exercise: PoolExerciseView): string {
  const parts: string[] = [];
  if (exercise.equipment !== 'None') parts.push(exerciseEquipmentLabel(exercise.equipment));
  const primary =
    exercise.muscles.find((muscle) => muscle.role === 'Primary') ?? exercise.muscles[0];
  if (primary) parts.push(muscleGroupLabel(primary.muscle));
  return parts.join(' · ');
}
