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
import type { SegmentOption } from '../../ui/segmented-control';
import { externalVideo, watchPage } from './external-video';

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
/** The seven types in the order the select and the filter list them (critique B9). */
export const TYPES: readonly ExerciseClassification[] = [
  'Strength',
  'Power',
  'Conditioning',
  'Mobility',
  'Balance',
  'WarmUp',
  'Other',
];
/** Other's own name ("Rehab") is kept up to 40 characters, as the server keeps it (LIB-005). */
export const OWN_TYPE_NAME_LENGTH = 40;
/** A tag is kept up to 60 characters. */
const TAG_LENGTH = 60;
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
  /** A type; Other whenever `typeName` names one of the coach's own. */
  readonly type: ExerciseClassification | null;
  /** Other's own name ("Rehab"), which the address carries as its type. */
  readonly typeName: string | null;
  readonly equipment: ExerciseEquipment | null;
  readonly tag: string | null;
  /** The Archived view in place of the exercises in use (critique B9); a view, kept by Clear filters. */
  readonly archived: boolean;
  readonly view: LibraryView;
}

export type FilterKey = 'muscle' | 'pattern' | 'type' | 'equipment' | 'tag';

/** What the library page's filters offer, as the server counted it (critique B9). */
export interface LibraryFacets {
  readonly active: number;
  readonly archived: number;
  readonly tags: readonly { readonly tag: string; readonly count: number }[];
  readonly typeNames: readonly string[];
}

export const NO_FACETS: LibraryFacets = { active: 0, archived: 0, tags: [], typeNames: [] };

/** An own type in a menu's actions, apart from the seven types' own values. */
const OWN = 'own:';

const pick = <T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
): T | null => (value && (allowed as readonly string[]).includes(value) ? (value as T) : null);

/**
 * An unknown muscle, pattern or equipment in the address is ignored, never sent: the server would refuse
 * it. A type that is none of the seven is Other's own name, which no type's name can be (LIB-005).
 */
export function filtersFrom(
  params: Readonly<Record<string, string | null | undefined>>,
): LibraryFilters {
  const type = pick(params['type'], TYPES);
  const typeName = type ? '' : (params['type'] ?? '').trim().slice(0, OWN_TYPE_NAME_LENGTH);
  return {
    query: (params['q'] ?? '').slice(0, 200),
    muscle: pick(params['muscle'], MUSCLES),
    pattern: pick(params['pattern'], PATTERNS),
    type: type ?? (typeName ? 'Other' : null),
    typeName: typeName || null,
    equipment: pick(params['equipment'], EQUIPMENT),
    tag: (params['tag'] ?? '').trim().slice(0, TAG_LENGTH) || null,
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
    type: filters.typeName ?? filters.type,
    equipment: filters.equipment,
    tag: filters.tag,
    archived: filters.archived ? '1' : null,
    view: filters.view === 'list' ? 'list' : null,
  };
}

/** Whether a search or a filter narrows the view; the view itself (yours or archived) is not a filter. */
export function isFiltered(filters: LibraryFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.muscle !== null ||
    filters.pattern !== null ||
    filters.type !== null ||
    filters.equipment !== null ||
    filters.tag !== null
  );
}

/** The filters with nothing narrowing them, in the same view and layout. */
export function withoutFilters(filters: LibraryFilters): LibraryFilters {
  return { ...filtersFrom({}), archived: filters.archived, view: filters.view };
}

/**
 * "Your exercises · Archived (3)" (critique B9): offered while something is archived, and while the
 * Archived view is open, so the way back stays.
 */
export function statusOptions(
  facets: LibraryFacets,
  archived: boolean,
  locale: string,
): readonly SegmentOption[] {
  if (facets.archived === 0 && !archived) return [];
  return [
    { value: 'active', label: $localize`Your exercises` },
    {
      value: 'archived',
      label: $localize`Archived (${formatNumber(facets.archived, locale, '1.0-0')}:count:)`,
    },
  ];
}

export interface FilterChip {
  readonly key: FilterKey;
  /** "Muscle" while unset, the chosen value once set ("Quadriceps"). */
  readonly label: string;
  /** The accessible name: what the chip filters and by what. */
  readonly name: string;
  readonly active: boolean;
  /** The action of the choice in effect, marked in the menu. */
  readonly current: string;
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
    current: value ?? '',
    items: [
      { label: $localize`Any`, action: '' },
      ...all.map((item) => ({ label: label(item), action: item })),
    ],
  };
}

/** The same name in another case, as the server lists it, so the menu marks the choice. */
function listed(names: readonly string[], name: string, locale: string): string {
  const key = name.toLocaleLowerCase(locale);
  return names.find((item) => item.toLocaleLowerCase(locale) === key) ?? name;
}

function byName(a: string, b: string, locale: string): number {
  return a.localeCompare(b, locale, { sensitivity: 'base' });
}

/** The seven types, then the coach's own names, each a kind of Other (critique B9). */
function typeChip(filters: LibraryFilters, own: readonly string[], locale: string): FilterChip {
  const title = $localize`Type`;
  const ownName = filters.typeName ? listed(own, filters.typeName, locale) : null;
  const value = ownName ?? (filters.type ? exerciseClassificationLabel(filters.type) : null);
  return {
    key: 'type',
    label: value ?? title,
    name: value ? $localize`${title}:filter:: ${value}:value:` : title,
    active: value !== null,
    current: ownName ? OWN + ownName : (filters.type ?? ''),
    items: [
      { label: $localize`Any`, action: '' },
      ...TYPES.map((type) => ({ label: exerciseClassificationLabel(type), action: type })),
      ...[...own]
        .sort((a, b) => byName(a, b, locale))
        .map((name) => ({
          label: name,
          hint: $localize`Your own type, under Other`,
          action: OWN + name,
        })),
    ],
  };
}

/** "knee-friendly (4)": each tag with how many exercises carry it; no chip while nothing is tagged. */
function tagChip(
  filters: LibraryFilters,
  tags: LibraryFacets['tags'],
  locale: string,
): FilterChip | null {
  if (tags.length === 0 && filters.tag === null) return null;
  const title = $localize`Tag`;
  const names = tags.map((item) => item.tag);
  const value = filters.tag ? listed(names, filters.tag, locale) : null;
  return {
    key: 'tag',
    label: value ?? title,
    name: value ? $localize`${title}:filter:: ${value}:value:` : title,
    active: value !== null,
    current: value ?? '',
    items: [
      { label: $localize`Any`, action: '' },
      ...[...tags]
        .sort((a, b) => byName(a.tag, b.tag, locale))
        .map((item) => ({
          label: $localize`${item.tag}:tag: (${formatNumber(item.count, locale, '1.0-0')}:count:)`,
          action: item.tag,
        })),
    ],
  };
}

export function filterChips(
  filters: LibraryFilters,
  facets: LibraryFacets,
  locale: string,
): FilterChip[] {
  const tag = tagChip(filters, facets.tags, locale);
  return [
    chip('muscle', $localize`Muscle`, filters.muscle, MUSCLES, muscleGroupLabel),
    chip('pattern', $localize`Pattern`, filters.pattern, PATTERNS, movementPatternLabel),
    typeChip(filters, facets.typeNames, locale),
    chip('equipment', $localize`Equipment`, filters.equipment, EQUIPMENT, exerciseEquipmentLabel),
    ...(tag ? [tag] : []),
  ];
}

export function withFilter(filters: LibraryFilters, key: FilterKey, value: string): LibraryFilters {
  switch (key) {
    case 'muscle':
      return { ...filters, muscle: pick(value, MUSCLES) };
    case 'pattern':
      return { ...filters, pattern: pick(value, PATTERNS) };
    case 'type': {
      const own = value.startsWith(OWN) ? value.slice(OWN.length).trim() : '';
      return own
        ? { ...filters, type: 'Other', typeName: own }
        : { ...filters, type: pick(value, TYPES), typeName: null };
    }
    case 'equipment':
      return { ...filters, equipment: pick(value, EQUIPMENT) };
    case 'tag':
      return { ...filters, tag: value.trim().slice(0, TAG_LENGTH) || null };
  }
}

/**
 * "42 exercises", "3 archived exercises", "3 match", "48 of 120 shown": the server's count, never the
 * loaded rows alone.
 */
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
  if (filters.archived) {
    return total === 1
      ? $localize`1 archived exercise`
      : $localize`${count}:count: archived exercises`;
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
    // Other's own name stands for the type, as the coach named it (critique B9).
    type: exercise.typeName?.trim() || exerciseClassificationLabel(exercise.classification),
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

/**
 * What a card shows for its first media: a picture, an uploaded video whose tile opens its demo
 * (critique B16), a YouTube or Vimeo link that opens the video on its own page, under the video's own
 * title when its provider gave one (critique B9), or a play tile for a link that is neither page.
 */
export type CardCover =
  | { readonly kind: 'image'; readonly url: string }
  | { readonly kind: 'upload' }
  | { readonly kind: 'video'; readonly label: string }
  | {
      readonly kind: 'link';
      readonly provider: 'YouTube' | 'Vimeo';
      readonly url: string;
      readonly title: string | null;
    };

/** A link's tile from the page the server built; a plain tile for an address that is neither page. */
function linkCover(
  watchUrl: string | null | undefined,
  title: string | null | undefined,
): CardCover {
  const video = watchPage(watchUrl);
  return video
    ? { kind: 'link', provider: video.provider, url: video.url, title: title?.trim() || null }
    : { kind: 'video', label: $localize`Video link` };
}

/**
 * What a card can show from the coach's media list alone: a link or a demo tile for a video, or null
 * for a picture, which needs a grant first (and for an asset the list did not include).
 */
export function coverFromAsset(asset: MediaAssetView | undefined): CardCover | null {
  if (!asset || asset.status === 'Purged' || asset.status === 'Rejected') return null;
  if (asset.source === 'ExternalEmbed') return linkCover(asset.watchUrl, asset.externalTitle);
  return asset.kind === 'Video' ? { kind: 'upload' } : null;
}

export function cardCover(access: MediaAccessView): CardCover {
  if (access.kind === 'Image' && access.source === 'Upload') {
    return { kind: 'image', url: access.thumbnailUrl ?? access.url };
  }
  // External pictures (a YouTube still) are not loaded: the page allows images from TB Gym only.
  if (access.source === 'ExternalEmbed') {
    return linkCover(externalVideo(access)?.url, access.externalTitle);
  }
  return { kind: 'upload' };
}

/** "Watch on YouTube · opens in a new tab", under the video's own title on the tile (critique B9). */
export function watchCaption(provider: 'YouTube' | 'Vimeo'): string {
  return $localize`Watch on ${provider}:provider: · opens in a new tab`;
}

/** A card's menu, with what its video's tile opens first: "Watch demo", or "Watch on YouTube". */
export function cardMenu(card: ExerciseCard, cover: CardCover | null): readonly UiMenuItem[] {
  if (cover?.kind === 'upload') {
    return [{ label: $localize`Watch demo`, action: 'demo' }, ...card.menu];
  }
  if (cover?.kind !== 'link') return card.menu;
  return [
    {
      label: $localize`Watch on ${cover.provider}:provider:`,
      hint: $localize`Opens in a new tab`,
      action: 'watch',
      href: cover.url,
    },
    ...card.menu,
  ];
}

// ---------- the exercise sheet ----------

export interface ExerciseValues {
  readonly name: string;
  readonly classification: ExerciseClassification;
  /** Other's own name; sent only while the type is Other. */
  readonly typeName: string;
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
    typeName: filters?.typeName ?? '',
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
    typeName: exercise.typeName ?? '',
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
  if (values.classification === 'Other' && values.typeName.trim().length > OWN_TYPE_NAME_LENGTH) {
    errors['typeName'] = [$localize`Keep the type’s name to 40 characters.`];
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
    // Only Other takes a name of the coach's own; another type sends none.
    typeName: values.classification === 'Other' ? values.typeName.trim() || null : null,
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

/**
 * "YouTube link · youtu.be/dQw4w9WgXcQ", "Video", "Picture": a media row's kind, in words. A link names its
 * address, so two links added to one exercise, which both carry its name as their title, read apart (audit
 * TRAIN-7). Nothing is fetched from the provider: the content policy stays as it is (C18).
 */
export function mediaLine(asset: MediaAssetView): string {
  if (asset.source === 'ExternalEmbed') {
    const id = asset.externalMediaId?.trim();
    if (asset.externalProvider === 'Vimeo') {
      return id ? $localize`Vimeo link · vimeo.com/${id}:id:` : $localize`Video link · Vimeo`;
    }
    return id ? $localize`YouTube link · youtu.be/${id}:id:` : $localize`Video link · YouTube`;
  }
  return asset.kind === 'Image' ? $localize`Picture` : $localize`Video`;
}

/** Someone saved the row after it was read: the answer to a stale version. */
export function isStaleWrite(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  const code = (error.error as { code?: string } | null)?.code;
  return code === 'concurrency_conflict' || (error.status === 409 && !code);
}

/**
 * A refusal in coach words; anything unexpected falls back to the server's own message. A stale write is
 * read again by the sheet before this is said (audit WEA-3), so the sentence promises only what happened.
 */
export function exerciseWriteError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const code = (error.error as { code?: string } | null)?.code;
    if (code === 'exercise_name_conflict') {
      return $localize`You already have an exercise with this name. Choose another name, or restore the archived one.`;
    }
    if (isStaleWrite(error)) {
      return $localize`This changed since you opened it, so it was read again. Try again.`;
    }
  }
  return apiErrorMessage(error, fallback);
}

/** Said after a save met a newer copy of the exercise, which the sheet now shows (audit WEA-3). */
export function staleExerciseMessage(): string {
  return $localize`Someone saved this exercise after you opened it. It now shows what they saved: make your change again.`;
}
