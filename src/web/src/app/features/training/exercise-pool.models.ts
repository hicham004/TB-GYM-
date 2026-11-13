import { formatNumber } from '@angular/common';
import type { Params } from '@angular/router';
import type { ExerciseEquipment, MuscleGroup, PoolExerciseView } from '../../core/api/generated';
import {
  exerciseClassificationLabel,
  exerciseEquipmentLabel,
  movementPatternLabel,
  muscleGroupLabel,
} from '../../core/i18n/display-labels';
import type { UiMenuItem } from '../../ui/menu';
import type { ClipDemo } from './demo-clips';
import { EQUIPMENT, initialsOf, MUSCLES } from './exercise-library.models';
import { poolExerciseDetail } from './own-workout.models';

/**
 * TB Gym's exercise pool as its trainee browses it (notes plan N9b4, LIB-006): the filters the page
 * keeps in the address (a search, a muscle and the equipment, the coach's library's own filters), an
 * exercise's card and the facts its page lists, in the trainee's words.
 */

/** The longest search kept from the address, as the coach's library keeps it. */
const QUERY_LENGTH = 200;

export interface PoolFilters {
  readonly query: string;
  readonly muscle: MuscleGroup | null;
  readonly equipment: ExerciseEquipment | null;
}

export type PoolFilterKey = 'muscle' | 'equipment';

export const NO_POOL_FILTERS: PoolFilters = { query: '', muscle: null, equipment: null };

const pick = <T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
): T | null => (value && (allowed as readonly string[]).includes(value) ? (value as T) : null);

/**
 * The filters an address asks for (`?q=&muscle=&equipment=`). A muscle or equipment the pool does not
 * know is left out, never sent: the server answers an unknown value with a 400.
 */
export function poolFiltersFrom(
  params: Readonly<Record<string, string | null | undefined>>,
): PoolFilters {
  return {
    query: (params['q'] ?? '').trim().slice(0, QUERY_LENGTH),
    muscle: pick(params['muscle'], MUSCLES),
    equipment: pick(params['equipment'], EQUIPMENT),
  };
}

/** The address's query parameters for these filters; one not set is left out, so the address stays short. */
export function poolFilterParams(filters: PoolFilters): Params {
  return {
    q: filters.query.trim().slice(0, QUERY_LENGTH) || null,
    muscle: filters.muscle,
    equipment: filters.equipment,
  };
}

export function isPoolFiltered(filters: PoolFilters): boolean {
  return filters.query.trim() !== '' || filters.muscle !== null || filters.equipment !== null;
}

export function withPoolFilter(
  filters: PoolFilters,
  key: PoolFilterKey,
  value: string,
): PoolFilters {
  return key === 'muscle'
    ? { ...filters, muscle: pick(value, MUSCLES) }
    : { ...filters, equipment: pick(value, EQUIPMENT) };
}

/** Equipment in the trainee's words: an exercise that needs none says so ("No equipment"). */
export function poolEquipmentLabel(value: ExerciseEquipment): string {
  return value === 'None' ? $localize`No equipment` : exerciseEquipmentLabel(value);
}

export interface PoolChip {
  readonly key: PoolFilterKey;
  /** What the chip reads and is named: "Muscle", or what it filters by once set ("Muscle: Quadriceps"). */
  readonly name: string;
  readonly active: boolean;
  /** The action of the choice in effect, marked in the chip's list. */
  readonly current: string;
  readonly items: readonly UiMenuItem[];
}

function chip<T extends string>(
  key: PoolFilterKey,
  title: string,
  value: T | null,
  all: readonly T[],
  label: (item: T) => string,
): PoolChip {
  return {
    key,
    name: value ? $localize`${title}:filter:: ${label(value)}:value:` : title,
    active: value !== null,
    current: value ?? '',
    items: [
      { label: $localize`Any`, action: '' },
      ...all.map((item) => ({ label: label(item), action: item })),
    ],
  };
}

/** The pool's two filters, as the coach's library offers them: "Any", then every value. */
export function poolChips(filters: PoolFilters): PoolChip[] {
  return [
    chip('muscle', $localize`Muscle`, filters.muscle, MUSCLES, muscleGroupLabel),
    chip('equipment', $localize`Equipment`, filters.equipment, EQUIPMENT, poolEquipmentLabel),
  ];
}

/**
 * "42 exercises", "3 exercises match", "48 of 120 shown": the server's count, never the rows read
 * alone, in the coach's library's words. A search or filter that finds nothing says so in the empty
 * state's own words, so the page's status line is heard then too (WCAG 4.1.3); an empty pool has no
 * line, since nothing there can be searched.
 */
export function poolSummaryLine(
  total: number,
  shown: number,
  filtered: boolean,
  locale: string,
): string {
  if (shown === 0) return filtered ? $localize`No exercise matches` : '';
  const count = formatNumber(total, locale, '1.0-0');
  if (shown < total) {
    return $localize`${formatNumber(shown, locale, '1.0-0')}:shown: of ${count}:total: shown`;
  }
  if (filtered) {
    return total === 1 ? $localize`1 exercise matches` : $localize`${count}:count: exercises match`;
  }
  return total === 1 ? $localize`1 exercise` : $localize`${count}:count: exercises`;
}

/** An exercise's demos as a clip plays them: each with what the pool says it is. */
export function clipDemos(exercise: PoolExerciseView): readonly ClipDemo[] {
  return exercise.demos.map((demo) => ({ id: demo.mediaAssetId, kind: demo.kind }));
}

/** One exercise's card in the pool's list. */
export interface PoolCard {
  readonly id: string;
  readonly name: string;
  /** "Kettlebell · Quadriceps", as the picker reads it. */
  readonly detail: string;
  readonly demos: readonly ClipDemo[];
  /** Its letters on a quiet tile where it has no demo, as the coach's library draws one. */
  readonly initials: string;
}

export function poolCard(exercise: PoolExerciseView): PoolCard {
  return {
    id: exercise.id,
    name: exercise.name,
    detail: poolExerciseDetail(exercise),
    demos: clipDemos(exercise),
    initials: initialsOf(exercise.name),
  };
}

/**
 * The exercise an address names, or null when it cannot name one (a dot, a slash or a space): such an
 * address is the page's "not in the pool" at once, and nothing is asked for it.
 */
export function poolExerciseIdFrom(value: string | null | undefined): string | null {
  return value && /^[\w-]+$/.test(value) ? value : null;
}

/** Other's own name where the house gave one ("Rehab"), else the type's (LIB-005). */
export function poolTypeLabel(exercise: PoolExerciseView): string {
  return exercise.typeName?.trim() || exerciseClassificationLabel(exercise.classification);
}

export interface PoolFact {
  readonly key: 'equipment' | 'movement' | 'type' | 'main' | 'also';
  readonly term: string;
  readonly value: string;
}

/** What an exercise's page lists about it; the muscles it also works only when there are some. */
export function poolExerciseFacts(exercise: PoolExerciseView): PoolFact[] {
  const named = (role: 'Primary' | 'Secondary') =>
    exercise.muscles
      .filter((muscle) => muscle.role === role)
      .map((muscle) => muscleGroupLabel(muscle.muscle));
  const main = named('Primary');
  const also = named('Secondary');
  const facts: PoolFact[] = [
    { key: 'equipment', term: $localize`Equipment`, value: poolEquipmentLabel(exercise.equipment) },
    {
      key: 'movement',
      term: $localize`Movement`,
      value: movementPatternLabel(exercise.movementPattern),
    },
    { key: 'type', term: $localize`Type`, value: poolTypeLabel(exercise) },
  ];
  if (main.length > 0) {
    facts.push({
      key: 'main',
      term: main.length === 1 ? $localize`Main muscle` : $localize`Main muscles`,
      value: main.join(', '),
    });
  }
  if (also.length > 0)
    facts.push({ key: 'also', term: $localize`Also works`, value: also.join(', ') });
  return facts;
}
