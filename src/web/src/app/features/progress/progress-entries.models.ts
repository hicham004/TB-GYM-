import { formatDate, formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from '../../core/api/api-error';
import type { MeasurementType, MeasurementUnit, ProgressPhotoPose } from '../../core/api/generated';
import {
  BODY_FAT_PERCENT,
  CENTIMETERS_PER_INCH,
  GIRTH_CM,
  lengthCentimeters,
  POUNDS_TO_KILOGRAMS,
  rangeInOtherUnit,
  WEIGHT_KG,
  weightKilograms,
  type GirthUnit,
  type MassUnit,
} from '../../core/units/body-units';
import { addDays, isIsoDate } from '../../ui/calendar';
import type {
  BodyMeasurement,
  BodyMeasurements,
  BodyweightHistory,
  BodyweightObservation,
  ProgressPhoto,
  ProgressViewModel,
} from './progress.models';

/**
 * What the weigh-in, measurement and photo screens show, ask and check (R5.3c). The server decides every
 * limit, date and conflict; this asks for the same things in the same order, says in words what is
 * wrong before the server has to refuse, and words each refusal the server does give. Nothing here
 * is added up, trended or estimated: the chart and the trend are the dashboard's.
 */

// ---------- who is reading ----------

/** The client on their own entries, or a coach on a client's. */
export interface Audience {
  readonly coach: boolean;
  /** The client's first name, for a coach's sentences. */
  readonly firstName: string | null;
  readonly locale: string;
}

export type EntrySource = 'Client' | 'Coach' | 'DeviceImport';

/** "Added by you", "Added by your coach", or, to a coach, "Added by Maya" and "Added by a coach". */
export function addedBy(source: EntrySource, audience: Audience): string {
  if (source === 'DeviceImport') return $localize`Imported from a device`;
  if (audience.coach) {
    if (source === 'Coach') return $localize`Added by a coach`;
    return audience.firstName
      ? $localize`Added by ${audience.firstName}:name:`
      : $localize`Added by the client`;
  }
  return source === 'Coach' ? $localize`Added by your coach` : $localize`Added by you`;
}

// ---------- the three tabs ----------

export type EntryTab = 'weight' | 'measurements' | 'photos';
export const ENTRY_TABS: readonly EntryTab[] = ['weight', 'measurements', 'photos'];

/** The tab a `?tab=` word names; anything else is the first one. */
export function entryTab(value: string | null | undefined): EntryTab {
  return (ENTRY_TABS as readonly string[]).includes(value ?? '') ? (value as EntryTab) : 'weight';
}

export function tabName(tab: EntryTab): string {
  switch (tab) {
    case 'measurements':
      return $localize`Measurements`;
    case 'photos':
      return $localize`Photos`;
    default:
      return $localize`Weight`;
  }
}

// ---------- units ----------

export function massWord(unit: MassUnit): string {
  return unit === 'Pound' ? 'lb' : 'kg';
}

export function lengthWord(unit: MeasurementUnit): string {
  return unit === 'Inch' ? 'in' : unit === 'Percent' ? '%' : 'cm';
}

const number = (value: number, locale: string) => formatNumber(value, locale, '1.0-2');

/** "80.2" in the person's own number format, up to two decimals. */
export function quantity(value: number, locale: string): string {
  return number(value, locale);
}

/** What a number box gives: a number, or null while it is empty or not a number yet. */
export function numberOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

// ---------- weigh-ins ----------

export interface WeighInRow {
  readonly id: string;
  readonly date: string;
  readonly version: number;
  /** "80.2 kg", in the unit the page shows. */
  readonly value: string;
  /** "Entered as 176.8 lb" when it was typed in the other unit. */
  readonly entered: string | null;
  readonly addedBy: string;
  readonly observation: BodyweightObservation;
}

/** The days with a weigh-in, newest first. A day without one never gets a row (plan section 2, rule 7). */
export function weighInRows(
  progress: ProgressViewModel | null,
  audience: Audience,
): readonly WeighInRow[] {
  if (progress === null) return [];
  const unit = progress.displayUnit;
  const rows: WeighInRow[] = [];
  for (const day of progress.days) {
    const observation = day.observation;
    if (observation === null || day.displayValue === null) continue;
    rows.push({
      id: observation.id,
      date: day.date,
      version: observation.version,
      value: `${number(day.displayValue, audience.locale)} ${massWord(unit)}`,
      entered:
        observation.enteredUnit === unit
          ? null
          : $localize`Entered as ${number(observation.enteredValue, audience.locale)}:value: ${massWord(observation.enteredUnit)}:unit:`,
      addedBy: addedBy(observation.source, audience),
      observation,
    });
  }
  return rows.reverse();
}

/** "Fri 9 Oct", or with the year for another year than today's. */
export function dayWords(date: string, today: string, locale: string): string {
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return formatDate(date, sameYear ? 'EEE d MMM' : 'EEE d MMM y', locale);
}

/** One line of a weigh-in's See changes: a number it was corrected from, or a day it was moved from. */
export type WeighInChange =
  | {
      readonly kind: 'correction';
      readonly id: string;
      readonly at: string;
      readonly value: number;
      readonly unit: MassUnit;
      readonly reason: string;
    }
  | {
      readonly kind: 'move';
      readonly id: string;
      readonly at: string;
      readonly fromDate: string;
      readonly reason: string;
    };

/**
 * A weigh-in's changes, newest first: its corrections and, for one moved to its real day, each move
 * and the corrections made before it, so nothing the client or coach did is hidden (PRG-011, CLIENT-14).
 */
export function weighInChanges(history: BodyweightHistory): readonly WeighInChange[] {
  const changes: WeighInChange[] = [
    ...history.previousValues.map((item) => ({
      kind: 'correction' as const,
      id: item.id,
      at: item.supersededAtUtc,
      value: item.enteredValue,
      unit: item.enteredUnit,
      reason: item.reason,
    })),
    ...history.moves.map((move) => ({
      kind: 'move' as const,
      id: move.fromObservationId,
      at: move.movedAtUtc,
      fromDate: move.fromDate,
      reason: move.reason,
    })),
  ];
  return changes.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

export function weightErrors(value: number | null, unit: MassUnit): string[] {
  if (value === null || !Number.isFinite(value)) return [$localize`Enter a weight.`];
  const kilograms = weightKilograms(value, unit);
  if (kilograms < WEIGHT_KG.min || kilograms > WEIGHT_KG.max) {
    const range =
      unit === 'Pound' ? rangeInOtherUnit(WEIGHT_KG, POUNDS_TO_KILOGRAMS) : toRange(WEIGHT_KG);
    return [
      $localize`Weight has to be between ${bounds(range.low)}:low: and ${bounds(range.high)}:high: ${massWord(unit)}:unit:.`,
    ];
  }
  return [];
}

function toRange(range: { readonly min: number; readonly max: number }) {
  return { low: range.min, high: range.max };
}

function bounds(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
}

export type DayKind = 'weighed' | 'measured' | 'photographed' | 'moved';

/** A day is needed, and it cannot be one that has not happened in the coaching space yet. */
export function dayErrors(day: string, today: string, kind: DayKind): string[] {
  if (!isIsoDate(day)) {
    switch (kind) {
      case 'measured':
        return [$localize`Choose the day you measured.`];
      case 'photographed':
        return [$localize`Choose the day the photo was taken.`];
      case 'moved':
        return [$localize`Choose the day it was really weighed.`];
      default:
        return [$localize`Choose the day you weighed.`];
    }
  }
  return day > today
    ? [$localize`That day has not happened yet. Choose today or an earlier day.`]
    : [];
}

/** Moving a weigh-in needs another day than the one it is on, and one without a weigh-in. */
export function moveErrors(
  day: string,
  current: string,
  today: string,
  taken: ReadonlySet<string>,
): string[] {
  const problems = dayErrors(day, today, 'moved');
  if (problems.length > 0) return problems;
  if (day === current) {
    return [$localize`That is the day it is on now. Choose the day it was really weighed.`];
  }
  if (taken.has(day)) {
    return [
      $localize`A weight is already logged for that day. Correct that one instead of moving this one onto it.`,
    ];
  }
  return [];
}

/** How the trend is worked out, in words, for a coach: the method, its settings and the days it covers. */
export interface TrendFacts {
  readonly method: string;
  readonly how: string;
  /** The days it covers, or null when the server named none. */
  readonly window: string | null;
}

export function trendFacts(
  trend: ProgressViewModel['trend'],
  today: string,
  locale: string,
): TrendFacts {
  const name =
    trend.methodKey === 'BodyweightTrendEwma' ? $localize`Smoothed average` : trend.methodKey;
  const hasWindow = isIsoDate(trend.windowStart) && isIsoDate(trend.windowEndExclusive);
  return {
    method: $localize`${name}:method:, version ${trend.methodVersion}:version:`,
    how: $localize`Each weigh-in counts less as it gets older (time constant ${trend.timeConstantDays}:days: days, ${trend.warmupDays}:warmup:-day warm-up). A trend needs ${trend.minimumSampleCount}:minimum: weigh-ins.`,
    window: hasWindow
      ? $localize`${dayWords(trend.windowStart, today, locale)}:from: to ${dayWords(addDays(trend.windowEndExclusive, -1), today, locale)}:to:`
      : null,
  };
}

// ---------- measurements ----------

/** The order a measuring tape is usually taken in; body fat comes last because it is not a girth. */
export const MEASURED: readonly MeasurementType[] = [
  'Waist',
  'Chest',
  'Hips',
  'Thigh',
  'Arm',
  'BodyFatPercentage',
];

export function measurementName(type: MeasurementType): string {
  switch (type) {
    case 'Waist':
      return $localize`Waist`;
    case 'Chest':
      return $localize`Chest`;
    case 'Hips':
      return $localize`Hips`;
    case 'Thigh':
      return $localize`Thigh`;
    case 'Arm':
      return $localize`Arm`;
    default:
      return $localize`Body fat`;
  }
}

/** Body fat is a percentage whatever the tape shows; every other line is the person's choice of tape. */
export function measurementUnit(type: MeasurementType, girth: GirthUnit): MeasurementUnit {
  return type === 'BodyFatPercentage' ? 'Percent' : girth;
}

/** A line left empty is fine; one with a number has to be one the server takes. */
export function measurementErrors(
  type: MeasurementType,
  value: number | null,
  girth: GirthUnit,
): string[] {
  if (value === null) return [];
  if (!Number.isFinite(value)) return [$localize`Enter a number.`];
  const name = measurementName(type);
  if (type === 'BodyFatPercentage') {
    return value < BODY_FAT_PERCENT.min || value > BODY_FAT_PERCENT.max
      ? [
          $localize`${name}:name: has to be between ${bounds(BODY_FAT_PERCENT.min)}:low: and ${bounds(BODY_FAT_PERCENT.max)}:high: %.`,
        ]
      : [];
  }
  const centimetres = lengthCentimeters(value, girth);
  if (centimetres < GIRTH_CM.min || centimetres > GIRTH_CM.max) {
    const range =
      girth === 'Inch' ? rangeInOtherUnit(GIRTH_CM, CENTIMETERS_PER_INCH) : toRange(GIRTH_CM);
    return [
      $localize`${name}:name: has to be between ${bounds(range.low)}:low: and ${bounds(range.high)}:high: ${lengthWord(girth)}:unit:.`,
    ];
  }
  return [];
}

export interface MeasurementRow {
  readonly id: string;
  readonly type: MeasurementType;
  readonly name: string;
  readonly version: number;
  /** "82 cm", in the unit the page shows. */
  readonly value: string;
  readonly entered: string | null;
  readonly addedBy: string;
  readonly measurement: BodyMeasurement;
}

export interface MeasurementDay {
  readonly date: string;
  readonly rows: readonly MeasurementRow[];
}

/** Only recorded measurements, a day at a time, newest first, each day in the tape's order. */
export function measurementDays(
  measurements: BodyMeasurements | null,
  audience: Audience,
): readonly MeasurementDay[] {
  if (measurements === null) return [];
  const days: MeasurementDay[] = [];
  for (const day of measurements.days) {
    const rows = [...day.measurements]
      .sort((a, b) => MEASURED.indexOf(a.measurementType) - MEASURED.indexOf(b.measurementType))
      .map<MeasurementRow>((measurement) => ({
        id: measurement.id,
        type: measurement.measurementType,
        name: measurementName(measurement.measurementType),
        version: measurement.version,
        value: `${number(measurement.displayValue, audience.locale)} ${lengthWord(measurement.displayUnit)}`,
        entered:
          measurement.enteredUnit === measurement.displayUnit
            ? null
            : $localize`Entered as ${number(measurement.enteredValue, audience.locale)}:value: ${lengthWord(measurement.enteredUnit)}:unit:`,
        addedBy: addedBy(measurement.source, audience),
        measurement,
      }));
    if (rows.length > 0) days.push({ date: day.date, rows });
  }
  return days.reverse();
}

// ---------- photos ----------

export const POSES: readonly ProgressPhotoPose[] = ['Front', 'Side', 'Back'];

export function poseName(pose: ProgressPhotoPose): string {
  switch (pose) {
    case 'Side':
      return $localize`Side`;
    case 'Back':
      return $localize`Back`;
    default:
      return $localize`Front`;
  }
}

/** The most a photo may weigh: the server's own limit. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** Why a chosen file cannot be a progress photo, or null when it can. The server looks again. */
export function photoFileError(file: {
  readonly type: string;
  readonly size: number;
}): string | null {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
    return $localize`Choose a JPEG or PNG photo.`;
  }
  if (file.size <= 0) return $localize`That file is empty. Choose the photo again.`;
  if (file.size > MAX_PHOTO_BYTES) {
    return $localize`That photo is larger than 15 MB. Choose a smaller one.`;
  }
  return null;
}

export interface PhotoTile {
  readonly photo: ProgressPhoto;
  readonly pose: string;
  readonly addedBy: string;
}

export interface PhotoDay {
  readonly date: string;
  readonly tiles: readonly PhotoTile[];
}

export interface PhotoLists {
  /** Active photos by day, newest day first, each day's Front, Side and Back in that order. */
  readonly days: readonly PhotoDay[];
  /** What the client removed: their own history, never a coach's. Newest first. */
  readonly removed: readonly PhotoTile[];
}

export function photoLists(photos: readonly ProgressPhoto[], audience: Audience): PhotoLists {
  const tile = (photo: ProgressPhoto): PhotoTile => ({
    photo,
    pose: poseName(photo.pose),
    addedBy: addedBy(photo.source, audience),
  });
  const byDay = new Map<string, ProgressPhoto[]>();
  const removed: PhotoTile[] = [];
  for (const photo of photos) {
    if (photo.status === 'Removed') {
      removed.push(tile(photo));
    } else {
      byDay.set(photo.photoDate, [...(byDay.get(photo.photoDate) ?? []), photo]);
    }
  }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map<PhotoDay>(([date, items]) => ({
      date,
      tiles: [...items].sort((a, b) => POSES.indexOf(a.pose) - POSES.indexOf(b.pose)).map(tile),
    }));
  removed.sort((a, b) =>
    a.photo.photoDate < b.photo.photoDate ? 1 : a.photo.photoDate > b.photo.photoDate ? -1 : 0,
  );
  return { days, removed };
}

// ---------- the reason the server always asks for ----------

export type ReasonKind = 'weight' | 'date' | 'measurement' | 'photo';

/** One tap names the commonest reason; "Something else" is typed. `text` is what is kept in the history. */
export interface ReasonPick {
  readonly key: string;
  readonly label: string;
  readonly text: string | null;
}

export const REASON_LIMIT = 500;

export function reasonPicks(kind: ReasonKind, audience: Audience): readonly ReasonPick[] {
  const other: ReasonPick = { key: 'other', label: $localize`Something else`, text: null };
  switch (kind) {
    case 'weight':
      return [
        pick('typo', $localize`Typed the wrong number`),
        pick('scale', $localize`Misread the scale`),
        other,
      ];
    case 'date':
      return [pick('day', $localize`Logged on the wrong day`), other];
    case 'measurement':
      return [
        pick('typo', $localize`Typed the wrong number`),
        pick('place', $localize`Measured in the wrong place`),
        other,
      ];
    default:
      return audience.coach
        ? [
            pick('photo', $localize`Wrong photo`),
            pick('pose', $localize`Wrong pose`),
            pick('asked', $localize`The client asked for it to be removed`),
            other,
          ]
        : [
            pick('photo', $localize`Wrong photo`),
            pick('pose', $localize`Wrong pose`),
            pick('private', $localize`I do not want it shared`),
            other,
          ];
  }
}

function pick(key: string, label: string): ReasonPick {
  return { key, label, text: label };
}

/** The reason as it will be kept: the pick's own words, or what was typed. */
export function reasonValue(chosen: ReasonPick | null, typed: string): string {
  if (chosen === null) return '';
  return (chosen.text ?? typed).trim();
}

export function reasonErrors(chosen: ReasonPick | null, typed: string): string[] {
  if (chosen === null) return [$localize`Choose what was wrong.`];
  if (chosen.text === null) {
    const words = typed.trim();
    if (words.length === 0) return [$localize`Write what was wrong.`];
    if (words.length > REASON_LIMIT)
      return [$localize`Keep it to ${REASON_LIMIT}:count: characters.`];
  }
  return [];
}

// ---------- what the server says back ----------

export interface Refusal {
  readonly status: number | null;
  readonly code: string | null;
}

export function refusalOf(error: unknown): Refusal {
  if (!(error instanceof HttpErrorResponse)) return { status: null, code: null };
  const body = error.error as { code?: unknown } | null;
  return { status: error.status, code: typeof body?.code === 'string' ? body.code : null };
}

const STALE_CODES: readonly string[] = [
  'BodyweightVersionConflict',
  'BodyweightObservationVoided',
  'BodyMeasurementVersionConflict',
  'ProgressPhotoVersionConflict',
  'ProgressPhotoAlreadyRemoved',
];

/** Whether the entry changed under the person: the list is read again and the sheet asks them to retry. */
export function isStale(error: unknown): boolean {
  const { code } = refusalOf(error);
  return code !== null && STALE_CODES.includes(code);
}

export interface RefusalContext {
  /** The day the entry was for, "Fri 9 Oct". */
  readonly day?: string;
  /** What was being added: "Waist", "Front". */
  readonly what?: string;
}

/** A refusal in words a person can act on: what exists already, what changed, or the server's own sentence. */
export function entryRefusal(
  error: unknown,
  fallback: string,
  context: RefusalContext = {},
): string {
  const { code } = refusalOf(error);
  const day = context.day ?? $localize`that day`;
  switch (code) {
    case 'BodyweightDateAlreadyExists':
      return $localize`A weight is already logged for ${day}:day:. Correct that one instead.`;
    case 'BodyMeasurementDateAndTypeAlreadyExists': {
      const what = context.what ?? $localize`That measurement`;
      return $localize`${what}:what: is already recorded for ${day}:day:. Correct that one instead.`;
    }
    case 'ProgressPhotoAlreadyExists': {
      const pose = (context.what ?? '').toLowerCase();
      return $localize`A ${pose}:pose: photo is already saved for ${day}:day:. Remove it first, or choose another day.`;
    }
    default:
      return isStale(error)
        ? $localize`This entry changed while it was open. The list has been read again, so try once more.`
        : apiErrorMessage(error, fallback);
  }
}
