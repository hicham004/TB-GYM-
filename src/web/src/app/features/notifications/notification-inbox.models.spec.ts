import { describe, expect, it } from 'vitest';
import { dayCount, groupByDay, noticeIcon, noticeTarget } from './notification-inbox.models';
import type { NotificationItem } from './notification.models';

function notice(
  id: string,
  createdAt: Date,
  extra: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id,
    kind: 'PaymentRequired',
    title: id,
    body: '',
    createdAtUtc: createdAt.toISOString(),
    readAtUtc: null,
    isRead: false,
    clientProfileId: null,
    sessionId: null,
    workoutExecutionId: null,
    weekNumber: null,
    ...extra,
  };
}

describe('groupByDay', () => {
  // Thursday 8 October 2026, mid-morning on the device's own calendar.
  const now = new Date(2026, 9, 8, 10, 30);

  it('heads today, yesterday, this week by weekday, then the date', () => {
    const days = groupByDay(
      [
        notice('a', new Date(2026, 9, 8, 9, 0)),
        notice('b', new Date(2026, 9, 8, 0, 5)),
        notice('c', new Date(2026, 9, 7, 23, 50)),
        notice('d', new Date(2026, 9, 5, 12, 0)),
        notice('e', new Date(2026, 8, 20, 12, 0)),
        notice('f', new Date(2025, 11, 30, 12, 0)),
      ],
      now,
      'en-GB',
    );

    expect(days.map((day) => day.heading)).toEqual([
      'Today',
      'Yesterday',
      'Monday',
      '20 September',
      '30 December 2025',
    ]);
    expect(days[0].items.map((item) => item.id)).toEqual(['a', 'b']);
    // Today and Yesterday stand open; an older day folds until the reader opens it (audit UIQ-21).
    expect(days.map((day) => day.recent)).toEqual([true, true, false, false, false]);
  });

  it('says what a folded day holds, and how many of them are unread', () => {
    const at = new Date(2026, 9, 5, 12, 0);
    const [one] = groupByDay([notice('a', at, { isRead: true })], now, 'en-GB');
    expect(dayCount(one)).toBe('1 notification');
    const [three] = groupByDay(
      [notice('a', at), notice('b', at, { isRead: true }), notice('c', at, { isRead: true })],
      now,
      'en-GB',
    );
    expect(dayCount(three)).toBe('3 notifications, 1 unread');
    const [two] = groupByDay([notice('a', at), notice('b', at)], now, 'en-GB');
    expect(dayCount(two)).toBe('2 notifications, 2 unread');
  });

  it('gives each day a stable key and keeps the order it was given', () => {
    const days = groupByDay(
      [notice('a', new Date(2026, 9, 8, 9, 0)), notice('b', new Date(2026, 9, 7, 9, 0))],
      now,
      'en-GB',
    );

    expect(days.map((day) => day.key)).toEqual(['2026-10-8', '2026-10-7']);
    expect(groupByDay([], now, 'en-GB')).toEqual([]);
  });
});

describe('noticeTarget', () => {
  const at = new Date(2026, 9, 8, 9, 0);

  it('opens a training notice in the client’s Training, at the week or workout it names', () => {
    expect(noticeTarget(notice('p', at, { kind: 'ProgramAssigned' }), false)).toEqual({
      commands: ['/training/program'],
    });
    expect(noticeTarget(notice('s', at, { kind: 'WeeksShared', weekNumber: 2 }), false)).toEqual({
      commands: ['/training/program'],
      queryParams: { week: 2 },
    });
    expect(
      noticeTarget(notice('n', at, { kind: 'CoachWorkoutNote', workoutExecutionId: 'w-1' }), false),
    ).toEqual({ commands: ['/training/program'], queryParams: { workout: 'w-1' } });
  });

  it('pins a week shortcut to its delivered program and falls back when no visible target remains', () => {
    expect(
      noticeTarget(
        notice('s', at, { kind: 'WeeksShared', weekNumber: 3, mesocycleId: 'program-a' }),
        false,
      ),
    ).toEqual({ commands: ['/training/program'], queryParams: { week: 3, program: 'program-a' } });
    expect(
      noticeTarget(
        notice('s', at, { kind: 'WeeksShared', weekNumber: null, mesocycleId: 'program-a' }),
        false,
      ),
    ).toEqual({ commands: ['/training/program'] });
  });

  it('opens a client’s note on that client’s Training, at the session', () => {
    expect(
      noticeTarget(
        notice('k', at, { kind: 'ClientWorkoutNote', clientProfileId: 'c-1', sessionId: 's-1' }),
        false,
      ),
    ).toEqual({ commands: ['/clients', 'c-1', 'training'], queryParams: { session: 's-1' } });
    // Without its client the notice has nowhere to go rather than a broken link.
    expect(noticeTarget(notice('k', at, { kind: 'ClientWorkoutNote' }), false)).toBeNull();
  });

  it('opens Former clients for the owner, and a coach’s own clients for a coach', () => {
    expect(noticeTarget(notice('l', at, { kind: 'ClientLeft' }), true)).toEqual({
      commands: ['/clients/former'],
    });
    expect(noticeTarget(notice('l', at, { kind: 'ClientLeft' }), false)).toEqual({
      commands: ['/clients'],
    });
    expect(noticeTarget(notice('r', at, { kind: 'CoachResigned' }), true)).toEqual({
      commands: ['/clients'],
    });
  });

  it('opens every plan notice, and a coach leaving, on the client’s Today (audit COACH-12)', () => {
    for (const kind of [
      'PaymentRequired',
      'EnrollmentActivated',
      'EnrollmentEndingSoon',
      'EnrollmentExpired',
      'EnrollmentRenewed',
      'CoachDeparted',
    ] as const) {
      expect(noticeTarget(notice(kind, at, { kind }), false)).toEqual({ commands: ['/'] });
    }
  });

  it('opens nothing only for a notice whose own target is missing', () => {
    expect(noticeTarget(notice('r', at, { kind: 'RenewalRequested' }), true)).toBeNull();
    expect(
      noticeTarget(notice('r', at, { kind: 'RenewalRequested', clientProfileId: 'c-1' }), true),
    ).toEqual({ commands: ['/clients', 'c-1', 'service'] });
  });
});

describe('noticeIcon', () => {
  it('pictures what a notice is about', () => {
    expect(noticeIcon('WeeksChanged')).toBe('training');
    expect(noticeIcon('ClientWorkoutNote')).toBe('messages');
    expect(noticeIcon('CoachResigned')).toBe('clients');
    expect(noticeIcon('EnrollmentEndingSoon')).toBe('products');
  });
});
