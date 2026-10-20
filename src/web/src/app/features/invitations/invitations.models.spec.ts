import { describe, expect, it } from 'vitest';
import { atlasInvitations, invitation, TODAY } from '../../../testing/invitation-fixtures';
import { adultCutoff } from '../../ui/calendar';
import {
  inviteErrors,
  invitationLine,
  invitationRow,
  sentText,
  splitInvitations,
  statusLabel,
  statusTone,
  type InviteEntry,
} from './invitations.models';

const LOCALE = 'en-US';

describe('invitation words', () => {
  it('names each state for a coach', () => {
    expect(statusLabel('Pending')).toBe('Waiting to join');
    expect(statusLabel('Accepted')).toBe('Joined');
    expect(statusLabel('Expired')).toBe('Link ran out');
    expect(statusLabel('Revoked')).toBe('Cancelled');
    expect(statusTone('Pending')).toBe('warning');
    expect(statusTone('Accepted')).toBe('success');
    expect(statusTone('Expired')).toBe('neutral');
  });

  it('counts the sends the way a person says them', () => {
    expect(sentText(0)).toBe('Sent once');
    expect(sentText(1)).toBe('Sent once');
    expect(sentText(2)).toBe('Sent twice');
    expect(sentText(5)).toBe('Sent 5 times');
  });

  it('says what is true of each invitation now, on the workspace clock in the house style', () => {
    const now = new Date('2026-10-09T09:00:00Z');
    const line = (overrides: Parameters<typeof invitation>[0]) =>
      invitationLine(invitation(overrides), LOCALE, 'Asia/Beirut', now);

    expect(line({ sendCount: 1 })).toBe('Sent once · the newest link works until Wed 14 Oct');
    // 23:30 UTC is already the next day in Beirut, which is the day the coach and client live (COACH-6).
    expect(line({ sendCount: 3, expiresAtUtc: '2026-10-20T23:30:00Z' })).toBe(
      'Sent 3 times · the newest link works until Wed 21 Oct',
    );
    expect(line({ status: 'Accepted' })).toBe('Set up their account and joined');
    expect(line({ status: 'Expired', expiresAtUtc: '2026-10-01T09:00:00Z' })).toBe(
      'The link ran out on Thu 1 Oct',
    );
    expect(line({ status: 'Revoked' })).toBe('The link was cancelled');
    // Another year says its year instead of a weekday.
    expect(line({ status: 'Expired', expiresAtUtc: '2025-11-03T09:00:00Z' })).toBe(
      'The link ran out on 3 Nov 2025',
    );
  });
});

describe('invitation rows', () => {
  it('offers the actions each state allows', () => {
    const row = (overrides: Parameters<typeof invitation>[0]) =>
      invitationRow(invitation(overrides), LOCALE);

    const pending = row({ developmentActionUrl: 'http://localhost/invite?x=1' });
    expect([pending.canSendAgain, pending.canCancel, pending.canInviteAgain]).toEqual([
      true,
      true,
      false,
    ]);
    expect(pending.developmentLink).toBe('http://localhost/invite?x=1');

    const joined = row({ status: 'Accepted', developmentActionUrl: 'http://localhost/x' });
    expect([joined.canSendAgain, joined.canCancel, joined.canInviteAgain]).toEqual([
      false,
      false,
      false,
    ]);
    expect(joined.developmentLink).toBeNull();

    for (const status of ['Expired', 'Revoked'] as const) {
      const closed = row({ status });
      expect([closed.canSendAgain, closed.canCancel, closed.canInviteAgain]).toEqual([
        false,
        false,
        true,
      ]);
    }
  });

  it('gives a face from the name, or the email when there is no name', () => {
    expect(invitationRow(invitation(), LOCALE).initials).toBe('RH');
    expect(
      invitationRow(invitation({ firstName: '', lastName: '', email: 'zed@example.test' }), LOCALE)
        .initials,
    ).toBe('Z');
  });

  it('puts who is still to join first, newest first, and the rest behind them', () => {
    const { waiting, earlier } = splitInvitations(atlasInvitations(), LOCALE);

    expect(waiting.map((row) => row.name)).toEqual(['Rana Haddad', 'Karl Bou Saab']);
    expect(earlier.map((row) => row.name)).toEqual([
      'Lynn Bou Khalil',
      'Maya Fakhoury',
      'Ali Nasr',
    ]);
  });
});

describe('the invite form', () => {
  const entry: InviteEntry = {
    firstName: 'Rana',
    lastName: 'Haddad',
    email: 'rana@example.test',
    phoneNumber: '',
    birthDate: '',
    birthStatus: 'empty',
  };
  const check = (change: Partial<InviteEntry>) => inviteErrors({ ...entry, ...change }, TODAY);

  it('needs only a name and an email', () => {
    expect(check({})).toEqual({});
    expect(
      check({ phoneNumber: '+96170123456', birthDate: '1990-03-27', birthStatus: 'valid' }),
    ).toEqual({});
  });

  it('asks for what is missing in words', () => {
    expect(check({ firstName: ' ' })['firstName']).toEqual(['Type their first name.']);
    expect(check({ lastName: '' })['lastName']).toEqual(['Type their last name.']);
    expect(check({ email: '' })['email']).toEqual(['Type their email address.']);
    expect(check({ email: 'rana@' })['email']).toEqual([
      'Type an email address like name@example.com.',
    ]);
    expect(check({ firstName: 'x'.repeat(101) })['firstName']).toEqual([
      'Keep it to 100 characters.',
    ]);
    expect(check({ phoneNumber: '7'.repeat(31) })['phoneNumber']).toEqual([
      'Keep it to 30 characters.',
    ]);
  });

  it('holds the birth date to an adult, and says when it is half typed or impossible', () => {
    expect(adultCutoff(TODAY)).toBe('2008-10-09');
    const born = (birthDate: string) => check({ birthDate, birthStatus: 'valid' })['birthDate'];

    expect(born('2008-10-09')).toBeUndefined();
    expect(born('2008-10-10')).toEqual(['Clients have to be 18 or older.']);
    expect(born('1906-10-09')).toBeUndefined();
    expect(born('1906-10-08')).toEqual(['Check the year: that is more than 120 years ago.']);
    expect(check({ birthStatus: 'incomplete' })['birthDate']).toEqual([
      'Type the day, month and year, or leave all three empty.',
    ]);
    expect(check({ birthStatus: 'invalid' })['birthDate']).toEqual([
      'That day does not exist. Check the day and the month.',
    ]);
  });
});
