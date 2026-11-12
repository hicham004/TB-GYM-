import { formatDate, formatNumber } from '@angular/common';
import { toNumber } from '../../core/api/api-client';
import type {
  HouseAdminView,
  HouseSetting,
  HouseSettingView,
  HouseSignUpView,
  HouseWorkspaceView,
  TraineeSignUpStatus,
} from '../../core/api/generated';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';
import { timeZoneOption, zoneLabel } from '../../core/i18n/time-zones';
import { addDays } from '../../ui/calendar';
import type { StatusPillTone } from '../../ui/status-pill';

/**
 * The house as its platform admin reads it (notes plan N9a2, on N9a1's API, ADR 0041): which coaching
 * space is TB Gym's own, where its sign-up stands this week, and the settings the admin enters, each
 * empty until filled. Nothing here decides anything: the server says whether sign-up is open.
 */
export interface HouseAdmin {
  readonly house: HouseWorkspace | null;
  readonly settings: readonly HouseSettingRow[];
  readonly signUp: HouseSignUp | null;
}

export interface HouseWorkspace {
  readonly tenantId: string;
  readonly name: string;
  readonly timeZoneId: string;
  /** Today on the house's clock, `YYYY-MM-DD`. */
  readonly currentDate: string;
}

export interface HouseSettingRow {
  readonly setting: HouseSetting;
  /** The value in force, as the server keeps it; null while empty. */
  readonly value: string | null;
  /** 0 while never set; what a change sends back as the version it read. */
  readonly version: number;
  readonly changedAtUtc: string | null;
  readonly changedByName: string | null;
}

export interface HouseSignUp {
  readonly status: TraineeSignUpStatus;
  readonly weekStartsOn: string;
  readonly weekEndsOnExclusive: string;
  /** Sign-ups confirmed this week: the places taken. */
  readonly signUpsThisWeek: number;
  /** Sign-ups whose email is not confirmed yet, or that were confirmed into a full week. */
  readonly waitingForConfirmation: number;
}

export function toHouseAdmin(view: HouseAdminView): HouseAdmin {
  return {
    house: view.house ? toHouseWorkspace(view.house) : null,
    settings: view.settings.map(toHouseSetting),
    signUp: view.signUp ? toHouseSignUp(view.signUp) : null,
  };
}

export function toHouseSetting(view: HouseSettingView): HouseSettingRow {
  return {
    setting: view.setting,
    value: view.value ?? null,
    version: toNumber(view.version),
    changedAtUtc: view.changedAtUtc ?? null,
    changedByName: view.changedByName ?? null,
  };
}

function toHouseWorkspace(view: HouseWorkspaceView): HouseWorkspace {
  return {
    tenantId: view.tenantId,
    name: view.name,
    timeZoneId: view.timeZoneId,
    currentDate: view.currentDate,
  };
}

function toHouseSignUp(view: HouseSignUpView): HouseSignUp {
  return {
    status: view.status,
    weekStartsOn: view.weekStartsOn,
    weekEndsOnExclusive: view.weekEndsOnExclusive,
    signUpsThisWeek: toNumber(view.signUpsThisWeek),
    waitingForConfirmation: toNumber(view.waitingForConfirmation),
  };
}

/** How a setting reads on the page and in its sheet; the bounds are the server's own (CLI-023). */
export interface HouseSettingWords {
  readonly label: string;
  /** The label inside a sentence: "Change new sign-ups a week". */
  readonly inSentence: string;
  readonly help: string;
  /** What the sheet says before sending a number outside the bounds; the server words its own refusal. */
  readonly reason: string;
  readonly min: number;
  readonly max: number;
}

/**
 * Each setting's words. A `Record` over every setting the API names, so a later row's new setting does not
 * compile until it has words of its own.
 */
export function houseSettingWords(): Record<HouseSetting, HouseSettingWords> {
  return {
    SignUpsPerWeek: {
      label: $localize`New sign-ups a week`,
      inSentence: $localize`new sign-ups a week`,
      help: $localize`A whole number from 0 to 10,000. Empty or 0 keeps sign-up closed.`,
      reason: $localize`Enter a whole number from 0 to 10,000, or leave it empty.`,
      min: 0,
      max: 10_000,
    },
    MinimumSignUpAge: {
      label: $localize`Youngest age that may sign up`,
      inSentence: $localize`the youngest age that may sign up`,
      help: $localize`From 18 to 100. Empty keeps sign-up closed. TB Gym is for adults, so it can’t be under 18.`,
      reason: $localize`Enter an age from 18 to 100, or leave it empty.`,
      min: 18,
      max: 100,
    },
  };
}

/** "20", "10,000" or "Empty": a setting's value as the page shows it. */
export function settingValueText(value: string | null, locale: string): string {
  if (value === null || value.trim() === '') return $localize`Empty`;
  const number = Number(value);
  return Number.isFinite(number) ? formatNumber(number, locale, '1.0-0') : value;
}

/**
 * "Changed by Hicham Haddad on Thu 12 Nov", on the house's clock and against its today, or "Never set"
 * while it was never changed.
 */
export function changedLine(row: HouseSettingRow, house: HouseWorkspace, locale: string): string {
  if (row.version === 0 || row.changedAtUtc === null) return $localize`Never set`;
  const day = houseDay(dayInZone(row.changedAtUtc, house.timeZoneId), locale, house.currentDate);
  return row.changedByName
    ? $localize`Changed by ${row.changedByName}:name: on ${day}:day:`
    : $localize`Changed on ${day}:day:`;
}

/** "Mon 9 Nov – Sun 15 Nov": the house's calendar week, its last day included. */
export function weekRange(signUp: HouseSignUp, locale: string): string {
  const from = formatDate(signUp.weekStartsOn, 'EEE d MMM', locale);
  const to = formatDate(addDays(signUp.weekEndsOnExclusive, -1), 'EEE d MMM', locale);
  return $localize`${from}:from: – ${to}:to:`;
}

/** "Beirut, Asia": the house's clock as Settings › Name and region names a zone. */
export function houseZoneLabel(
  house: HouseWorkspace,
  locale: string,
  at: Date = new Date(),
): string {
  return zoneLabel(timeZoneOption(house.timeZoneId, at, locale));
}

/** The pill beside "Sign-up this week", from the server's answer alone. */
export function signUpPill(status: TraineeSignUpStatus): {
  readonly label: string;
  readonly tone: StatusPillTone;
} {
  switch (status) {
    case 'Open':
      return { label: $localize`Open`, tone: 'success' };
    case 'Full':
      return { label: $localize`Full this week`, tone: 'warning' };
    case 'Closed':
      return { label: $localize`Closed`, tone: 'neutral' };
  }
}

/** What the status means, in one sentence; it explains the server's answer and never works it out. */
export function signUpLine(signUp: HouseSignUp, locale: string): string {
  switch (signUp.status) {
    case 'Open':
      return $localize`People can sign up on the Train with TB Gym page now.`;
    case 'Full':
      return $localize`This week’s places are taken. Sign-up opens again on ${formatDate(signUp.weekEndsOnExclusive, 'EEEE', locale)}:weekday:.`;
    case 'Closed':
      return $localize`Sign-up opens once new sign-ups a week is above 0 and the youngest age is filled.`;
  }
}

/** "8 of 20 this week" under Places taken, or "this week" while the number is empty. */
export function placesContext(perWeek: string | null, locale: string): string {
  const number = perWeek === null ? Number.NaN : Number(perWeek);
  return Number.isFinite(number) && number > 0
    ? $localize`of ${formatNumber(number, locale, '1.0-0')}:places: this week`
    : $localize`this week`;
}
