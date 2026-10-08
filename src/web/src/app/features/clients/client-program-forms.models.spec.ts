import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import type { ClientEnrollment } from '../../core/api/api.models';
import type {
  PreviousProgramMaxesView,
  ProgramTemplateSummary,
  ProgramTemplateVersionView,
  ProgressionPreviewView,
  StrengthMaxView,
} from '../../core/api/generated';
import {
  chartSet,
  exerciseView,
  leanProgram,
  sessionView,
  setView,
  weekView,
} from '../../../testing/mesocycle-fixtures';
import {
  assignmentErrors,
  assignmentRequest,
  cancelReasonErrors,
  copiesThatFit,
  coverageText,
  defaultStartDate,
  exercisesNeedingMax,
  hasProgressionProblems,
  lastDayOf,
  maxRow,
  nextBlockFormula,
  planChoices,
  previewWeeks,
  programChoices,
  programNameErrors,
  programWriteError,
  progressionErrors,
  rescheduleErrors,
  runSummary,
  stepReach,
  withMaxMode,
  withSuggestedMax,
  withTypedMax,
  type AssignmentValues,
  type ProgressionValues,
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
      {
        versionId: 'fbr-2',
        label: 'Full Body Reset · 6 weeks',
        weekCount: 6,
        name: 'Full Body Reset',
      },
      { versionId: 'ls-1', label: 'Lean & Strong · 1 week', weekCount: 1, name: 'Lean & Strong' },
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
      { exerciseId: 'squat', name: 'Back squat', anchor: null },
      { exerciseId: 'bench', name: 'Bench press', anchor: null },
    ]);
  });

  it('tells which set week 1’s weight would be read from, when the chart covers one', () => {
    const week = (sets: object[]) =>
      ({
        weeks: [
          {
            weekNumber: 1,
            sessions: [
              {
                dayOffset: 0,
                exercises: [{ exerciseId: 'squat', exerciseName: 'Back squat', position: 1, sets }],
              },
            ],
          },
        ],
      }) as unknown as ProgramTemplateVersionView;
    const set = (position: number, fields: object) => ({
      position,
      setType: 'Normal',
      loadStrategy: 'RpeChart',
      repetitionsMaximum: 5,
      targetRpe: 7,
      ...fields,
    });

    expect(exercisesNeedingMax(week([set(1, {})]))[0].anchor).toEqual({ repetitions: 5, rpe: 7 });
    // A warm-up never counts, nor a set the chart does not cover: the next one does.
    expect(
      exercisesNeedingMax(
        week([
          set(1, { setType: 'WarmUp' }),
          set(2, { targetRpe: 6 }),
          set(3, { repetitionsMaximum: 3, targetRpe: 8.5 }),
        ]),
      )[0].anchor,
    ).toEqual({ repetitions: 3, rpe: 8.5 });
    expect(exercisesNeedingMax(week([set(1, { targetRpe: 6 })]))[0].anchor).toBeNull();
  });

  it('starts from the recorded training max in the unit, else any recorded max in it', () => {
    const need = { exerciseId: 'squat', name: 'Back squat' };

    expect(maxRow(need, [recorded({})], 'Kilogram')).toEqual({
      exerciseId: 'squat',
      name: 'Back squat',
      value: 100,
      unit: 'Kilogram',
      sourceRecordId: 'max-1',
      mode: 'number',
      weekOneWeight: null,
      anchor: null,
      carriedFromMaxId: null,
      loggedSetId: null,
      previous: null,
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
      mode: 'number',
      weekOneWeight: null,
      anchor: null,
      carriedFromMaxId: null,
      loggedSetId: null,
      previous: null,
    });
    // With a max in each unit, each unit finds its own and 100 kg is never read as 100 lb.
    expect(maxRow(need, [kilograms, pounds], 'Pound')).toMatchObject({ value: 220, unit: 'Pound' });
  });

  describe('from the latest program (STR-014)', () => {
    const need = { exerciseId: 'squat', name: 'Back squat' };
    const previous: PreviousProgramMaxesView = {
      mesocycleId: 'block-old',
      programName: 'Phase 1',
      lastDay: '2026-09-30',
      loadUnit: 'Kilogram',
      maxes: [
        {
          exerciseId: 'squat',
          exerciseName: 'Back squat',
          maxId: 'snap-1',
          value: 105,
          unit: 'Kilogram',
          setOn: '2026-09-20',
          suggestion: {
            value: 110.974,
            unit: 'Kilogram',
            basis: {
              load: 90,
              repetitions: 5,
              rpe: 8,
              methodKey: 'BestLoggedSet',
              methodVersion: '1.0',
              loggedSet: {
                setPerformanceId: 'set-9',
                weekNumber: 4,
                performedOn: '2026-09-28',
                sessionName: 'Lower A',
              },
            },
            explanation: 'Best logged set v1.',
          },
        },
      ],
    };

    it('starts where the latest program left a lift, unless a max recorded since is newer', () => {
      const older = recorded({ effectiveDate: '2026-09-01' });
      const newer = recorded({ effectiveDate: '2026-09-25' });

      expect(maxRow(need, [older], 'Kilogram', previous)).toMatchObject({
        value: 105,
        sourceRecordId: null,
        carriedFromMaxId: 'snap-1',
        loggedSetId: null,
        previous: { maxId: 'snap-1', programName: 'Phase 1', suggestion: { value: 110.974 } },
      });
      expect(maxRow(need, [], 'Kilogram', previous)).toMatchObject({ value: 105 });
      expect(maxRow(need, [newer], 'Kilogram', previous)).toMatchObject({
        value: 100,
        sourceRecordId: 'max-1',
        carriedFromMaxId: null,
        previous: { maxId: 'snap-1' },
      });
      // Kilograms are never read as pounds.
      expect(maxRow(need, [], 'Pound', previous)).toMatchObject({ value: null, previous: null });
    });

    it('takes the suggestion as the set alone, and a typed number as the coach’s own', () => {
      const carried = maxRow(need, [], 'Kilogram', previous);
      const suggested = withSuggestedMax(carried);

      expect(suggested).toMatchObject({
        value: 110.974,
        carriedFromMaxId: null,
        sourceRecordId: null,
        loggedSetId: 'set-9',
      });
      expect(withTypedMax(suggested, 112.5)).toMatchObject({
        value: 112.5,
        carriedFromMaxId: null,
        loggedSetId: null,
      });
      // Week 1's weight is another source: choosing it drops the suggestion.
      expect(
        withMaxMode({ ...suggested, anchor: { repetitions: 5, rpe: 8 } }, 'weekOne'),
      ).toMatchObject({
        mode: 'weekOne',
        loggedSetId: null,
      });
      // A lift with nothing suggested stays as it was.
      expect(withSuggestedMax(maxRow(need, [], 'Kilogram'))).toMatchObject({ loggedSetId: null });
    });

    it('sends a carried max with its number and a suggestion with its set only', () => {
      const values = (row: ReturnType<typeof maxRow>): AssignmentValues => ({
        enrollmentId: 'enrollment-1',
        templateVersionId: 'version-1',
        startDate: '2026-10-12',
        loadUnit: 'Kilogram',
        loadIncrement: 2.5,
        loadRoundingMode: 'Nearest',
        maxes: [row],
      });
      const carried = maxRow(need, [], 'Kilogram', previous);

      expect(assignmentRequest(values(carried)).workingMaxes).toEqual([
        {
          exerciseId: 'squat',
          strengthMaxRecordId: null,
          value: 105,
          unit: 'Kilogram',
          carriedFromMaxId: 'snap-1',
        },
      ]);
      expect(assignmentRequest(values(withSuggestedMax(carried))).workingMaxes).toEqual([
        {
          exerciseId: 'squat',
          strengthMaxRecordId: null,
          value: null,
          unit: 'Kilogram',
          loggedSetId: 'set-9',
        },
      ]);
      expect(assignmentErrors(values(withSuggestedMax(carried)))).toEqual({});
    });
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
        mode: 'number',
        weekOneWeight: null,
        anchor: { repetitions: 5, rpe: 7 },
      },
    ],
  };

  it('accepts a complete assignment', () => {
    expect(assignmentErrors(values)).toEqual({});
  });

  it('works a max out from week 1’s weight when the coach chooses it, and sends only that', () => {
    const fromWeekOne: AssignmentValues = {
      ...values,
      name: '  Peaking block  ',
      maxes: [{ ...values.maxes[0], mode: 'weekOne', weekOneWeight: 110 }],
    };

    expect(assignmentErrors(fromWeekOne)).toEqual({});
    expect(assignmentRequest(fromWeekOne).workingMaxes).toEqual([
      {
        exerciseId: 'squat',
        strengthMaxRecordId: null,
        value: null,
        unit: 'Kilogram',
        weekOneWeight: 110,
      },
    ]);
    expect(assignmentRequest(fromWeekOne).name).toBe('Peaking block');
    // The typed number is not sent beside it, and no name is sent when none was given.
    expect(assignmentRequest(values)).not.toHaveProperty('name');
    expect(
      assignmentErrors({
        ...fromWeekOne,
        maxes: [{ ...fromWeekOne.maxes[0], weekOneWeight: null }],
      }),
    ).toEqual({ 'max:squat': ['Enter the weight for Back squat in week 1.'] });
  });

  it('keeps the program name within the limit and clears the other way when the mode changes', () => {
    expect(assignmentErrors({ ...values, name: 'x'.repeat(161) })['name']).toEqual([
      'Keep the name to 160 characters or fewer.',
    ]);
    expect(programNameErrors('')).toEqual(['Give the program a name.']);
    expect(programNameErrors('x'.repeat(160))).toEqual([]);

    const typed = { ...values.maxes[0], weekOneWeight: 99 };
    expect(withMaxMode(typed, 'weekOne')).toMatchObject({ mode: 'weekOne', weekOneWeight: null });
    // A lift whose week 1 has nothing the chart covers cannot be switched to it.
    expect(withMaxMode({ ...typed, anchor: null }, 'weekOne').mode).toBe('number');
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
});

describe('building the next block', () => {
  const starting: ProgressionValues = {
    weekIds: ['w6'],
    iterations: 3,
    rpeStep: 0.5,
    repetitionsStep: 0,
    percentageStep: 0,
    loadStep: 0,
  };
  const fine = { weeks: [], copies: [], rpe: [], reps: [], percentage: [], load: [] };

  it('accepts the starting steps on a chosen week', () => {
    expect(progressionErrors(starting, 12)).toEqual(fine);
    expect(hasProgressionProblems(progressionErrors(starting, 12))).toBe(false);
  });

  it('checks the weeks, the copies and each step the way the server does', () => {
    const problems = progressionErrors(
      {
        weekIds: [],
        iterations: 0,
        rpeStep: 0.3,
        repetitionsStep: 21,
        percentageStep: 50.5,
        loadStep: 500.01,
      },
      12,
    );

    expect(problems).toEqual({
      weeks: ['Choose at least one week to build on.'],
      copies: ['Choose 1 to 12 copies.'],
      rpe: ['Use -2 to 2, in steps of 0.5.'],
      reps: ['Use a whole number from -20 to 20.'],
      percentage: ['Use -50 to 50 points, with at most two decimals.'],
      load: ['Use -500 to 500, with at most two decimals.'],
    });
    expect(hasProgressionProblems(problems)).toBe(true);
  });

  it('takes the edges of every range and nothing past them', () => {
    const edge = (fields: Partial<ProgressionValues>) =>
      hasProgressionProblems(progressionErrors({ ...starting, ...fields }, 12));

    expect([-2, 2, -0.5, 0].some((rpeStep) => edge({ rpeStep }))).toBe(false);
    expect([-2.5, 2.5, 0.25].every((rpeStep) => edge({ rpeStep }))).toBe(true);
    expect([-20, 20].some((repetitionsStep) => edge({ repetitionsStep }))).toBe(false);
    expect([-21, 21, 1.5].every((repetitionsStep) => edge({ repetitionsStep }))).toBe(true);
    expect([-50, 50, 2.25].some((percentageStep) => edge({ percentageStep }))).toBe(false);
    expect([-50.5, 51, 1.005].every((percentageStep) => edge({ percentageStep }))).toBe(true);
    expect([-500, 500, 2.5].some((loadStep) => edge({ loadStep }))).toBe(false);
    expect([-500.5, 501, 1.005].every((loadStep) => edge({ loadStep }))).toBe(true);
    // A field the coach emptied is not zero.
    expect(edge({ rpeStep: null })).toBe(true);
    expect(edge({ repetitionsStep: null })).toBe(true);
    expect(edge({ percentageStep: null })).toBe(true);
    expect(edge({ loadStep: null })).toBe(true);
    expect(edge({ iterations: null })).toBe(true);
    // A fraction of a copy is not a copy.
    expect(edge({ iterations: 1.5 })).toBe(true);
  });

  it('leaves room for copies up to 12 and for no more than 52 weeks', () => {
    expect(copiesThatFit(6, 1)).toBe(12);
    expect(copiesThatFit(48, 1)).toBe(4);
    expect(copiesThatFit(50, 3)).toBe(0);
    expect(copiesThatFit(40, 3)).toBe(4);
    expect(copiesThatFit(52, 1)).toBe(0);
    expect(progressionErrors({ ...starting, iterations: 5 }, 4).copies).toEqual([
      'Choose 1 to 4 copies.',
    ]);
    expect(progressionErrors({ ...starting, iterations: 1 }, 0).copies).toEqual([
      'A program holds up to 52 weeks, and this one is full. Assign a new program to carry on.',
    ]);
  });

  it('says how many sets each step would move, and leaves warm-ups out', () => {
    const program = leanProgram();

    // Week 6: a warm-up (never moved), a chart set, a typed bench weight and a % of the max.
    expect(stepReach(program, ['block-lean-week6'])).toEqual({
      rpe: 2,
      reps: 3,
      percentage: 1,
      load: 1,
      unit: 'kg',
    });
    // Two weeks double the counts; none says nothing moves.
    expect(stepReach(program, ['block-lean-week5', 'block-lean-week6']).rpe).toBe(4);
    expect(stepReach(program, [])).toEqual({ rpe: 0, reps: 0, percentage: 0, load: 0, unit: null });
  });

  it('counts a manual weight as a fixed one, in its own unit', () => {
    const program = leanProgram();
    const set = program.weeks[5].sessions[0].exercises[1].sets[1];
    program.weeks[5].sessions[0].exercises[1].sets[1] = {
      ...set,
      loadStrategy: 'Direct',
      isManualLoadOverride: true,
      loadUnit: 'Pound',
      percentageWorkingMax: null,
    };

    expect(stepReach(program, ['block-lean-week6'])).toMatchObject({
      percentage: 0,
      load: 2,
      unit: 'kg / lb',
    });
  });

  it('names the formula the chosen weeks use for sets set by RPE', () => {
    const program = leanProgram();
    expect(nextBlockFormula(program, ['block-lean-week6'])).toBe('RpeChart');

    const curve = leanProgram();
    curve.weeks[5].sessions[0].exercises[0].sets[1] = chartSet(2, {
      loadStrategy: 'RpeBasedEpley',
    });
    expect(nextBlockFormula(curve, ['block-lean-week6'])).toBe('RpeBasedEpley');
    expect(nextBlockFormula(curve, ['block-lean-week5', 'block-lean-week6'])).toBe('mixed');
    expect(nextBlockFormula(curve, [])).toBeNull();

    const typed = leanProgram();
    typed.weeks[5].sessions[0].exercises[0].sets[1] = setView({ position: 2 });
    expect(nextBlockFormula(typed, ['block-lean-week6'])).toBeNull();
  });

  describe('the preview', () => {
    // Round by round: the chosen weeks once, then once again, so week 5 and 6 give 7, 8, 9, 10.
    function previewOf(weeks: { number: number; load: number; rpe: number }[]) {
      return {
        previewHash: 'hash',
        transformKey: 'WeekStep',
        transformVersion: '1.0',
        resultingWeekCount: 6 + weeks.length,
        resultingEndDateExclusive: '2026-12-07',
        isInsideTrainingCoverage: true,
        coverageMessage: null,
        generatedWeeks: weeks.map((week) =>
          weekView(`new-${week.number}`, week.number, [
            sessionView(`new-s${week.number}`, 'Lower A', [
              exerciseView(`new-squat-${week.number}`, 'Back squat', [
                setView({
                  position: 1,
                  setType: 'WarmUp',
                  loadStrategy: 'Direct',
                  loadUnit: 'Kilogram',
                  directLoad: 60,
                  prescribedLoad: 60,
                  targetRpe: 6,
                }),
                chartSet(2, { prescribedLoad: week.load, targetRpe: week.rpe }),
              ]),
            ]),
          ]),
        ),
      } as ProgressionPreviewView;
    }

    it('marks a set that differs from the week its copy builds on, and not one that is the same', () => {
      const program = leanProgram();
      const result = previewOf([
        { number: 7, load: 80, rpe: 7.5 },
        { number: 8, load: 82.5, rpe: 8 },
      ]);

      const [seven, eight] = previewWeeks(
        result,
        program,
        ['block-lean-week6'],
        'Kilogram',
        'en-US',
      );

      expect(seven.number).toBe(7);
      // Told only when several weeks were chosen and it could be any of them.
      expect(seven.from).toBeNull();
      const squat = seven.sessions[0].exercises[0];
      expect(squat.name).toBe('Back squat');
      expect(squat.sets).toEqual([
        { text: '5 reps · 60 kg · RPE 6', changed: false },
        { text: '5 reps · 80 kg · RPE 7.5', changed: true },
      ]);
      // Week 8 is read against week 7, not against the week they all started from.
      expect(eight.sessions[0].exercises[0].sets.map((set) => set.changed)).toEqual([false, true]);
    });

    it('says which chosen week each new week builds on, round by round', () => {
      const program = leanProgram();
      const result = previewOf([
        { number: 7, load: 80, rpe: 7.5 },
        { number: 8, load: 80, rpe: 7.5 },
        { number: 9, load: 82.5, rpe: 8 },
        { number: 10, load: 82.5, rpe: 8 },
      ]);

      const weeks = previewWeeks(
        result,
        program,
        ['block-lean-week6', 'block-lean-week5'],
        'Kilogram',
        'en-US',
      );

      expect(weeks.map((week) => [week.number, week.from])).toEqual([
        [7, 5],
        [8, 6],
        [9, 5],
        [10, 6],
      ]);
      // Week 9 is the second round of week 5, so it is read against week 7.
      expect(weeks[2].sessions[0].exercises[0].sets[1].changed).toBe(true);
      expect(weeks[3].sessions[0].exercises[0].sets[1].changed).toBe(true);
    });

    it('shows the weeks without marks while the program is not read yet', () => {
      const result = previewOf([{ number: 7, load: 80, rpe: 7.5 }]);

      const [week] = previewWeeks(result, null, ['block-lean-week6'], 'Kilogram', 'en-US');

      expect(week.from).toBeNull();
      expect(week.sessions[0].exercises[0].sets.map((set) => set.changed)).toEqual([false, false]);
    });
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

  it('says a training max update went stale in plain words, not the engine’s', () => {
    expect(
      programWriteError(
        conflict(
          'training_maxes_preview_changed',
          'The new weights no longer match the ones you reviewed. Preview them again before applying.',
        ),
        'Failed.',
        'Maya',
      ),
    ).toBe('The new weights changed since you looked at them. Show them again, then update.');
    expect(
      programWriteError(
        conflict('training_maxes_conflict', 'The program changed after this update was prepared.'),
        'Failed.',
        'Maya',
      ),
    ).toBe(
      'This program changed since you opened this. Close it and open it again to see the latest, then try again.',
    );
  });

  it('says a block that was changed after it was previewed in coach words', () => {
    // A stale version is refused while the block is worked out, so it arrives as a conflict, not as
    // the database's concurrency error.
    expect(
      programWriteError(
        conflict(
          'progression_conflict',
          'The mesocycle changed after this progression request was prepared.',
        ),
        'Failed.',
        'Maya',
      ),
    ).toBe(
      'This program changed since you opened this. Close it and open it again to see the latest, then try again.',
    );
    expect(
      programWriteError(
        conflict(
          'progression_preview_changed',
          'The progression no longer matches the reviewed preview. Generate a new preview before applying.',
        ),
        'Failed.',
        'Maya',
      ),
    ).toBe('The new weeks changed since you looked at them. Preview them again, then add them.');
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
