import type { ClientInvitation, InvitationStatus } from '../../core/api/api.models';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';
import { initialsOf } from '../../shell/initials';
import { addYears, adultCutoff, isIsoDate, type IsoDate } from '../../ui/calendar';
import type { DateInputStatus } from '../../ui/date-input';
import type { StatusPillTone } from '../../ui/status-pill';

/**
 * What the Invitations screen says and asks (R5.3a): a person's name and what is true of their
 * invitation now, in coach words, and what the invite form needs before it is sent. The server
 * decides everything else: who may invite, what an adult is, which link works.
 */

export type InvitationFilter = 'waiting' | 'earlier';

export function statusLabel(status: InvitationStatus): string {
  switch (status) {
    case 'Pending':
      return $localize`Waiting to join`;
    case 'Accepted':
      return $localize`Joined`;
    case 'Expired':
      return $localize`Link ran out`;
    case 'Revoked':
      return $localize`Cancelled`;
  }
}

export function statusTone(status: InvitationStatus): StatusPillTone {
  switch (status) {
    case 'Pending':
      return 'warning';
    case 'Accepted':
      return 'success';
    default:
      return 'neutral';
  }
}

/**
 * "Sun 25 Oct", or "1 Oct 2025" in another year: the day an instant falls on in the workspace, as every
 * coach page writes a day (COACH-6), never UTC's day.
 */
function workspaceDay(instant: string, locale: string, timeZone: string | null, now: Date): string {
  return houseDay(dayInZone(instant, timeZone), locale, dayInZone(now, timeZone));
}

/** How many times the link was sent on purpose: once, twice, "3 times". */
export function sentText(count: number): string {
  if (count <= 1) return $localize`Sent once`;
  if (count === 2) return $localize`Sent twice`;
  return $localize`Sent ${count}:count: times`;
}

/** The line under a person's name: what happened and what happens next. */
export function invitationLine(
  invitation: ClientInvitation,
  locale: string,
  timeZone: string | null = null,
  now: Date = new Date(),
): string {
  const until = workspaceDay(invitation.expiresAtUtc, locale, timeZone, now);
  switch (invitation.status) {
    case 'Pending':
      return $localize`${sentText(invitation.sendCount)}:sent: · the newest link works until ${until}:date:`;
    case 'Accepted':
      return $localize`Set up their account and joined`;
    case 'Expired':
      return $localize`The link ran out on ${until}:date:`;
    case 'Revoked':
      return $localize`The link was cancelled`;
  }
}

export interface InvitationRow {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly email: string;
  readonly status: InvitationStatus;
  readonly statusLabel: string;
  readonly tone: StatusPillTone;
  readonly line: string;
  /** Pending only: a new link now, which makes every earlier link stop working. */
  readonly canSendAgain: boolean;
  readonly canCancel: boolean;
  /** A link that ran out or was cancelled: start again with the same details filled in. */
  readonly canInviteAgain: boolean;
  /** Only the development API holds a link to open; production sends it by email alone. */
  readonly developmentLink: string | null;
  readonly invitation: ClientInvitation;
}

export function invitationRow(
  invitation: ClientInvitation,
  locale: string,
  timeZone: string | null = null,
  now: Date = new Date(),
): InvitationRow {
  const name = `${invitation.firstName} ${invitation.lastName}`.trim();
  return {
    id: invitation.id,
    name,
    initials: initialsOf(name, invitation.email),
    email: invitation.email,
    status: invitation.status,
    statusLabel: statusLabel(invitation.status),
    tone: statusTone(invitation.status),
    line: invitationLine(invitation, locale, timeZone, now),
    canSendAgain: invitation.status === 'Pending',
    canCancel: invitation.status === 'Pending',
    canInviteAgain: invitation.status === 'Expired' || invitation.status === 'Revoked',
    developmentLink: invitation.status === 'Pending' ? invitation.developmentActionUrl : null,
    invitation,
  };
}

/** Who is still to join first; the rest, newest first, behind a closed disclosure. */
export function splitInvitations(
  invitations: readonly ClientInvitation[],
  locale: string,
  timeZone: string | null = null,
  now: Date = new Date(),
): { waiting: InvitationRow[]; earlier: InvitationRow[] } {
  const rows = [...invitations]
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))
    .map((invitation) => invitationRow(invitation, locale, timeZone, now));
  return {
    waiting: rows.filter((row) => row.status === 'Pending'),
    earlier: rows.filter((row) => row.status !== 'Pending'),
  };
}

// ---------- the invite form ----------

export interface InviteEntry {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  /** A real day, `YYYY-MM-DD`, or `''`. */
  birthDate: string;
  birthStatus: DateInputStatus;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function inviteErrors(entry: InviteEntry, today: IsoDate): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const first = entry.firstName.trim();
  if (first === '') errors['firstName'] = [$localize`Type their first name.`];
  else if (first.length > 100) errors['firstName'] = [$localize`Keep it to 100 characters.`];
  const last = entry.lastName.trim();
  if (last === '') errors['lastName'] = [$localize`Type their last name.`];
  else if (last.length > 100) errors['lastName'] = [$localize`Keep it to 100 characters.`];
  const email = entry.email.trim();
  if (email === '') errors['email'] = [$localize`Type their email address.`];
  else if (email.length > 320 || !EMAIL.test(email)) {
    errors['email'] = [$localize`Type an email address like name@example.com.`];
  }
  if (entry.phoneNumber.trim().length > 30) {
    errors['phoneNumber'] = [$localize`Keep it to 30 characters.`];
  }
  if (entry.birthStatus === 'incomplete') {
    errors['birthDate'] = [$localize`Type the day, month and year, or leave all three empty.`];
  } else if (entry.birthStatus === 'invalid') {
    errors['birthDate'] = [$localize`That day does not exist. Check the day and the month.`];
  } else if (isIsoDate(entry.birthDate)) {
    if (entry.birthDate > adultCutoff(today)) {
      errors['birthDate'] = [$localize`Clients have to be 18 or older.`];
    } else if (entry.birthDate < addYears(today, -120)) {
      errors['birthDate'] = [$localize`Check the year: that is more than 120 years ago.`];
    }
  }
  return errors;
}
