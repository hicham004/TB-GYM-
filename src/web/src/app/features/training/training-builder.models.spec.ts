import { describe, expect, it } from 'vitest';
import { draftView, setView, versionView } from '../../../testing/program-builder-fixtures';
import {
  type DraftSet,
  draftFromContent,
  draftFromVersion,
  duplicateWeek,
  emptyExercise,
  emptyProgram,
  emptySession,
  emptySet,
  followMainLiftRest,
  moveItem,
  takesTypedWeight,
  toDraftContent,
  toTrainingSessionRequest,
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

  describe('a last time + step set (N6a)', () => {
    /** A session holding one set, as the builder sends it. */
    const sent = (overrides: Partial<DraftSet>) => {
      const session = emptySession(0);
      const exercise = emptyExercise('goblet', false, 'Goblet squat');
      exercise.sets = [{ ...emptySet(), ...overrides }];
      session.exercises = [exercise];
      return toTrainingSessionRequest(session).exercises[0].sets[0];
    };

    it('starts every new set with no step, and counts a starting weight as a typed one', () => {
      expect(emptySet().loadStep).toBeNull();
      expect(emptyExercise('goblet').sets[0].loadStep).toBeNull();
      expect(takesTypedWeight('Direct')).toBe(true);
      expect(takesTypedWeight('LastTimeStep')).toBe(true);
      for (const other of ['None', 'PercentageWorkingMax', 'RpeChart', 'RpeBasedEpley'] as const) {
        expect(takesTypedWeight(other)).toBe(false);
      }
    });

    it('sends its step, its unit and its starting weight, and never a fixed load instead', () => {
      expect(
        sent({
          loadStrategy: 'LastTimeStep',
          loadStep: 2,
          loadValue: 5,
          loadUnit: 'Pound',
          repetitionsMinimum: 10,
          repetitionsMaximum: 10,
          // Left over from a % set the coach switched: the server would refuse it.
          manualLoadOverride: 80,
        }),
      ).toMatchObject({
        loadStrategy: 'LastTimeStep',
        directLoad: 5,
        loadUnit: 'Pound',
        percentageWorkingMax: null,
        loadStep: 2,
        manualLoadOverride: null,
      });
      // With no starting weight the client picks the weight.
      expect(sent({ loadStrategy: 'LastTimeStep', loadStep: 2.5, loadValue: null })).toMatchObject({
        directLoad: null,
        loadStep: 2.5,
        loadUnit: 'Kilogram',
      });
    });

    it('sends no step on any other set, though the draft keeps the one typed before a switch', () => {
      for (const loadStrategy of ['None', 'Direct', 'PercentageWorkingMax', 'RpeChart'] as const) {
        expect(sent({ loadStrategy, loadStep: 2, loadValue: 60 }).loadStep).toBeNull();
      }
      expect(sent({ loadStrategy: 'Direct', loadStep: 2, loadValue: 60 })).toMatchObject({
        directLoad: 60,
        percentageWorkingMax: null,
      });
      expect(
        sent({ loadStrategy: 'PercentageWorkingMax', loadStep: 2, loadValue: 75 }),
      ).toMatchObject({ directLoad: null, percentageWorkingMax: 75 });
    });

    it('reads its step and starting weight back from a published version and from a draft', () => {
      const version = versionView();
      version.weeks[0].sessions[0].exercises[0].sets[0] = setView({
        loadStrategy: 'LastTimeStep',
        directLoad: '5',
        percentageWorkingMax: null,
        loadStep: '2.5',
        prescribedLoad: 5,
        loadUnit: 'Pound',
      });
      expect(draftFromVersion(version).weeks[0].sessions[0].exercises[0].sets[0]).toMatchObject({
        loadStrategy: 'LastTimeStep',
        loadValue: 5,
        loadStep: 2.5,
        loadUnit: 'Pound',
        manualLoadOverride: null,
      });

      const view = draftView();
      const set = view.content.weeks[0].sessions[0].exercises[0].sets[0];
      view.content.weeks[0].sessions[0].exercises[0].sets[0] = {
        ...set,
        loadStrategy: 'LastTimeStep',
        directLoad: 7,
        percentageWorkingMax: null,
        loadStep: 2,
      };
      const read = draftFromContent(view).weeks[0].sessions[0].exercises[0].sets[0];
      expect(read).toMatchObject({ loadStrategy: 'LastTimeStep', loadValue: 7, loadStep: 2 });

      // A set saved before the step existed has none, never NaN.
      const older: Partial<typeof set> = { ...set };
      delete older.loadStep;
      view.content.weeks[0].sessions[0].exercises[0].sets[0] = older as typeof set;
      expect(draftFromContent(view).weeks[0].sessions[0].exercises[0].sets[0].loadStep).toBeNull();
    });
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
