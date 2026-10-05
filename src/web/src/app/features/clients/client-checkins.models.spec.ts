import { describe, expect, it } from 'vitest';
import {
  comparisonOf,
  CURRENT_ID,
  earlierDetail,
  EARLIER_ID,
  listItemOf,
  OLDEST_ID,
  QUESTIONS,
  reviewDashboard,
  reviewDetail,
  reviewList,
} from '../../../testing/checkin-review-fixtures';
import { LEA_ID } from '../../../testing/coach-today-fixtures';
import { mapProgressDashboard } from '../progress/progress-dashboard.models';
import {
  changedCount,
  checkInFacts,
  checkInListGroups,
  checkInsClosed,
  earlierCheckIns,
  localDate,
  primaryReplyAction,
  replyIssues,
  reviewPhotoAssetIds,
  reviewPhotos,
  reviewRows,
  reviewWeight,
  reviewWindow,
  sameAnswer,
  type CheckInContext,
} from './client-checkins.models';

const CONTEXT: CheckInContext = {
  today: '2026-10-01',
  locale: 'en-US',
  timeZone: 'Asia/Beirut',
  userId: LEA_ID,
};

describe('the check-in list on a client’s record', () => {
  it('puts what needs review first, then what is not sent, then what was reviewed', () => {
    const groups = checkInListGroups(reviewList().items, CONTEXT);

    expect(groups.toReview.map((row) => row.id)).toEqual([CURRENT_ID]);
    expect(groups.open.map((row) => row.id)).toEqual(['assignment-7-oct']);
    expect(groups.reviewed.map((row) => row.id)).toEqual([EARLIER_ID, OLDEST_ID]);
  });

  it('says when each was sent, how late, and when it was reviewed, in words', () => {
    const groups = checkInListGroups(reviewList().items, CONTEXT);

    // The group's heading already says the state, so these rows carry no pill of their own.
    expect(groups.toReview[0]).toMatchObject({
      line: 'Sent Thu 1 Oct · 1 day late',
      pill: null,
      canOpen: true,
    });
    expect(groups.reviewed[0]).toMatchObject({
      line: 'Sent Wed 23 Sep · reviewed Thu 24 Sep',
      pill: null,
    });
    expect(groups.open[0]).toMatchObject({ line: 'Due Wed 7 Oct', pill: null, canOpen: false });
  });

  it('marks one past its due date as overdue and a started one as started, neither openable', () => {
    const overdue = listItemOf(reviewDetail({ id: 'late', status: null, dueDate: '2026-09-28' }));
    const started = listItemOf(
      reviewDetail({ id: 'draft', status: 'Draft', dueDate: '2026-10-07' }),
    );
    const { open } = checkInListGroups([overdue, started], CONTEXT);

    expect(open[0]).toMatchObject({
      line: 'Was due Mon 28 Sep',
      pill: { label: 'Overdue', tone: 'warm' },
      canOpen: false,
    });
    expect(open[1]).toMatchObject({ pill: { label: 'Started' }, canOpen: false });
  });

  it('says why check-ins are closed in coach words, never as an empty list', () => {
    expect(checkInsClosed('NoEntitlement', 'Karl')).toBe('Check-ins aren’t part of Karl’s plan.');
    expect(checkInsClosed('Expired', 'Elie')).toBe(
      'Elie’s plan has ended, so their check-ins aren’t shown.',
    );
    expect(checkInsClosed('RelationshipBlocked', 'Jad')).toContain('You have blocked Jad');
  });
});

describe('the facts at the top of a review', () => {
  it('gives the day it was sent, its due day and the days it was late', () => {
    expect(checkInFacts(reviewDetail(), CONTEXT, 'Maya')).toEqual({
      headline: 'Sent Thu 1 Oct',
      detail: 'Due Wed 30 Sep',
      late: '1 day late',
      reviewed: null,
      pill: { label: 'Needs review', tone: 'warning' },
    });
  });

  it('says who reviewed it, and "by you" only for the signed-in coach', () => {
    const mine = checkInFacts(earlierDetail(), CONTEXT, 'Maya');
    const theirs = checkInFacts(earlierDetail(), { ...CONTEXT, userId: 'someone-else' }, 'Maya');

    expect(mine.reviewed).toBe('Reviewed Thu 24 Sep by you');
    expect(mine.late).toBeNull();
    expect(mine.pill).toEqual({ label: 'Reviewed', tone: 'success' });
    expect(theirs.reviewed).toBe('Reviewed Thu 24 Sep');
  });

  it('keeps an unsent check-in’s answers out of it and says so (CHK-013)', () => {
    const draft = checkInFacts(reviewDetail({ status: 'Draft' }), CONTEXT, 'Maya');
    const none = checkInFacts(
      reviewDetail({ status: null, dueDate: '2026-10-07' }),
      CONTEXT,
      'Maya',
    );

    expect(draft.headline).toBe('Not sent yet');
    expect(draft.detail).toBe(
      'Was due Wed 30 Sep. Maya has started it. You’ll see the answers once it is sent.',
    );
    expect(draft.pill.label).toBe('Overdue');
    expect(none.detail).toBe('Due Wed 7 Oct. You’ll see the answers once Maya sends it.');
    expect(none.pill.label).toBe('Not sent yet');
  });

  it('reads an instant on the workspace’s own calendar', () => {
    expect(localDate('2026-09-30T22:30:00Z', 'Asia/Beirut')).toBe('2026-10-01');
    expect(localDate('2026-09-30T22:30:00Z', 'Not/AZone')).toBe('2026-09-30');
  });
});

describe('the earlier check-ins a review can be read beside', () => {
  it('takes only the same form, sent before this one, newest first', () => {
    const otherForm = listItemOf(earlierDetail({ id: 'other-form' }));
    otherForm.assignment = { ...otherForm.assignment, formId: 'form-monthly' };
    const items = [...reviewList().items, otherForm];

    expect(earlierCheckIns(items, reviewDetail()).map((item) => item.assignment.id)).toEqual([
      EARLIER_ID,
      OLDEST_ID,
    ]);
    expect(earlierCheckIns(items, earlierDetail()).map((item) => item.assignment.id)).toEqual([
      OLDEST_ID,
    ]);
  });

  it('has nothing to compare with until this one is sent', () => {
    expect(earlierCheckIns(reviewList().items, reviewDetail({ status: 'Draft' }))).toEqual([]);
    expect(earlierCheckIns(reviewList().items, reviewDetail({ status: null }))).toEqual([]);
  });
});

describe('answers side by side', () => {
  const current = reviewDetail();
  const earlier = earlierDetail();

  it('keeps this check-in’s order and marks only the answers that differ', () => {
    const rows = reviewRows(current, comparisonOf(current, earlier), QUESTIONS);

    expect(rows.map((row) => [row.key, row.changed])).toEqual([
      ['energy', true],
      ['sleep', false],
      ['stress', true],
      ['adherence', true],
      ['win', true],
      ['notes', true],
    ]);
    expect(changedCount(rows)).toBe(5);
  });

  it('writes each answer the way the client saw the question, and a blank as blank', () => {
    const rows = reviewRows(current, comparisonOf(current, earlier), QUESTIONS);
    const energy = rows[0];
    const notes = rows[5];

    expect(energy.current).toEqual({
      text: '8 out of 10',
      blank: false,
      scale: { value: '8', maximum: '10', position: 7 / 9 },
    });
    expect(energy.earlier?.text).toBe('6 out of 10');
    expect(energy.helpText).toBe('1 is exhausted, 10 is unstoppable.');
    expect(rows[3].current?.text).toBe('Most of it');
    expect(notes.earlier).toEqual({ text: '', blank: true, scale: null });
    expect(notes.long).toBe(true);
  });

  it('never says which way an answer moved or by how much (CHK-012)', () => {
    const rows = reviewRows(current, comparisonOf(current, earlier), QUESTIONS);
    const words = JSON.stringify(rows);

    for (const judgement of ['better', 'worse', 'improv', '↑', '↓', '+2', '-3']) {
      expect(words).not.toContain(judgement);
    }
  });

  it('shows a re-worded question with both wordings, and a new or dropped one as such', () => {
    const reworded = QUESTIONS.map((item) =>
      item.questionKey === 'sleep'
        ? { ...item, prompt: 'How many good nights did you have?' }
        : item,
    );
    const withNew = [
      ...reworded.filter((item) => item.questionKey !== 'notes'),
      { ...QUESTIONS[4], id: 'q-water', questionKey: 'water', order: 7, prompt: 'Water each day?' },
    ];
    const asked = reviewDetail({ questions: withNew, versionId: 'version-weekly-2' });
    const rows = reviewRows(asked, comparisonOf(asked, earlier), QUESTIONS);

    expect(rows.find((row) => row.key === 'sleep')).toMatchObject({
      prompt: 'How many good nights did you have?',
      earlierPrompt: 'How well did you sleep?',
      presence: 'both',
    });
    expect(rows.find((row) => row.key === 'water')).toMatchObject({
      presence: 'new',
      earlier: null,
      changed: false,
    });
    expect(rows.at(-1)).toMatchObject({
      key: 'notes',
      presence: 'dropped',
      current: null,
      prompt: 'Anything else I should know?',
      changed: false,
    });
  });

  it('stands alone when there is no earlier check-in', () => {
    const rows = reviewRows(current, null, null);

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.presence === 'only' && row.earlier === null)).toBe(true);
    expect(rows[1].current?.text).toBe('6 out of 10');
  });

  it('writes an earlier scale without its end when that version is not known', () => {
    const rows = reviewRows(current, comparisonOf(current, earlier), null);

    expect(rows[0].earlier?.text).toBe('6');
    expect(rows[0].earlier?.scale?.position).toBeNull();
  });

  it('treats case, spacing and choice order as the same answer', () => {
    const text = (value: string) => ({
      questionId: 'q',
      questionKey: 'k',
      questionType: 'LongText' as const,
      textValue: value,
      numericValue: null,
      choices: [],
    });
    const choices = (...labels: string[]) => ({
      ...text(''),
      questionType: 'MultipleChoice' as const,
      textValue: null,
      choices: labels.map((label, index) => ({ questionOptionId: label, order: index, label })),
    });

    expect(sameAnswer(text('All good '), text('all  good'))).toBe(true);
    expect(sameAnswer(text(''), null)).toBe(true);
    expect(sameAnswer(choices('Walks', 'Swims'), choices('Swims', 'Walks'))).toBe(true);
    expect(sameAnswer(choices('Walks'), choices('Swims'))).toBe(false);
  });
});

describe('weight and photos up to the day it was sent', () => {
  it('reads the 12 weeks up to and including the day it was sent', () => {
    expect(reviewWindow('2026-10-01')).toEqual({ from: '2026-07-10', toExclusive: '2026-10-02' });
  });

  it('gives the latest weekly average with the change on the week before', () => {
    const weight = reviewWeight(mapProgressDashboard(reviewDashboard()), CONTEXT);

    expect(weight).toMatchObject({
      value: '71.4',
      unit: 'kg',
      context: '↓ 0.4 kg on the week before',
      lastWeighed: 'Last weighed Thu 1 Oct',
      values: [72.6, 72.2, 71.8, 71.4],
    });
    expect(reviewWeight(mapProgressDashboard(reviewDashboard({ weighIns: false })), CONTEXT)).toBe(
      null,
    );
  });

  it('pairs each pose’s newest photo with the newest one up to the earlier check-in', () => {
    const dashboard = mapProgressDashboard(reviewDashboard());
    const poses = reviewPhotos(dashboard, '2026-09-23');

    expect(
      poses.map((pose) => [pose.pose, pose.latest.photoDate, pose.earlier?.photoDate]),
    ).toEqual([
      ['Front', '2026-10-01', '2026-09-23'],
      ['Side', '2026-10-01', undefined],
    ]);
    expect(reviewPhotoAssetIds(poses)).toEqual([
      'asset-front-1-oct',
      'asset-front-23-sep',
      'asset-side-1-oct',
    ]);
  });

  it('falls back to the oldest photo in the window without an earlier check-in', () => {
    const poses = reviewPhotos(mapProgressDashboard(reviewDashboard()), null);

    expect(poses[0].earlier?.photoDate).toBe('2026-09-02');
    expect(reviewPhotos(mapProgressDashboard(reviewDashboard({ photos: false })), null)).toEqual(
      [],
    );
  });
});

describe('the reply', () => {
  it('marks reviewed, sends and marks reviewed, or only sends once reviewed', () => {
    expect(primaryReplyAction('waiting', false, true)).toBe('review');
    expect(primaryReplyAction('waiting', true, true)).toBe('send-and-review');
    expect(primaryReplyAction('waiting', true, false)).toBe('review');
    expect(primaryReplyAction('reviewed', false, true)).toBe('send');
    expect(primaryReplyAction('reviewed', true, false)).toBeNull();
    expect(primaryReplyAction('draft', true, true)).toBeNull();
  });

  it('asks for words first and keeps to the message limit', () => {
    expect(replyIssues('   ')).toEqual(['Write your reply first.']);
    expect(replyIssues('Great week!')).toEqual([]);
    expect(replyIssues('x'.repeat(2001))).toEqual(['A reply can be at most 2000 characters.']);
  });
});
