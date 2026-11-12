import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import type { TenantMembership } from '../../core/api/api.models';
import type {
  TraineeCallerSignUp,
  TraineeSignUpStatus,
  TraineeSignUpStatusView,
} from '../../core/api/generated';
import { deviceTimeZoneId, timeZoneOption } from '../../core/i18n/time-zones';

/**
 * Where TB Gym's own sign-up stands for this visit (notes plan N9a2), as the server answered it: open,
 * full for the week or closed. While closed the server says nothing else, not even the house's name.
 */
export interface TrainSignUp {
  readonly status: TraineeSignUpStatus;
  readonly workspaceName: string | null;
  readonly timeZoneId: string | null;
  readonly minimumAge: number | null;
  /** The house's calendar day sign-up opens again on, `YYYY-MM-DD`; only while full. */
  readonly opensAgainOn: string | null;
  /** The server-signed stamp the form sends back; only while open. */
  readonly formStamp: string | null;
  /** For someone signed in: already a trainee here, or confirmed and waiting for a place. */
  readonly caller: TraineeCallerSignUp | null;
}

export function toTrainSignUp(view: TraineeSignUpStatusView): TrainSignUp {
  const age =
    view.minimumAge === null || view.minimumAge === undefined ? null : Number(view.minimumAge);
  return {
    status: view.status,
    workspaceName: view.workspaceName ?? null,
    timeZoneId: view.timeZoneId ?? null,
    minimumAge: age !== null && Number.isFinite(age) ? age : null,
    opensAgainOn: view.opensAgainOn ?? null,
    formStamp: view.formStamp ?? null,
    caller: view.callerSignUp ?? null,
  };
}

/** What the page shows after a refusal said sign-up closed meanwhile: nothing about the house. */
export const CLOSED_SIGN_UP: TrainSignUp = {
  status: 'Closed',
  workspaceName: null,
  timeZoneId: null,
  minimumAge: null,
  opensAgainOn: null,
  formStamp: null,
  caller: null,
};

/**
 * "Monday": the weekday of a house calendar day. Angular reads `YYYY-MM-DD` as that day on any device,
 * so a visitor far from Beirut reads the same weekday as the house.
 */
export function weekdayOf(day: string | null, locale: string): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return formatDate(day, 'EEEE', locale);
}

/**
 * The person's membership of TB Gym's own space, by the name the status read gives it: the one Client
 * membership so named, else the one membership so named (the house's staff), else none, since a coach's
 * space may carry the same name and the server names no id.
 */
export function houseMembership(
  memberships: readonly TenantMembership[],
  name: string | null,
): TenantMembership | undefined {
  if (!name) return undefined;
  const named = memberships.filter((membership) => membership.tenantName === name);
  const clients = named.filter((membership) => membership.role === 'Client');
  return clients.length === 1 ? clients[0] : named.length === 1 ? named[0] : undefined;
}

/** "Sign-up is full for this week. It opens again on Monday." */
export function fullSentence(opensAgainOn: string | null, locale: string): string {
  const day = weekdayOf(opensAgainOn, locale);
  return day
    ? $localize`Sign-up is full for this week. It opens again on ${day}:weekday:.`
    : $localize`Sign-up is full for this week.`;
}

/** The refusal of a second sign-up in one house week, by someone who left and came back. */
export function onceAWeekSentence(opensAgainOn: string | null, locale: string): string {
  const day = weekdayOf(opensAgainOn, locale);
  return day
    ? $localize`You already signed up this week. You can sign up again on ${day}:weekday:.`
    : $localize`You already signed up this week. You can sign up again next week.`;
}

/**
 * The refusal when a date of birth is under the house's age. The number is the house's setting; the
 * sentence a form shows beside the box before anything is sent is the lawyer's, so none is shown.
 */
export function ageSentence(minimumAge: number | null): string {
  return minimumAge === null
    ? $localize`Sign-up is not open to people of your age.`
    : $localize`Sign-up is open to people aged ${minimumAge}:age: or older.`;
}

/** The house's clock, and whether this device reads another one right now. */
export interface HouseClock {
  /** "Training days follow Beirut time." */
  readonly line: string;
  /** "On your device's clock, a new training day starts at 9:00 PM.", or null on the house's own clock. */
  readonly abroad: string | null;
}

/**
 * Training days follow the house's clock (ADR 0003, notes plan N9): its city, and for a device on another
 * offset the hour a new training day starts there, now (it moves with daylight saving).
 */
export function houseClock(
  timeZoneId: string | null,
  locale: string,
  at: Date = new Date(),
  deviceZone: string | null = deviceTimeZoneId(),
): HouseClock | null {
  if (!timeZoneId) return null;
  const house = timeZoneOption(timeZoneId, at, locale);
  const line = $localize`Training days follow ${house.city}:city: time.`;
  if (!deviceZone || deviceZone === timeZoneId) return { line, abroad: null };
  const device = timeZoneOption(deviceZone, at, locale);
  if (device.offsetMinutes === house.offsetMinutes) return { line, abroad: null };
  // The house's midnight on the device's clock, as minutes after the device's own midnight.
  const minutes = (((device.offsetMinutes - house.offsetMinutes) % 1440) + 1440) % 1440;
  const time = formatDate(Date.UTC(2000, 0, 1, 0, minutes), 'shortTime', locale, '+0000');
  return {
    line,
    abroad: $localize`On your device’s clock, a new training day starts at ${time}:time:.`,
  };
}

/** The form's fields a refusal can name. */
export type TrainField = 'firstName' | 'lastName' | 'email' | 'password' | 'birthDate';

/** What a refused sign-up means for the page. */
export type TrainRefusal =
  | { readonly kind: 'closed' }
  | { readonly kind: 'full'; readonly opensAgainOn: string | null }
  | { readonly kind: 'age'; readonly minimumAge: number | null }
  | { readonly kind: 'fields'; readonly errors: Partial<Record<TrainField, readonly string[]>> }
  | { readonly kind: 'too-fast' }
  | { readonly kind: 'stamp' }
  | { readonly kind: 'existing-account' }
  | { readonly kind: 'wrong-account' }
  | { readonly kind: 'already-joined' }
  | { readonly kind: 'former-staff' }
  | { readonly kind: 'not-available' }
  | { readonly kind: 'once-a-week'; readonly opensAgainOn: string | null }
  | { readonly kind: 'legal' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'other' };

interface RefusalBody {
  readonly code?: unknown;
  readonly opensAgainOn?: unknown;
  readonly minimumAge?: unknown;
  readonly errors?: unknown;
}

/** Reads a refused `POST /api/auth/register/trainee` (N9a1's codes); anything else is `other`. */
export function trainRefusal(error: unknown): TrainRefusal {
  if (!(error instanceof HttpErrorResponse)) return { kind: 'other' };
  if (error.status === 429) return { kind: 'busy' };
  const body = (typeof error.error === 'object' ? error.error : null) as RefusalBody | null;
  const day = typeof body?.opensAgainOn === 'string' ? body.opensAgainOn : null;
  switch (body?.code) {
    case 'trainee_sign_up_closed':
      return { kind: 'closed' };
    case 'trainee_sign_up_full':
      return { kind: 'full', opensAgainOn: day };
    case 'trainee_sign_up_age_not_met': {
      const age = Number(body.minimumAge);
      return {
        kind: 'age',
        minimumAge: body.minimumAge != null && Number.isFinite(age) ? age : null,
      };
    }
    case 'sign_up_form_too_fast':
      return { kind: 'too-fast' };
    case 'sign_up_form_stamp_invalid':
      return { kind: 'stamp' };
    case 'existing_account_sign_in_required':
      return { kind: 'existing-account' };
    case 'wrong_signed_in_account':
      return { kind: 'wrong-account' };
    case 'trainee_already_joined':
      return { kind: 'already-joined' };
    case 'trainee_former_staff':
      return { kind: 'former-staff' };
    case 'trainee_sign_up_not_available':
      return { kind: 'not-available' };
    case 'trainee_sign_up_once_a_week':
      return { kind: 'once-a-week', opensAgainOn: day };
    case 'legal_acceptance_required':
      return { kind: 'legal' };
  }
  if (error.status === 400 && body && typeof body.errors === 'object' && body.errors !== null) {
    const errors = fieldErrors(body.errors as Record<string, unknown>);
    if (Object.keys(errors).length > 0) return { kind: 'fields', errors };
  }
  return { kind: 'other' };
}

/** The server's field messages under the form's own fields: its password rules come as `identity`. */
function fieldErrors(
  errors: Record<string, unknown>,
): Partial<Record<TrainField, readonly string[]>> {
  const fields: Partial<Record<TrainField, string[]>> = {};
  for (const [key, value] of Object.entries(errors)) {
    const messages = Array.isArray(value)
      ? value.filter((message): message is string => typeof message === 'string' && message !== '')
      : [];
    if (messages.length === 0) continue;
    const name = key.charAt(0).toLowerCase() + key.slice(1);
    const field: TrainField | null =
      name === 'identity'
        ? 'password'
        : ((['firstName', 'lastName', 'email', 'password', 'birthDate'] as const).find(
            (candidate) => candidate === name,
          ) ?? null);
    if (field) fields[field] = [...(fields[field] ?? []), ...messages];
  }
  return fields;
}

/** The sentence a refusal shows in the form's summary; null where the page changes state instead. */
export function refusalSentence(refusal: TrainRefusal, locale: string): string | null {
  switch (refusal.kind) {
    case 'closed':
    case 'full':
    case 'legal':
      return null;
    case 'age':
      return ageSentence(refusal.minimumAge);
    case 'fields':
      return $localize`Check the fields marked above.`;
    case 'too-fast':
      return $localize`That was quick. Give it a moment and send again.`;
    case 'stamp':
      return $localize`The form needs to be opened again before it can be sent. Reload the page and send it again.`;
    case 'existing-account':
      return $localize`An account already uses this email. Sign in with it, then sign up from there. If you already signed up here, open the link in the email we sent you; if that link has stopped working, sign up again in a few days.`;
    case 'wrong-account':
      return $localize`You are signed in with a different email. Use that email, or sign out first.`;
    case 'already-joined':
      return $localize`You are already part of this coaching space.`;
    case 'former-staff':
      return $localize`You were on this coaching space’s team, so you can’t sign up to train in it. Talk to its owner.`;
    case 'not-available':
      return $localize`This coaching space ended your coaching or blocked your access, so you can’t sign up again by yourself. Ask it to invite you back.`;
    case 'once-a-week':
      return onceAWeekSentence(refusal.opensAgainOn, locale);
    case 'busy':
      return $localize`Too many sign-ups from this connection for now. Try again in an hour.`;
    case 'other':
      return null;
  }
}

/** The calendar day a date of birth must not be after, and the oldest one taken: the server's own bounds. */
export function birthDateReasons(
  status: 'empty' | 'incomplete' | 'invalid' | 'valid',
  value: string,
  today: string,
): string[] {
  switch (status) {
    case 'empty':
      return [$localize`Enter your date of birth.`];
    case 'incomplete':
      return [$localize`Enter the day, month and year.`];
    case 'invalid':
      return [$localize`That day does not exist. Check the day and the month.`];
    case 'valid': {
      const oldest = `${Number(today.slice(0, 4)) - 120}${today.slice(4)}`;
      return value > today || value < oldest
        ? [$localize`Check the year of your date of birth.`]
        : [];
    }
  }
}
