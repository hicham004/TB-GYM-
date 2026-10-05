import type {
  CheckInAnswerView,
  CheckInAssignmentListItem,
  CheckInComparisonRow,
  CheckInComparisonView,
  CheckInQuestionView,
  CheckInResponseDetail,
  CheckInResponseStatus,
  ProgressDashboardView,
  ProgressPhotoPose,
} from '../app/core/api/generated';
import { LEA_ID, MAYA } from './coach-today-fixtures';

/**
 * Maya Fakhoury's weekly check-in (C5) on Thu 1 Oct 2026, the day Coach Today's fixtures use. It was
 * due Wed 30 Sep and came this morning, a day late; last week's came on time and Lea reviewed it.
 * The questions are the Atlas demo's: three 1–10 scales, one choice and two free answers.
 */
export const REVIEW_CLIENT_ID = MAYA.clientProfileId;
export const FORM_ID = 'form-weekly';
export const VERSION_ID = 'version-weekly-1';
export const CURRENT_ID = 'assignment-30-sep';
export const EARLIER_ID = 'assignment-23-sep';
export const OLDEST_ID = 'assignment-16-sep';

function scale(id: string, key: string, order: number, prompt: string, help: string | null) {
  return question(id, key, order, 'NumericScale', prompt, help, { min: 1, max: 10 });
}

function question(
  id: string,
  key: string,
  order: number,
  questionType: CheckInQuestionView['questionType'],
  prompt: string,
  helpText: string | null = null,
  range: { min: number; max: number } | null = null,
  options: readonly string[] = [],
): CheckInQuestionView {
  return {
    id,
    questionKey: key,
    order,
    questionType,
    prompt,
    helpText,
    isRequired: questionType !== 'LongText',
    scaleMinimum: range?.min ?? null,
    scaleMaximum: range?.max ?? null,
    scaleStep: range ? 1 : null,
    options: options.map((label, index) => ({
      id: `${id}-o${index + 1}`,
      order: index + 1,
      label,
    })),
  };
}

export const QUESTIONS: CheckInQuestionView[] = [
  scale(
    'q-energy',
    'energy',
    1,
    'How was your energy this week?',
    '1 is exhausted, 10 is unstoppable.',
  ),
  scale('q-sleep', 'sleep', 2, 'How well did you sleep?', null),
  scale('q-stress', 'stress', 3, 'How stressed did you feel?', '1 is calm, 10 is overwhelmed.'),
  question(
    'q-adherence',
    'adherence',
    4,
    'SingleChoice',
    'How closely did you follow your plan?',
    null,
    null,
    ['All of it', 'Most of it', 'About half', 'Not much this week'],
  ),
  question('q-win', 'win', 5, 'LongText', 'What was your biggest win this week?'),
  question('q-notes', 'notes', 6, 'LongText', 'Anything else I should know?'),
];

export interface AnswerSet {
  energy?: number;
  sleep?: number;
  stress?: number;
  adherence?: string;
  win?: string;
  notes?: string;
}

export const CURRENT_ANSWERS: AnswerSet = {
  energy: 8,
  sleep: 6,
  stress: 4,
  adherence: 'Most of it',
  win: 'Added weight on my main lift.',
  notes: 'Knee felt a bit tight on lunges, nothing sharp.',
};

export const EARLIER_ANSWERS: AnswerSet = {
  energy: 6,
  sleep: 6,
  stress: 7,
  adherence: 'All of it',
  win: 'Meal-prepped on Sunday and it saved my week.',
};

export function answers(
  set: AnswerSet,
  questions: readonly CheckInQuestionView[] = QUESTIONS,
): CheckInAnswerView[] {
  const result: CheckInAnswerView[] = [];
  for (const item of questions) {
    const value = set[item.questionKey as keyof AnswerSet];
    if (value === undefined) continue;
    const option = item.options.find((candidate) => candidate.label === value);
    result.push({
      questionId: item.id,
      questionKey: item.questionKey,
      questionType: item.questionType,
      textValue: typeof value === 'string' && !option ? value : null,
      numericValue: typeof value === 'number' ? value : null,
      choices: option
        ? [{ questionOptionId: option.id, order: option.order, label: option.label }]
        : [],
    });
  }
  return result;
}

export interface DetailOptions {
  id?: string;
  status?: CheckInResponseStatus | null;
  dueDate?: string;
  submittedAtUtc?: string | null;
  submittedDate?: string | null;
  isLate?: boolean;
  reviewedAtUtc?: string | null;
  reviewedByUserId?: string | null;
  answers?: AnswerSet;
  questions?: CheckInQuestionView[];
  versionId?: string;
  version?: number;
}

/** The coach's read of one check-in, as `GET …/assignments/{id}/response` returns it. */
export function reviewDetail(options: DetailOptions = {}): CheckInResponseDetail {
  const id = options.id ?? CURRENT_ID;
  const status = options.status === undefined ? 'Submitted' : options.status;
  const questions = options.questions ?? QUESTIONS;
  const versionId = options.versionId ?? VERSION_ID;
  const withheld = status === 'Draft';
  return {
    assignment: {
      id,
      formId: FORM_ID,
      formTitle: 'Weekly check-in',
      formVersionId: versionId,
      formVersionNumber: 1,
      clientProfileId: REVIEW_CLIENT_ID,
      dueDate: options.dueDate ?? '2026-09-30',
      assignedAtUtc: '2026-09-24T07:00:00Z',
      assignedByUserId: LEA_ID,
    },
    version: {
      id: versionId,
      formId: FORM_ID,
      formTitle: 'Weekly check-in',
      formDescription: 'Takes two minutes. Be honest: it is how I adjust your plan.',
      versionNumber: 1,
      status: 'Published',
      derivedFromVersionId: null,
      publishedAtUtc: '2026-08-01T09:00:00Z',
      publishedByUserId: LEA_ID,
      questions,
      version: 1,
    },
    response:
      status === null
        ? null
        : {
            id: `response-${id}`,
            assignmentId: id,
            clientProfileId: REVIEW_CLIENT_ID,
            status,
            submittedAtUtc: withheld
              ? null
              : options.submittedAtUtc === undefined
                ? '2026-10-01T06:40:00Z'
                : options.submittedAtUtc,
            submittedDate: withheld
              ? null
              : options.submittedDate === undefined
                ? '2026-10-01'
                : options.submittedDate,
            isLate: options.isLate ?? (status !== 'Draft' && options.dueDate === undefined),
            reviewedAtUtc: options.reviewedAtUtc ?? null,
            reviewedByUserId: options.reviewedByUserId ?? null,
            answers: withheld ? [] : answers(options.answers ?? CURRENT_ANSWERS, questions),
            version: options.version ?? 4,
            answersWithheld: withheld,
          },
  };
}

/** Last week's check-in: due and sent Wed 23 Sep, reviewed by Lea the next morning. */
export function earlierDetail(overrides: DetailOptions = {}): CheckInResponseDetail {
  return reviewDetail({
    id: EARLIER_ID,
    status: 'Reviewed',
    dueDate: '2026-09-23',
    submittedAtUtc: '2026-09-23T16:05:00Z',
    submittedDate: '2026-09-23',
    isLate: false,
    reviewedAtUtc: '2026-09-24T07:30:00Z',
    reviewedByUserId: LEA_ID,
    answers: EARLIER_ANSWERS,
    version: 6,
    ...overrides,
  });
}

/**
 * What `GET …/checkin-comparison` returns for this check-in first and an earlier one second: rows in
 * the first's order, then any question only the second asked.
 */
export function comparisonOf(
  first: CheckInResponseDetail,
  second: CheckInResponseDetail,
): CheckInComparisonView {
  const secondByKey = new Map(second.version.questions.map((item) => [item.questionKey, item]));
  const firstKeys = new Set(first.version.questions.map((item) => item.questionKey));
  const cell = (detail: CheckInResponseDetail, item: CheckInQuestionView) => ({
    questionId: item.id,
    order: item.order,
    questionType: item.questionType,
    prompt: item.prompt,
    isRequired: item.isRequired,
    answer: detail.response!.answers.find((answer) => answer.questionId === item.id) ?? null,
  });
  const rows: CheckInComparisonRow[] = first.version.questions.map((item) => {
    const counterpart = secondByKey.get(item.questionKey);
    return {
      questionKey: item.questionKey,
      presence: counterpart ? 'InBoth' : 'OnlyInFirst',
      first: cell(first, item),
      second: counterpart ? cell(second, counterpart) : null,
    };
  });
  for (const item of second.version.questions.filter((q) => !firstKeys.has(q.questionKey))) {
    rows.push({
      questionKey: item.questionKey,
      presence: 'OnlyInSecond',
      first: null,
      second: cell(second, item),
    });
  }
  const side = (detail: CheckInResponseDetail) => ({
    responseId: detail.response!.id,
    assignmentId: detail.assignment.id,
    formVersionId: detail.version.id,
    formVersionNumber: detail.version.versionNumber,
    status: detail.response!.status,
    dueDate: detail.assignment.dueDate,
    submittedDate: detail.response!.submittedDate,
    submittedAtUtc: detail.response!.submittedAtUtc,
    isLate: detail.response!.isLate,
  });
  return {
    clientProfileId: REVIEW_CLIENT_ID,
    formId: FORM_ID,
    formTitle: 'Weekly check-in',
    first: side(first),
    second: side(second),
    rows,
  };
}

/** A list row for a check-in, from the read that lists them. */
export function listItemOf(detail: CheckInResponseDetail): CheckInAssignmentListItem {
  const response = detail.response;
  return {
    assignment: detail.assignment,
    response: response
      ? {
          responseId: response.id,
          status: response.status,
          submittedDate: response.submittedDate,
          submittedAtUtc: response.submittedAtUtc,
          reviewedAtUtc: response.reviewedAtUtc,
          isLate: response.isLate,
        }
      : null,
  };
}

/** The list on Maya's record: next week's due, this one waiting, two reviewed before it. */
export function reviewList(current: CheckInResponseDetail = reviewDetail()) {
  const items = [
    listItemOf(reviewDetail({ id: 'assignment-7-oct', status: null, dueDate: '2026-10-07' })),
    listItemOf(current),
    listItemOf(earlierDetail()),
    listItemOf(
      earlierDetail({
        id: OLDEST_ID,
        dueDate: '2026-09-16',
        submittedAtUtc: '2026-09-16T18:20:00Z',
        submittedDate: '2026-09-16',
        reviewedAtUtc: '2026-09-17T08:00:00Z',
      }),
    ),
  ];
  return { clientProfileId: REVIEW_CLIENT_ID, total: items.length, items };
}

function week(weekStart: string, mean: number, observedDayCount: number) {
  const end = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86_400_000);
  return {
    weekStart,
    weekEndExclusive: end.toISOString().slice(0, 10),
    meanKilograms: mean,
    displayMean: mean,
    observedDayCount,
  };
}

function photo(id: string, date: string, pose: ProgressPhotoPose) {
  return {
    id,
    photoDate: date,
    pose,
    mediaAssetId: `asset-${id}`,
    thumbnailUrl: `/api/media/asset-${id}/content/thumbnail`,
  };
}

/** The 12 weeks of weigh-ins and photos up to the day it was sent. */
export function reviewDashboard(
  options: { photos?: boolean; weighIns?: boolean } = {},
): ProgressDashboardView {
  const photos = options.photos ?? true;
  const weighIns = options.weighIns ?? true;
  const poses = photos
    ? [
        {
          pose: 'Front' as const,
          photos: [
            photo('front-2-sep', '2026-09-02', 'Front'),
            photo('front-23-sep', '2026-09-23', 'Front'),
            photo('front-1-oct', '2026-10-01', 'Front'),
          ],
        },
        { pose: 'Side' as const, photos: [photo('side-1-oct', '2026-10-01', 'Side')] },
      ]
    : [];
  return {
    clientProfileId: REVIEW_CLIENT_ID,
    timeZoneId: 'Asia/Beirut',
    weekStartsOn: 'Monday',
    from: '2026-07-10',
    toExclusive: '2026-10-02',
    windowDayCount: 84,
    displayUnit: 'Kilogram',
    measurementDisplayUnit: 'Centimetre',
    bodyweight: {
      latest: weighIns
        ? {
            id: 'weight-1-oct',
            measurementDate: '2026-10-01',
            valueKilograms: 71.2,
            enteredValue: 71.2,
            enteredUnit: 'Kilogram',
            source: 'Client',
            recordedByUserId: null,
            recordedAtUtc: '2026-10-01T05:10:00Z',
            status: 'Active',
            version: 1,
          }
        : null,
      latestDisplayValue: weighIns ? 71.2 : null,
      change: null,
      weeks: weighIns
        ? [
            week('2026-09-07', 72.6, 6),
            week('2026-09-14', 72.2, 7),
            week('2026-09-21', 71.8, 6),
            week('2026-09-28', 71.4, 4),
          ]
        : [],
      trend: {
        isEstimate: true,
        availability: 'NotEnoughData',
        methodKey: 'BodyweightTrendEwma',
        methodVersion: '1',
        timeConstantDays: 10,
        warmupDays: 7,
        minimumSampleCount: 5,
        sampleCount: weighIns ? 23 : 0,
        windowStart: '2026-07-10',
        windowEndExclusive: '2026-10-02',
        latestEstimateKilograms: null,
        latestDisplayEstimate: null,
      },
      observedDayCount: weighIns ? 23 : 0,
    },
    measurements: { measurements: [], observedDayCount: 0 },
    photos: {
      poses,
      photoCount: poses.reduce((sum, pose) => sum + pose.photos.length, 0),
      missingThumbnailCount: 0,
      previewPhotoCount: poses.reduce((sum, pose) => sum + pose.photos.length, 0),
    },
    nutrition: {
      feature: 'Nutrition',
      availability: 'Unavailable',
      reason: 'NoEntitlement',
      context: null,
    },
    training: {
      feature: 'Training',
      availability: 'Unavailable',
      reason: 'NoEntitlement',
      context: null,
    },
  };
}
