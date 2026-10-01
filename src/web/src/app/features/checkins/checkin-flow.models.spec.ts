import { describe, expect, it } from 'vitest';
import type { CheckInAssignmentListItem, CheckInQuestionView } from '../../core/api/generated';
import {
  answerText,
  answeredCount,
  dayBefore,
  flowSteps,
  homeLists,
  resumeStep,
  scalePositions,
  stepIssues,
  stepOfQuestion,
  stepScale,
} from './checkin-flow.models';
import type { AnswerDraft, ResponseDraft } from './checkin-response.models';

const base: CheckInQuestionView = {
  id: 'q-text',
  questionKey: 'a'.repeat(32),
  order: 1,
  questionType: 'LongText',
  prompt: 'Anything else?',
  helpText: null,
  isRequired: false,
  scaleMinimum: null,
  scaleMaximum: null,
  scaleStep: null,
  options: [],
};
const scale: CheckInQuestionView = {
  ...base,
  id: 'q-scale',
  questionKey: 'b'.repeat(32),
  questionType: 'NumericScale',
  prompt: 'Energy',
  isRequired: true,
  scaleMinimum: 1,
  scaleMaximum: 10,
  scaleStep: 1,
};
const choice: CheckInQuestionView = {
  ...base,
  id: 'q-choice',
  questionKey: 'c'.repeat(32),
  questionType: 'MultipleChoice',
  prompt: 'What did you do?',
  isRequired: true,
  options: [
    { id: 'o1', order: 1, label: 'Walked' },
    { id: 'o2', order: 2, label: 'Swam' },
  ],
};

function answer(question: CheckInQuestionView, change: Partial<AnswerDraft> = {}): AnswerDraft {
  return {
    questionId: question.id,
    questionKey: question.questionKey,
    questionType: question.questionType,
    textValue: '',
    numericValue: null,
    selectedOptionIds: [],
    ...change,
  };
}

function draft(...answers: AnswerDraft[]): ResponseDraft {
  return { assignmentId: 'a', status: 'Draft', version: null, answers };
}

describe('check-in flow steps', () => {
  it('asks each question, then the optional photos, then the review', () => {
    expect(flowSteps([scale, base], true).map((step) => step.kind)).toEqual([
      'question',
      'question',
      'photos',
      'review',
    ]);
    expect(flowSteps([scale], false).map((step) => step.kind)).toEqual(['question', 'review']);
    const first = flowSteps([scale, base], false)[1];
    expect(first.kind === 'question' && first.number).toBe(2);
  });

  it('resumes at the first unanswered question, or the review when all are answered', () => {
    const steps = flowSteps([scale, choice, base], true);
    expect(resumeStep(steps, draft(answer(scale), answer(choice), answer(base)))).toBe(0);
    expect(
      resumeStep(steps, draft(answer(scale, { numericValue: 7 }), answer(choice), answer(base))),
    ).toBe(1);
    const allAnswered = draft(
      answer(scale, { numericValue: 7 }),
      answer(choice, { selectedOptionIds: ['o1'] }),
      answer(base, { textValue: 'Fine' }),
    );
    expect(resumeStep(steps, allAnswered)).toBe(steps.length - 1);
  });

  it('finds the step that asks a question, so a refusal can open it', () => {
    const steps = flowSteps([scale, choice], true);
    expect(stepOfQuestion(steps, choice.questionKey)).toBe(1);
    expect(stepOfQuestion(steps, 'missing')).toBe(-1);
  });

  it('holds a required question until it is answered, and lets an optional one through', () => {
    expect(stepIssues(scale, draft(answer(scale)))).toEqual(['This question has to be answered.']);
    expect(stepIssues(scale, draft(answer(scale, { numericValue: 12 })))).toEqual([
      'Answer between 1 and 10.',
    ]);
    expect(stepIssues(scale, draft(answer(scale, { numericValue: 4 })))).toEqual([]);
    expect(stepIssues(base, draft(answer(base)))).toEqual([]);
  });
});

describe('scale controls', () => {
  it('shows a short scale as every value it accepts', () => {
    expect(scalePositions(scale)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(scalePositions({ ...scale, scaleMinimum: 0, scaleMaximum: 2, scaleStep: 0.5 })).toEqual([
      0, 0.5, 1, 1.5, 2,
    ]);
  });

  it('gives a long scale a stepper instead of a wall of chips', () => {
    expect(scalePositions({ ...scale, scaleMinimum: 0, scaleMaximum: 100 })).toBeNull();
    expect(scalePositions({ ...scale, scaleStep: null })).toBeNull();
  });

  it('steps within the scale, starting from the end nearest the press', () => {
    const long = { ...scale, scaleMinimum: 0, scaleMaximum: 100, scaleStep: 0.5 };
    expect(stepScale(long, null, 1)).toBe(0);
    expect(stepScale(long, null, -1)).toBe(100);
    expect(stepScale(long, 0.5, 1)).toBe(1);
    expect(stepScale(long, 100, 1)).toBe(100);
    expect(stepScale(long, 0, -1)).toBe(0);
    // Binary floating point must not leak into the value the client sees.
    expect(stepScale({ ...long, scaleStep: 0.1 }, 0.2, 1)).toBe(0.3);
  });
});

describe('answers as the review shows them', () => {
  it('restates what was recorded, and nothing when it was left blank', () => {
    expect(answerText(scale, answer(scale, { numericValue: 7 }))).toBe('7 out of 10');
    expect(answerText(choice, answer(choice, { selectedOptionIds: ['o2', 'o1'] }))).toBe(
      'Swam, Walked',
    );
    expect(answerText(base, answer(base, { textValue: '  Slept well  ' }))).toBe('Slept well');
    expect(answerText(base, answer(base, { textValue: '   ' }))).toBeNull();
    expect(answerText(base, null)).toBeNull();
  });

  it('counts answered questions', () => {
    expect(
      answeredCount(draft(answer(scale, { numericValue: 3 }), answer(choice), answer(base))),
    ).toBe(1);
  });
});

describe('check-ins home', () => {
  const item = (
    id: string,
    dueDate: string,
    response: Partial<NonNullable<CheckInAssignmentListItem['response']>> | null = null,
  ) =>
    ({
      assignment: { id, formTitle: id, dueDate },
      response,
    }) as CheckInAssignmentListItem;

  it('puts the open check-in due first on top and the latest sent first below', () => {
    const lists = homeLists([
      item('later', '2026-09-30'),
      item('sent-old', '2026-09-16', {
        status: 'Reviewed',
        submittedAtUtc: '2026-09-16T18:00:00Z',
      }),
      item('draft', '2026-09-23', { status: 'Draft' }),
      item('sent-new', '2026-09-23', {
        status: 'Submitted',
        submittedAtUtc: '2026-09-23T19:00:00Z',
      }),
    ]);
    expect(lists.open.map((entry) => entry.assignment.id)).toEqual(['draft', 'later']);
    expect(lists.sent.map((entry) => entry.assignment.id)).toEqual(['sent-new', 'sent-old']);
  });
});

describe('workspace today from the photo window', () => {
  it('is the day before the window ends, across month and year ends', () => {
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
  });
});
