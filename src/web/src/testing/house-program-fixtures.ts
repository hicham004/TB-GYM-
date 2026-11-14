import type {
  HousePlanAskView,
  HousePlanOfferView,
  HousePlansView,
  HouseProgramMaxView,
  HouseProgramPassView,
  HouseProgramRunningView,
  HouseProgramSampleSessionView,
  HouseProgramStartedView,
  HouseProgramsView,
  HouseProgramView,
  StrengthMaxView,
} from '../app/core/api/generated';

/**
 * TB Gym's programs as a self-directed trainee of the house reads them (notes plan N9c4), read on Sat
 * 14 Nov 2026, the house's day. "Strength Base" is a run of two blocks: block 1 runs two weeks, block 2
 * one; "Powerbuilding 6" runs six weeks, longer than a four-week Pro+ pass. Every program's sample week
 * is Day A and Day B, three days apart.
 */
export const HOUSE_TODAY = '2026-11-14';

export const SQUAT_ID = '00000000-0000-4000-8000-00000000c501';
export const ROW_ID = '00000000-0000-4000-8000-00000000c502';
export const BENCH_ID = '00000000-0000-4000-8000-00000000c503';

export const BASE_1_LISTING = '00000000-0000-4000-8000-00000000d101';
export const BASE_2_LISTING = '00000000-0000-4000-8000-00000000d102';
export const POWER_LISTING = '00000000-0000-4000-8000-00000000d103';

const SAMPLE_WEEK: HouseProgramSampleSessionView[] = [
  {
    name: 'Day A',
    dayOffset: 0,
    exercises: [
      {
        exerciseId: SQUAT_ID,
        name: 'Back squat',
        isMainLift: true,
        sets: 3,
        repetitionsMinimum: 5,
        repetitionsMaximum: 5,
      },
      {
        exerciseId: ROW_ID,
        name: 'Barbell row',
        isMainLift: false,
        sets: '2',
        repetitionsMinimum: '8',
        repetitionsMaximum: '12',
      },
    ],
  },
  {
    name: 'Day B',
    dayOffset: '3',
    exercises: [
      {
        exerciseId: SQUAT_ID,
        name: 'Back squat',
        isMainLift: true,
        sets: 3,
        repetitionsMinimum: 5,
        repetitionsMaximum: 5,
      },
      {
        exerciseId: ROW_ID,
        name: 'Barbell row',
        isMainLift: false,
        sets: 2,
        repetitionsMinimum: 8,
        repetitionsMaximum: 12,
      },
    ],
  },
];

/** The Back squat max a program reads: none typed yet unless a test says so. */
export function programMax(overrides: Partial<HouseProgramMaxView> = {}): HouseProgramMaxView {
  return {
    exerciseId: SQUAT_ID,
    exerciseName: 'Back squat',
    unit: 'Kilogram',
    value: null,
    from: null,
    on: null,
    ...overrides,
  };
}

/** Strength Base 1 on Free: Pro+ is needed, and its Back squat has no max yet. */
export function houseProgram(overrides: Partial<HouseProgramView> = {}): HouseProgramView {
  return {
    listingId: BASE_1_LISTING,
    templateId: '00000000-0000-4000-8000-00000000e101',
    templateVersionId: '00000000-0000-4000-8000-00000000f101',
    name: 'Strength Base 1',
    description: 'Squat and row twice a week, adding a little each week.',
    suits: 'New to the barbell, two days a week.',
    runName: 'Strength Base',
    runPosition: 1,
    weeks: 2,
    loadUnit: 'Kilogram',
    sampleWeek: SAMPLE_WEEK,
    maxes: [programMax()],
    canStart: false,
    refusal: 'house_program_needs_pass',
    opensOn: null,
    lastStartDay: null,
    timesStarted: 3,
    ...overrides,
  };
}

/** Block 2 of Strength Base, one week long, which opens once block 1 has run. */
export function secondBlock(overrides: Partial<HouseProgramView> = {}): HouseProgramView {
  return houseProgram({
    listingId: BASE_2_LISTING,
    templateId: '00000000-0000-4000-8000-00000000e102',
    templateVersionId: '00000000-0000-4000-8000-00000000f102',
    name: 'Strength Base 2',
    description: null,
    suits: 'After block 1.',
    runPosition: '2',
    weeks: '1',
    ...overrides,
  });
}

/** Six weeks with no run, longer than a four-week pass. */
export function powerbuilding(overrides: Partial<HouseProgramView> = {}): HouseProgramView {
  return houseProgram({
    listingId: POWER_LISTING,
    templateId: '00000000-0000-4000-8000-00000000e103',
    templateVersionId: '00000000-0000-4000-8000-00000000f103',
    name: 'Powerbuilding 6',
    description: null,
    suits: 'Lifters with a year behind them.',
    runName: null,
    runPosition: null,
    weeks: 6,
    maxes: [programMax(), programMax({ exerciseId: BENCH_ID, exerciseName: 'Bench press' })],
    ...overrides,
  });
}

/** A four-week Pro+ pass from the house's day: its last day is Fri 11 Dec. */
export function proPass(overrides: Partial<HouseProgramPassView> = {}): HouseProgramPassView {
  return {
    enrollmentId: '00000000-0000-4000-8000-00000000aa01',
    name: 'Pro+ Programs',
    startDate: HOUSE_TODAY,
    endDateExclusive: '2026-12-12',
    ...overrides,
  };
}

/** Strength Base 1 started on the house's day: it runs to Fri 27 Nov. */
export function runningBlock(
  overrides: Partial<HouseProgramRunningView> = {},
): HouseProgramRunningView {
  return {
    programId: '00000000-0000-4000-8000-00000000bb01',
    name: 'Strength Base 1',
    startDate: HOUSE_TODAY,
    endDateExclusive: '2026-11-28',
    ...overrides,
  };
}

/** The read on Free: the three programs, each needing Pro+. */
export function housePrograms(overrides: Partial<HouseProgramsView> = {}): HouseProgramsView {
  return {
    today: HOUSE_TODAY,
    pass: null,
    running: null,
    programs: [houseProgram(), secondBlock(), powerbuilding()],
    ...overrides,
  };
}

/**
 * The read under a pass with a Back squat max typed: block 1 can start until Fri 27 Nov, block 2 waits for
 * block 1, and Powerbuilding 6 is longer than the pass.
 */
export function underPass(overrides: Partial<HouseProgramsView> = {}): HouseProgramsView {
  const typed = programMax({ value: 140, from: 'Typed', on: '2026-11-12' });
  return housePrograms({
    pass: proPass(),
    programs: [
      houseProgram({
        maxes: [typed],
        canStart: true,
        refusal: null,
        lastStartDay: '2026-11-27',
      }),
      secondBlock({
        maxes: [typed],
        refusal: 'house_program_block_not_open',
        lastStartDay: '2026-12-05',
      }),
      powerbuilding({
        maxes: [typed, programMax({ exerciseId: BENCH_ID, exerciseName: 'Bench press' })],
        refusal: 'house_program_does_not_fit',
      }),
    ],
    ...overrides,
  });
}

export function startedView(
  overrides: Partial<HouseProgramStartedView> = {},
): HouseProgramStartedView {
  return {
    programId: '00000000-0000-4000-8000-00000000bb01',
    listingId: BASE_1_LISTING,
    name: 'Strength Base 1',
    startDate: HOUSE_TODAY,
    endDateExclusive: '2026-11-28',
    ...overrides,
  };
}

/** The max `POST /api/strength/me/maxes` answers: a training max the trainee typed, dated the house's day. */
export function typedMaxView(overrides: Partial<StrengthMaxView> = {}): StrengthMaxView {
  return {
    id: '00000000-0000-4000-8000-00000000cc01',
    clientProfileId: '00000000-0000-4000-8000-00000000cc00',
    exerciseId: SQUAT_ID,
    exerciseName: 'Back squat',
    kind: 'CoachWorkingMax',
    value: 140,
    unit: 'Kilogram',
    effectiveDate: HOUSE_TODAY,
    source: 'Manual',
    methodKey: 'TraineeTyped',
    methodVersion: '1.0',
    sourceWorkoutExecutionId: null,
    note: null,
    createdAtUtc: '2026-11-14T09:00:00Z',
    ...overrides,
  };
}

/** One option of the house's Pro+ plan on sale, as `GET /api/house-plans/me` lists it. */
export function proPlusOffer(overrides: Partial<HousePlanOfferView> = {}): HousePlanOfferView {
  return {
    offerId: '00000000-0000-4000-8000-0000000000e1',
    productId: '00000000-0000-4000-8000-0000000000e0',
    tier: 'ProPlus',
    name: 'Pro+ Programs',
    description: 'TB Gym’s programs, one at a time.',
    optionLabel: '4 weeks',
    priceAmount: '47.5',
    priceCurrency: 'USD',
    durationCount: 4,
    durationUnit: 'Week',
    features: ['Training'],
    ...overrides,
  };
}

/** An ask of the Pro+ option, waiting on TB Gym. */
export function proPlusAsk(overrides: Partial<HousePlanAskView> = {}): HousePlanAskView {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    offerId: '00000000-0000-4000-8000-0000000000e1',
    tier: 'ProPlus',
    planName: 'Pro+ Programs',
    optionLabel: '4 weeks',
    priceAmount: '47.5',
    priceCurrency: 'USD',
    durationCount: 4,
    durationUnit: 'Week',
    askedOn: '2026-11-13',
    state: 'Asked',
    moneySent: null,
    outcome: null,
    ...overrides,
  };
}

/** What the house sells, with asks open and Pro+ on sale unless a test says otherwise. */
export function housePlansView(overrides: Partial<HousePlansView> = {}): HousePlansView {
  return {
    today: HOUSE_TODAY,
    asksOpen: true,
    whishNumber: '+961 70 123456',
    plans: [proPlusOffer()],
    asks: [],
    ...overrides,
  };
}
