import type {
  ExercisePrescriptionView,
  SetPrescriptionView,
  TrainingMesocycleView,
  TrainingSessionView,
  TrainingWeekView,
} from '../app/core/api/generated';

/**
 * A coach's read of one assigned program as the server sends it, for specs that need what each set
 * prescribes (the Build next block sheet). The ids follow `runningBlock()`: the block is `block-lean`
 * and its weeks `block-lean-week1` to `block-lean-week6`.
 */

export function setView(overrides: Partial<SetPrescriptionView> = {}): SetPrescriptionView {
  return {
    id: 'set',
    position: 1,
    setType: 'Normal',
    repetitionsMinimum: 5,
    repetitionsMaximum: 5,
    loadStrategy: 'None',
    directLoad: null,
    loadUnit: null,
    percentageWorkingMax: null,
    targetRpe: null,
    targetRir: null,
    exertionDisplayPreference: 'Rpe',
    restSeconds: null,
    tempo: null,
    coachNotes: null,
    workingMaxSnapshotId: null,
    unroundedRecommendedLoad: null,
    prescribedLoad: null,
    calculationStrategyKey: null,
    calculationStrategyVersion: null,
    calculationExplanation: null,
    isManualLoadOverride: false,
    ...overrides,
  };
}

/** A set whose weight the RTS chart works out from the max: 5 reps at RPE 7 on a 100 kg max is 77.5 kg. */
export function chartSet(position: number, overrides: Partial<SetPrescriptionView> = {}) {
  return setView({
    position,
    loadStrategy: 'RpeChart',
    loadUnit: 'Kilogram',
    targetRpe: 7,
    prescribedLoad: 77.5,
    ...overrides,
  });
}

export function exerciseView(
  id: string,
  name: string,
  sets: SetPrescriptionView[],
): ExercisePrescriptionView {
  return {
    id,
    exerciseId: `${id}-exercise`,
    exerciseName: name,
    position: 1,
    isMainLift: false,
    modificationPolicy: 'CoachApprovedSwap',
    coachNotes: null,
    approvedAlternativeExerciseIds: [],
    sets,
    mediaAssetIds: [],
  };
}

export function sessionView(
  id: string,
  name: string,
  exercises: ExercisePrescriptionView[],
): TrainingSessionView {
  return {
    id,
    position: 1,
    dayOffset: 0,
    scheduledDate: null,
    name,
    coachNotes: null,
    hasStarted: false,
    isCompleted: false,
    workoutExecutionId: null,
    exercises,
  };
}

export function weekView(
  id: string,
  weekNumber: number,
  sessions: TrainingSessionView[],
): TrainingWeekView {
  return {
    id,
    weekNumber,
    label: null,
    startsOn: null,
    isPublished: true,
    isVisible: true,
    unlockDate: null,
    sessions,
  };
}

/** One session on a day of a program, with a single RTS-chart squat set. */
export function datedSession(
  id: string,
  name: string,
  dayOffset: number,
  scheduledDate: string,
  state: Partial<TrainingSessionView> = {},
): TrainingSessionView {
  return {
    ...sessionView(id, name, [exerciseView(`${id}-squat`, 'Back squat', [chartSet(1)])]),
    dayOffset,
    position: dayOffset,
    scheduledDate,
    ...state,
  };
}

/**
 * Three weeks from Mon 28 Sep, read on Wed 7 Oct (P3b): week 1 is past (one done, two not), week 2
 * has Monday gone and today's and Friday's still to come, week 3 is all to come.
 */
export function pastAndComingProgram(): TrainingMesocycleView {
  return leanProgram({
    startDate: '2026-09-28',
    endDateExclusive: '2026-10-19',
    weeks: [
      weekView('w1', 1, [
        datedSession('w1-mon', 'Lower A', 0, '2026-09-28', { hasStarted: true, isCompleted: true }),
        datedSession('w1-wed', 'Upper', 2, '2026-09-30'),
        datedSession('w1-fri', 'Lower B', 4, '2026-10-02'),
      ]),
      weekView('w2', 2, [
        datedSession('w2-mon', 'Lower A', 0, '2026-10-05'),
        datedSession('w2-wed', 'Upper', 2, '2026-10-07'),
        datedSession('w2-fri', 'Lower B', 4, '2026-10-09'),
      ]),
      weekView('w3', 3, [
        datedSession('w3-mon', 'Lower A', 0, '2026-10-12'),
        datedSession('w3-wed', 'Upper', 2, '2026-10-14'),
        datedSession('w3-fri', 'Lower B', 4, '2026-10-16'),
      ]),
    ],
  });
}

/** Six weeks of one lower-body session: a warm-up, an RTS-chart squat set and a typed bench weight. */
export function leanProgram(overrides: Partial<TrainingMesocycleView> = {}): TrainingMesocycleView {
  const weeks = [1, 2, 3, 4, 5, 6].map((number) =>
    weekView(`block-lean-week${number}`, number, [
      sessionView(`block-lean-s${number}`, 'Lower A', [
        exerciseView(`squat-${number}`, 'Back squat', [
          setView({
            position: 1,
            setType: 'WarmUp',
            loadStrategy: 'Direct',
            loadUnit: 'Kilogram',
            directLoad: 60,
            prescribedLoad: 60,
            targetRpe: 6,
          }),
          chartSet(2),
        ]),
        exerciseView(`bench-${number}`, 'Bench press', [
          setView({
            position: 1,
            loadStrategy: 'Direct',
            loadUnit: 'Kilogram',
            directLoad: 100,
            prescribedLoad: 100,
            targetRpe: 7,
          }),
          setView({
            position: 2,
            loadStrategy: 'PercentageWorkingMax',
            loadUnit: 'Kilogram',
            percentageWorkingMax: 70,
            prescribedLoad: 70,
          }),
        ]),
      ]),
    ]),
  );
  return {
    id: 'block-lean',
    clientProfileId: 'maya',
    enrollmentId: 'plan-1',
    sourceTemplateId: 'template-1',
    sourceTemplateVersionId: 'template-1-v1',
    name: 'Lean & Strong',
    startDate: '2026-09-14',
    endDateExclusive: '2026-10-26',
    timeZoneId: 'Asia/Beirut',
    kind: 'Primary',
    status: 'Active',
    revealAllWeeks: false,
    loadUnit: 'Kilogram',
    loadIncrement: 2.5,
    loadRoundingMode: 'Nearest',
    workingMaxes: [],
    weeks,
    lifecycle: [],
    version: 4,
    ...overrides,
  };
}
