import { describe, expect, it } from 'vitest';
import {
  POOL_BENCH_PRESS,
  POOL_GOBLET_SQUAT,
  POOL_PLANK,
  POOL_WALKING_LUNGE,
  poolExercise,
} from '../../../testing/own-workout-fixtures';
import {
  clipDemos,
  isPoolFiltered,
  NO_POOL_FILTERS,
  poolCard,
  poolChips,
  poolEquipmentLabel,
  poolExerciseFacts,
  poolExerciseIdFrom,
  poolFilterParams,
  poolFiltersFrom,
  poolSummaryLine,
  poolTypeLabel,
  withPoolFilter,
} from './exercise-pool.models';

describe('the pool’s page in the trainee’s words (notes plan N9b4)', () => {
  describe('filters in the address', () => {
    it('reads a search, a muscle and the equipment, and leaves out what the pool does not know', () => {
      expect(
        poolFiltersFrom({ q: '  goblet ', muscle: 'Glutes', equipment: 'Kettlebell' }),
      ).toEqual({ query: 'goblet', muscle: 'Glutes', equipment: 'Kettlebell' });
      // An unknown value is never sent: the server would answer it with a 400.
      expect(poolFiltersFrom({ muscle: 'Wings', equipment: 'barbell', pattern: 'Squat' })).toEqual(
        NO_POOL_FILTERS,
      );
      expect(poolFiltersFrom({ q: 'x'.repeat(250) }).query).toHaveLength(200);
    });

    it('writes only what is set, so the address stays short', () => {
      expect(poolFilterParams(NO_POOL_FILTERS)).toEqual({ q: null, muscle: null, equipment: null });
      expect(poolFilterParams({ query: ' row ', muscle: 'Back', equipment: null })).toEqual({
        q: 'row',
        muscle: 'Back',
        equipment: null,
      });
    });

    it('is filtered by a search, a muscle or the equipment, and by nothing blank', () => {
      expect(isPoolFiltered(NO_POOL_FILTERS)).toBe(false);
      expect(isPoolFiltered({ ...NO_POOL_FILTERS, query: '  ' })).toBe(false);
      expect(isPoolFiltered({ ...NO_POOL_FILTERS, query: 'row' })).toBe(true);
      expect(isPoolFiltered({ ...NO_POOL_FILTERS, muscle: 'Chest' })).toBe(true);
      expect(isPoolFiltered({ ...NO_POOL_FILTERS, equipment: 'None' })).toBe(true);
    });

    it('sets a chip’s value, and Any or an unknown value takes it off', () => {
      const chest = withPoolFilter(NO_POOL_FILTERS, 'muscle', 'Chest');
      expect(chest).toEqual({ query: '', muscle: 'Chest', equipment: null });
      expect(withPoolFilter(chest, 'equipment', 'None')).toEqual({
        query: '',
        muscle: 'Chest',
        equipment: 'None',
      });
      expect(withPoolFilter(chest, 'muscle', '')).toEqual(NO_POOL_FILTERS);
      expect(withPoolFilter(chest, 'muscle', 'Wings')).toEqual(NO_POOL_FILTERS);
    });
  });

  describe('the chips', () => {
    it('offers Any, then every muscle and every equipment, an exercise needing none as No equipment', () => {
      const [muscle, equipment] = poolChips(NO_POOL_FILTERS);

      expect(muscle).toMatchObject({ key: 'muscle', name: 'Muscle', active: false, current: '' });
      expect(muscle.items.map((item) => item.label)).toEqual([
        'Any',
        'Chest',
        'Back',
        'Shoulders',
        'Biceps',
        'Triceps',
        'Forearms',
        'Quadriceps',
        'Hamstrings',
        'Glutes',
        'Calves',
        'Abdominals',
        'Adductors',
        'Abductors',
        'Full body',
        'Other',
      ]);
      expect(equipment).toMatchObject({ key: 'equipment', name: 'Equipment', active: false });
      expect(equipment.items.map((item) => item.label)).toEqual([
        'Any',
        'Barbell',
        'Dumbbell',
        'Kettlebell',
        'Machine',
        'Cable',
        'Band',
        'Bodyweight',
        'Specialty bar',
        'No equipment',
        'Other',
      ]);
      expect(equipment.items.find((item) => item.label === 'No equipment')?.action).toBe('None');
    });

    it('names a chip once set by what it filters and by what, and marks the choice', () => {
      const [muscle, equipment] = poolChips({ query: '', muscle: 'FullBody', equipment: 'None' });

      expect(muscle).toMatchObject({
        name: 'Muscle: Full body',
        active: true,
        current: 'FullBody',
      });
      expect(equipment).toMatchObject({
        name: 'Equipment: No equipment',
        active: true,
        current: 'None',
      });
      expect(poolEquipmentLabel('SpecialtyBar')).toBe('Specialty bar');
    });
  });

  it('counts as the coach’s library does: the server’s total, never the rows alone', () => {
    expect(poolSummaryLine(42, 42, false, 'en-US')).toBe('42 exercises');
    expect(poolSummaryLine(1, 1, false, 'en-US')).toBe('1 exercise');
    expect(poolSummaryLine(3, 3, true, 'en-US')).toBe('3 exercises match');
    expect(poolSummaryLine(1, 1, true, 'en-US')).toBe('1 exercise matches');
    expect(poolSummaryLine(1200, 50, false, 'en-US')).toBe('50 of 1,200 shown');
  });

  it('says when a search or filter finds nothing, in the empty state’s words, and nothing for an empty pool', () => {
    // The page's status line: heard where the list was (WCAG 4.1.3).
    expect(poolSummaryLine(0, 0, true, 'en-US')).toBe('No exercise matches');
    // Nothing to search in an empty pool: its empty state alone says so.
    expect(poolSummaryLine(0, 0, false, 'en-US')).toBe('');
  });

  it('makes a card of each exercise: its name, its equipment and main muscle, its demos with their kinds, its letters', () => {
    expect(poolCard(POOL_GOBLET_SQUAT)).toEqual({
      id: 'pool-goblet-squat',
      name: 'Goblet squat',
      detail: 'Kettlebell · Quadriceps',
      demos: [{ id: 'm-goblet-video', kind: 'Video' }],
      initials: 'GS',
    });
    expect(poolCard(POOL_PLANK)).toMatchObject({ detail: 'Abdominals', demos: [], initials: 'PL' });
    expect(clipDemos(POOL_WALKING_LUNGE)).toEqual([
      { id: 'm-lunge-photo', kind: 'Picture' },
      { id: 'm-lunge-video', kind: 'Video' },
      { id: 'm-lunge-link', kind: 'VideoLink' },
    ]);
  });

  it('takes an exercise from the address only when it can name one', () => {
    expect(poolExerciseIdFrom('pool-goblet-squat')).toBe('pool-goblet-squat');
    expect(poolExerciseIdFrom('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(
      '0f8fad5b-d9cb-469f-a165-70867728950e',
    );
    for (const odd of ['', '.', '..', 'a/b', 'a b', 'a?b', null, undefined]) {
      expect(poolExerciseIdFrom(odd)).toBeNull();
    }
  });

  describe('an exercise’s facts', () => {
    it('lists what it needs and works, the house’s own type, and the muscles it also works', () => {
      expect(
        poolExerciseFacts(POOL_WALKING_LUNGE).map((fact) => [fact.key, fact.term, fact.value]),
      ).toEqual([
        ['equipment', 'Equipment', 'No equipment'],
        ['movement', 'Movement', 'Locomotion'],
        ['type', 'Type', 'Rehab'],
        ['main', 'Main muscle', 'Quadriceps'],
        ['also', 'Also works', 'Glutes, Hamstrings'],
      ]);
    });

    it('names the main muscle wherever it is listed, and says nothing of others when there are none', () => {
      const bench = poolExerciseFacts(POOL_BENCH_PRESS);
      expect(bench.find((fact) => fact.key === 'main')?.value).toBe('Chest');
      expect(bench.find((fact) => fact.key === 'also')?.value).toBe('Triceps');
      expect(bench.find((fact) => fact.key === 'type')?.value).toBe('Strength');

      const plank = poolExerciseFacts(POOL_PLANK);
      expect(plank.map((fact) => fact.key)).toEqual(['equipment', 'movement', 'type', 'main']);
    });

    it('says Main muscles for two, and lists no muscle line when it has none', () => {
      const two = poolExercise('Thruster', {
        muscles: [
          { muscle: 'Quadriceps', role: 'Primary' },
          { muscle: 'Shoulders', role: 'Primary' },
        ],
      });
      expect(poolExerciseFacts(two).find((fact) => fact.key === 'main')).toMatchObject({
        term: 'Main muscles',
        value: 'Quadriceps, Shoulders',
      });
      expect(
        poolExerciseFacts(poolExercise('Breathing', { muscles: [] })).map((f) => f.key),
      ).toEqual(['equipment', 'movement', 'type']);
    });

    it('reads Other’s own name when the house gave one, else the type’s', () => {
      expect(poolTypeLabel(poolExercise('Hop', { classification: 'Other', typeName: ' ' }))).toBe(
        'Other',
      );
      expect(poolTypeLabel(poolExercise('Hop', { classification: 'Power' }))).toBe('Power');
    });
  });
});
