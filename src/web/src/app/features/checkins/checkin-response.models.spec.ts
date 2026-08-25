import { describe, expect, it } from 'vitest';
import type {
  CheckInComparisonView,
  CheckInQuestionView,
  CheckInResponseDetail,
} from '../../core/api/generated';
import {
  comparisonRows,
  formatAnswer,
  isAnswered,
  isEditable,
  issuesByQuestion,
  issuesFromServer,
  responseDraftFromDetail,
  submitGuard,
  toSaveRequest,
  withSelection,
} from './checkin-response.models';

const TEXT_KEY = 'a'.repeat(32);
const SCALE_KEY = 'b'.repeat(32);
const CHOICE_KEY = 'c'.repeat(32);
const ADDED_KEY = 'd'.repeat(32);

function question(overrides: Partial<CheckInQuestionView>): CheckInQuestionView {
  return {
    id: 'question-1',
    questionKey: TEXT_KEY,
    order: 1,
    questionType: 'ShortText',
    prompt: 'How is your body feeling?',
    helpText: null,
    isRequired: true,
    scaleMinimum: null,
    scaleMaximum: null,
    scaleStep: null,
    options: [],
    ...overrides,
  };
}

const TEXT_QUESTION = question({});

const SCALE_QUESTION = question({
  id: 'question-2',
  questionKey: SCALE_KEY,
  order: 2,
  questionType: 'NumericScale',
  prompt: 'Sleep quality',
  scaleMinimum: 1,
  scaleMaximum: 10,
  scaleStep: 1,
});

const CHOICE_QUESTION = question({
  id: 'question-3',
  questionKey: CHOICE_KEY,
  order: 3,
  questionType: 'SingleChoice',
  prompt: 'Energy level',
  isRequired: false,
  options: [
    { id: 'option-low', order: 1, label: 'Low' },
    { id: 'option-high', order: 2, label: 'High' },
  ],
});

const QUESTIONS = [TEXT_QUESTION, SCALE_QUESTION, CHOICE_QUESTION];

function detail(response: CheckInResponseDetail['response']): CheckInResponseDetail {
  return {
    assignment: {
      id: 'assignment-1',
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formVersionId: 'version-1',
      formVersionNumber: 1,
      clientProfileId: 'client-1',
      dueDate: '2026-08-27',
      assignedAtUtc: '2026-08-22T09:00:00Z',
      assignedByUserId: 'coach-1',
    },
    version: {
      id: 'version-1',
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formDescription: null,
      versionNumber: 1,
      status: 'Published',
      derivedFromVersionId: null,
      publishedAtUtc: '2026-08-22T09:00:00Z',
      publishedByUserId: 'coach-1',
      questions: QUESTIONS,
      version: 7,
    },
    response,
  };
}

describe('check-in response draft', () => {
  it('starts empty when the client has not answered anything yet', () => {
    const draft = responseDraftFromDetail(detail(null));

    expect(draft.version).toBeNull();
    expect(draft.status).toBe('Draft');
    expect(draft.answers).toHaveLength(3);
    expect(draft.answers.every((answer) => !isAnswered(answer))).toBe(true);
  });

  it('resumes a partial draft with its answers intact and the rest still empty', () => {
    const draft = responseDraftFromDetail(
      detail({
        id: 'response-1',
        assignmentId: 'assignment-1',
        clientProfileId: 'client-1',
        status: 'Draft',
        submittedAtUtc: null,
        submittedDate: null,
        isLate: false,
        reviewedAtUtc: null,
        reviewedByUserId: null,
        version: 12,
        answers: [
          {
            questionId: 'question-1',
            questionKey: TEXT_KEY,
            questionType: 'ShortText',
            textValue: 'Shoulders are tight.',
            numericValue: null,
            choices: [],
          },
          {
            questionId: 'question-3',
            questionKey: CHOICE_KEY,
            questionType: 'SingleChoice',
            textValue: null,
            numericValue: null,
            choices: [{ questionOptionId: 'option-high', order: 2, label: 'High' }],
          },
        ],
      }),
    );

    expect(draft.version).toBe(12);
    expect(draft.answers[0].textValue).toBe('Shoulders are tight.');
    expect(draft.answers[2].selectedOptionIds).toEqual(['option-high']);
    // The question never answered comes back empty rather than guessed at.
    expect(draft.answers[1].numericValue).toBeNull();
  });

  it('carries the concurrency token and every answer, including the cleared ones', () => {
    const draft = responseDraftFromDetail(detail(null));
    draft.answers[0].textValue = '  Feeling good.  ';

    const request = toSaveRequest(draft);

    expect(request.version).toBeNull();
    expect(request.answers).toHaveLength(3);
    expect(request.answers[0].textValue).toBe('Feeling good.');
    expect(request.answers[1].numericValue).toBeNull();
    expect(request.answers[2].selectedOptionIds).toEqual([]);
  });

  it('keeps a single-choice question to one selection and toggles a multiple-choice one', () => {
    const draft = responseDraftFromDetail(detail(null));
    const single = draft.answers[2];

    const picked = withSelection(single, 'option-low');
    expect(picked.selectedOptionIds).toEqual(['option-low']);

    // Choosing another option replaces rather than adds, so "exactly one" cannot be broken here.
    const replaced = withSelection(picked, 'option-high');
    expect(replaced.selectedOptionIds).toEqual(['option-high']);
    expect(withSelection(replaced, 'option-high').selectedOptionIds).toEqual([]);

    const multiple = { ...single, questionType: 'MultipleChoice' as const };
    const both = withSelection(withSelection(multiple, 'option-low'), 'option-high');
    expect(both.selectedOptionIds).toEqual(['option-low', 'option-high']);
    expect(withSelection(both, 'option-low').selectedOptionIds).toEqual(['option-high']);
  });

  it('treats a submitted or reviewed response as no longer editable', () => {
    expect(isEditable(null)).toBe(true);
    const submitted = detail({
      id: 'response-1',
      assignmentId: 'assignment-1',
      clientProfileId: 'client-1',
      status: 'Submitted',
      submittedAtUtc: '2026-08-25T10:00:00Z',
      submittedDate: '2026-08-25',
      isLate: false,
      reviewedAtUtc: null,
      reviewedByUserId: null,
      version: 20,
      answers: [],
    }).response;
    expect(isEditable(submitted)).toBe(false);
  });
});

describe('check-in submit guard', () => {
  it('blocks submission while a required question is unanswered and names every one', () => {
    const draft = responseDraftFromDetail(detail(null));

    const guard = submitGuard(QUESTIONS, draft);

    expect(guard.canSubmit).toBe(false);
    // The optional choice question is not one of them.
    expect(guard.issues.map((issue) => issue.questionKey)).toEqual([TEXT_KEY, SCALE_KEY]);
  });

  it('reports an out-of-range and an off-step numeric answer separately', () => {
    const outOfRange = responseDraftFromDetail(detail(null));
    outOfRange.answers[0].textValue = 'Fine.';
    outOfRange.answers[1].numericValue = 42;
    expect(submitGuard(QUESTIONS, outOfRange).issues[0].message).toContain('between');

    const offStep = responseDraftFromDetail(detail(null));
    offStep.answers[0].textValue = 'Fine.';
    offStep.answers[1].numericValue = 7.5;
    expect(submitGuard(QUESTIONS, offStep).issues[0].message).toContain('steps of');
  });

  it('allows submission once every required question holds a valid answer', () => {
    const draft = responseDraftFromDetail(detail(null));
    draft.answers[0].textValue = 'Shoulders are tight.';
    draft.answers[1].numericValue = 8;

    const guard = submitGuard(QUESTIONS, draft);

    expect(guard.canSubmit).toBe(true);
    expect(guard.issues).toEqual([]);
  });

  it('surfaces local and server refusals in the same shape, grouped by question', () => {
    const draft = responseDraftFromDetail(detail(null));
    const local = issuesByQuestion(submitGuard(QUESTIONS, draft).issues);
    expect(Object.keys(local)).toEqual([TEXT_KEY, SCALE_KEY]);
    expect(local[TEXT_KEY]).toHaveLength(1);

    const server = issuesFromServer([
      { questionKey: SCALE_KEY, code: 'NumericOffStep', message: 'Answer in steps of 1 from 1.' },
      { questionKey: SCALE_KEY, code: 'NumericOutOfRange', message: 'Answer between 1 and 10.' },
    ]);
    expect(issuesByQuestion(server)[SCALE_KEY]).toHaveLength(2);
  });
});

describe('check-in comparison rendering', () => {
  const comparison: CheckInComparisonView = {
    clientProfileId: 'client-1',
    formId: 'form-1',
    formTitle: 'Weekly check-in',
    first: {
      responseId: 'response-1',
      assignmentId: 'assignment-1',
      formVersionId: 'version-1',
      formVersionNumber: 1,
      status: 'Reviewed',
      dueDate: '2026-08-20',
      submittedDate: '2026-08-20',
      submittedAtUtc: '2026-08-20T09:00:00Z',
      isLate: false,
    },
    second: {
      responseId: 'response-2',
      assignmentId: 'assignment-2',
      formVersionId: 'version-2',
      formVersionNumber: 2,
      status: 'Submitted',
      dueDate: '2026-08-27',
      submittedDate: '2026-08-28',
      submittedAtUtc: '2026-08-28T09:00:00Z',
      isLate: true,
    },
    rows: [
      {
        questionKey: TEXT_KEY,
        presence: 'InBoth',
        first: {
          questionId: 'question-1',
          order: 1,
          questionType: 'ShortText',
          prompt: 'How is your body feeling?',
          isRequired: true,
          answer: {
            questionId: 'question-1',
            questionKey: TEXT_KEY,
            questionType: 'ShortText',
            textValue: 'Shoulders are tight.',
            numericValue: null,
            choices: [],
          },
        },
        second: {
          questionId: 'question-9',
          order: 1,
          questionType: 'ShortText',
          prompt: 'How does your body feel today?',
          isRequired: true,
          answer: {
            questionId: 'question-9',
            questionKey: TEXT_KEY,
            questionType: 'ShortText',
            textValue: 'Much better.',
            numericValue: null,
            choices: [],
          },
        },
      },
      {
        questionKey: ADDED_KEY,
        presence: 'OnlyInSecond',
        first: null,
        second: {
          questionId: 'question-10',
          order: 4,
          questionType: 'LongText',
          prompt: 'Anything else?',
          isRequired: false,
          answer: null,
        },
      },
    ],
  };

  it('keeps both wordings for a re-worded question and flags that it changed', () => {
    const [shared] = comparisonRows(comparison);

    expect(shared.presence).toBe('InBoth');
    expect(shared.firstPrompt).toBe('How is your body feeling?');
    expect(shared.secondPrompt).toBe('How does your body feel today?');
    expect(shared.wordingChanged).toBe(true);
    expect(shared.firstAnswer).toBe('Shoulders are tight.');
    expect(shared.secondAnswer).toBe('Much better.');
    expect(shared.isOneSided).toBe(false);
  });

  it('renders a one-sided question as not asked, never as an empty answer', () => {
    const oneSided = comparisonRows(comparison)[1];

    expect(oneSided.presence).toBe('OnlyInSecond');
    expect(oneSided.isOneSided).toBe(true);
    // Null means "this side was never asked"; an empty string would mean "asked and left blank".
    expect(oneSided.firstPrompt).toBeNull();
    expect(oneSided.firstAnswer).toBeNull();
    expect(oneSided.secondPrompt).toBe('Anything else?');
    expect(oneSided.secondAnswer).toBe('');
  });

  it('formats each answer type without interpreting it', () => {
    expect(formatAnswer(null)).toBe('');
    expect(
      formatAnswer({
        questionId: 'question-2',
        questionKey: SCALE_KEY,
        questionType: 'NumericScale',
        textValue: null,
        numericValue: '8.000',
        choices: [],
      }),
    ).toBe('8');
    expect(
      formatAnswer({
        questionId: 'question-3',
        questionKey: CHOICE_KEY,
        questionType: 'MultipleChoice',
        textValue: null,
        numericValue: null,
        choices: [
          { questionOptionId: 'option-low', order: 1, label: 'Low' },
          { questionOptionId: 'option-high', order: 2, label: 'High' },
        ],
      }),
    ).toBe('Low, High');
  });
});
