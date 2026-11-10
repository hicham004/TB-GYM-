import type {
  ClientWeightNoteView,
  LiftStanding,
  LiftStandingReasonDetail,
  LiftStandingView,
  LiftWeightsAppliedView,
  LoggedSet,
  SetStanding,
} from '../app/core/api/generated';

/**
 * Where a lift stands and what applying it wrote (notes plan N6c), as the server answers them: the leg curl's
 * three step sets in Lower A on Thu 12 Nov, judged on the server's day, Tue 10 Nov 2026.
 */
export const STANDING_TODAY = '2026-11-10';

export function loggedSet(
  setNumber: number,
  weight: number | null,
  repetitions: number | null,
  overrides: Partial<LoggedSet> = {},
): LoggedSet {
  return {
    setNumber,
    setType: 'Normal',
    repetitionsAsked: 10,
    targetRpe: null,
    prescribedWeight: null,
    prescribedUnit: null,
    isCompleted: true,
    repetitions,
    weight,
    unit: weight === null ? null : 'Kilogram',
    rpe: null,
    ...overrides,
  };
}

export function standingSet(setNumber: number, overrides: Partial<SetStanding> = {}): SetStanding {
  return {
    setPrescriptionId: `set-${setNumber}`,
    setNumber,
    move: 'StepUp',
    weight: 17,
    currentWeight: 15,
    unit: 'Kilogram',
    step: 2,
    note: 'None',
    ...overrides,
  };
}

export function standingReason(
  overrides: Partial<LiftStandingReasonDetail> = {},
): LiftStandingReasonDetail {
  return {
    kind: 'EverySetDone',
    day: '2026-11-05',
    setNumber: null,
    repetitions: null,
    repetitionsAsked: null,
    rpe: null,
    targetRpe: null,
    weight: null,
    earlierWeight: null,
    unit: null,
    workoutExecutionId: null,
    ...overrides,
  };
}

/** Every set done at 15 kg on Thu 5 Nov: 17 kg next time on each of the three sets, from 15 kg now. */
export function liftStanding(
  standing: Partial<LiftStanding> = {},
  overrides: Partial<LiftStandingView> = {},
): LiftStandingView {
  return {
    ruleKey: 'LastTimeStep',
    ruleVersion: 1,
    mesocycleId: 'block-1',
    sessionId: 'session-2',
    sessionName: 'Lower A',
    sessionDate: '2026-11-12',
    exercisePrescriptionId: 'prescription-1',
    exerciseId: 'leg-curl',
    exerciseName: 'Seated Leg Curl',
    occurrence: 1,
    exertionDisplay: 'Rpe',
    standing: {
      outcome: 'StepUp',
      reason: standingReason(),
      lastTime: {
        workoutExecutionId: 'workout-1',
        day: '2026-11-05',
        sets: [loggedSet(1, 15, 10), loggedSet(2, 15, 10), loggedSet(3, 15, 10)],
      },
      sets: [standingSet(1), standingSet(2), standingSet(3)],
      judgedOn: STANDING_TODAY,
      ...standing,
    },
    ...overrides,
  };
}

/** What the server answers once the given lifts are applied, each set to its standing's weight. */
export function liftWeightsApplied(views: readonly LiftStandingView[]): LiftWeightsAppliedView {
  return {
    clientProfileId: 'client-1',
    lifts: views.map((view, index) => ({
      applicationId: `application-${index + 1}`,
      mesocycleId: view.mesocycleId,
      sessionId: view.sessionId,
      sessionName: view.sessionName,
      sessionDate: view.sessionDate,
      exercisePrescriptionId: view.exercisePrescriptionId,
      exerciseId: view.exerciseId,
      exerciseName: view.exerciseName,
      sets: view.standing.sets
        .filter(
          (set) => set.move !== 'Unchanged' && Number(set.weight) !== Number(set.currentWeight),
        )
        .map((set) => ({
          setPrescriptionId: set.setPrescriptionId,
          setNumber: set.setNumber,
          move: set.move,
          weightBefore: set.currentWeight,
          weightAfter: set.weight as number,
          unit: set.unit,
          step: set.step,
        })),
      appliedAtUtc: '2026-11-10T10:00:00Z',
    })),
  };
}

/** The client's line: up 2 kg on each of three working sets of 10, done on Thu 5 Nov. */
export function weightNote(overrides: Partial<ClientWeightNoteView> = {}): ClientWeightNoteView {
  return {
    move: 'StepUp',
    increases: [2, 2, 2],
    unit: 'Kilogram',
    lastTimeDay: '2026-11-05',
    workingSets: 3,
    repetitionsAsked: 10,
    reason: null,
    exertionDisplay: 'Rpe',
    ...overrides,
  };
}
