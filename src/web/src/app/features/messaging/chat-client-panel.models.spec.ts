import { describe, expect, it } from 'vitest';
import { profileOverview } from '../../../testing/client-profile-fixtures';
import { COACH_NOW, COACH_TODAY, MAYA } from '../../../testing/coach-today-fixtures';
import { clientPanel } from './chat-client-panel.models';

const context = { locale: 'en-US', now: new Date(COACH_NOW) };

describe('clientPanel', () => {
  it('says how the client stands, their plan and their last workout in coach words', () => {
    const panel = clientPanel(profileOverview(), context);

    expect(panel).toMatchObject({
      id: 'c-maya',
      name: 'Maya Fakhoury',
      firstName: 'Maya',
      initials: 'MF',
      link: '/clients/c-maya',
      status: { label: 'On track', tone: 'success' },
      activity: 'Trained 2 hours ago',
      plan: { name: 'Online coaching', label: 'Plan ends Sun 20 Dec', soon: false },
      trainingClosed: null,
      week: '2 of 5 sessions done this week',
    });
    expect(panel.lastWorkout).toEqual({
      title: 'Lower A',
      detail: '52 min · 2 hours ago',
      at: '2026-10-01T10:00:00Z',
      records: ['Back squat 85 kg × 5'],
      moreRecords: 0,
      link: '/clients/c-maya/training',
    });
  });

  it('flags a plan in its last two weeks', () => {
    const panel = clientPanel(profileOverview({ planEndsOn: '2026-10-10' }), context);

    expect(panel.plan).toEqual({
      name: 'Online coaching',
      label: 'Plan ends in 9 days',
      soon: true,
    });
  });

  it('says why there is no training when the plan does not let the coach read it', () => {
    const ended = clientPanel(
      profileOverview({
        planState: 'Ended',
        planEndsOn: '2026-09-29',
        week: null,
        lastWorkout: null,
        status: 'NoActivePlan',
      }),
      context,
    );
    expect(ended.trainingClosed).toBe('Maya’s plan has ended, so their training isn’t shown.');
    expect(ended.week).toBeNull();
    expect(ended.lastWorkout).toBeNull();
    expect(ended.plan).toEqual({
      name: 'Online coaching',
      label: 'Plan ended Tue 29 Sep',
      soon: false,
    });

    const none = clientPanel(
      profileOverview({ planState: 'None', planEndsOn: null, planName: null, week: null }),
      context,
    );
    expect(none.plan).toEqual({ name: null, label: 'No plan yet', soon: false });
  });

  it('counts a week with nothing scheduled as no sessions, not "0 of 0"', () => {
    const week = { ...profileOverview().week!, scheduled: 0, completed: 0 };

    expect(clientPanel(profileOverview({ week }), context).week).toBe('No sessions this week');
  });

  it('lists what waits for the coach except the messages, which are on screen already', () => {
    const panel = clientPanel(
      profileOverview({
        attention: [
          {
            kind: 'UnreadMessages',
            client: MAYA,
            since: '2026-10-01T09:00:00Z',
            date: null,
            count: 2,
            weekNumber: null,
            subjectId: 'conversation-1',
          },
          {
            kind: 'CheckInToReview',
            client: MAYA,
            since: '2026-10-01T08:00:00Z',
            date: null,
            count: 1,
            weekNumber: null,
            subjectId: 'assignment-1',
          },
        ],
      }),
      context,
    );

    expect(panel.needs.map((need) => need.kind)).toEqual(['CheckInToReview']);
    expect(panel.needs[0].heading).toBe('Check-in ready to review');
    expect(COACH_TODAY).toBe('2026-10-01');
  });
});
