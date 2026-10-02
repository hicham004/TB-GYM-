import { describe, expect, it } from 'vitest';
import type { FormerClient } from '../../core/api/api.models';
import {
  coachClient,
  COACH_NOW,
  COACH_TODAY,
  OWNER_ID,
} from '../../../testing/coach-today-fixtures';
import { clientListView, overviewRow, recentDays } from '../../../testing/client-list-fixtures';
import {
  clientRow,
  clientWeek,
  formerClientRow,
  mapClientList,
  matches,
  type ClientListContext,
  type ClientRow,
} from './clients.models';

const context: ClientListContext = {
  locale: 'en-US',
  now: new Date(COACH_NOW),
  userId: OWNER_ID,
};

function rows(): Record<string, ClientRow> {
  const list = mapClientList(clientListView(), context);
  return Object.fromEntries(list.rows.map((row) => [row.name.split(' ')[0], row]));
}

describe('client list (C2)', () => {
  it('keeps the server order and counts each chip over the whole list', () => {
    const list = mapClientList(clientListView(), context);

    expect(list.rows.map((row) => row.name)).toEqual([
      'Elie Azar',
      'Hiba Nasser',
      'Jad Karam',
      'Karl Saade',
      'Lynn Bou Khalil',
      'Maya Fakhoury',
      'Nour Hamdan',
      'Rami Tabet',
      'Rita Daher',
      'Sara Mansour',
      'Tala Rizk',
      'Ziad Chahine',
    ]);
    expect(list.counts).toEqual({ all: 12, attention: 6, ending: 2, paused: 1, new: 2 });
  });

  it('names each server status with a tone, never colour alone', () => {
    const { Maya, Karl, Rita, Rami, Ziad } = rows();

    expect(Maya.status).toEqual({ label: 'Needs attention', tone: 'warning' });
    expect(Karl.status).toEqual({ label: 'Paused', tone: 'info' });
    expect(Rita.status).toEqual({ label: 'Ending soon', tone: 'warm' });
    expect(Rami.status).toEqual({ label: 'On track', tone: 'success' });
    expect(Ziad.status).toEqual({ label: 'No active plan', tone: 'neutral' });
  });

  /** The plan column already says when it ends, so the reasons leave that out. */
  it('says why a client needs attention, without repeating the plan end', () => {
    const { Sara, Rita, Jad, Lynn, Elie } = rows();

    expect(Sara.reasons).toBe('Unread messages');
    expect(Rita.reasons).toBe('');
    expect(Jad.reasons).toBe('Missed sessions');
    expect(Lynn.reasons).toBe('No program yet');
    expect(Elie.reasons).toBe('Asked to renew');

    const both = clientRow(
      overviewRow(coachClient('c-x', 'Ali', 'Fares'), {
        status: 'NeedsAttention',
        attention: ['CheckInToReview', 'WeekNotShared'],
      }),
      COACH_TODAY,
      context,
    );
    expect(both.reasons).toBe('Check-in to review · Week not shared');
  });

  it('phrases the last activity by what it was and how long ago', () => {
    const { Maya, Sara, Elie, Lynn, Ziad } = rows();

    expect(Maya.activity).toBe('Trained 2 hours ago');
    expect(Sara.activity).toBe('Sent a check-in 19 hours ago');
    expect(Elie.activity).toBe('Weighed in yesterday');
    expect(Lynn.activity).toBe('No activity yet');
    // A lapsed plan hides what it no longer covers, so "yet" would not be true.
    expect(Ziad.activity).toBe('No activity to show');
  });

  it('draws the last seven days and says them in words', () => {
    const { Maya, Tala, Lynn, Elie } = rows();

    expect(Maya.week?.days.map((day) => day.mark)).toEqual([
      'done',
      'rest',
      'done',
      'rest',
      'missed',
      'rest',
      'done',
    ]);
    expect(Maya.week?.value).toBe('3 of 4');
    expect(Maya.week?.summary).toBe('3 of 4 sessions done in the last 7 days');

    // Two sessions with one done is partly done; today's session is due, not missed.
    expect(Tala.week?.days.map((day) => day.mark)).toEqual([
      'done',
      'rest',
      'partial',
      'rest',
      'done',
      'rest',
      'due',
    ]);
    expect(Tala.week?.value).toBe('3 of 5');

    expect(Lynn.week?.days).toEqual([]);
    expect(Lynn.week?.value).toBe('None scheduled');
    expect(Lynn.week?.summary).toBe('Nothing scheduled in the last 7 days');
    // Training is not in Elie's plan, so there is no strip at all.
    expect(Elie.week).toBeNull();
  });

  it('never counts more done than were scheduled on a day', () => {
    const week = clientWeek(
      recentDays([
        [1, 2],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
      COACH_TODAY,
    );

    expect(week.value).toBe('1 of 1');
  });

  it('says when the plan ends, counted from the workspace date', () => {
    const { Rita, Sara, Maya, Hiba, Elie, Karl, Ziad } = rows();

    expect(Rita.plan).toEqual({ label: 'Plan ends tomorrow', soon: true });
    expect(Sara.plan).toEqual({ label: 'Plan ends in 11 days', soon: true });
    expect(Maya.plan).toEqual({ label: 'Plan ends Sun 20 Dec', soon: false });
    // Another year gets its year.
    expect(Hiba.plan).toEqual({ label: 'Plan ends 15 Jan 2027', soon: false });
    expect(Elie.plan).toEqual({ label: 'Plan ended Sun 27 Sep', soon: false });
    expect(Karl.plan.label).toBe('Plan paused');
    expect(Ziad.plan.label).toBe('Payment due');

    const today = clientRow(
      overviewRow(coachClient('c-x', 'Ali', 'Fares'), { planEndsOn: COACH_TODAY }),
      COACH_TODAY,
      context,
    );
    expect(today.plan).toEqual({ label: 'Plan ends today', soon: true });
  });

  it("names the coach only on a team member's client", () => {
    const { Maya, Rami } = rows();

    expect(Maya.coach).toBe('Lea Khoury');
    expect(Rami.coach).toBeNull();
    const signedOut = mapClientList(clientListView(), { ...context, userId: null });
    expect(signedOut.rows.every((row) => row.coach === null)).toBe(true);
  });

  it('puts a plan ending soon under Ending soon even when something else needs attention', () => {
    const { Sara, Karl, Nour } = rows();

    expect([...Sara.filters]).toEqual(['all', 'attention', 'ending']);
    expect([...Karl.filters]).toEqual(['all', 'paused']);
    expect([...Nour.filters]).toEqual(['all', 'attention', 'new']);
  });

  it('searches names and goals, ignoring case, accents and word order', () => {
    const { Maya, Nour } = rows();
    const elie = clientRow(overviewRow(coachClient('c-e', 'Élie', 'Azar')), COACH_TODAY, context);

    expect(matches(Maya, 'all', 'wedding MAYA')).toBe(true);
    expect(matches(Maya, 'all', 'maya pull-up')).toBe(false);
    expect(matches(Nour, 'all', '  glutes ')).toBe(true);
    expect(matches(elie, 'all', 'elie')).toBe(true);
    expect(matches(Maya, 'paused', '')).toBe(false);
  });

  it('describes a former client by how and when coaching ended', () => {
    const former: FormerClient = {
      id: 'client-9',
      firstName: 'Omar',
      lastName: 'Nasr',
      email: 'omar@example.test',
      releasedAtUtc: '2026-09-20T10:00:00Z',
      reason: 'Followed his coach to another gym',
      departureKind: 'LeftByClient',
    };

    expect(formerClientRow(former, 'en-US')).toEqual({
      id: 'client-9',
      name: 'Omar Nasr',
      initials: 'ON',
      link: '/clients/client-9',
      ended: 'Sun 20 Sep 2026',
      endedAt: '2026-09-20T10:00:00Z',
      how: 'Left by client',
      reason: 'Followed his coach to another gym',
    });
    expect(formerClientRow({ ...former, departureKind: 'ReleasedByOwner' }, 'en-US').how).toBe(
      'Ended by owner',
    );
  });
});
