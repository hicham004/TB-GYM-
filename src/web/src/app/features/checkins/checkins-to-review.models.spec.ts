import { describe, expect, it } from 'vitest';
import type { CheckInToReviewItem } from '../../core/api/generated';
import { limitNote, matchesName, reviewCount, toReviewRow } from './checkins-to-review.models';

const CONTEXT = { today: '2026-10-22', locale: 'en-GB', userId: 'user-lea' };

function item(overrides: Partial<CheckInToReviewItem> = {}): CheckInToReviewItem {
  return {
    assignmentId: 'assignment-1',
    clientProfileId: 'client-maya',
    clientFirstName: 'Maya',
    clientLastName: 'Rahman',
    coachUserId: 'user-lea',
    coachName: 'Lea Khoury',
    formTitle: 'Weekly check-in',
    sentAtUtc: '2026-10-19T07:30:00Z',
    sentDate: '2026-10-19',
    dueDate: '2026-10-19',
    daysLate: 0,
    ...overrides,
  };
}

describe('a check-in to review (critique B3b)', () => {
  it('says the day it was sent, and how late only when it was', () => {
    expect(toReviewRow(item(), CONTEXT).sent).toBe('Sent Mon 19 Oct');
    expect(toReviewRow(item({ daysLate: 1 }), CONTEXT).sent).toBe('Sent Mon 19 Oct · 1 day late');
    expect(toReviewRow(item({ daysLate: '4' }), CONTEXT).sent).toBe(
      'Sent Mon 19 Oct · 4 days late',
    );
  });

  it('says the year of a day from another year', () => {
    expect(toReviewRow(item({ sentDate: '2025-12-30' }), CONTEXT).sent).toBe(
      'Sent Tue 30 Dec 2025',
    );
  });

  it('names the coach only of another coach’s client', () => {
    expect(toReviewRow(item(), CONTEXT).coach).toBeNull();
    const other = toReviewRow(
      item({ coachUserId: 'user-karim', coachName: 'Karim Haddad' }),
      CONTEXT,
    );
    expect(other.coach).toBe('Coached by Karim Haddad');
    expect(other.spoken).toBe('Weekly check-in, Sent Mon 19 Oct, Coached by Karim Haddad');
    // Before the reader is known, no row is called someone else's.
    expect(
      toReviewRow(item({ coachUserId: 'user-karim' }), { ...CONTEXT, userId: null }).coach,
    ).toBeNull();
  });

  it('matches every word of a search in the name, in any case and without accents', () => {
    const row = toReviewRow(item({ clientFirstName: 'Élie', clientLastName: 'Nassar' }), CONTEXT);
    expect(row.initials).toBe('ÉN');
    expect(matchesName(row, '')).toBe(true);
    expect(matchesName(row, '  ELIE  nas ')).toBe(true);
    expect(matchesName(row, 'elie maya')).toBe(false);
  });

  it('counts the ones waiting, one or many, all or those a search keeps', () => {
    expect(reviewCount(1, 1, 1)).toBe('1 check-in to review');
    expect(reviewCount(2, 2, 2)).toBe('2 check-ins to review');
    expect(reviewCount(500, 500, 612)).toBe('612 check-ins to review');
    expect(reviewCount(0, 1, 1)).toBe('0 of 1 check-in to review');
    expect(reviewCount(1, 3, 3)).toBe('1 of 3 check-ins to review');
  });

  it('notes the oldest are shown only when more wait than were read', () => {
    expect(limitNote({ items: [item()], total: 1 })).toBeNull();
    expect(limitNote({ items: [item()], total: '3' })).toBe(
      'The oldest 1 of 3 are shown. The rest come as you review these.',
    );
  });
});
