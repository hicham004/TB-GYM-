import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import type { ClientEnrollment } from '../../core/api/api.models';
import type {
  ProgramTemplateSummary,
  ProgramTemplateVersionView,
  StrengthMaxView,
} from '../../core/api/generated';
import {
  assignmentErrors,
  assignmentRequest,
  cancelReasonErrors,
  coverageText,
  defaultStartDate,
  exercisesNeedingMax,
  lastDayOf,
  maxRow,
  planChoices,
  programChoices,
  programWriteError,
  progressionErrors,
  rescheduleErrors,
  runSummary,
  type AssignmentValues,
} from './client-program-forms.models';

function enrollment(fields: Partial<ClientEnrollment>): ClientEnrollment {
  return {
    id: 'enrollment-1',
    productName: 'Online Coaching',
    offerLabel: '12 weeks',
    startDate: '2026-09-01',
    endDateExclusive: '2026-11-24',
    lastActiveDate: '2026-11-23',
    storedStatus: 'Active',
    effectiveStatus: 'Active',
    features: ['Training', 'Messaging'],
    ...fields,
  } as ClientEnrollment;
}

function template(
  name: string,
  versions: { id: string; versionNumber: number; isPublished: boolean; weekCount: number }[],
  isArchived = false,
): ProgramTemplateSummary {
  return {
    id: `template-${name}`,
    name,
    currentVersionNumber: Math.max(...versions.map((version) => version.versionNumber)),
    isArchived,
    version: 1,
    versions: versions.map((version) => ({
      ...version,
      name,
      createdAtUtc: '2026-09-01T09:00:00Z',
    })),
  };
}

describe('choosing a plan', () => {
  it('names a plan by product, price option and dates', () => {
    expect(planChoices([enrollment({})], 'en-US')).toEqual([
      {
        id: 'enrollment-1',
        label: 'Online Coaching · 12 weeks · 1 Sep – 23 Nov 2026',
        startDate: '2026-09-01',
        lastDay: '2026-11-23',
      },
    ]);
  });

  it('offers only plans that include training and are neither cancelled nor over', () => {
    const choices = planChoices(
      [
        enrollment({ id: 'ok' }),
        enrollment({ id: 'cancelled', storedStatus: 'Cancelled', effectiveStatus: 'Cancelled' }),
        // Over by its dates though the system has not marked it so yet.
        enrollment({ id: 'expired', effectiveStatus: 'Expired' }),
        enrollment({ id: 'messaging', features: ['Messaging'] }),
        enrollment({ id: 'next', startDate: '2026-12-01' }),
      ],
      'en-US',
    );

    expect(choices.map((choice) => choice.id)).toEqual(['ok', 'next']);
  });

  it('starts on today, or on the day a plan that has not begun starts', () => {
    const [running] = planChoices([enrollment({})], 'en-US');
    const [later] = planChoices([enrollment({ startDate: '2026-10-12' })], 'en-US');

    expect(defaultStartDate('2026-10-01', running)).toBe('2026-10-01');
    expect(defaultStartDate('2026-10-01', later)).toBe('2026-10-12');
    expect(defaultStartDate('2026-10-01', undefined)).toBe('2026-10-01');
  });
});

describe('choosing a program', () => {
  it('offers each program once, at its newest published version', () => {
    const choices = programChoices([
      template('Full Body Reset', [
        { id: 'fbr-1', versionNumber: 1, isPublished: true, weekCount: 4 },
        { id: 'fbr-2', versionNumber: 2, isPublished: true, weekCount: 6 },
        { id: 'fbr-3', versionNumber: 3, isPublished: false, weekCount: 6 },
      ]),
      template('Lean & Strong', [
        { id: 'ls-1', versionNumber: 1, isPublished: true, weekCount: 1 },
      ]),
    ]);

    expect(choices).toEqual([
      { versionId: 'fbr-2', label: 'Full Body Reset · 6 weeks', weekCount: 6 },
      { versionId: 'ls-1', label: 'Lean & Strong · 1 week', weekCount: 1 },
    ]);
    // The version number is history, not a thing to choose between.
    expect(choices.map((choice) => choice.label).join()).not.toMatch(/v\d/);
  });

  it('leaves out archived programs and ones with nothing published', () => {
    const choices = programChoices([
      template('Old', [{ id: 'old-1', versionNumber: 1, isPublished: true, weekCount: 4 }], true),
      template('Draft', [{ id: 'draft-1', versionNumber: 1, isPublished: false, weekCount: 4 }]),
    ]);

    expect(choices).toEqual([]);
  });
});

describe('where a program would run', () => {
  it('says the days it covers and whether that is past the end of the plan', () => {
    expect(lastDayOf('2026-10-12', 6)).toBe('2026-11-22');
    expect(runSummary('2026-10-12', 6, '2026-11-23', 'en-US')).toEqual({
      text: 'Runs Mon 12 Oct – Sun 22 Nov',
      pastPlanEnd: false,
    });
    expect(runSummary('2026-10-19', 6, '2026-11-23', 'en-US')?.pastPlanEnd).toBe(true);
    // The last covered day itself is fine.
    expect(runSummary('2026-10-12', 6, '2026-11-22', 'en-US')?.pastPlanEnd).toBe(false);
  });

  it('says nothing until there is a date and a program', () => {
    expect(runSummary('', 6, null, 'en-US')).toBeNull();
    expect(runSummary('2026-10-12', 0, null, 'en-US')).toBeNull();
  });
});

describe('training maxes', () => {
  const version = {
    weeks: [
      {
        sessions: [
          {
            exercises: [
              {
                exerciseId: 'squat',
                exerciseName: 'Back squat',
                sets: [{ loadStrategy: 'PercentageWorkingMax' }, { loadStrategy: 'Direct' }],
              },
              { exerciseId: 'curl', exerciseName: 'Leg curl', sets: [{ loadStrategy: 'Direct' }] },
              {
                exerciseId: 'bench',
                exerciseName: 'Bench press',
                sets: [{ loadStrategy: 'RpeBasedEpley' }],
              },
              {
                exerciseId: 'squat',
                exerciseName: 'Back squat',
                sets: [{ loadStrategy: 'RpeBasedEpley' }],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as ProgramTemplateVersionView;

  function recorded(fields: Partial<StrengthMaxView>): StrengthMaxView {
    return {
      id: 'max-1',
      exerciseId: 'squat',
      exerciseName: 'Back squat',
      kind: 'CoachWorkingMax',
      value: 100,
      unit: 'Kilogram',
      ...fields,
    } as StrengthMaxView;
  }

  it('asks only for the exercises whose load is worked out from a max, each once', () => {
    expect(exercisesNeedingMax(version)).toEqual([
      { exerciseId: 'squat', name: 'Back squat' },
      { exerciseId: 'bench', name: 'Bench press' },
    ]);
  });

  it('starts from the recorded training max in the unit, else any recorded max in it', () => {
    const need = { exerciseId: 'squat', name: 'Back squat' };

    expect(maxRow(need, [recorded({})], 'Kilogram')).toEqual({
      exerciseId: 'squat',
      name: 'Back squat',
      value: 100,
      unit: 'Kilogram',
      sourceRecordId: 'max-1',
    });
    const tested = recorded({ id: 'max-2', kind: 'TestedOneRepMax', value: 120 });
    expect(maxRow(need, [tested], 'Kilogram').value).toBe(120);
    expect(maxRow(need, [tested, recorded({})], 'Kilogram').sourceRecordId).toBe('max-1');
  });

  it('leaves a row empty when nothing was recorded in that unit, and never converts', () => {
    const need = { exerciseId: 'squat', name: 'Back squat' };
    const kilograms = recorded({});
    const pounds = recorded({ id: 'max-3', unit: 'Pound', value: 220 });

    expect(maxRow(need, [pounds], 'Kilogram')).toMatchObject({ value: null, sourceRecordId: null });
    expect(maxRow(need, [kilograms], 'Pound')).toEqual({
      exerciseId: 'squat',
      name: 'Back squat',
      value: null,
      unit: 'Pound',
      sourceRecordId: null,
    });
    // With a max in each unit, each unit finds its own and 100 kg is never read as 100 lb.
    expect(maxRow(need, [kilograms, pounds], 'Pound')).toMatchObject({ value: 220, unit: 'Pound' });
  });
});

describe('assigning a program', () => {
  const values: AssignmentValues = {
    enrollmentId: 'enrollment-1',
    templateVersionId: 'version-1',
    startDate: '2026-10-12',
    loadUnit: 'Kilogram',
    loadIncrement: 2.5,
    loadRoundingMode: 'Nearest',
    maxes: [
      {
        exerciseId: 'squat',
        name: 'Back squat',
        value: 100,
        unit: 'Kilogram',
        sourceRecordId: 'max-1',
      },
    ],
  };

  it('accepts a complete assignment', () => {
    expect(assignmentErrors(values)).toEqual({});
  });

  it('says what is missing, field by field', () => {
    const errors = assignmentErrors({
      ...values,
      enrollmentId: '',
      templateVersionId: '',
      startDate: '',
      loadIncrement: 0,
      maxes: [{ ...values.maxes[0], value: null }],
    });

    expect(errors).toEqual({
      enrollmentId: ['Choose a plan.'],
      templateVersionId: ['Choose a program.'],
      startDate: ['Choose a start date.'],
      loadIncrement: ['Enter a number above 0, such as 2.5.'],
      'max:squat': ['Enter the training max for Back squat.'],
    });
  });

  it('builds the request from the form, with the recorded max it came from', () => {
    expect(assignmentRequest(values)).toEqual({
      enrollmentId: 'enrollment-1',
      templateVersionId: 'version-1',
      startDate: '2026-10-12',
      kind: 'Primary',
      loadUnit: 'Kilogram',
      loadIncrement: 2.5,
      loadRoundingMode: 'Nearest',
      workingMaxes: [
        { exerciseId: 'squat', strengthMaxRecordId: 'max-1', value: 100, unit: 'Kilogram' },
      ],
    });
  });
});

describe('changing a program', () => {
  it('needs a start date to move a program to', () => {
    expect(rescheduleErrors('2026-10-19')).toEqual([]);
    expect(rescheduleErrors('')).toEqual(['Choose the new start date.']);
  });

  it('needs a reason to cancel, within the limit', () => {
    expect(cancelReasonErrors('Client travelling')).toEqual([]);
    expect(cancelReasonErrors('   ')).toEqual(['Say why, so it is on record.']);
    expect(cancelReasonErrors('x'.repeat(501))).toEqual([
      'Keep the reason to 500 characters or fewer.',
    ]);
  });

  it('checks the weeks to build on, how many to add and the effort step', () => {
    expect(progressionErrors({ weekIds: ['w1'], iterations: 3, rpeIncrement: 0.5 })).toEqual([]);
    expect(progressionErrors({ weekIds: [], iterations: 0, rpeIncrement: 0.3 })).toEqual([
      'Choose at least one week to build on.',
      'Add between 1 and 12 weeks.',
      'The effort change must be between -2 and 2, in steps of 0.5.',
    ]);
    expect(progressionErrors({ weekIds: ['w1'], iterations: 13, rpeIncrement: -2.5 })).toHaveLength(
      2,
    );
    expect(
      progressionErrors({ weekIds: ['w1'], iterations: null, rpeIncrement: null }),
    ).toHaveLength(2);
    // A fraction of a week is not a week.
    expect(progressionErrors({ weekIds: ['w1'], iterations: 1.5, rpeIncrement: 0 })).toHaveLength(
      1,
    );
  });
});

describe('what the server answers', () => {
  const conflict = (code: string, message: string) =>
    new HttpErrorResponse({ status: 409, error: { code, message } });
  const invalid = (message: string) =>
    new HttpErrorResponse({ status: 400, error: { errors: { assignment: [message] } } });

  it('says a program overlaps another in coach words', () => {
    const error = conflict(
      'mesocycle_overlap',
      'The client already has an overlapping primary mesocycle.',
    );

    expect(programWriteError(error, 'Failed.', 'Maya')).toBe(
      'Maya already has a program on those dates. Choose other dates, or change the other program first.',
    );
  });

  it('says another change got there first', () => {
    const error = conflict('concurrency_conflict', 'Training data was changed by another request.');

    expect(programWriteError(error, 'Failed.', 'Maya')).toContain('changed somewhere else');
  });

  it('keeps the authorized server explanation of the program and dates that clash', () => {
    const message =
      'Maya already has Meso 1 from Mon 21 Sep 2026 to Sun 18 Oct 2026. Choose other dates.';
    expect(programWriteError(conflict('mesocycle_overlap', message), 'Failed.', 'Maya')).toBe(
      message,
    );
  });

  it('rewrites the known refusals about the plan, the dates, a workout and closing', () => {
    const say = (text: string) => programWriteError(invalid(text), 'Failed.', 'Maya');

    expect(say('The entire mesocycle must remain inside its training entitlement period.')).toBe(
      'These weeks run past the end of Maya’s plan.',
    );
    expect(say('The enrollment does not provide usable training entitlement.')).toBe(
      'Maya’s plan doesn’t include training on those dates.',
    );
    expect(say('A mesocycle cannot be rescheduled after a workout starts.')).toBe(
      'The dates can’t move once Maya has started a workout.',
    );
    expect(say('A mesocycle with a workout in progress cannot be cancelled.')).toBe(
      'Maya has a workout open right now. Cancel the program once it is finished.',
    );
    expect(
      say(
        'Every programmed session must be completed, or the last day must have passed, before the mesocycle closes.',
      ),
    ).toBe('The program can be closed after its last day, or once every session is done.');
    expect(say('A mesocycle with a workout in progress cannot be completed.')).toBe(
      'Maya has a workout open right now. Close the program once it is finished.',
    );
    expect(say('A planned mesocycle cannot be completed before it starts.')).toBe(
      'A program that hasn’t started can’t be closed.',
    );
    expect(say('Completed or cancelled mesocycle history is immutable.')).toBe(
      'A completed or cancelled program can’t be changed.',
    );
    expect(say('Historical sessions cannot be reprogrammed.')).toBe(
      'That session has already begun, so it can’t be swapped.',
    );
  });

  it('keeps a plain sentence the server sent, and never shows its engine words', () => {
    expect(programWriteError(invalid('Choose a later date.'), 'Failed.', 'Maya')).toBe(
      'Choose a later date.',
    );
    expect(
      programWriteError(
        invalid('The mesocycle snapshot is stale.'),
        'The change could not be saved.',
        'Maya',
      ),
    ).toBe('The change could not be saved.');
    expect(programWriteError(new Error('offline'), 'The change could not be saved.', 'Maya')).toBe(
      'The change could not be saved.',
    );
  });

  it('words a preview’s coverage message for a coach', () => {
    expect(
      coverageText(
        'The entire mesocycle must remain inside its training entitlement period.',
        'Maya',
      ),
    ).toBe('These weeks run past the end of Maya’s plan.');
    expect(coverageText(null, 'Maya')).toBe('These weeks run past the end of Maya’s plan.');
    expect(coverageText('Choose fewer weeks.', 'Maya')).toBe('Choose fewer weeks.');
  });
});
