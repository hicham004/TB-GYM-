import { describe, expect, it } from 'vitest';
import {
  chatDayLabel,
  chatTimeline,
  conversationTimeLabel,
  firstUnreadSequence,
} from './chat-timeline';
import type { Message } from './messaging.models';

// Local wall-clock times, so the day grouping under test is the same in every time zone.
const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute);
const NOW = at(9, 30, 18);

function message(sequence: number, sent: Date, overrides: Partial<Message> = {}): Message {
  return {
    id: `m-${sequence}`,
    conversationId: 'c',
    sequence,
    senderUserId: 'coach',
    isFromCaller: false,
    sentAtUtc: sent.toISOString(),
    availableAtUtc: sent.toISOString(),
    editedAtUtc: null,
    revisionNumber: 1,
    body: `Message ${sequence}`,
    isDeleted: false,
    deletionKind: null,
    deletedAtUtc: null,
    canEdit: false,
    canDelete: false,
    canModerate: false,
    isUnreadByCaller: false,
    version: 1,
    deliveryState: 'Persisted',
    ...overrides,
  };
}

describe('chatTimeline', () => {
  it('groups a thread by the reader’s day, oldest first, with friendly day names', () => {
    const days = chatTimeline(
      [
        message(1, at(9, 1, 20)),
        message(2, at(9, 29, 8)),
        message(3, at(9, 30, 7)),
        message(4, at(9, 30, 9)),
      ],
      null,
      NOW,
      'en-US',
    );

    expect(days.map((day) => day.label)).toEqual(['Tue 1 Sep', 'Yesterday', 'Today']);
    expect(days.map((day) => day.entries.map((entry) => entry.message.sequence))).toEqual([
      [1],
      [2],
      [3, 4],
    ]);
  });

  it('joins quick messages from one side into a run and breaks it on a reply or a pause', () => {
    const [today] = chatTimeline(
      [
        message(1, at(9, 30, 9, 0)),
        message(2, at(9, 30, 9, 2)),
        message(3, at(9, 30, 9, 3), { isFromCaller: true }),
        message(4, at(9, 30, 9, 20), { isFromCaller: true }),
      ],
      null,
      NOW,
      'en-US',
    );

    expect(today.entries.map(({ startsRun, endsRun }) => [startsRun, endsRun])).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [true, true],
    ]);
  });

  it('puts the new-messages divider before the first unread message, once, and breaks the run there', () => {
    const [today] = chatTimeline(
      [message(1, at(9, 30, 9, 0)), message(2, at(9, 30, 9, 1)), message(3, at(9, 30, 9, 2))],
      2,
      NOW,
      'en-US',
    );

    expect(today.entries.map((entry) => entry.firstUnread)).toEqual([false, true, false]);
    expect(today.entries[0].endsRun).toBe(true);
    expect(today.entries[1].startsRun).toBe(true);
    expect(today.entries[2].startsRun).toBe(false);
  });

  it('is empty for an empty thread', () => {
    expect(chatTimeline([], null, NOW, 'en-US')).toEqual([]);
  });
});

describe('firstUnreadSequence', () => {
  it('finds the first unread message from the other person and ignores the reader’s own', () => {
    expect(
      firstUnreadSequence([
        message(1, at(9, 30, 8)),
        message(2, at(9, 30, 8, 1), { isFromCaller: true, isUnreadByCaller: true }),
        message(3, at(9, 30, 8, 2), { isUnreadByCaller: true }),
      ]),
    ).toBe(3);
    expect(firstUnreadSequence([message(1, at(9, 30, 8))])).toBeNull();
  });
});

describe('day and list labels', () => {
  it('names the day, and adds the year only when it is not this one', () => {
    expect(chatDayLabel(at(9, 30, 1), NOW, 'en-US')).toBe('Today');
    expect(chatDayLabel(at(9, 29, 23), NOW, 'en-US')).toBe('Yesterday');
    expect(chatDayLabel(at(9, 28, 12), NOW, 'en-US')).toBe('Mon 28 Sep');
    expect(chatDayLabel(new Date(2025, 11, 31, 12), NOW, 'en-US')).toBe('Wed 31 Dec 2025');
  });

  it('shows a time today, then Yesterday, a weekday this week and a date after that', () => {
    const label = (date: Date) => conversationTimeLabel(date.toISOString(), NOW, 'en-US');
    // Angular's en-US time puts a narrow no-break space before AM and PM.
    expect(label(at(9, 30, 9, 5))).toBe('9:05 AM');
    expect(label(at(9, 29, 22))).toBe('Yesterday');
    expect(label(at(9, 25, 12))).toBe('Fri');
    expect(label(at(9, 1, 12))).toBe('1 Sep');
    expect(label(new Date(2025, 5, 3, 12))).toBe('3 Jun 2025');
    // A server instant a little ahead of this device's clock is still today.
    expect(label(at(9, 30, 18, 1))).toBe('6:01 PM');
  });
});
