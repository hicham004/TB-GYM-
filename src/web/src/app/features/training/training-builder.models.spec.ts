import { describe, expect, it } from 'vitest';
import {
  duplicateWeek,
  emptyExercise,
  emptyProgram,
  emptySet,
  followMainLiftRest,
  moveItem,
  toDraftContent,
  withExertionPreference,
} from './training-builder.models';

describe('training builder model', () => {
  it('duplicates complete week content without reusing mutable identities', () => {
    const original = emptyProgram().weeks[0];
    original.sessions[0].exercises.push(emptyExercise('exercise-1', true));

    const duplicate = duplicateWeek(original);

    expect(duplicate.key).not.toBe(original.key);
    expect(duplicate.sessions[0].key).not.toBe(original.sessions[0].key);
    expect(duplicate.sessions[0].exercises[0].key).not.toBe(original.sessions[0].exercises[0].key);
    duplicate.sessions[0].exercises[0].sets[0].repetitionsMinimum = 8;
    expect(original.sessions[0].exercises[0].sets[0].repetitionsMinimum).toBe(5);
  });

  it('normalizes positions and prevents contradictory exertion targets', () => {
    const draft = emptyProgram();
    draft.name = 'Strength base';
    const exercise = emptyExercise('exercise-1');
    exercise.sets[0].exertionDisplayPreference = 'Rir';
    exercise.sets[0].exertionTarget = 3;
    draft.weeks[0].sessions[0].exercises.push(exercise);

    const request = toDraftContent(draft);
    const set = request.weeks[0].sessions[0].exercises[0].sets[0];

    // The draft's content, nothing of the direct template save the API no longer has (audit INV-12).
    expect(Object.keys(request).sort()).toEqual(['description', 'name', 'weeks']);

    expect(set.position).toBe(1);
    expect(set.targetRpe).toBeNull();
    expect(set.targetRir).toBe(3);
  });

  it('starts a set made from scratch with a rest: 3:00 for a main lift, 1:30 otherwise (C1)', () => {
    expect(emptySet().restSeconds).toBe(90);
    expect(emptySet(true).restSeconds).toBe(180);
    expect(emptyExercise('exercise-1').sets[0].restSeconds).toBe(90);
    expect(emptyExercise('exercise-1', true).sets[0].restSeconds).toBe(180);

    // The rest reaches the server as seconds, like one the coach typed.
    const draft = emptyProgram();
    draft.name = 'Strength base';
    draft.weeks[0].sessions[0].exercises.push(emptyExercise('exercise-1', true));
    expect(toDraftContent(draft).weeks[0].sessions[0].exercises[0].sets[0].restSeconds).toBe(180);
  });

  it('moves only the rests still on a default when Main lift changes', () => {
    const exercise = emptyExercise('exercise-1');
    exercise.sets.push(
      { ...exercise.sets[0], key: 'typed', restSeconds: 120 },
      { ...exercise.sets[0], key: 'cleared', restSeconds: null },
    );

    exercise.isMainLift = true;
    followMainLiftRest(exercise);
    expect(exercise.sets.map((set) => set.restSeconds)).toEqual([180, 120, null]);

    exercise.isMainLift = false;
    followMainLiftRest(exercise);
    expect(exercise.sets.map((set) => set.restSeconds)).toEqual([90, 120, null]);
  });

  it('moves ordered items without mutating the source array', () => {
    const source = ['one', 'two', 'three'];
    expect(moveItem(source, 0, 2)).toEqual(['two', 'three', 'one']);
    expect(source).toEqual(['one', 'two', 'three']);
  });

  it('preserves exertion meaning when switching between RPE and RIR', () => {
    const set = emptyProgram().weeks[0].sessions[0];
    const exercise = emptyExercise('exercise-1');
    exercise.sets[0].exertionDisplayPreference = 'Rpe';
    exercise.sets[0].exertionTarget = 8;

    const rir = withExertionPreference(exercise.sets[0], 'Rir');
    const rpe = withExertionPreference(rir, 'Rpe');

    expect(rir.exertionTarget).toBe(2);
    expect(rpe.exertionTarget).toBe(8);
    expect(set.exercises).toEqual([]);
  });
});
