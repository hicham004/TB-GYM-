import type {
  CheckInAssignmentListItem,
  CheckInQuestionView,
  ProgressPhotoPose,
} from '../../core/api/generated';
import { CHECK_IN_LIMITS, isChoice, stepDividesRange } from './checkin-builder.models';
import {
  isAnswered,
  submitGuard,
  type AnswerDraft,
  type ResponseDraft,
} from './checkin-response.models';

/**
 * One screen of the client's check-in (M6): a question, the optional photo step, or the review
 * before sending. Only the questions come from the coach's form; the other two are the flow's own.
 */
export type FlowStep =
  | { kind: 'question'; number: number; question: CheckInQuestionView }
  | { kind: 'photos' }
  | { kind: 'review' };

export function flowSteps(
  questions: readonly CheckInQuestionView[],
  offerPhotos: boolean,
): FlowStep[] {
  return [
    ...questions.map((question, index): FlowStep => ({
      kind: 'question',
      number: index + 1,
      question,
    })),
    ...(offerPhotos ? [{ kind: 'photos' } as const] : []),
    { kind: 'review' },
  ];
}

/**
 * Where "Continue" lands: the first question not answered yet, otherwise the review. A check-in left
 * half-way resumes where it was left rather than at question one.
 */
export function resumeStep(steps: readonly FlowStep[], draft: ResponseDraft): number {
  const answers = new Map(draft.answers.map((answer) => [answer.questionId, answer]));
  const open = steps.findIndex((step) => {
    if (step.kind !== 'question') return false;
    const answer = answers.get(step.question.id);
    return answer === undefined || !isAnswered(answer);
  });
  return open === -1 ? steps.length - 1 : open;
}

/** The step that asks `questionKey`, so a refusal on review can take the client straight to it. */
export function stepOfQuestion(steps: readonly FlowStep[], questionKey: string): number {
  return steps.findIndex(
    (step) => step.kind === 'question' && step.question.questionKey === questionKey,
  );
}

/**
 * What stands between this question and the next one, by the same rules submission applies. The
 * server's draft is lenient, but a step form that let a required answer through would only move the
 * refusal to the end, where it is further from the question it is about.
 */
export function stepIssues(question: CheckInQuestionView, draft: ResponseDraft): string[] {
  return submitGuard([question], draft)
    .issues.filter((issue) => issue.questionKey === question.questionKey)
    .map((issue) => issue.message);
}

/** A scale this long or shorter is shown as tappable numbers; a longer one gets a stepper. */
export const MAX_SCALE_CHIPS = 11;

/**
 * Every value a scale accepts, from its minimum to its maximum, or null when it is too long to show
 * as chips. The builder guarantees the step divides the range, so the maximum is always reached.
 */
export function scalePositions(question: CheckInQuestionView): number[] | null {
  const minimum = toNumber(question.scaleMinimum);
  const maximum = toNumber(question.scaleMaximum);
  const step = toNumber(question.scaleStep);
  if (minimum === null || maximum === null || step === null || step <= 0 || maximum < minimum) {
    return null;
  }

  const count = Math.round((maximum - minimum) / step) + 1;
  if (count > MAX_SCALE_CHIPS || !stepDividesRange(minimum, maximum, step)) {
    return null;
  }

  return Array.from({ length: count }, (_, index) => roundScale(minimum + index * step));
}

/**
 * One stepper press from `current`, clamped to the scale. An empty answer starts at the minimum
 * (going up) or the maximum (going down), so the first press always lands on a value the scale
 * accepts.
 */
export function stepScale(
  question: CheckInQuestionView,
  current: number | null,
  direction: 1 | -1,
): number | null {
  const minimum = toNumber(question.scaleMinimum);
  const maximum = toNumber(question.scaleMaximum);
  const step = toNumber(question.scaleStep);
  if (minimum === null || maximum === null || step === null) return current;
  if (current === null) return direction === 1 ? minimum : maximum;
  const next = roundScale(current + direction * step);
  return Math.min(maximum, Math.max(minimum, next));
}

/**
 * The answer as the review and the sent view show it, or null when it was left blank. It restates
 * what was recorded and draws no conclusion from it (CHK-012).
 */
export function answerText(
  question: CheckInQuestionView,
  answer: AnswerDraft | null,
): string | null {
  if (answer === null || !isAnswered(answer)) return null;
  if (isChoice(question.questionType)) {
    const labels = new Map(question.options.map((option) => [option.id, option.label]));
    return answer.selectedOptionIds
      .map((id) => labels.get(id) ?? '')
      .filter(Boolean)
      .join(', ');
  }

  if (question.questionType === 'NumericScale') {
    const maximum = toNumber(question.scaleMaximum);
    const value = formatScale(answer.numericValue!);
    return maximum === null ? value : $localize`${value} out of ${formatScale(maximum)}`;
  }

  return answer.textValue.trim();
}

export function answeredCount(draft: ResponseDraft): number {
  return draft.answers.filter(isAnswered).length;
}

/** Open check-ins first by due date; sent ones newest first. */
export interface CheckInHomeLists {
  open: CheckInAssignmentListItem[];
  sent: CheckInAssignmentListItem[];
}

export function homeLists(items: readonly CheckInAssignmentListItem[]): CheckInHomeLists {
  const isOpen = (item: CheckInAssignmentListItem) =>
    item.response === null || item.response.status === 'Draft';
  return {
    open: items
      .filter(isOpen)
      .sort((a, b) => a.assignment.dueDate.localeCompare(b.assignment.dueDate)),
    sent: items
      .filter((item) => !isOpen(item))
      .sort((a, b) =>
        (b.response?.submittedAtUtc ?? b.assignment.dueDate).localeCompare(
          a.response?.submittedAtUtc ?? a.assignment.dueDate,
        ),
      ),
  };
}

export const PHOTO_POSES: readonly ProgressPhotoPose[] = ['Front', 'Side', 'Back'];

export function poseLabel(pose: ProgressPhotoPose): string {
  switch (pose) {
    case 'Front':
      return $localize`Front`;
    case 'Side':
      return $localize`Side`;
    case 'Back':
      return $localize`Back`;
  }
}

/**
 * The workspace's today, read from the photo window the server chose. Its default window ends
 * (exclusively) tomorrow in the workspace's own calendar, so the day before is today there, whatever
 * the phone's clock says.
 */
export function dayBefore(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function toNumber(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function roundScale(value: number): number {
  return Number(value.toFixed(CHECK_IN_LIMITS.scaleDecimals));
}

function formatScale(value: number): string {
  return String(roundScale(value));
}
