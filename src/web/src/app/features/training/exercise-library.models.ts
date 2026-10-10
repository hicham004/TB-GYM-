import { formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import type { Params } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CreateExerciseRequest,
  ExerciseClassification,
  ExerciseEquipment,
  ExerciseView,
  ExternalMediaProvider,
  MediaAccessView,
  MediaAssetView,
  MovementPattern,
  MuscleGroup,
} from '../../core/api/generated';
import {
  exerciseClassificationLabel,
  exerciseEquipmentLabel,
  movementPatternLabel,
  muscleGroupLabel,
} from '../../core/i18n/display-labels';
import type { UiMenuItem } from '../../ui/menu';

/**
 * The exercise library (C10, R5.1b) in coach words. The server holds the rules (a unique name, one
 * primary muscle, ready media only, ADR 0026's tenancy); this phrases what it returns, keeps the
 * filters in the address, and checks what a form can check before a round trip.
 */

export const EQUIPMENT: readonly ExerciseEquipment[] = [
  'Barbell',
  'Dumbbell',
  'Kettlebell',
  'Machine',
  'Cable',
  'Band',
  'Bodyweight',
  'SpecialtyBar',
  'None',
  'Other',
];
export const PATTERNS: readonly MovementPattern[] = [
  'Squat',
  'Hinge',
  'HorizontalPush',
  'VerticalPush',
  'HorizontalPull',
  'VerticalPull',
  'Carry',
  'Rotation',
  'Locomotion',
  'Isolation',
  'Mobility',
  'Other',
];
export const TYPES: readonly ExerciseClassification[] = [
  'Strength',
  'Conditioning',
  'Mobility',
  'General',
];
export const MUSCLES: readonly MuscleGroup[] = [
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
  'FullBody',
  'Other',
];

/** A page of cards: enough to fill a wide grid evenly (2, 3, 4 or 6 across). */
export const PAGE_SIZE = 48;

// ---------- filters, kept in the address ----------

export type LibraryView = 'grid' | 'list';

export interface LibraryFilters {
  readonly query: string;
  readonly muscle: MuscleGroup | null;
  readonly pattern: MovementPattern | null;
  readonly type: ExerciseClassification | null;
  readonly equipment: ExerciseEquipment | null;
  readonly archived: boolean;
  readonly view: LibraryView;
}

export type FilterKey = 'muscle' | 'pattern' | 'type' | 'equipment';

const pick = <T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
): T | null => (value && (allowed as readonly string[]).includes(value) ? (value as T) : null);

/** An unknown value in the address is ignored, never sent: the server would refuse it. */
export function filtersFrom(
  params: Readonly<Record<string, string | null | undefined>>,
): LibraryFilters {
  return {
    query: (params['q'] ?? '').slice(0, 200),
    muscle: pick(params['muscle'], MUSCLES),
    pattern: pick(params['pattern'], PATTERNS),
    type: pick(params['type'], TYPES),
    equipment: pick(params['equipment'], EQUIPMENT),
    archived: params['archived'] === '1',
    view: params['view'] === 'list' ? 'list' : 'grid',
  };
}

/** The query parameters for these filters; a default is left out so the address stays short. */
export function filterParams(filters: LibraryFilters): Params {
  return {
    q: filters.query.trim() || null,
    muscle: filters.muscle,
    pattern: filters.pattern,
    type: filters.type,
    equipment: filters.equipment,
    archived: filters.archived ? '1' : null,
    view: filters.view === 'list' ? 'list' : null,
  };
}

export function isFiltered(filters: LibraryFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.muscle !== null ||
    filters.pattern !== null ||
    filters.type !== null ||
    filters.equipment !== null ||
    filters.archived
  );
}

export interface FilterChip {
  readonly key: FilterKey;
  /** "Muscle" while unset, the chosen value once set ("Quadriceps"). */
  readonly label: string;
  /** The accessible name: what the chip filters and by what. */
  readonly name: string;
  readonly active: boolean;
  readonly items: readonly UiMenuItem[];
}

function chip<T extends string>(
  key: FilterKey,
  title: string,
  value: T | null,
  all: readonly T[],
  label: (item: T) => string,
): FilterChip {
  return {
    key,
    label: value ? label(value) : title,
    name: value ? $localize`${title}:filter:: ${label(value)}:value:` : title,
    active: value !== null,
    items: [
      { label: $localize`Any`, action: '' },
      ...all.map((item) => ({ label: label(item), action: item })),
    ],
  };
}

export function filterChips(filters: LibraryFilters): FilterChip[] {
  return [
    chip('muscle', $localize`Muscle`, filters.muscle, MUSCLES, muscleGroupLabel),
    chip('pattern', $localize`Pattern`, filters.pattern, PATTERNS, movementPatternLabel),
    chip('type', $localize`Type`, filters.type, TYPES, exerciseClassificationLabel),
    chip('equipment', $localize`Equipment`, filters.equipment, EQUIPMENT, exerciseEquipmentLabel),
  ];
}

export function withFilter(filters: LibraryFilters, key: FilterKey, value: string): LibraryFilters {
  switch (key) {
    case 'muscle':
      return { ...filters, muscle: pick(value, MUSCLES) };
    case 'pattern':
      return { ...filters, pattern: pick(value, PATTERNS) };
    case 'type':
      return { ...filters, type: pick(value, TYPES) };
    case 'equipment':
      return { ...filters, equipment: pick(value, EQUIPMENT) };
  }
}

/** "42 exercises", "3 match", "48 of 120 shown": the server's count, never the loaded rows alone. */
export function summaryLine(
  total: number,
  shown: number,
  filters: LibraryFilters,
  locale: string,
): string {
  const count = formatNumber(total, locale, '1.0-0');
  if (shown < total) {
    return $localize`${formatNumber(shown, locale, '1.0-0')}:shown: of ${count}:total: shown`;
  }
  if (isFiltered(filters)) {
    return total === 1 ? $localize`1 exercise matches` : $localize`${count}:count: exercises match`;
  }
  return total === 1 ? $localize`1 exercise` : $localize`${count}:count: exercises`;
}

// ---------- cards ----------

/** The tint of a card with no picture, by the part of the body its pattern trains. */
export type CardTone = 'lower' | 'push' | 'pull' | 'other';

export interface ExerciseCard {
  readonly id: string;
  readonly name: string;
  /** "Quadriceps · Squat · Barbell". */
  readonly detail: string;
  readonly type: string;
  readonly tags: string;
  readonly isArchived: boolean;
  readonly initials: string;
  readonly tone: CardTone;
  /** The media a card shows first, if any; the card asks for its grant. */
  readonly coverId: string | null;
  readonly mediaCount: number;
  readonly menu: readonly UiMenuItem[];
  readonly exercise: ExerciseView;
}

function toneOf(pattern: MovementPattern): CardTone {
  switch (pattern) {
    case 'Squat':
    case 'Hinge':
    case 'Locomotion':
      return 'lower';
    case 'HorizontalPush':
    case 'VerticalPush':
      return 'push';
    case 'HorizontalPull':
    case 'VerticalPull':
      return 'pull';
    default:
      return 'other';
  }
}

export function initialsOf(name: string): string {
  const words = name
    .split(/[\s\-–/]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toLocaleUpperCase();
}

export function primaryMuscle(exercise: ExerciseView): MuscleGroup | null {
  return exercise.muscles.find((muscle) => muscle.role === 'Primary')?.muscle ?? null;
}

export function exerciseCard(exercise: ExerciseView): ExerciseCard {
  const primary = primaryMuscle(exercise);
  return {
    id: exercise.id,
    name: exercise.name,
    detail: [
      primary ? muscleGroupLabel(primary) : null,
      movementPatternLabel(exercise.movementPattern),
      exerciseEquipmentLabel(exercise.equipment),
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
    type: exerciseClassificationLabel(exercise.classification),
    tags: exercise.tags.join(', '),
    isArchived: exercise.isArchived,
    initials: initialsOf(exercise.name),
    tone: toneOf(exercise.movementPattern),
    coverId: exercise.mediaAssetIds[0] ?? null,
    mediaCount: exercise.mediaAssetIds.length,
    // An archived exercise cannot be edited (the server refuses), so it offers Restore alone.
    menu: exercise.isArchived
      ? [{ label: $localize`Restore`, action: 'restore' }]
      : [
          { label: $localize`Edit`, action: 'edit' },
          {
            label: $localize`Archive`,
            hint: $localize`Programs already built keep it`,
            action: 'archive',
          },
        ],
    exercise,
  };
}

/** What a card shows for its first media: a picture, or a play tile naming where the video is. */
export type CardCover =
  | { readonly kind: 'image'; readonly url: string }
  | { readonly kind: 'video'; readonly label: string };

/**
 * What a card can show from the coach's media list alone: a play tile for a video, or null for a
 * picture, which needs a grant first (and for an asset the list did not include).
 */
export function coverFromAsset(asset: MediaAssetView | undefined): CardCover | null {
  if (!asset || asset.status === 'Purged' || asset.status === 'Rejected') return null;
  if (asset.source === 'ExternalEmbed') return { kind: 'video', label: $localize`Video link` };
  return asset.kind === 'Video' ? { kind: 'video', label: $localize`Video` } : null;
}

export function cardCover(access: MediaAccessView): CardCover {
  if (access.kind === 'Image' && access.source === 'Upload') {
    return { kind: 'image', url: access.thumbnailUrl ?? access.url };
  }
  // External pictures (a YouTube still) are not loaded: the page allows images from TB Gym only.
  return {
    kind: 'video',
    label: access.source === 'ExternalEmbed' ? $localize`Video link` : $localize`Video`,
  };
}

// ---------- the exercise sheet ----------

export interface ExerciseValues {
  readonly name: string;
  readonly classification: ExerciseClassification;
  readonly equipment: ExerciseEquipment;
  readonly pattern: MovementPattern;
  readonly primaryMuscle: MuscleGroup;
  readonly secondaryMuscles: readonly MuscleGroup[];
  readonly tags: string;
  readonly instructions: string;
  readonly alternativeIds: readonly string[];
  readonly mediaAssetIds: readonly string[];
  /** A YouTube or Vimeo link to add as the exercise's video on save. */
  readonly videoLink: string;
}

export type FieldMessages = Record<string, string[]>;

/** A new exercise starts as the most common kind: a strength movement with a barbell. */
export function emptyExercise(filters?: LibraryFilters): ExerciseValues {
  return {
    name: '',
    classification: filters?.type ?? 'Strength',
    equipment: filters?.equipment ?? 'Barbell',
    pattern: filters?.pattern ?? 'Squat',
    primaryMuscle: filters?.muscle ?? 'Quadriceps',
    secondaryMuscles: [],
    tags: '',
    instructions: '',
    alternativeIds: [],
    mediaAssetIds: [],
    videoLink: '',
  };
}

export function valuesFrom(exercise: ExerciseView): ExerciseValues {
  return {
    name: exercise.name,
    classification: exercise.classification,
    equipment: exercise.equipment,
    pattern: exercise.movementPattern,
    primaryMuscle: primaryMuscle(exercise) ?? 'FullBody',
    secondaryMuscles: exercise.muscles
      .filter((muscle) => muscle.role === 'Secondary')
      .map((muscle) => muscle.muscle),
    tags: exercise.tags.join(', '),
    instructions: exercise.instructions ?? '',
    alternativeIds: exercise.alternatives.map((item) => item.exerciseId),
    mediaAssetIds: [...exercise.mediaAssetIds],
    videoLink: '',
  };
}

export function tagsOf(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag, index, tags) => tag.length > 0 && tags.indexOf(tag) === index);
}

export interface VideoLink {
  readonly provider: ExternalMediaProvider;
  readonly id: string;
}

/**
 * A YouTube or Vimeo address as the coach copies it (watch, share, Shorts, embed or player links).
 * The server checks the id again; this only finds it.
 */
export function parseVideoLink(text: string): VideoLink | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  const path = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') {
    return youtube(path[0]);
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (path[0] === 'watch') return youtube(url.searchParams.get('v'));
    if (['shorts', 'embed', 'live', 'v'].includes(path[0] ?? '')) return youtube(path[1]);
    return null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = [...path].reverse().find((part) => /^\d{5,12}$/.test(part));
    return id ? { provider: 'Vimeo', id } : null;
  }
  return null;
}

function youtube(id: string | null | undefined): VideoLink | null {
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: 'YouTube', id } : null;
}

export function exerciseErrors(values: ExerciseValues): FieldMessages {
  const errors: FieldMessages = {};
  const name = values.name.trim();
  if (!name) errors['name'] = [$localize`Give the exercise a name.`];
  else if (name.length > 160) errors['name'] = [$localize`Keep the name to 160 characters.`];
  if (values.videoLink.trim() && !parseVideoLink(values.videoLink)) {
    errors['videoLink'] = [$localize`Paste a YouTube or Vimeo link, like youtube.com/watch?v=…`];
  }
  const long = tagsOf(values.tags).find((tag) => tag.length > 60);
  if (long) errors['tags'] = [$localize`Keep each tag to 60 characters.`];
  if (values.instructions.trim().length > 8000) {
    errors['instructions'] = [$localize`Keep the instructions to 8,000 characters.`];
  }
  return errors;
}

export function exerciseRequest(
  values: ExerciseValues,
  mediaAssetIds: readonly string[],
): CreateExerciseRequest {
  return {
    name: values.name.trim(),
    instructions: values.instructions.trim() || null,
    equipment: values.equipment,
    movementPattern: values.pattern,
    classification: values.classification,
    muscles: [
      { muscle: values.primaryMuscle, role: 'Primary' },
      ...values.secondaryMuscles
        .filter((muscle) => muscle !== values.primaryMuscle)
        .map((muscle) => ({ muscle, role: 'Secondary' as const })),
    ],
    tags: tagsOf(values.tags),
    alternatives: values.alternativeIds.map((exerciseId) => ({ exerciseId, note: null })),
    mediaAssetIds: [...mediaAssetIds],
  };
}

/** "Video link · YouTube", "Video", "Picture": a media row's kind, in words. */
export function mediaLine(asset: MediaAssetView): string {
  if (asset.source === 'ExternalEmbed') {
    return asset.externalProvider === 'Vimeo'
      ? $localize`Video link · Vimeo`
      : $localize`Video link · YouTube`;
  }
  return asset.kind === 'Image' ? $localize`Picture` : $localize`Video`;
}

/** A refusal in coach words; anything unexpected falls back to the server's own message. */
export function exerciseWriteError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const code = (error.error as { code?: string } | null)?.code;
    if (code === 'exercise_name_conflict') {
      return $localize`You already have an exercise with this name. Choose another name, or restore the archived one.`;
    }
    if (code === 'concurrency_conflict' || (error.status === 409 && !code)) {
      return $localize`This exercise changed since you opened it. The library has been reloaded; try again.`;
    }
  }
  return apiErrorMessage(error, fallback);
}
