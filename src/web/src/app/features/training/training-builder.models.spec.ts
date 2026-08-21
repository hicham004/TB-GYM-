import { describe, expect, it } from 'vitest';
import {
  duplicateWeek,
  emptyExercise,
  emptyProgram,
  moveItem,
  toProgramRequest,
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

    const request = toProgramRequest(draft);
    const set = request.weeks[0].sessions[0].exercises[0].sets[0];

    expect(set.position).toBe(1);
    expect(set.targetRpe).toBeNull();
    expect(set.targetRir).toBe(3);
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
