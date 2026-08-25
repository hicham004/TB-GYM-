import { describe, expect, it } from 'vitest';
import type { CheckInFormVersionView } from '../../core/api/generated';
import {
  FORM_LEVEL,
  draftFromVersion,
  emptyForm,
  emptyQuestion,
  moveItem,
  stepDividesRange,
  toCreateRequest,
  toSaveRequest,
  validateAssignment,
  validateDraft,
  withQuestionType,
  type FormDraft,
} from './checkin-builder.models';

const QUESTION_KEY = 'a'.repeat(32);

function draftWith(...questions: FormDraft['questions']): FormDraft {
  return { title: 'Weekly check-in', description: '', questions };
}

function choiceQuestion(...labels: string[]): FormDraft['questions'][number] {
  const question = emptyQuestion('SingleChoice');
  question.prompt = 'Energy level';
  question.options = labels.map((label, index) => ({ key: `option-${index}`, label }));
  return question;
}

function scaleQuestion(minimum: number, maximum: number, step: number) {
  const question = emptyQuestion('NumericScale');
  question.prompt = 'Sleep quality';
  question.scaleMinimum = minimum;
  question.scaleMaximum = maximum;
  question.scaleStep = step;
  return question;
}

describe('check-in builder validation', () => {
  it('requires a title and at least one prompted question', () => {
    const empty = emptyForm();
    const result = validateDraft(empty);

    expect(result.isValid).toBe(false);
    expect(result.formErrors).toContain('A title is required.');
    // The starter question has no prompt yet, so it is reported against that question.
    expect(result.questionErrors[empty.questions[0].key]).toContain('A question needs a prompt.');
  });

  it('accepts a complete short-text form', () => {
    const question = emptyQuestion('ShortText');
    question.prompt = 'How is your body feeling?';

    expect(validateDraft(draftWith(question)).isValid).toBe(true);
  });

  it('holds a choice question to at least two distinct, labelled options', () => {
    const tooFew = choiceQuestion('Low');
    expect(validateDraft(draftWith(tooFew)).questionErrors[tooFew.key]).toContain(
      'A choice question needs at least two options.',
    );

    const blank = choiceQuestion('Low', '   ');
    expect(validateDraft(draftWith(blank)).questionErrors[blank.key]).toContain(
      'Every option needs a label.',
    );

    // Distinctness is case-insensitive, matching the server's own option comparison.
    const duplicated = choiceQuestion('Low', 'low');
    expect(validateDraft(draftWith(duplicated)).questionErrors[duplicated.key]).toContain(
      'Options must be distinct.',
    );

    expect(validateDraft(draftWith(choiceQuestion('Low', 'High'))).isValid).toBe(true);
  });

  it('rejects a numeric scale whose step cannot land on its maximum', () => {
    const inverted = scaleQuestion(10, 1, 1);
    expect(validateDraft(draftWith(inverted)).questionErrors[inverted.key]).toContain(
      'The scale minimum must be below its maximum.',
    );

    const zeroStep = scaleQuestion(1, 10, 0);
    expect(validateDraft(draftWith(zeroStep)).questionErrors[zeroStep.key]).toContain(
      'The scale step must be greater than zero.',
    );

    // 1..10 by 2 stops at 9, so the coach's own maximum is unreachable.
    const offStep = scaleQuestion(1, 10, 2);
    expect(validateDraft(draftWith(offStep)).questionErrors[offStep.key]).toContain(
      'The step must divide the range exactly, ending on the maximum.',
    );

    expect(validateDraft(draftWith(scaleQuestion(1, 10, 1))).isValid).toBe(true);
    expect(validateDraft(draftWith(scaleQuestion(0, 10, 2.5))).isValid).toBe(true);
  });

  it('divides a decimal step exactly rather than in binary floating point', () => {
    // 0.1 + 0.2 !== 0.3 in binary, so the naive remainder would reject this valid scale.
    expect(stepDividesRange(0, 0.3, 0.1)).toBe(true);
    expect(stepDividesRange(1, 10, 2)).toBe(false);
  });

  it('caps a scale at the server-supported number of positions', () => {
    const tooMany = scaleQuestion(0, 1000, 1);
    expect(validateDraft(draftWith(tooMany)).questionErrors[tooMany.key]).toContain(
      'A scale cannot have more than 100 steps.',
    );
  });
});

describe('check-in builder editing', () => {
  it('discards content the new question type cannot carry', () => {
    const choice = choiceQuestion('Low', 'High');
    const asScale = withQuestionType(choice, 'NumericScale');

    // The server refuses a scale that still has options, so switching type clears them.
    expect(asScale.options).toEqual([]);
    expect(asScale.scaleMinimum).toBe(1);

    const asText = withQuestionType(asScale, 'ShortText');
    expect(asText.scaleMinimum).toBeNull();
    expect(asText.options).toEqual([]);
  });

  it('keeps existing options when switching between the two choice types', () => {
    const single = choiceQuestion('Low', 'High');
    const multiple = withQuestionType(single, 'MultipleChoice');

    expect(multiple.options.map((option) => option.label)).toEqual(['Low', 'High']);
  });

  it('reorders questions without losing or duplicating any', () => {
    const items = ['a', 'b', 'c'];

    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(items, 2, 0)).toEqual(['c', 'a', 'b']);
    // An out-of-range move is a no-op rather than a corruption.
    expect(moveItem(items, 0, 5)).toEqual(items);
    expect(moveItem(items, 1, 1)).toEqual(items);
  });
});

describe('check-in builder requests', () => {
  it('lets the server own every key on a brand new lineage', () => {
    const question = emptyQuestion('ShortText');
    question.prompt = '  How is your body feeling?  ';
    question.questionKey = QUESTION_KEY;

    const request = toCreateRequest(draftWith(question));

    // A new form has no history to align to, so a supplied key would be meaningless — and the
    // server refuses one outright.
    expect(request.questions[0].questionKey).toBeNull();
    expect(request.questions[0].prompt).toBe('How is your body feeling?');
    expect(request.description).toBeNull();
  });

  it('echoes an existing key unchanged when saving a derived draft', () => {
    const question = emptyQuestion('ShortText');
    question.prompt = 'How does your body feel today?';
    question.questionKey = QUESTION_KEY;

    const request = toSaveRequest(draftWith(question), 12);

    expect(request.version).toBe(12);
    expect(request.questions[0].questionKey).toBe(QUESTION_KEY);
  });

  it('sends only the fields the question type accepts', () => {
    const request = toCreateRequest(
      draftWith(choiceQuestion('Low', 'High'), scaleQuestion(1, 10, 1)),
    );

    expect(request.questions[0].options).toEqual(['Low', 'High']);
    expect(request.questions[0].scaleMinimum).toBeNull();
    expect(request.questions[1].options).toEqual([]);
    expect(request.questions[1].scaleMaximum).toBe(10);
  });

  it('rebuilds an editable draft from a version, carrying its keys', () => {
    const version: CheckInFormVersionView = {
      id: 'version-1',
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formDescription: 'Sent every Monday.',
      versionNumber: 2,
      status: 'Draft',
      derivedFromVersionId: 'version-0',
      publishedAtUtc: null,
      publishedByUserId: null,
      version: 3,
      questions: [
        {
          id: 'question-1',
          questionKey: QUESTION_KEY,
          order: 1,
          questionType: 'SingleChoice',
          prompt: 'Energy level',
          helpText: null,
          isRequired: true,
          scaleMinimum: null,
          scaleMaximum: null,
          scaleStep: null,
          options: [
            { id: 'option-1', order: 1, label: 'Low' },
            { id: 'option-2', order: 2, label: 'High' },
          ],
        },
      ],
    };

    const draft = draftFromVersion(version);

    expect(draft.title).toBe('Weekly check-in');
    expect(draft.description).toBe('Sent every Monday.');
    expect(draft.questions[0].questionKey).toBe(QUESTION_KEY);
    expect(draft.questions[0].options.map((option) => option.label)).toEqual(['Low', 'High']);
    // Round-tripping preserves the key, which is what keeps answers comparable across versions.
    expect(toSaveRequest(draft, 3).questions[0].questionKey).toBe(QUESTION_KEY);
  });
});

describe('check-in assignment form', () => {
  it('requires a client, a published version and a due date that is not already past', () => {
    const today = '2026-08-25';

    expect(
      validateAssignment({ clientProfileId: '', formVersionId: '', dueDate: '' }, today).errors,
    ).toEqual(['Choose a client.', 'Choose a published version to assign.', 'Choose a due date.']);

    expect(
      validateAssignment(
        { clientProfileId: 'client-1', formVersionId: 'version-1', dueDate: '2026-08-24' },
        today,
      ).errors,
    ).toEqual(['The due date cannot be in the past.']);
  });

  /**
   * Each reason is keyed by the control it belongs to, so a message can wait for its own field to be
   * left rather than appearing on a form nobody has touched. The client has no control in this form,
   * so its reason is form-level and only a submit attempt can reveal it.
   */
  it('keys each reason to the control it belongs to', () => {
    const validation = validateAssignment(
      { clientProfileId: '', formVersionId: '', dueDate: '2026-08-24' },
      '2026-08-25',
    );

    expect(validation.byField['formVersionId']).toEqual(['Choose a published version to assign.']);
    expect(validation.byField['dueDate']).toEqual(['The due date cannot be in the past.']);
    expect(validation.byField[FORM_LEVEL]).toEqual(['Choose a client.']);
    expect(validation.isValid).toBe(false);
  });

  it('accepts today, so the boundary is the workspace date and not "strictly future"', () => {
    const today = '2026-08-25';

    expect(
      validateAssignment(
        { clientProfileId: 'client-1', formVersionId: 'version-1', dueDate: today },
        today,
      ).errors,
    ).toEqual([]);
  });
});
