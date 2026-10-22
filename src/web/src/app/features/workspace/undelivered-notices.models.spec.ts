import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CommercialNotificationKind,
  NotificationDeadLetterView,
} from '../../core/api/generated';
import {
  noticeAbout,
  noticeAudience,
  toUndeliveredNoticePage,
  type UndeliveredNotice,
  undeliveredNoticeRow,
  undeliveredReason,
  undeliveredSummary,
} from './undelivered-notices.models';

function view(overrides: Partial<NotificationDeadLetterView> = {}): NotificationDeadLetterView {
  return {
    outboxItemId: 'outbox-1',
    channelDeliveryId: '01a16213-e736-7ba5-be56-a3b8b5ef1d3e',
    channel: 'Email',
    kind: 'PaymentRequired',
    scheduledAtUtc: '2026-10-12T06:00:00Z',
    attemptCount: '6',
    deadLetteredAtUtc: '2026-10-12T12:12:00Z',
    failureCode: 'notification-attempts-exhausted',
    ...overrides,
  };
}

function notice(overrides: Partial<UndeliveredNotice> = {}): UndeliveredNotice {
  return { ...toUndeliveredNoticePage({ total: 1, items: [view()] }).items[0], ...overrides };
}

describe('Undelivered notices, as the owner reads them (audit INV-4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T09:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('keeps the reference, the kind, the channel, the times and the count the server sends', () => {
    expect(toUndeliveredNoticePage({ total: '3', items: [view()] })).toEqual({
      total: 3,
      items: [
        {
          id: '01a16213-e736-7ba5-be56-a3b8b5ef1d3e',
          kind: 'PaymentRequired',
          channel: 'Email',
          scheduledAtUtc: '2026-10-12T06:00:00Z',
          attemptCount: 6,
          deadLetteredAtUtc: '2026-10-12T12:12:00Z',
          failureCode: 'notification-attempts-exhausted',
        },
      ],
    });
  });

  it('writes a notice as what it was about, how it went, for whom, why it stopped and when', () => {
    expect(undeliveredNoticeRow(notice(), 'en-US', 'Asia/Beirut')).toEqual({
      id: '01a16213-e736-7ba5-be56-a3b8b5ef1d3e',
      about: 'A plan waiting for payment',
      channel: 'Email',
      reason: 'Tried 6 times without getting through.',
      facts: 'For a client · Due Mon 12 Oct, 9:00 AM · Given up Mon 12 Oct, 3:12 PM',
    });
  });

  it('reads both times on the workspace’s clock, never the device’s or UTC’s day', () => {
    // 22:30 UTC on Sunday is already 01:30 on Monday in Beirut.
    const row = undeliveredNoticeRow(
      notice({
        channel: 'InApp',
        scheduledAtUtc: '2026-10-11T22:30:00Z',
        deadLetteredAtUtc: '2026-10-11T23:05:00Z',
      }),
      'en-US',
      'Asia/Beirut',
    );
    expect([row.channel, row.facts]).toEqual([
      'In the app',
      'For a client · Due Mon 12 Oct, 1:30 AM · Given up Mon 12 Oct, 2:05 AM',
    ]);
    // Another year says its year.
    expect(
      undeliveredNoticeRow(
        notice({ scheduledAtUtc: '2025-12-30T10:00:00Z' }),
        'en-US',
        'Asia/Beirut',
      ).facts,
    ).toBe('For a client · Due 30 Dec 2025, 12:00 PM · Given up Mon 12 Oct, 3:12 PM');
  });

  it('leaves out when it was given up if the server has no instant for it', () => {
    expect(
      undeliveredNoticeRow(notice({ deadLetteredAtUtc: null }), 'en-US', 'Asia/Beirut').facts,
    ).toBe('For a client · Due Mon 12 Oct, 9:00 AM');
  });

  it('names every kind of notice from the owner’s side, and who such a notice goes to', () => {
    const kinds: CommercialNotificationKind[] = [
      'PaymentRequired',
      'EnrollmentActivated',
      'EnrollmentEndingSoon',
      'EnrollmentExpired',
      'EnrollmentRenewed',
      'CoachDeparted',
      'ClientLeft',
      'CoachResigned',
      'RenewalRequested',
      'ProgramAssigned',
      'WeeksShared',
      'WeeksChanged',
      'CoachWorkoutNote',
      'ClientWorkoutNote',
    ];
    expect(kinds.map((kind) => [noticeAbout(kind), noticeAudience(kind)])).toEqual([
      ['A plan waiting for payment', 'For a client'],
      ['A plan that started', 'For a client'],
      ['A plan ending soon', 'For a client'],
      ['A plan that ended', 'For a client'],
      ['A plan renewed', 'For a client'],
      ['A change of coach', 'For a client'],
      ['A client who left', 'For you or a coach'],
      ['A coach who left your team', 'For you'],
      ['A client asking to renew', 'For you or a coach'],
      ['A new program', 'For a client'],
      ['Program weeks shared', 'For a client'],
      ['Program weeks updated', 'For a client'],
      ['A coach’s note on a workout', 'For a client'],
      ['A client’s note on a workout', 'For you or a coach'],
    ]);
    // A kind this build does not know yet still reads as a notice, for nobody it can name.
    expect(noticeAbout('SomethingNew' as CommercialNotificationKind)).toBe('A notice');
    expect(noticeAudience('SomethingNew' as CommercialNotificationKind)).toBeNull();
    expect(
      undeliveredNoticeRow(
        notice({ kind: 'SomethingNew' as CommercialNotificationKind }),
        'en-US',
        'Asia/Beirut',
      ).facts,
    ).toBe('Due Mon 12 Oct, 9:00 AM · Given up Mon 12 Oct, 3:12 PM');
  });

  it('says why TB Gym stopped in a person’s words, never its code', () => {
    expect(
      [
        ['notification-attempts-exhausted', 6],
        ['notification-attempts-exhausted', 1],
        ['notification-email-provider-rejected', 1],
        ['notification-email-transport-permanent', 1],
        ['notification-email-provider-idempotency-conflict', 1],
        ['notification-email-provider-response-invalid', 1],
        ['notification-payload-invalid', 1],
        ['notification-template-missing', 1],
        ['notification-aggregate-mismatch', 1],
        ['something-new', 1],
        [null, 1],
      ].map(([code, attempts]) => undeliveredReason(code as string | null, attempts as number)),
    ).toEqual([
      'Tried 6 times without getting through.',
      'Tried once without getting through.',
      'The email service refused it.',
      'The email service refused it.',
      'The email service refused it.',
      'The email service answered in a way TB Gym couldn’t use.',
      'TB Gym couldn’t put this notice together.',
      'TB Gym couldn’t put this notice together.',
      'TB Gym couldn’t put this notice together.',
      'TB Gym couldn’t deliver it.',
      'TB Gym couldn’t deliver it.',
    ]);
  });

  it('counts the notices in the line over the list', () => {
    expect(undeliveredSummary(1)).toBe('1 notice TB Gym gave up on, newest first.');
    expect(undeliveredSummary(27)).toBe('27 notices TB Gym gave up on, newest first.');
  });
});
