import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientInvitation, TeamMember } from '../../core/api/api.models';
import { invitationRows, memberRows, teamSummary } from './team.models';

const NOW = '2026-10-22T09:00:00Z';

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    userId: 'owner-1',
    displayName: 'Olivia Haddad',
    email: 'olivia@example.test',
    role: 'Owner',
    assignedClientCount: 3,
    joinedAtUtc: '2026-08-20T09:00:00Z',
    version: 1,
    ...overrides,
  };
}

const coach = (userId: string, displayName: string, overrides: Partial<TeamMember> = {}) =>
  member({
    userId,
    displayName,
    email: `${userId}@example.test`,
    role: 'Coach',
    assignedClientCount: 2,
    ...overrides,
  });

function invitation(overrides: Partial<ClientInvitation> = {}): ClientInvitation {
  return {
    id: 'invite-1',
    email: 'nora@example.test',
    firstName: 'Nora',
    lastName: 'Khoury',
    status: 'Pending',
    // 22:30 UTC is already the next day in Beirut.
    createdAtUtc: '2026-10-20T22:30:00Z',
    expiresAtUtc: '2026-10-27T22:30:00Z',
    sendCount: 1,
    logicalSendGeneration: 1,
    version: 1,
    developmentActionUrl: null,
    kind: 'Coach',
    ...overrides,
  };
}

describe('Settings › Team: the people', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => vi.useRealTimers());

  it('puts the owner first, then the coaches by name in the reader’s language', () => {
    const rows = memberRows(
      [
        coach('coach-zoe', 'Zoe Matar'),
        coach('coach-elie', 'Élie Haddad'),
        member(),
        coach('coach-cara', 'Cara Nassar'),
      ],
      null,
      'en-US',
    );

    // By code point "É" would sort after "Z"; in English it is an E.
    expect(rows.map((row) => row.member.displayName)).toEqual([
      'Olivia Haddad',
      'Cara Nassar',
      'Élie Haddad',
      'Zoe Matar',
    ]);
  });

  it('says who owns the space, who coaches in it and which row is the reader', () => {
    const team = [member(), coach('coach-cara', 'Cara Nassar')];

    const asCara = memberRows(team, 'coach-cara', 'en-US');
    expect(asCara.map((row) => [row.role, row.isOwner, row.isYou])).toEqual([
      ['Owner', true, false],
      ['Coach', false, true],
    ]);
    expect(memberRows(team, null, 'en-US').some((row) => row.isYou)).toBe(false);
  });

  it('counts each person’s clients with the right singular', () => {
    const rows = memberRows(
      [
        member({ assignedClientCount: 12 }),
        coach('coach-a', 'Adam Sabbagh', { assignedClientCount: 1 }),
        coach('coach-b', 'Bilal Saad', { assignedClientCount: 0 }),
      ],
      null,
      'en-US',
    );

    expect(rows.map((row) => row.clients)).toEqual(['12 clients', '1 client', '0 clients']);
  });

  it('gives each person their initials, from the email when the name has none', () => {
    const rows = memberRows(
      [member(), coach('zed', '   ', { email: 'zed@example.test' })],
      null,
      'en-US',
    );

    expect(rows.map((row) => row.initials)).toEqual(['OH', 'Z']);
  });

  it('says the day each joined on the workspace’s calendar, with the year only for another year', () => {
    const team = [
      member({ joinedAtUtc: '2026-10-02T22:30:00Z' }),
      coach('coach-cara', 'Cara Nassar', { joinedAtUtc: '2025-10-02T22:30:00Z' }),
    ];

    expect(memberRows(team, null, 'en-US', 'Asia/Beirut').map((row) => row.joined)).toEqual([
      'Joined Sat 3 Oct',
      'Joined 3 Oct 2025',
    ]);
    expect(memberRows(team, null, 'en-US', 'UTC').map((row) => row.joined)).toEqual([
      'Joined Fri 2 Oct',
      'Joined 2 Oct 2025',
    ]);
  });

  it('knows which year it is on the workspace’s clock too', () => {
    // 22:30 UTC on New Year's Eve is already 2027 in Beirut (UTC+2 in winter), and still 2026 in UTC.
    vi.setSystemTime(new Date('2026-12-31T22:30:00Z'));
    const team = [
      member({ joinedAtUtc: '2026-12-31T22:15:00Z' }),
      coach('coach-adam', 'Adam Sabbagh', { joinedAtUtc: '2026-12-31T21:45:00Z' }),
      coach('coach-cara', 'Cara Nassar', { joinedAtUtc: '2026-06-01T09:00:00Z' }),
    ];

    expect(memberRows(team, null, 'en-US', 'Asia/Beirut').map((row) => row.joined)).toEqual([
      'Joined Fri 1 Jan',
      'Joined 31 Dec 2026',
      'Joined 1 Jun 2026',
    ]);
    expect(memberRows(team, null, 'en-US', 'UTC').map((row) => row.joined)).toEqual([
      'Joined Thu 31 Dec',
      'Joined Thu 31 Dec',
      'Joined Mon 1 Jun',
    ]);
  });

  it('offers a coach’s row Remove from the team, and the owner’s row nothing', () => {
    const [owner, cara] = memberRows([member(), coach('coach-cara', 'Cara Nassar')], null, 'en-US');

    expect(owner.menu).toEqual([]);
    expect(cara.menu).toEqual([
      {
        label: 'Remove from the team',
        hint: 'Their clients move to you',
        action: 'remove',
        danger: true,
      },
    ]);
  });
});

describe('Settings › Team: the invitations', () => {
  const now = new Date(NOW);

  it('lists only the invitations still waiting for an answer, newest first', () => {
    const rows = invitationRows(
      [
        invitation({ id: 'older', createdAtUtc: '2026-10-19T08:00:00Z' }),
        invitation({ id: 'accepted', status: 'Accepted', createdAtUtc: '2026-10-21T08:00:00Z' }),
        invitation({ id: 'revoked', status: 'Revoked', createdAtUtc: '2026-10-21T09:00:00Z' }),
        invitation({ id: 'expired', status: 'Expired', createdAtUtc: '2026-10-21T10:00:00Z' }),
        invitation({ id: 'newer', createdAtUtc: '2026-10-21T07:00:00Z' }),
      ],
      now,
      'en-US',
    );

    expect(rows.map((row) => row.invitation.id)).toEqual(['newer', 'older']);
  });

  it('names the person without a stray space, with initials from the email when there is no name', () => {
    const rows = invitationRows(
      [
        invitation({ id: 'whole', createdAtUtc: '2026-10-21T08:00:00Z' }),
        invitation({ id: 'first', lastName: '', createdAtUtc: '2026-10-20T08:00:00Z' }),
        invitation({
          id: 'none',
          firstName: '',
          lastName: '',
          email: 'zed@example.test',
          createdAtUtc: '2026-10-19T08:00:00Z',
        }),
      ],
      now,
      'en-US',
    );

    expect(rows.map((row) => [row.name, row.initials])).toEqual([
      ['Nora Khoury', 'NK'],
      ['Nora', 'N'],
      ['', 'Z'],
    ]);
  });

  it('says when it was sent and until when the link works, on the workspace’s calendar', () => {
    const [beirut] = invitationRows([invitation()], now, 'en-US', 'Asia/Beirut');
    expect(beirut.expired).toBe(false);
    expect(beirut.detail).toBe('Sent Wed 21 Oct · the link works until Wed 28 Oct');

    const [utc] = invitationRows([invitation()], now, 'en-US', 'UTC');
    expect(utc.detail).toBe('Sent Tue 20 Oct · the link works until Tue 27 Oct');
  });

  it('calls the link run out from the very instant it expires', () => {
    const sent = '2026-10-14T09:00:00Z';
    const [atExpiry] = invitationRows(
      [invitation({ createdAtUtc: sent, expiresAtUtc: NOW })],
      now,
      'en-US',
      'Asia/Beirut',
    );
    expect(atExpiry.expired).toBe(true);
    expect(atExpiry.detail).toBe('Sent Wed 14 Oct · the link ran out Thu 22 Oct');

    const [justBefore] = invitationRows(
      [invitation({ createdAtUtc: sent, expiresAtUtc: '2026-10-22T09:00:00.001Z' })],
      now,
      'en-US',
      'Asia/Beirut',
    );
    expect(justBefore.expired).toBe(false);
    expect(justBefore.detail).toBe('Sent Wed 14 Oct · the link works until Thu 22 Oct');
  });

  it('writes a day of another year with its year', () => {
    const [row] = invitationRows(
      [invitation({ createdAtUtc: '2025-12-30T10:00:00Z', expiresAtUtc: '2026-01-06T10:00:00Z' })],
      now,
      'en-US',
      'Asia/Beirut',
    );

    expect(row.detail).toBe('Sent 30 Dec 2025 · the link ran out Tue 6 Jan');
  });

  it('offers a new link while the link works, and only cancelling once it has run out', () => {
    const [live] = invitationRows([invitation()], now, 'en-US');
    expect(live.menu).toEqual([
      {
        label: 'Send a new link',
        hint: 'The link sent before stops working',
        action: 'resend',
      },
      {
        label: 'Cancel the invitation',
        hint: 'The link stops working',
        action: 'revoke',
        danger: true,
      },
    ]);

    const [lapsed] = invitationRows(
      [invitation({ expiresAtUtc: '2026-10-21T09:00:00Z' })],
      now,
      'en-US',
    );
    expect(lapsed.menu).toEqual([
      { label: 'Cancel the invitation', action: 'revoke', danger: true },
    ]);
  });
});

describe('Settings › Team: the line under the heading', () => {
  it('says it is just the owner so far, however many clients they have', () => {
    expect(teamSummary([member({ assignedClientCount: 8 })])).toBe(
      'Just you so far. Invite a coach and give them their own clients: a coach sees only the clients you give them.',
    );
  });

  it('counts the coaches and every client between them, the owner’s own included', () => {
    expect(teamSummary([member(), coach('coach-cara', 'Cara Nassar')])).toBe(
      'You and 1 coach, 5 clients between you. Each client has one coach, and a coach sees only their own; you see every client.',
    );
    expect(
      teamSummary([
        member({ assignedClientCount: 0 }),
        coach('coach-a', 'Adam Sabbagh', { assignedClientCount: 1 }),
        coach('coach-b', 'Bilal Saad', { assignedClientCount: 0 }),
      ]),
    ).toBe(
      'You and 2 coaches, 1 client between you. Each client has one coach, and a coach sees only their own; you see every client.',
    );
  });
});
