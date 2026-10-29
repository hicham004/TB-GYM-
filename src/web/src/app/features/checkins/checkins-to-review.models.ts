import type { CheckInToReviewItem, CheckInToReviewList } from '../../core/api/generated';
import { initialsOf } from '../../shell/initials';
import { dayLabel, lateBy } from '../clients/client-checkins.models';

/**
 * Check-ins to review (critique B3b): every sent check-in waiting for its review, of the clients the
 * reader coaches (CHK-014), worked out here so the page only draws. The server sends them oldest first.
 */

export interface ToReviewContext {
  /** The workspace's own date, so a day of another year says its year. */
  today: string;
  locale: string;
  /** The signed-in coach: a check-in of their own client does not name its coach. */
  userId: string | null;
}

export interface ToReviewRow {
  id: string;
  name: string;
  initials: string;
  form: string;
  /** "Sent Mon 19 Oct · 1 day late", or "Sent Mon 19 Oct" when it came on time. */
  sent: string;
  /** "Coached by Lea Khoury" on an owner's team coach's client; null on the reader's own. */
  coach: string | null;
  /** What the row's link says after the name, as one sentence for a screen reader. */
  spoken: string;
  /** The review, on the client's record. */
  link: string[];
  /** The name in lower case without accents, for the search. */
  searchText: string;
}

export function toReviewRow(item: CheckInToReviewItem, context: ToReviewContext): ToReviewRow {
  const name = `${item.clientFirstName} ${item.clientLastName}`.trim();
  const sent = $localize`Sent ${dayLabel(item.sentDate, context)}:date:`;
  const late = Number(item.daysLate);
  const line = late > 0 ? `${sent} · ${lateBy(late)}` : sent;
  const coach =
    context.userId !== null && item.coachUserId !== context.userId
      ? $localize`Coached by ${item.coachName}:coach:`
      : null;
  return {
    id: item.assignmentId,
    name,
    initials: initialsOf(name),
    form: item.formTitle,
    sent: line,
    coach,
    spoken: [item.formTitle, line, coach].filter(Boolean).join(', '),
    link: ['/clients', item.clientProfileId, 'checkins', item.assignmentId],
    searchText: searchable(name),
  };
}

/** Whether every word typed in the search box is in the client's name. */
export function matchesName(row: ToReviewRow, search: string): boolean {
  const words = searchable(search).split(/\s+/).filter(Boolean);
  return words.every((word) => row.searchText.includes(word));
}

/**
 * "3 check-ins to review", every one waiting, or "1 of 3 check-ins to review" while a search narrows
 * the ones read. When more wait than were read, a search looks through the oldest only and says so:
 * "0 of the oldest 500 check-ins to review".
 */
export function reviewCount(
  shown: number,
  read: number,
  total: number,
  searching: boolean,
): string {
  if (searching && read < total) {
    return $localize`${shown}:shown: of the oldest ${read}:count: check-ins to review`;
  }
  if (shown === read) {
    return total === 1
      ? $localize`1 check-in to review`
      : $localize`${total}:count: check-ins to review`;
  }
  return read === 1
    ? $localize`${shown}:shown: of 1 check-in to review`
    : $localize`${shown}:shown: of ${read}:count: check-ins to review`;
}

/** The oldest are shown when more wait than one read brings; reviewing them brings the rest. */
export function limitNote(list: Pick<CheckInToReviewList, 'items' | 'total'>): string | null {
  const total = Number(list.total);
  return total > list.items.length
    ? $localize`The oldest ${list.items.length}:shown: of ${total}:total: are shown. The rest come as you review these.`
    : null;
}

/** Lower case without accents, so "elie" finds "Élie". */
function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}
