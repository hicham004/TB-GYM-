import type {
  ClientCoachAssignmentReason,
  ClientCoachAssignmentView,
} from '../../core/api/generated';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';

/**
 * The client's coach history (ADR 0026), as the coach dialog shows it under its promise that a note is
 * kept there (audit COACH-16): each coach with the days they coached the client, why the change was made,
 * and the owner's note. Newest first. The server keeps the history append-only; this only phrases it.
 */
export interface CoachHistoryRow {
  readonly id: string;
  /** The coach's name, or "Waiting for a coach" on an entry naming nobody (N9d1b). */
  readonly coach: string;
  /** "Since Tue 13 Oct · moved from Karim Haddad", or "Mon 5 Oct to Tue 13 Oct · joined". */
  readonly line: string;
  readonly note: string | null;
  readonly current: boolean;
}

export function coachHistoryRows(
  items: readonly ClientCoachAssignmentView[],
  locale: string,
  timeZone: string | null,
  now: Date = new Date(),
): CoachHistoryRow[] {
  const today = dayInZone(now, timeZone);
  const day = (instant: string) => houseDay(dayInZone(instant, timeZone), locale, today);
  const oldestFirst = [...items].sort((a, b) => Number(a.sequence) - Number(b.sequence));
  return oldestFirst
    .map((item, index) => {
      const next = oldestFirst[index + 1];
      const span = next
        ? $localize`${day(item.assignedAtUtc)}:from: to ${day(next.assignedAtUtc)}:until:`
        : $localize`Since ${day(item.assignedAtUtc)}:from:`;
      const why = reasonWords(item);
      return {
        id: item.id,
        // A coach leaving, or an invitation or sign-up landing with nobody to coach the client (CLI-012).
        coach: item.coachUserId === null ? $localize`Waiting for a coach` : (item.coachName ?? ''),
        line: why ? `${span} · ${why}` : span,
        note: item.note?.trim() || null,
        current: !next,
      };
    })
    .reverse();
}

/** Why the client came to this coach, in the owner's words; nothing when there is nothing to say. */
function reasonWords(
  item: Pick<ClientCoachAssignmentView, 'reason' | 'previousCoachUserId' | 'previousCoachName'>,
): string {
  const previous = item.previousCoachName;
  const reason: ClientCoachAssignmentReason = item.reason;
  switch (reason) {
    case 'Invitation':
      return $localize`joined`;
    // A trainee of TB Gym's own space signed up with no invitation (notes plan N9a1).
    case 'SignUp':
      return $localize`signed up`;
    case 'Reassigned':
      // A reassignment naming nobody before it ends a wait for a coach (N9d1b).
      return previous
        ? $localize`moved from ${previous}:coach:`
        : item.previousCoachUserId === null
          ? $localize`after waiting for a coach`
          : $localize`moved by you`;
    case 'CoachRemoved':
      return previous
        ? $localize`${previous}:coach: was removed from the team`
        : $localize`their coach was removed from the team`;
    case 'CoachResigned':
      return previous
        ? $localize`${previous}:coach: left the team`
        : $localize`their coach left the team`;
    case 'Released':
      return $localize`coaching ended`;
    case 'ClientLeft':
      return $localize`the client left`;
    case 'Migration':
      return '';
  }
}

/** Who the client has now, as the coach dialog weighs a change: nobody, the caller, or someone else. */
export type CurrentCoach =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'you' }
  | { readonly kind: 'other'; readonly name: string };

/** The one the owner picked in the dialog; null while nothing is picked. */
export type CoachChoice =
  { readonly kind: 'you' } | { readonly kind: 'other'; readonly name: string };

/**
 * What the change does, in the dialog under the choice (C8, N9d1a/b): who sees the client's private side
 * from now on, what the coach before them loses, and that the client is told. The client is named, never
 * given a pronoun. The server tells a coached client of a new coach and a self-directed trainee of who can
 * see their training; the details say neither, so the last sentence fits both.
 */
export function coachChangeSentence(
  firstName: string,
  current: CurrentCoach,
  chosen: CoachChoice | null,
): string {
  const gains =
    chosen === null
      ? $localize`The coach you choose sees ${firstName}:name: and all their history right away.`
      : chosen.kind === 'you'
        ? $localize`You become ${firstName}:name:’s coach and see their training, nutrition, check-ins and progress right away.`
        : $localize`${chosen.name}:coach: sees ${firstName}:name: and all their history right away.`;
  const loses =
    current.kind === 'other'
      ? $localize`${current.name}:coach: loses access, and their chat with ${firstName}:name: stays readable to ${firstName}:name: only.`
      : current.kind === 'you'
        ? $localize`You keep ${firstName}:name:’s plan and payments as the owner; their training and progress close to you, and your chat with ${firstName}:name: stays readable to ${firstName}:name: only.`
        : null;
  const told = $localize`${firstName}:name: is told of the change.`;
  return [gains, loses, told].filter((part) => part !== null).join(' ');
}
