import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import type { ClientWorkoutView } from '../../core/api/generated';
import {
  loggedOwnSetView,
  ownExerciseView,
  ownSetView,
  ownWorkoutNote,
  ownWorkoutView,
  poolExercise,
} from '../../../testing/own-workout-fixtures';
import {
  changeRefusalWords,
  exerciseHasNote,
  isOwnWorkout,
  OWN_EXERCISE_LIMIT,
  OWN_SET_LIMIT,
  ownRefusal,
  ownTrainingClosedWords,
  ownWorkoutAsPlayed,
  poolExerciseDetail,
  startRefusalWords,
} from './own-workout.models';

/** A refusal of N9b2's routes as the API sends it: a 409 carries its code and the server's sentence. */
function refused(status: number, code?: string, message?: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: code === undefined ? null : { code, message },
  });
}

const CHANGE_FALLBACK = 'The set couldn’t be added. Try again.';

describe('a workout of one’s own in the player (notes plan N9b3, TRN-033)', () => {
  it('plays as a workout with nothing prescribed, keyed by its own id', () => {
    const lastTime = {
      date: '2026-11-10',
      bestLoad: 24,
      unit: 'Kilogram' as const,
      repetitions: 10,
      rpe: null,
      sets: [{ position: 1, repetitions: 10, load: 24, loadUnit: 'Kilogram' as const, rpe: null }],
    };
    const view = ownWorkoutView({
      notes: [ownWorkoutNote('Short on time today.')],
      exercises: [
        ownExerciseView({
          mediaAssetIds: ['m-goblet-video'],
          previousPerformance: lastTime,
          sets: [
            loggedOwnSetView({
              actualRpe: 8,
              actualRir: 2,
              clientNote: 'Felt easy.',
            }),
          ],
        }),
      ],
    });

    expect(ownWorkoutAsPlayed(view)).toEqual({
      own: true,
      sessionId: 'own-1',
      mesocycleId: '',
      workoutExecutionId: 'own-1',
      name: 'Workout',
      coachNotes: null,
      status: 'InProgress',
      executionVersion: 5,
      startedAtUtc: '2026-11-13T07:00:00Z',
      durationSeconds: null,
      notes: [ownWorkoutNote('Short on time today.')],
      exercises: [
        {
          prescriptionId: 'own-exercise-1',
          performanceId: 'own-exercise-1',
          prescribedExerciseId: 'pool-goblet-squat',
          prescribedExerciseName: 'Goblet squat',
          actualExerciseId: 'pool-goblet-squat',
          actualExerciseName: 'Goblet squat',
          wasSubstituted: false,
          modificationPolicy: 'Locked',
          alternatives: [],
          coachNotes: null,
          mediaAssetIds: ['m-goblet-video'],
          previousPerformance: lastTime,
          weightNote: null,
          sets: [
            {
              prescriptionId: 'own-set-1',
              performanceId: 'own-set-1',
              position: 1,
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
              actualRepetitions: 10,
              actualLoad: 24,
              actualLoadUnit: 'Kilogram',
              actualRpe: 8,
              actualRir: 2,
              isCompleted: true,
              clientNote: 'Felt easy.',
            },
          ],
        },
      ],
    });
  });

  it('orders its exercises and their sets by position, as numbers, leaving the server’s answer as it was', () => {
    const view = ownWorkoutView({
      exercises: [
        ownExerciseView({
          performanceId: 'own-exercise-10',
          exerciseName: 'Plank',
          position: '10',
          sets: [
            ownSetView({ performanceId: 'own-set-c', position: '10' }),
            ownSetView({ performanceId: 'own-set-a', position: '2' }),
            ownSetView({ performanceId: 'own-set-b', position: '9' }),
          ],
        }),
        ownExerciseView({
          performanceId: 'own-exercise-9',
          exerciseName: 'Bench press',
          position: 9,
        }),
      ],
    });

    const played = ownWorkoutAsPlayed(view);

    // As text, "10" would come before "9".
    expect(played.exercises.map((exercise) => exercise.actualExerciseName)).toEqual([
      'Bench press',
      'Plank',
    ]);
    expect(played.exercises[1].sets.map((set) => set.performanceId)).toEqual([
      'own-set-a',
      'own-set-b',
      'own-set-c',
    ]);
    expect(view.exercises.map((exercise) => exercise.performanceId)).toEqual([
      'own-exercise-10',
      'own-exercise-9',
    ]);
    expect(view.exercises[0].sets.map((set) => set.performanceId)).toEqual([
      'own-set-c',
      'own-set-a',
      'own-set-b',
    ]);
  });

  it('carries a finished workout’s status and an empty one’s exercises as they are', () => {
    const finished = ownWorkoutAsPlayed(
      ownWorkoutView({ status: 'Completed', version: 9, exercises: [] }),
    );
    expect(finished).toMatchObject({ status: 'Completed', executionVersion: 9, exercises: [] });
  });

  it('tells a workout of one’s own from a program’s', () => {
    const played = ownWorkoutAsPlayed(ownWorkoutView());
    const program: ClientWorkoutView = {
      sessionId: 'session-1',
      mesocycleId: 'mesocycle-1',
      workoutExecutionId: 'execution-1',
      name: 'Lower A',
      coachNotes: null,
      status: 'InProgress',
      exercises: [],
      notes: [],
      executionVersion: 3,
    };

    expect(isOwnWorkout(played)).toBe(true);
    expect(isOwnWorkout(program)).toBe(false);
    expect(isOwnWorkout(null)).toBe(false);
    expect(isOwnWorkout(undefined)).toBe(false);
  });

  it('finds the exercises a note names, which then stay in the workout', () => {
    const played = ownWorkoutAsPlayed(
      ownWorkoutView({
        exercises: [
          ownExerciseView(),
          ownExerciseView({ performanceId: 'own-exercise-2', exerciseName: 'Plank', position: 2 }),
        ],
        notes: [
          ownWorkoutNote('Short on time today.'),
          ownWorkoutNote('Knee felt it on the way down.', 'own-exercise-1'),
        ],
      }),
    );

    expect(exerciseHasNote(played, 'own-exercise-1')).toBe(true);
    // A note on the whole workout names no exercise.
    expect(exerciseHasNote(played, 'own-exercise-2')).toBe(false);
  });

  it('holds the server’s limits, so the buttons say so before it refuses', () => {
    expect(OWN_EXERCISE_LIMIT).toBe(40);
    expect(OWN_SET_LIMIT).toBe(20);
  });
});

describe('a refusal of a workout of one’s own', () => {
  it('reads each code N9b2’s routes send, and what a 403 or a 404 means there', () => {
    const codes: [string, ReturnType<typeof ownRefusal>][] = [
      ['own_workout_in_progress', 'in-progress'],
      ['own_workout_daily_limit', 'daily-limit'],
      ['own_workout_nothing_to_copy', 'nothing-to-copy'],
      ['own_exercise_has_note', 'has-note'],
      ['own_workout_limit', 'limit'],
      ['own_workout_not_last_set', 'not-last-set'],
      ['workout_immutable', 'finished'],
      ['concurrency_conflict', 'changed'],
    ];
    for (const [code, refusal] of codes) {
      expect(ownRefusal(refused(409, code, 'The server’s sentence.')), code).toBe(refusal);
    }

    // The own-workout routes forbid with no body, and answer 404 outside the house.
    expect(ownRefusal(refused(403))).toBe('closed');
    expect(ownRefusal(refused(404))).toBe('gone');
  });

  it('leaves every other failure to the screen’s own words', () => {
    expect(ownRefusal(refused(409, 'substitution_after_logged_set', 'Locked.'))).toBeNull();
    expect(ownRefusal(refused(409))).toBeNull();
    expect(ownRefusal(refused(400, 'own_workout_limit', 'Not a conflict.'))).toBeNull();
    expect(ownRefusal(refused(500))).toBeNull();
    expect(ownRefusal(refused(0))).toBeNull();
    expect(ownRefusal(new Error('own_workout_in_progress'))).toBeNull();
    expect(ownRefusal(null)).toBeNull();
  });

  it('says why a start was refused in words a trainee can act on', () => {
    expect(startRefusalWords(refused(409, 'own_workout_in_progress', 'In progress.'))).toBe(
      'You have a workout you haven’t finished. Carry on with it, or finish it first.',
    );
    expect(startRefusalWords(refused(409, 'own_workout_daily_limit', 'Ten a day.'))).toBe(
      'You’ve started 10 workouts today, the most one day holds. Start the next one tomorrow.',
    );
    expect(startRefusalWords(refused(403))).toBe(
      'Training isn’t open for you right now, so a workout can’t be started.',
    );
    expect(startRefusalWords(refused(404))).toBe(
      'Workouts of your own are for people training with TB Gym’s own space.',
    );
  });

  it('passes the server’s sentence through where a start from a past workout has two reasons', () => {
    expect(
      startRefusalWords(
        refused(409, 'own_workout_nothing_to_copy', 'That workout has no exercises to start from.'),
      ),
    ).toBe('That workout has no exercises to start from.');
    expect(
      startRefusalWords(
        refused(
          409,
          'own_workout_nothing_to_copy',
          "None of that workout's exercises is in the exercise pool now.",
        ),
      ),
    ).toBe("None of that workout's exercises is in the exercise pool now.");
    expect(
      startRefusalWords(refused(409, 'own_workout_limit', 'A workout holds at most 40 exercises.')),
    ).toBe('A workout holds at most 40 exercises.');
  });

  it('falls back to its own sentence, and to the app’s for a lost connection', () => {
    expect(startRefusalWords(new Error('Boom'))).toBe(
      'The workout couldn’t be started. Try again.',
    );
    expect(startRefusalWords(refused(500))).toBe('The workout couldn’t be started. Try again.');
    expect(startRefusalWords(refused(0))).toBe(
      'The app couldn’t connect. Check your connection and try again.',
    );
  });

  it('says why a change was refused in words a trainee can act on', () => {
    const words: [HttpErrorResponse, string][] = [
      [
        refused(409, 'own_exercise_has_note', 'Noted.'),
        'This exercise has a note, so it stays in this workout.',
      ],
      [
        refused(409, 'own_workout_not_last_set', 'Last only.'),
        'Only an exercise’s last set can be removed.',
      ],
      [
        refused(409, 'workout_immutable', 'Completed workout history is immutable.'),
        'This workout was finished on another phone or tab, so it can’t change now.',
      ],
      [
        refused(409, 'concurrency_conflict', 'Training data was changed by another request.'),
        'This workout changed on another phone or tab. It’s up to date now, so try again.',
      ],
      [refused(403), 'Training isn’t open for you right now, so this workout can’t change.'],
      [refused(404), 'That isn’t in this workout or in the exercise pool anymore.'],
    ];
    for (const [error, sentence] of words) {
      expect(changeRefusalWords(error, CHANGE_FALLBACK)).toBe(sentence);
    }
  });

  it('passes the server’s sentence through for a limit, which says which one', () => {
    expect(
      changeRefusalWords(
        refused(409, 'own_workout_limit', 'A workout holds at most 40 exercises.'),
        CHANGE_FALLBACK,
      ),
    ).toBe('A workout holds at most 40 exercises.');
    expect(
      changeRefusalWords(
        refused(409, 'own_workout_limit', 'An exercise holds at most 20 sets.'),
        CHANGE_FALLBACK,
      ),
    ).toBe('An exercise holds at most 20 sets.');
    expect(
      changeRefusalWords(
        refused(409, 'own_workout_nothing_to_copy', 'That workout has no exercises to start from.'),
        CHANGE_FALLBACK,
      ),
    ).toBe('That workout has no exercises to start from.');
  });

  it('falls back to the sentence the change brings for anything else', () => {
    expect(changeRefusalWords(new Error('Boom'), CHANGE_FALLBACK)).toBe(CHANGE_FALLBACK);
    expect(changeRefusalWords(refused(500), CHANGE_FALLBACK)).toBe(CHANGE_FALLBACK);
    expect(changeRefusalWords(refused(409), CHANGE_FALLBACK)).toBe(CHANGE_FALLBACK);
  });

  it('says why Training is closed as TB Gym would, to someone with no coach to contact', () => {
    expect(ownTrainingClosedWords('RelationshipBlocked')).toBe('TB Gym has paused your access.');
    expect(ownTrainingClosedWords('MembershipInactive')).toBe(
      'You no longer train with TB Gym, so training is closed.',
    );
    expect(ownTrainingClosedWords('PlatformBlocked')).toBe(
      'Your account is blocked. Contact support.',
    );
    // Free never ends: any other reason is one of the house's paid plans, said without a coach.
    for (const reason of [
      'Expired',
      'NotStarted',
      'NoEntitlement',
      'Paused',
      'Cancelled',
      'PaymentRequired',
      'Unknown',
    ]) {
      expect(ownTrainingClosedWords(reason)).toBe('Training isn’t open for you right now.');
    }
  });
});

describe('a pool exercise’s line in the picker', () => {
  it('names its equipment, then its main muscle, as the library reads them', () => {
    expect(
      poolExerciseDetail(
        poolExercise('Hip thrust', {
          equipment: 'SpecialtyBar',
          muscles: [
            { muscle: 'Hamstrings', role: 'Secondary' },
            { muscle: 'Glutes', role: 'Primary' },
          ],
        }),
      ),
    ).toBe('Specialty bar · Glutes');
  });

  it('leaves out equipment of None', () => {
    expect(
      poolExerciseDetail(
        poolExercise('Burpee', {
          equipment: 'None',
          muscles: [{ muscle: 'FullBody', role: 'Primary' }],
        }),
      ),
    ).toBe('Full body');
  });

  it('names the first muscle when none is the main one, and nothing when it has none', () => {
    expect(
      poolExerciseDetail(
        poolExercise('Wrist curl', {
          equipment: 'Dumbbell',
          muscles: [
            { muscle: 'Forearms', role: 'Secondary' },
            { muscle: 'Biceps', role: 'Secondary' },
          ],
        }),
      ),
    ).toBe('Dumbbell · Forearms');
    expect(poolExerciseDetail(poolExercise('Bar hang', { equipment: 'Other', muscles: [] }))).toBe(
      'Other',
    );
    expect(poolExerciseDetail(poolExercise('Stretch', { equipment: 'None', muscles: [] }))).toBe(
      '',
    );
  });
});
