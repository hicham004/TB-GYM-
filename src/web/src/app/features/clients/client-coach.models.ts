import type {
  ClientCoachAssignmentReason,
  ClientCoachAssignmentView,
} from '../../core/api/generated';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';

/**
 * The client's coach history (ADR 0026), as the Reassign dialog shows it under its promise that a note is
 * kept there (audit COACH-16): each coach with the days they coached the client, why the change was made,
 * and the owner's note. Newest first. The server keeps the history append-only; this only phrases it.
 */
export interface CoachHistoryRow {
  readonly id: string;
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
      const why = reasonWords(item.reason, item.previousCoachName);
      return {
        id: item.id,
        coach: item.coachName,
        line: why ? `${span} · ${why}` : span,
        note: item.note?.trim() || null,
        current: !next,
      };
    })
    .reverse();
}

/** Why the client came to this coach, in the owner's words; nothing when there is nothing to say. */
function reasonWords(reason: ClientCoachAssignmentReason, previous: string | null): string {
  switch (reason) {
    case 'Invitation':
      return $localize`joined`;
    case 'Reassigned':
      return previous ? $localize`moved from ${previous}:coach:` : $localize`moved by you`;
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
