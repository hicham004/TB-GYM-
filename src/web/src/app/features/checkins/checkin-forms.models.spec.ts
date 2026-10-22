import { describe, expect, it } from 'vitest';
import type { CheckInFormDetails, CheckInFormSummary } from '../../core/api/generated';
import { toCreateRequest, validateDraft } from './checkin-builder.models';
import {
  formCard,
  formStanding,
  libraryLine,
  questionFacts,
  versionRows,
  weeklyCheckIn,
  type FormClock,
} from './checkin-forms.models';

/** Beirut is UTC+3 in October: 22:30 UTC on the 21st is already the 22nd on the workspace's clock. */
const CLOCK: FormClock = { locale: 'en-US', timeZone: 'Asia/Beirut', today: '2026-10-22' };

function summary(overrides: Partial<CheckInFormSummary> = {}): CheckInFormSummary {
  return {
    id: 'form-1',
    title: 'Weekly check-in',
    description: 'Takes two minutes.',
    status: 'Published',
    isArchived: false,
    currentVersionNumber: 1,
    draftVersionId: null,
    latestPublishedVersionId: 'version-1',
    latestPublishedVersionNumber: 1,
    questionCount: 6,
    latestPublishedAtUtc: '2026-10-21T22:30:00Z',
    version: 2,
    ...overrides,
  };
}

const NEVER_PUBLISHED = {
  status: 'Draft',
  latestPublishedVersionId: null,
  latestPublishedVersionNumber: null,
  latestPublishedAtUtc: null,
  draftVersionId: 'version-1',
} as const;

describe('a check-in form’s card (audit A14b)', () => {
  it('says a published form is ready, how many questions a client is sent, and the day it was published', () => {
    expect(formCard(summary(), CLOCK)).toEqual({
      id: 'form-1',
      title: 'Weekly check-in',
      description: 'Takes two minutes.',
      link: ['/checkins/forms', 'form-1'],
      status: 'Ready to assign',
      tone: 'success',
      questions: '6 questions',
      note: null,
      line: 'Published Thu 22 Oct',
    });
  });

  it('notes changes not published yet beside the version clients are sent', () => {
    const card = formCard(summary({ draftVersionId: 'version-2' }), CLOCK);

    expect([card.status, card.note, card.line]).toEqual([
      'Ready to assign',
      'Changes not published yet',
      'Published Thu 22 Oct',
    ]);
  });

  it('calls a form never published a draft, and says what makes it assignable', () => {
    const card = formCard(summary({ ...NEVER_PUBLISHED, questionCount: 1 }), CLOCK);

    expect([card.status, card.tone, card.questions, card.line]).toEqual([
      'Draft',
      'neutral',
      '1 question',
      'Publish it to assign it to clients',
    ]);
  });

  it('marks an archived form, and leaves no promise of publishing it', () => {
    expect(formCard(summary({ isArchived: true }), CLOCK).status).toBe('Archived');
    const draft = formCard(summary({ ...NEVER_PUBLISHED, isArchived: true }), CLOCK);
    expect([draft.status, draft.note, draft.line]).toEqual(['Archived', null, 'Never published']);
  });

  it('drops an empty description', () => {
    expect(formCard(summary({ description: '  ' }), CLOCK).description).toBeNull();
  });
});

describe('the library line', () => {
  it('counts the forms in use and those ready to assign, never the archived ones', () => {
    const forms = [
      summary(),
      summary({ id: 'form-2', ...NEVER_PUBLISHED }),
      summary({ id: 'form-3', isArchived: true }),
    ];

    expect(libraryLine(forms, 3)).toBe('2 forms, 1 ready to assign');
    expect(libraryLine([summary({ ...NEVER_PUBLISHED })], 1)).toBe('1 form, none published yet');
    expect(libraryLine([summary({ isArchived: true })], 1)).toBe('');
    expect(libraryLine([], 0)).toBe('');
  });

  it('says no count while part of a long library is read, since the server counts archived forms too', () => {
    expect(libraryLine([summary()], 140)).toBe('');
  });
});

function details(overrides: Partial<CheckInFormSummary> = {}): CheckInFormDetails {
  return {
    form: summary(overrides),
    versions: [
      {
        id: 'version-1',
        versionNumber: 1,
        status: 'Published',
        derivedFromVersionId: null,
        publishedAtUtc: '2026-10-01T09:00:00Z',
        publishedByUserId: 'coach-1',
        questionCount: 5,
        version: 1,
      },
      {
        id: 'version-2',
        versionNumber: 2,
        status: 'Published',
        derivedFromVersionId: 'version-1',
        publishedAtUtc: '2026-10-21T22:30:00Z',
        publishedByUserId: 'coach-1',
        questionCount: 6,
        version: 1,
      },
      {
        id: 'version-3',
        versionNumber: 3,
        status: 'Draft',
        derivedFromVersionId: 'version-2',
        publishedAtUtc: null,
        publishedByUserId: null,
        questionCount: 7,
        version: 4,
      },
    ],
  };
}

describe('where a form stands', () => {
  it('says when the version clients are sent was published, and where to assign it', () => {
    const standing = formStanding(
      details({ latestPublishedVersionId: 'version-2', draftVersionId: null }).form,
      CLOCK,
    );

    expect(standing).toEqual({
      label: 'Ready to assign',
      tone: 'success',
      note: 'Published Thu 22 Oct. Assign it from a client’s Check-ins tab.',
    });
  });

  it('says changes being written are not sent until they are published', () => {
    const standing = formStanding(
      details({ latestPublishedVersionId: 'version-2', draftVersionId: 'version-3' }).form,
      CLOCK,
    );

    expect(standing.note).toBe(
      'Published Thu 22 Oct. Your changes are not published yet: clients get the published questions until you publish them.',
    );
  });

  it('says a draft must be published, and an archived form must be restored', () => {
    expect(formStanding(details({ ...NEVER_PUBLISHED }).form, CLOCK)).toEqual({
      label: 'Draft',
      tone: 'neutral',
      note: 'Publish it to assign it to clients.',
    });
    expect(formStanding(details({ isArchived: true }).form, CLOCK).note).toBe(
      'It can’t be changed or assigned until you restore it. Check-ins already sent from it are kept.',
    );
  });
});

describe('the versions sheet', () => {
  it('lists every version newest first, with its day and size, and the one clients are sent', () => {
    const rows = versionRows(
      details({ latestPublishedVersionId: 'version-2', draftVersionId: 'version-3' }),
      CLOCK,
    );

    expect(rows.map((row) => [row.title, row.state, row.line, row.current])).toEqual([
      ['Version 3', 'Draft', '7 questions', false],
      ['Version 2', 'Published', 'Thu 22 Oct · 6 questions', true],
      ['Version 1', 'Published', 'Thu 1 Oct · 5 questions', false],
    ]);
  });
});

describe('a question read where it cannot be changed', () => {
  it('says its kind, what a scale allows, and whether an answer is needed', () => {
    const base = { scaleMinimum: null, scaleMaximum: null, scaleStep: null };

    expect(questionFacts({ ...base, questionType: 'ShortText', isRequired: true })).toBe(
      'Short answer · Required',
    );
    expect(questionFacts({ ...base, questionType: 'MultipleChoice', isRequired: false })).toBe(
      'Choose several · Optional',
    );
    expect(
      questionFacts({
        questionType: 'NumericScale',
        isRequired: true,
        scaleMinimum: 1,
        scaleMaximum: 10,
        scaleStep: 1,
      }),
    ).toBe('Number scale, 1 to 10 · Required');
    expect(
      questionFacts({
        questionType: 'NumericScale',
        isRequired: true,
        scaleMinimum: '0',
        scaleMaximum: '5',
        scaleStep: '0.5',
      }),
    ).toBe('Number scale, 0 to 5 in steps of 0.5 · Required');
  });
});

describe('the weekly check-in to start from', () => {
  it('is the demo’s six questions, complete enough to save as it is, with new keys for the server', () => {
    const starter = weeklyCheckIn();

    expect(validateDraft(starter).isValid).toBe(true);
    expect(starter.questions.map((question) => question.questionType)).toEqual([
      'NumericScale',
      'NumericScale',
      'NumericScale',
      'SingleChoice',
      'LongText',
      'LongText',
    ]);
    expect(starter.questions[0].helpText).toBe('1 is exhausted, 10 is unstoppable.');
    expect(
      toCreateRequest(starter).questions.every((question) => question.questionKey === null),
    ).toBe(true);
    expect(new Set(weeklyCheckIn().questions.map((question) => question.key)).size).toBe(6);
  });
});
