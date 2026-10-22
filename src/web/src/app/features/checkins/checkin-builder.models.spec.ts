import { describe, expect, it } from 'vitest';
import type { CheckInFormVersionView } from '../../core/api/generated';
import {
  FORM_LEVEL,
  draftFromVersion,
  emptyForm,
  emptyQuestion,
  moveItem,
  nameIssues,
  questionIssues,
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
  it('requires a name and at least one written question', () => {
    const empty = emptyForm();
    const result = validateDraft(empty);

    expect(result.isValid).toBe(false);
    expect(result.formErrors).toContain('Give the form a name.');
    // The starter question is not written yet, so it is reported against that question.
    expect(result.questionErrors[empty.questions[0].key]).toEqual(['Write the question.']);
    expect(validateDraft(draftWith()).byField[FORM_LEVEL]).toEqual(['Add at least one question.']);
  });

  it('accepts a complete short-text form', () => {
    const question = emptyQuestion('ShortText');
    question.prompt = 'How is your body feeling?';

    expect(validateDraft(draftWith(question)).isValid).toBe(true);
  });

  it('holds a choice question to at least two distinct, written choices', () => {
    const tooFew = choiceQuestion('Low');
    expect(validateDraft(draftWith(tooFew)).questionErrors[tooFew.key]).toEqual([
      'Give at least two choices.',
    ]);

    const blank = choiceQuestion('Low', '   ');
    expect(validateDraft(draftWith(blank)).questionErrors[blank.key]).toEqual([
      'Write this choice, or remove it.',
    ]);

    // Distinctness is case-insensitive, matching the server's own option comparison.
    const duplicated = choiceQuestion('Low', 'low');
    expect(validateDraft(draftWith(duplicated)).questionErrors[duplicated.key]).toEqual([
      'An earlier choice says the same.',
    ]);

    expect(validateDraft(draftWith(choiceQuestion('Low', 'High'))).isValid).toBe(true);
  });

  it('rejects a numeric scale whose step cannot land on its highest number', () => {
    const inverted = scaleQuestion(10, 1, 1);
    expect(validateDraft(draftWith(inverted)).questionErrors[inverted.key]).toEqual([
      'Make it more than the lowest number.',
    ]);

    const zeroStep = scaleQuestion(1, 10, 0);
    expect(validateDraft(draftWith(zeroStep)).questionErrors[zeroStep.key]).toEqual([
      'The step must be more than 0.',
    ]);

    // 1..10 by 2 stops at 9, so the coach's own highest number is never reached.
    const offStep = scaleQuestion(1, 10, 2);
    expect(validateDraft(draftWith(offStep)).questionErrors[offStep.key]).toEqual([
      'Counting from 1 in steps of 2 never lands on 10.',
    ]);

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
    expect(validateDraft(draftWith(tooMany)).questionErrors[tooMany.key]).toEqual([
      'That is more than 100 steps. Use a bigger step.',
    ]);
  });
});

/**
 * Audit A14b: each reason sits under the box it is about, so a coach is never told "every option needs a
 * label" without being shown which one.
 */
describe('check-in question issues', () => {
  it('puts the question’s and the hint’s reasons under their own boxes', () => {
    const question = emptyQuestion('ShortText');
    question.prompt = 'x'.repeat(501);
    question.helpText = 'y'.repeat(1001);

    const issues = questionIssues(question);

    expect(issues.prompt).toEqual(['Keep the question under 500 characters.']);
    expect(issues.hint).toEqual(['Keep the hint under 1,000 characters.']);
    expect([...issues.choices, ...issues.lowest, ...issues.highest, ...issues.step]).toEqual([]);
  });

  it('names each choice that is wrong by its key, and how many there are under the group', () => {
    const question = choiceQuestion('Low', '', 'low', 'z'.repeat(201));
    const issues = questionIssues(question);

    expect(issues.choices).toEqual([]);
    expect(issues.choice).toEqual({
      'option-1': ['Write this choice, or remove it.'],
      'option-2': ['An earlier choice says the same.'],
      'option-3': ['Keep this choice under 200 characters.'],
    });
    expect(questionIssues(choiceQuestion('Only')).choices).toEqual(['Give at least two choices.']);
    const many = choiceQuestion(...Array.from({ length: 31 }, (_, index) => `Choice ${index}`));
    expect(questionIssues(many).choices).toEqual(['Keep it to 30 choices or fewer.']);
  });

  it('keeps a scale to what the server stores: three decimal places, within a million either way', () => {
    const fine = questionIssues(scaleQuestion(-5, 5, 0.125));
    expect([...fine.lowest, ...fine.highest, ...fine.step]).toEqual([]);

    const precise = questionIssues(scaleQuestion(0, 0.1, 0.0011));
    expect(precise.step).toEqual(['Use at most 3 decimal places.']);
    const huge = questionIssues(scaleQuestion(0, 2_000_000, 20_000));
    expect(huge.highest).toEqual(['Keep it between -1,000,000 and 1,000,000.']);
    // A number already refused says only that; the range checks wait until every number is usable.
    expect(huge.step).toEqual([]);
  });

  it('compares choices the way the server does, whatever the browser’s language', () => {
    // OrdinalIgnoreCase: "Iyi" and "iyi" are the same choice; "İyi" (dotted capital I) is another.
    expect(questionIssues(choiceQuestion('Iyi', 'iyi')).choice).toEqual({
      'option-1': ['An earlier choice says the same.'],
    });
    expect(questionIssues(choiceQuestion('İyi', 'iyi')).choice).toEqual({});
  });

  it('says under each number of a scale what it needs', () => {
    const empty = scaleQuestion(1, 10, 1);
    empty.scaleMinimum = null;
    empty.scaleMaximum = null;
    empty.scaleStep = null;

    const blank = questionIssues(empty);
    expect([blank.lowest, blank.highest, blank.step]).toEqual([
      ['Enter the lowest number.'],
      ['Enter the highest number.'],
      ['Enter the step.'],
    ]);
    const inverted = questionIssues(scaleQuestion(10, 1, 1));
    expect([inverted.lowest, inverted.highest, inverted.step]).toEqual([
      [],
      ['Make it more than the lowest number.'],
      [],
    ]);
  });
});

describe('a form’s name and description', () => {
  it('holds the new form’s boxes and the rename sheet to one rule', () => {
    expect(nameIssues('  ', '')).toEqual({ title: ['Give the form a name.'], description: [] });
    expect(nameIssues('x'.repeat(161), 'y'.repeat(2001))).toEqual({
      title: ['The name is too long.'],
      description: ['The description is too long.'],
    });
    expect(nameIssues('Weekly check-in', '')).toEqual({ title: [], description: [] });
    expect(validateDraft({ ...emptyForm(), title: ' ' }).byField['title']).toEqual(
      nameIssues(' ', '').title,
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
  it('requires a published form and a due date that is not already past', () => {
    const today = '2026-08-25';

    expect(validateAssignment({ formVersionId: '', dueDate: '' }, today).errors).toEqual([
      'Choose the form to send.',
      'Choose the day it is due.',
    ]);

    expect(
      validateAssignment({ formVersionId: 'version-1', dueDate: '2026-08-24' }, today).errors,
    ).toEqual(['Choose today or a later day.']);
  });

  /**
   * Each reason is keyed by the control it belongs to, so a message can wait for its own field to be
   * left rather than appearing on a form nobody has touched. The client is the record the sheet was
   * opened on, so there is no client to choose (audit A14b).
   */
  it('keys each reason to the control it belongs to', () => {
    const validation = validateAssignment(
      { formVersionId: '', dueDate: '2026-08-24' },
      '2026-08-25',
    );

    expect(validation.byField['formVersionId']).toEqual(['Choose the form to send.']);
    expect(validation.byField['dueDate']).toEqual(['Choose today or a later day.']);
    expect(validation.byField[FORM_LEVEL]).toBeUndefined();
    expect(validation.isValid).toBe(false);
  });

  it('accepts today, so the boundary is the workspace date and not "strictly future"', () => {
    const today = '2026-08-25';

    expect(
      validateAssignment({ formVersionId: 'version-1', dueDate: today }, today).errors,
    ).toEqual([]);
  });
});
