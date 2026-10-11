import { formatDate, formatNumber } from '@angular/common';
import type {
  CheckInAnswerView,
  CheckInAssignmentListItem,
  CheckInComparisonCell,
  CheckInComparisonView,
  CheckInQuestionType,
  CheckInQuestionView,
  CheckInResponseDetail,
  FeatureAccessReason,
  ProgressPhotoPose,
} from '../../core/api/generated';
import type { StatusPillTone } from '../../ui/status-pill';
import { isChoice } from '../checkins/checkin-builder.models';
import type { DashboardPhoto, ProgressDashboard } from '../progress/progress-dashboard.models';
import { addDays, bodyweightSummary, daysBetween } from './client-overview.models';

/**
 * A client's check-ins (C5, R4.3): the list on their record and the review of one, worked out here
 * so the two screens only draw. Nothing here scores, rates or interprets an answer (CHK-012). A row
 * says whether two recorded answers are the same, never which way one moved, by how much, or
 * whether that is good.
 */

/** Weeks of weigh-ins and photos read up to the day a check-in was sent. */
export const REVIEW_WINDOW_WEEKS = 12;

/** The server's limit on one message (MSG rules); the reply goes into the chat. */
export const MAXIMUM_REPLY_LENGTH = 2000;

export interface CheckInContext {
  /** The workspace's own date, never the browser's. */
  today: string;
  locale: string;
  /** The workspace's time zone, for the day an instant fell on. */
  timeZone: string;
  /** The signed-in person, so a review they made reads "by you". */
  userId: string | null;
}

// ------------------------------------------------------------------------------------------------
// Dates
// ------------------------------------------------------------------------------------------------

/** "Sun 4 Oct", with the year only when it is not the workspace's current one. */
export function dayLabel(date: string, context: Pick<CheckInContext, 'today' | 'locale'>): string {
  const sameYear = date.slice(0, 4) === context.today.slice(0, 4);
  return formatDate(date, sameYear ? 'EEE d MMM' : 'EEE d MMM y', context.locale);
}

/** The workspace's calendar day an instant fell on, as `YYYY-MM-DD`. */
export function localDate(instant: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    // An unknown zone name falls back to the UTC day; only a label depends on it.
    return instant.slice(0, 10);
  }
}

function daysLate(dueDate: string, sentDate: string): string {
  const days = daysBetween(dueDate, sentDate);
  return days === 1 ? $localize`1 day late` : $localize`${days}:count: days late`;
}

// ------------------------------------------------------------------------------------------------
// Access
// ------------------------------------------------------------------------------------------------

/**
 * Why a client's check-ins are not shown, in a sentence. "Not part of the plan" and "the plan has
 * ended" are different facts, and a closed list is never drawn as an empty one (CHK-011).
 */
export function checkInsClosed(reason: FeatureAccessReason, name: string): string {
  switch (reason) {
    case 'NoEntitlement':
      return $localize`Check-ins aren’t part of ${name}:name:’s plan.`;
    case 'Expired':
      return $localize`${name}:name:’s plan has ended, so their check-ins aren’t shown.`;
    case 'Cancelled':
      return $localize`${name}:name:’s plan was cancelled, so their check-ins aren’t shown.`;
    case 'Paused':
      return $localize`${name}:name:’s plan is paused, so their check-ins aren’t shown.`;
    case 'PaymentRequired':
      return $localize`${name}:name:’s plan is waiting for payment, so their check-ins aren’t shown.`;
    case 'NotStarted':
      return $localize`${name}:name:’s plan hasn’t started yet, so their check-ins aren’t shown.`;
    case 'RelationshipBlocked':
      return $localize`You have blocked ${name}:name:, so their check-ins aren’t shown.`;
    case 'MembershipInactive':
      return $localize`${name}:name: is no longer with you, so their check-ins aren’t shown.`;
    case 'PlatformBlocked':
      return $localize`${name}:name:’s access is blocked, so their check-ins aren’t shown.`;
    default:
      return $localize`${name}:name:’s check-ins aren’t available right now.`;
  }
}

// ------------------------------------------------------------------------------------------------
// The list on the client's record
// ------------------------------------------------------------------------------------------------

export interface CheckInListRow {
  id: string;
  title: string;
  /** What happened and when: "Sent Sun 4 Oct · 1 day late", "Due Sun 11 Oct". */
  line: string;
  /** Only what the group's heading does not already say: Overdue, or Started. */
  pill: { label: string; tone: StatusPillTone } | null;
  /** Only a sent check-in has answers to read; a draft is the client's own (CHK-013). */
  canOpen: boolean;
}

export interface CheckInListGroups {
  toReview: CheckInListRow[];
  /** Not sent yet: due, overdue, or started and not sent. */
  open: CheckInListRow[];
  reviewed: CheckInListRow[];
}

/** The workflow state only, in the server's order (newest due first). */
export function checkInListGroups(
  items: readonly CheckInAssignmentListItem[],
  context: CheckInContext,
): CheckInListGroups {
  const groups: CheckInListGroups = { toReview: [], open: [], reviewed: [] };
  for (const item of items) {
    const row = listRow(item, context);
    const status = item.response?.status;
    if (status === 'Submitted') groups.toReview.push(row);
    else if (status === 'Reviewed') groups.reviewed.push(row);
    else groups.open.push(row);
  }
  return groups;
}

function listRow(item: CheckInAssignmentListItem, context: CheckInContext): CheckInListRow {
  const { assignment, response } = item;
  const due = dayLabel(assignment.dueDate, context);
  const base = { id: assignment.id, title: assignment.formTitle };
  if (response && response.status !== 'Draft' && response.submittedDate) {
    const sent = $localize`Sent ${dayLabel(response.submittedDate, context)}:date:`;
    const late = response.isLate ? daysLate(assignment.dueDate, response.submittedDate) : null;
    if (response.status === 'Submitted') {
      return { ...base, line: late ? `${sent} · ${late}` : sent, pill: null, canOpen: true };
    }
    const reviewed = response.reviewedAtUtc
      ? $localize`reviewed ${dayLabel(localDate(response.reviewedAtUtc, context.timeZone), context)}:date:`
      : null;
    return {
      ...base,
      line: [sent, late, reviewed].filter(Boolean).join(' · '),
      pill: null,
      canOpen: true,
    };
  }

  const overdue = assignment.dueDate < context.today;
  const started = response?.status === 'Draft';
  return {
    ...base,
    line: overdue ? $localize`Was due ${due}:date:` : $localize`Due ${due}:date:`,
    pill: overdue
      ? { label: $localize`Overdue`, tone: 'warm' }
      : started
        ? { label: $localize`Started`, tone: 'info' }
        : null,
    canOpen: false,
  };
}

// ------------------------------------------------------------------------------------------------
// One check-in under review
// ------------------------------------------------------------------------------------------------

export type ReviewStage = 'not-started' | 'draft' | 'waiting' | 'reviewed';

export function reviewStage(detail: CheckInResponseDetail): ReviewStage {
  switch (detail.response?.status) {
    case 'Submitted':
      return 'waiting';
    case 'Reviewed':
      return 'reviewed';
    case 'Draft':
      return 'draft';
    default:
      return 'not-started';
  }
}

export interface CheckInFacts {
  /** "Sent Mon 5 Oct", or "Not sent yet". */
  headline: string;
  /** "Due Sun 4 Oct", "Was due Sun 4 Oct. Maya has started it." */
  detail: string;
  /** "1 day late"; null when it came on time or has not come. A fact, not a judgement (CHK-012). */
  late: string | null;
  /** "Reviewed Mon 5 Oct by you"; null until it is reviewed. */
  reviewed: string | null;
  pill: { label: string; tone: StatusPillTone };
}

export function checkInFacts(
  detail: CheckInResponseDetail,
  context: CheckInContext,
  name: string,
): CheckInFacts {
  const { assignment, response } = detail;
  const due = dayLabel(assignment.dueDate, context);
  const stage = reviewStage(detail);
  if ((stage === 'waiting' || stage === 'reviewed') && response?.submittedDate) {
    const reviewedLine =
      stage === 'reviewed' && response.reviewedAtUtc
        ? response.reviewedByUserId !== null && response.reviewedByUserId === context.userId
          ? $localize`Reviewed ${dayLabel(localDate(response.reviewedAtUtc, context.timeZone), context)}:date: by you`
          : $localize`Reviewed ${dayLabel(localDate(response.reviewedAtUtc, context.timeZone), context)}:date:`
        : null;
    return {
      headline: $localize`Sent ${dayLabel(response.submittedDate, context)}:date:`,
      detail: $localize`Due ${due}:date:`,
      late: response.isLate ? daysLate(assignment.dueDate, response.submittedDate) : null,
      reviewed: reviewedLine,
      pill:
        stage === 'waiting'
          ? { label: $localize`Needs review`, tone: 'warning' }
          : { label: $localize`Reviewed`, tone: 'success' },
    };
  }

  const overdue = assignment.dueDate < context.today;
  const when = overdue ? $localize`Was due ${due}:date:.` : $localize`Due ${due}:date:.`;
  return {
    headline: $localize`Not sent yet`,
    detail:
      stage === 'draft'
        ? $localize`${when}:when: ${name}:name: has started it. You’ll see the answers once it is sent.`
        : $localize`${when}:when: You’ll see the answers once ${name}:name: sends it.`,
    late: null,
    reviewed: null,
    pill: overdue
      ? { label: $localize`Overdue`, tone: 'warm' }
      : stage === 'draft'
        ? { label: $localize`Started`, tone: 'info' }
        : { label: $localize`Not sent yet`, tone: 'neutral' },
  };
}

/**
 * The check-ins this one can be read beside: the same form (one lineage, CHK-010), sent before it,
 * newest first. The first is "last time".
 */
export function earlierCheckIns(
  items: readonly CheckInAssignmentListItem[],
  detail: CheckInResponseDetail,
): CheckInAssignmentListItem[] {
  const sentAt = detail.response?.submittedAtUtc;
  if (!sentAt || reviewStage(detail) === 'draft') return [];
  const current = Date.parse(sentAt);
  return items
    .filter(
      (item) =>
        item.assignment.id !== detail.assignment.id &&
        item.assignment.formId === detail.assignment.formId &&
        (item.response?.status === 'Submitted' || item.response?.status === 'Reviewed') &&
        item.response.submittedAtUtc !== null &&
        Date.parse(item.response.submittedAtUtc) < current,
    )
    .sort(
      (first, second) =>
        Date.parse(second.response!.submittedAtUtc!) - Date.parse(first.response!.submittedAtUtc!),
    );
}

// ------------------------------------------------------------------------------------------------
// Answers, side by side
// ------------------------------------------------------------------------------------------------

export interface ScaleFigure {
  /** "8". */
  value: string;
  /** "10", or null when the scale's end is not known. */
  maximum: string | null;
  /** Where the answer sits from the scale's start (0) to its end (1), for the meter. */
  position: number | null;
}

export interface AnswerCell {
  /** What was recorded, ready to read; "8 out of 10" for a scale. Empty when left blank. */
  text: string;
  blank: boolean;
  scale: ScaleFigure | null;
}

/**
 * `both`: asked both times. `new`: asked this time only. `dropped`: asked last time only, so this
 * check-in never asked it. `only`: there is no earlier check-in to read it beside. "Not asked" and
 * "asked and left blank" are different facts and are never drawn the same (CHK-010).
 */
export type AnswerPresence = 'both' | 'new' | 'dropped' | 'only';

export interface ReviewAnswerRow {
  key: string;
  type: CheckInQuestionType;
  /** The wording this check-in asked, or for a dropped question the wording it had last time. */
  prompt: string;
  /** Last time's wording, only when it was worded differently. */
  earlierPrompt: string | null;
  helpText: string | null;
  presence: AnswerPresence;
  current: AnswerCell | null;
  earlier: AnswerCell | null;
  /** The two recorded answers are not the same. Equality only: never direction, size or merit. */
  changed: boolean;
  /** Free text, which takes the full width. */
  long: boolean;
}

/**
 * The rows of a review, in this check-in's own question order. With a comparison (this check-in
 * first, the earlier one second, so the server's alignment keeps this one's order) each row carries
 * both answers; without one, this check-in's answers stand alone.
 */
export function reviewRows(
  detail: CheckInResponseDetail,
  comparison: CheckInComparisonView | null,
  earlierQuestions: readonly CheckInQuestionView[] | null,
): ReviewAnswerRow[] {
  const currentByKey = new Map(detail.version.questions.map((q) => [q.questionKey, q]));
  const earlierByKey = new Map((earlierQuestions ?? []).map((q) => [q.questionKey, q]));

  if (comparison === null) {
    const answers = new Map((detail.response?.answers ?? []).map((a) => [a.questionId, a]));
    return [...detail.version.questions]
      .sort((first, second) => Number(first.order) - Number(second.order))
      .map((question) => ({
        key: question.questionKey,
        type: question.questionType,
        prompt: question.prompt,
        earlierPrompt: null,
        helpText: question.helpText,
        presence: 'only' as const,
        current: answerCell(answers.get(question.id) ?? null, question),
        earlier: null,
        changed: false,
        long: isLong(question.questionType),
      }));
  }

  return comparison.rows.map((row) => {
    const current = currentByKey.get(row.questionKey) ?? null;
    const earlier = earlierByKey.get(row.questionKey) ?? null;
    const asked = row.first;
    const before = row.second;
    const type = (asked ?? before)!.questionType;
    if (row.presence === 'InBoth' && asked && before) {
      return {
        key: row.questionKey,
        type,
        prompt: asked.prompt,
        earlierPrompt: before.prompt !== asked.prompt ? before.prompt : null,
        helpText: current?.helpText ?? null,
        presence: 'both' as const,
        current: cellFrom(asked, current),
        earlier: cellFrom(before, earlier),
        changed: !sameAnswer(asked.answer, before.answer),
        long: isLong(type),
      };
    }
    if (row.presence === 'OnlyInFirst' && asked) {
      return {
        key: row.questionKey,
        type,
        prompt: asked.prompt,
        earlierPrompt: null,
        helpText: current?.helpText ?? null,
        presence: 'new' as const,
        current: cellFrom(asked, current),
        earlier: null,
        changed: false,
        long: isLong(type),
      };
    }
    return {
      key: row.questionKey,
      type,
      prompt: before!.prompt,
      earlierPrompt: null,
      helpText: earlier?.helpText ?? null,
      presence: 'dropped' as const,
      current: null,
      earlier: cellFrom(before!, earlier),
      changed: false,
      long: isLong(type),
    };
  });
}

/** How many answers differ from last time, for the line above the answers. */
export function changedCount(rows: readonly ReviewAnswerRow[]): number {
  return rows.filter((row) => row.changed).length;
}

function isLong(type: CheckInQuestionType): boolean {
  return type === 'LongText';
}

function cellFrom(cell: CheckInComparisonCell, question: CheckInQuestionView | null): AnswerCell {
  return answerCell(cell.answer, question);
}

function answerCell(
  answer: CheckInAnswerView | null,
  question: CheckInQuestionView | null,
): AnswerCell {
  const type = answer?.questionType ?? question?.questionType ?? 'ShortText';
  if (type === 'NumericScale') {
    const value = numberOrNull(answer?.numericValue);
    if (value === null) return blankCell();
    const minimum = numberOrNull(question?.scaleMinimum);
    const maximum = numberOrNull(question?.scaleMaximum);
    const figure: ScaleFigure = {
      value: scaleText(value),
      maximum: maximum === null ? null : scaleText(maximum),
      position:
        minimum !== null && maximum !== null && maximum > minimum
          ? Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)))
          : null,
    };
    return {
      text:
        figure.maximum === null
          ? figure.value
          : $localize`${figure.value}:value: out of ${figure.maximum}:maximum:`,
      blank: false,
      scale: figure,
    };
  }

  if (answer === null) return blankCell();
  const text = isChoice(type)
    ? answer.choices
        .slice()
        .sort((first, second) => Number(first.order) - Number(second.order))
        .map((choice) => choice.label)
        .join(', ')
    : (answer.textValue ?? '').trim();
  return text === '' ? blankCell() : { text, blank: false, scale: null };
}

function blankCell(): AnswerCell {
  return { text: '', blank: true, scale: null };
}

/**
 * Whether two recorded answers say the same thing: the same number, the same choices (by their
 * words, since each version owns its own options), or the same text give or take case and spacing.
 */
export function sameAnswer(first: CheckInAnswerView | null, second: CheckInAnswerView | null) {
  return answerKey(first) === answerKey(second);
}

function answerKey(answer: CheckInAnswerView | null): string {
  if (answer === null) return '';
  if (isChoice(answer.questionType)) {
    return answer.choices
      .map((choice) => normalize(choice.label))
      .sort()
      .join('\u0000');
  }
  if (answer.questionType === 'NumericScale') {
    const value = numberOrNull(answer.numericValue);
    return value === null ? '' : String(value);
  }
  return normalize(answer.textValue ?? '');
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Trailing zeros from the server's fixed decimals are noise on a 1–10 scale. */
function scaleText(value: number): string {
  return String(Number(value.toFixed(2)));
}

// ------------------------------------------------------------------------------------------------
// Weight up to the day it was sent
// ------------------------------------------------------------------------------------------------

/** The dashboard window behind a review: the weeks up to and including the day it was sent. */
export function reviewWindow(sentDate: string): { from: string; toExclusive: string } {
  const toExclusive = addDays(sentDate, 1);
  return { from: addDays(toExclusive, -7 * REVIEW_WINDOW_WEEKS), toExclusive };
}

export interface ReviewWeight {
  /** The latest weekly average, "71.4". */
  value: string;
  unit: string;
  /** "↓ 0.8 kg on the week before": a fact about the averages, never judged good or bad. */
  context: string;
  lastWeighed: string | null;
  values: number[];
  summary: string;
}

export function reviewWeight(
  dashboard: ProgressDashboard,
  context: Pick<CheckInContext, 'today' | 'locale'>,
): ReviewWeight | null {
  const summary = bodyweightSummary(dashboard.bodyweight.weeks);
  if (summary.latest === null) return null;
  const unit = dashboard.displayUnit === 'Pound' ? 'lb' : 'kg';
  const amount = (value: number) => formatNumber(Math.abs(value), context.locale, '1.1-1');
  const change = summary.change;
  const lastDate = dashboard.bodyweight.latestDate;
  return {
    value: formatNumber(summary.latest.value, context.locale, '1.1-1'),
    unit,
    context:
      change === null
        ? $localize`One week of weigh-ins before this check-in`
        : change === 0
          ? $localize`No change on the week before`
          : change < 0
            ? $localize`↓ ${amount(change)}:amount: ${unit}:unit: on the week before`
            : $localize`↑ ${amount(change)}:amount: ${unit}:unit: on the week before`,
    lastWeighed: lastDate ? $localize`Last weighed ${dayLabel(lastDate, context)}:date:` : null,
    values: summary.points.map((point) => point.value),
    summary: weightTrendWords(
      summary.points.map((point) => point.value),
      unit,
      context.locale,
    ),
  };
}

/**
 * The spoken summary of the weight sparkline: where the weekly averages start and end in the window. A
 * range that reads the same at one decimal is not said as one ("from 64.0 to 64.0"), since it sits beside
 * the change on the week before, which may still move.
 */
function weightTrendWords(values: readonly number[], unit: string, locale: string): string {
  const first = formatNumber(values[0], locale, '1.1-1');
  const last = formatNumber(values[values.length - 1], locale, '1.1-1');
  if (values.length === 1) {
    return $localize`Weekly average weight in the ${REVIEW_WINDOW_WEEKS}:weeks: weeks to this check-in: ${last}:last: ${unit}:unit:, from one week of weigh-ins`;
  }
  return first === last
    ? $localize`Weekly average weight in the ${REVIEW_WINDOW_WEEKS}:weeks: weeks to this check-in, ${last}:last: ${unit}:unit: at the start and at the end`
    : $localize`Weekly average weight in the ${REVIEW_WINDOW_WEEKS}:weeks: weeks to this check-in, from ${first}:first: to ${last}:last: ${unit}:unit:`;
}

// ------------------------------------------------------------------------------------------------
// Photos, by the day they were taken
// ------------------------------------------------------------------------------------------------

export interface PosePhotos {
  pose: ProgressPhotoPose;
  label: string;
  /** The newest photo of this pose up to the day the check-in was sent. */
  latest: DashboardPhoto;
  /**
   * What it is compared with: the newest one up to the earlier check-in, else the oldest in the
   * window. Null when there is only one.
   */
  earlier: DashboardPhoto | null;
}

const POSE_ORDER: readonly ProgressPhotoPose[] = ['Front', 'Side', 'Back'];

/**
 * Progress photos are not attached to a check-in (ADR 0016 defers check-in files); the check-in's
 * photo step saves ordinary progress photos dated the day they were taken. So a review shows them
 * by date and never says they belong to the check-in.
 */
export function reviewPhotos(
  dashboard: ProgressDashboard,
  earlierSentDate: string | null,
): PosePhotos[] {
  const poses: PosePhotos[] = [];
  for (const pose of POSE_ORDER) {
    const timeline = dashboard.photos.poses.find((item) => item.pose === pose);
    // Oldest first, as the server sends them; a photo with no preview cannot be shown in a tile.
    const usable = (timeline?.photos ?? []).filter((photo) => photo.thumbnailUrl !== null);
    const latest = usable.at(-1);
    if (!latest) continue;
    const others = usable.filter((photo) => photo.id !== latest.id);
    const beforeEarlier =
      earlierSentDate === null
        ? undefined
        : others.filter((photo) => photo.photoDate <= earlierSentDate).at(-1);
    poses.push({
      pose,
      label: poseLabel(pose),
      latest,
      earlier: beforeEarlier ?? others[0] ?? null,
    });
  }
  return poses;
}

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

/** The previews a review is about to show, each needing its own short-lived grant. */
export function reviewPhotoAssetIds(poses: readonly PosePhotos[]): string[] {
  return [
    ...new Set(
      poses.flatMap((pose) =>
        [pose.latest, pose.earlier]
          .filter((photo): photo is DashboardPhoto => photo !== null)
          .map((photo) => photo.mediaAssetId),
      ),
    ),
  ];
}

// ------------------------------------------------------------------------------------------------
// The reply
// ------------------------------------------------------------------------------------------------

export type ReplyAction = 'review' | 'send-and-review' | 'send';

/**
 * The one filled button. Before review it marks the check-in reviewed, sending the reply first when
 * one is written; after review it sends the reply. Null when there is nothing left to do here.
 */
export function primaryReplyAction(
  stage: ReviewStage,
  hasReply: boolean,
  canReply: boolean,
): ReplyAction | null {
  if (stage === 'waiting') return hasReply && canReply ? 'send-and-review' : 'review';
  if (stage === 'reviewed') return canReply ? 'send' : null;
  return null;
}

/** The two things a reply can be wrong about, in the order the server reports them. */
export function replyIssues(value: string): string[] {
  const body = value.trim();
  if (body.length === 0) return [$localize`Write your reply first.`];
  return body.length > MAXIMUM_REPLY_LENGTH
    ? [$localize`A reply can be at most ${MAXIMUM_REPLY_LENGTH}:max: characters.`]
    : [];
}
