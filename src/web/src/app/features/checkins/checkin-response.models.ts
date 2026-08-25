import type {
  CheckInAnswerRequest,
  CheckInAnswerView,
  CheckInComparisonRow,
  CheckInComparisonView,
  CheckInQuestionType,
  CheckInQuestionView,
  CheckInResponseDetail,
  CheckInResponseView,
  SaveCheckInResponseRequest,
} from '../../core/api/generated';
import { CHECK_IN_LIMITS, isChoice, stepDividesRange } from './checkin-builder.models';

/** Mirrors the server's answer limits so a refusal can be explained before it happens. */
export const CHECK_IN_ANSWER_LIMITS = {
  shortTextLength: 500,
  longTextLength: 4000,
} as const;

/**
 * The client's in-progress answer to one question. A draft is deliberately allowed to be empty or to
 * hold a number the scale does not accept, exactly like the server's draft: losing what someone typed
 * because it is not yet valid would be worse than storing it.
 */
export interface AnswerDraft {
  questionId: string;
  questionKey: string;
  questionType: CheckInQuestionType;
  textValue: string;
  numericValue: number | null;
  selectedOptionIds: string[];
}

export interface ResponseDraft {
  assignmentId: string;
  status: 'Draft' | 'Submitted' | 'Reviewed';
  /** Null until the first save creates the response row on the server. */
  version: number | null;
  answers: AnswerDraft[];
}

/** One reason a submission was refused, placed against the question it belongs to. */
export interface SubmissionIssue {
  questionKey: string;
  message: string;
}

export interface SubmitGuard {
  canSubmit: boolean;
  issues: SubmissionIssue[];
}

/** The server's structured failure payload, as returned alongside a 400 from the submit route. */
export interface ServerSubmissionFailure {
  questionKey: string;
  code: string;
  message: string;
}

function toNumber(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Builds the editable draft for an assignment. Answers already saved are restored onto their
 * questions, and questions never answered start empty, so resuming shows exactly what was left
 * behind rather than a blank form.
 */
export function responseDraftFromDetail(detail: CheckInResponseDetail): ResponseDraft {
  const saved = new Map<string, CheckInAnswerView>(
    (detail.response?.answers ?? []).map((answer) => [answer.questionId, answer]),
  );

  return {
    assignmentId: detail.assignment.id,
    status: detail.response?.status ?? 'Draft',
    version: detail.response === null ? null : Number(detail.response.version),
    answers: detail.version.questions.map((question) =>
      answerDraftFor(question, saved.get(question.id)),
    ),
  };
}

function answerDraftFor(
  question: CheckInQuestionView,
  saved: CheckInAnswerView | undefined,
): AnswerDraft {
  return {
    questionId: question.id,
    questionKey: question.questionKey,
    questionType: question.questionType,
    textValue: saved?.textValue ?? '',
    numericValue: toNumber(saved?.numericValue),
    selectedOptionIds: (saved?.choices ?? []).map((choice) => choice.questionOptionId),
  };
}

export function isAnswered(answer: AnswerDraft): boolean {
  if (isChoice(answer.questionType)) {
    return answer.selectedOptionIds.length > 0;
  }

  return answer.questionType === 'NumericScale'
    ? answer.numericValue !== null
    : answer.textValue.trim().length > 0;
}

/**
 * Selecting on a single-choice question replaces the selection rather than adding to it, so the
 * "exactly one" rule cannot be broken from the UI at all. A multiple-choice question toggles.
 */
export function withSelection(answer: AnswerDraft, optionId: string): AnswerDraft {
  if (answer.questionType === 'SingleChoice') {
    return {
      ...answer,
      selectedOptionIds: answer.selectedOptionIds.includes(optionId) ? [] : [optionId],
    };
  }

  if (answer.questionType !== 'MultipleChoice') {
    return answer;
  }

  return {
    ...answer,
    selectedOptionIds: answer.selectedOptionIds.includes(optionId)
      ? answer.selectedOptionIds.filter((id) => id !== optionId)
      : [...answer.selectedOptionIds, optionId],
  };
}

/**
 * The submit guard. It runs the same rules the server runs at submission and reports all of them at
 * once, so the button explains itself instead of the client discovering the refusals one at a time.
 * The server still decides: this only avoids a round trip that was always going to fail.
 */
export function submitGuard(
  questions: readonly CheckInQuestionView[],
  draft: ResponseDraft,
): SubmitGuard {
  const byQuestion = new Map(draft.answers.map((answer) => [answer.questionId, answer]));
  const issues: SubmissionIssue[] = [];

  for (const question of questions) {
    const answer = byQuestion.get(question.id);
    if (answer === undefined || !isAnswered(answer)) {
      if (question.isRequired) {
        issues.push({
          questionKey: question.questionKey,
          message: $localize`This question has to be answered.`,
        });
      }

      continue;
    }

    issues.push(...questionIssues(question, answer));
  }

  return { canSubmit: issues.length === 0, issues };
}

function questionIssues(question: CheckInQuestionView, answer: AnswerDraft): SubmissionIssue[] {
  const issues: SubmissionIssue[] = [];
  if (question.questionType === 'SingleChoice' && answer.selectedOptionIds.length > 1) {
    issues.push({
      questionKey: question.questionKey,
      message: $localize`This question takes exactly one answer.`,
    });
  }

  if (question.questionType === 'ShortText' || question.questionType === 'LongText') {
    const limit =
      question.questionType === 'ShortText'
        ? CHECK_IN_ANSWER_LIMITS.shortTextLength
        : CHECK_IN_ANSWER_LIMITS.longTextLength;
    if (answer.textValue.trim().length > limit) {
      issues.push({
        questionKey: question.questionKey,
        message: $localize`This answer is too long.`,
      });
    }
  }

  if (question.questionType !== 'NumericScale' || answer.numericValue === null) {
    return issues;
  }

  const minimum = toNumber(question.scaleMinimum);
  const maximum = toNumber(question.scaleMaximum);
  const step = toNumber(question.scaleStep);
  if (minimum === null || maximum === null || step === null) {
    return issues;
  }

  if (answer.numericValue < minimum || answer.numericValue > maximum) {
    issues.push({
      questionKey: question.questionKey,
      message: $localize`Answer between ${minimum} and ${maximum}.`,
    });
    return issues;
  }

  // The same exact-decimal reasoning the builder uses: scale to integer precision before the
  // remainder, because a decimal step is not safe to modulo in binary floating point.
  if (!stepDividesRange(minimum, answer.numericValue, step)) {
    issues.push({
      questionKey: question.questionKey,
      message: $localize`Answer in steps of ${step} from ${minimum}.`,
    });
  }

  return issues;
}

/** Groups issues by question key so a form can place each message against its own question. */
export function issuesByQuestion(issues: readonly SubmissionIssue[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const issue of issues) {
    grouped[issue.questionKey] = [...(grouped[issue.questionKey] ?? []), issue.message];
  }

  return grouped;
}

/**
 * Surfaces the server's own refusal in the same shape as the local guard, so a failure the client
 * could not predict renders identically to one it could.
 */
export function issuesFromServer(failures: readonly ServerSubmissionFailure[]): SubmissionIssue[] {
  return failures.map((failure) => ({
    questionKey: failure.questionKey,
    message: failure.message,
  }));
}

/** Every answer is sent, including the empty ones: clearing a question is a real edit. */
export function toSaveRequest(draft: ResponseDraft): SaveCheckInResponseRequest {
  return {
    answers: draft.answers.map(toAnswerRequest),
    version: draft.version,
  };
}

function toAnswerRequest(answer: AnswerDraft): CheckInAnswerRequest {
  const text = answer.questionType === 'ShortText' || answer.questionType === 'LongText';
  return {
    questionId: answer.questionId,
    textValue: text && answer.textValue.trim().length > 0 ? answer.textValue.trim() : null,
    numericValue: answer.questionType === 'NumericScale' ? answer.numericValue : null,
    selectedOptionIds: isChoice(answer.questionType) ? answer.selectedOptionIds : [],
  };
}

export function isEditable(response: CheckInResponseView | null): boolean {
  return response === null || response.status === 'Draft';
}

/** How one comparison row should render, resolved once rather than re-derived in a template. */
export interface ComparisonRowView {
  questionKey: string;
  presence: 'InBoth' | 'OnlyInFirst' | 'OnlyInSecond';
  /** The wording each side used. A re-worded question shows both rather than one standing in. */
  firstPrompt: string | null;
  secondPrompt: string | null;
  firstAnswer: string | null;
  secondAnswer: string | null;
  /**
   * True when only one side asked this question. The other side is rendered as "not asked", never
   * as an empty answer, because those mean different things.
   */
  isOneSided: boolean;
  wordingChanged: boolean;
}

export function comparisonRows(comparison: CheckInComparisonView): ComparisonRowView[] {
  return comparison.rows.map(toComparisonRowView);
}

function toComparisonRowView(row: CheckInComparisonRow): ComparisonRowView {
  const firstPrompt = row.first?.prompt ?? null;
  const secondPrompt = row.second?.prompt ?? null;
  return {
    questionKey: row.questionKey,
    presence: row.presence,
    firstPrompt,
    secondPrompt,
    firstAnswer: row.first === null ? null : formatAnswer(row.first.answer),
    secondAnswer: row.second === null ? null : formatAnswer(row.second.answer),
    isOneSided: row.presence !== 'InBoth',
    wordingChanged:
      row.presence === 'InBoth' && firstPrompt !== null && firstPrompt !== secondPrompt,
  };
}

/**
 * Renders an answer for display. An unanswered optional question is an empty string rather than a
 * placeholder, and nothing here interprets, scores or compares the two values — a comparison shows
 * what was recorded, side by side, and draws no conclusion from it.
 */
export function formatAnswer(answer: CheckInAnswerView | null): string {
  if (answer === null) {
    return '';
  }

  if (isChoice(answer.questionType)) {
    return answer.choices.map((choice) => choice.label).join(', ');
  }

  if (answer.questionType === 'NumericScale') {
    const value = toNumber(answer.numericValue);
    return value === null ? '' : formatScaleValue(value);
  }

  return answer.textValue ?? '';
}

function formatScaleValue(value: number): string {
  // Trailing zeros from the server's fixed decimal precision are noise on a 1-10 scale.
  return String(Number(value.toFixed(CHECK_IN_LIMITS.scaleDecimals)));
}
