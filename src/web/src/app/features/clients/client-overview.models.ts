import type { ClientEnrollment } from '../../core/api/api.models';
import type {
  CheckInAssignmentListItem,
  DayOfWeek,
  MesocycleSummary,
  TrainingMesocycleView,
} from '../../core/api/generated';

/**
 * The client Overview's reading of data other screens already own (Figma 131:419). Everything here
 * is a pure function of server responses and the workspace's own date, so the screen never works
 * out "today" from the browser clock and every rule has a fixed test.
 */

const DAY_MS = 86_400_000;
const WEEKDAYS: readonly DayOfWeek[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** How close to its last day an active plan must be before the Overview offers a renewal. */
export const RENEWAL_PROMPT_DAYS = 14;

function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function fromDayNumber(value: number): string {
  return new Date(value * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar arithmetic on `YYYY-MM-DD` dates, never through a local-time `Date`. */
export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The workspace week containing `today`, half-open: `[start, endExclusive)`. */
export function weekContaining(
  today: string,
  weekStartsOn: DayOfWeek,
): { start: string; endExclusive: string } {
  const weekday = new Date(dayNumber(today) * DAY_MS).getUTCDay();
  const offset = (weekday - WEEKDAYS.indexOf(weekStartsOn) + 7) % 7;
  const start = addDays(today, -offset);
  return { start, endExclusive: addDays(start, 7) };
}

// ------------------------------------------------------------------------------------------------
// The client's plan (their enrollment with this workspace)
// ------------------------------------------------------------------------------------------------

function covers(enrollment: ClientEnrollment, today: string): boolean {
  return enrollment.startDate <= today && today < enrollment.endDateExclusive;
}

/**
 * The plan the header describes: the one covering today (an active one first), else the next one
 * to start, else the one that ended most recently. Cancelled plans are history, not the plan.
 */
export function currentEnrollment(
  enrollments: readonly ClientEnrollment[],
  today: string,
): ClientEnrollment | null {
  const live = enrollments.filter((item) => item.effectiveStatus !== 'Cancelled');
  const covering = live.filter((item) => covers(item, today));
  const active = covering.find((item) => item.effectiveStatus === 'Active');
  if (active) return active;
  if (covering.length > 0) return covering[0];
  const upcoming = live
    .filter((item) => item.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (upcoming.length > 0) return upcoming[0];
  const ended = [...enrollments].sort((a, b) =>
    b.endDateExclusive.localeCompare(a.endDateExclusive),
  );
  return ended[0] ?? null;
}

export interface RenewalPrompt {
  enrollment: ClientEnrollment;
  /** 0 on the plan's last day. */
  daysLeft: number;
}

/**
 * Offer a renewal when an active plan's last day is at most {@link RENEWAL_PROMPT_DAYS} away and
 * nothing already follows it: no renewal of it, and no other live plan starting when it ends.
 */
export function renewalPrompt(
  enrollments: readonly ClientEnrollment[],
  today: string,
): RenewalPrompt | null {
  const current = enrollments.find(
    (item) => item.effectiveStatus === 'Active' && covers(item, today),
  );
  if (!current) return null;
  const daysLeft = daysBetween(today, current.lastActiveDate);
  if (daysLeft < 0 || daysLeft > RENEWAL_PROMPT_DAYS) return null;
  const followed = enrollments.some(
    (item) =>
      item.id !== current.id &&
      item.effectiveStatus !== 'Cancelled' &&
      (item.renewedFromEnrollmentId === current.id ||
        (item.startDate >= current.endDateExclusive &&
          item.features.some((feature) => current.features.includes(feature)))),
  );
  return followed ? null : { enrollment: current, daysLeft };
}

// ------------------------------------------------------------------------------------------------
// Check-ins
// ------------------------------------------------------------------------------------------------

export type CheckInState =
  | { kind: 'needsReview'; item: CheckInAssignmentListItem; submittedAtUtc: string }
  | { kind: 'overdue'; item: CheckInAssignmentListItem }
  | { kind: 'due'; item: CheckInAssignmentListItem }
  | { kind: 'reviewed'; item: CheckInAssignmentListItem }
  | { kind: 'none' };

/**
 * One line about the client's check-ins, most urgent first: a submission awaiting review, then an
 * open check-in already past due, then the next one due, then the last one reviewed. It states
 * facts about the workflow only; nothing here reads, rates or compares an answer (CHK-012).
 */
export function checkInState(
  items: readonly CheckInAssignmentListItem[],
  today: string,
): CheckInState {
  const submitted = items
    .filter((item) => item.response?.status === 'Submitted' && item.response.submittedAtUtc)
    .sort((a, b) => b.response!.submittedAtUtc!.localeCompare(a.response!.submittedAtUtc!));
  if (submitted.length > 0) {
    return {
      kind: 'needsReview',
      item: submitted[0],
      submittedAtUtc: submitted[0].response!.submittedAtUtc!,
    };
  }
  const open = items
    .filter((item) => item.response === null || item.response.status === 'Draft')
    .sort((a, b) => a.assignment.dueDate.localeCompare(b.assignment.dueDate));
  const overdue = open.filter((item) => item.assignment.dueDate < today);
  if (overdue.length > 0) return { kind: 'overdue', item: overdue[overdue.length - 1] };
  if (open.length > 0) return { kind: 'due', item: open[0] };
  const reviewed = items
    .filter((item) => item.response?.status === 'Reviewed')
    .sort((a, b) =>
      (b.response!.reviewedAtUtc ?? '').localeCompare(a.response!.reviewedAtUtc ?? ''),
    );
  return reviewed.length > 0 ? { kind: 'reviewed', item: reviewed[0] } : { kind: 'none' };
}

// ------------------------------------------------------------------------------------------------
// Training
// ------------------------------------------------------------------------------------------------

export interface SessionPointer {
  name: string;
  date: string;
}

export type TrainingWeekState =
  | { kind: 'noProgram' }
  | { kind: 'betweenPrograms'; nextStartDate: string }
  | {
      kind: 'notShared' | 'shared';
      blockName: string;
      weekNumber: number | null;
      weekCount: number;
      /** The first session today that is not yet completed. */
      today: SessionPointer | null;
      /** The first uncompleted session from today on, which may be today's. */
      next: SessionPointer | null;
    };

function isLive(block: { status: string }): boolean {
  return block.status !== 'Cancelled' && block.status !== 'Completed';
}

/**
 * The block covering today, the primary one first. Only blocks that are neither cancelled nor
 * completed count, the same predicate the client's own Today read uses.
 */
export function activeBlock(
  blocks: readonly MesocycleSummary[],
  today: string,
): MesocycleSummary | null {
  const covering = blocks.filter(
    (block) => isLive(block) && block.startDate <= today && today < block.endDateExclusive,
  );
  return covering.find((block) => block.kind === 'Primary') ?? covering[0] ?? null;
}

/**
 * Where the client's training stands this week. "Not shared" means the client cannot see the
 * current week: the server's own `isVisible` (published and unlocked, TRN-006) is false for it.
 */
export function trainingWeekState(
  blocks: readonly MesocycleSummary[],
  detail: TrainingMesocycleView | null,
  today: string,
): TrainingWeekState {
  const active = activeBlock(blocks, today);
  if (active === null || detail === null || detail.id !== active.id) {
    const next = blocks
      .filter((block) => isLive(block) && block.startDate > today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    return next
      ? { kind: 'betweenPrograms', nextStartDate: next.startDate }
      : { kind: 'noProgram' };
  }

  const week = detail.weeks.find((item) => {
    const start = item.startsOn ?? addDays(detail.startDate, (Number(item.weekNumber) - 1) * 7);
    return start <= today && today < addDays(start, 7);
  });
  const upcoming = detail.weeks
    .flatMap((item) => item.sessions)
    .filter((session) => session.scheduledDate !== null && session.scheduledDate >= today)
    .filter((session) => !session.isCompleted)
    .sort(
      (a, b) =>
        a.scheduledDate!.localeCompare(b.scheduledDate!) || Number(a.position) - Number(b.position),
    )
    .map((session) => ({ name: session.name, date: session.scheduledDate! }));
  const shared = week === undefined || (week.isPublished && week.isVisible !== false);
  return {
    kind: shared ? 'shared' : 'notShared',
    blockName: detail.name,
    weekNumber: week === undefined ? null : Number(week.weekNumber),
    weekCount: detail.weeks.length,
    today: upcoming.find((session) => session.date === today) ?? null,
    next: upcoming[0] ?? null,
  };
}

// ------------------------------------------------------------------------------------------------
// Bodyweight
// ------------------------------------------------------------------------------------------------

export interface WeeklyMean {
  weekStart: string;
  value: number;
}

export interface BodyweightSummary {
  points: WeeklyMean[];
  latest: WeeklyMean | null;
  /** Latest weekly mean minus the one before it, to 0.1; null without two weeks to compare. */
  change: number | null;
}

/** Weekly means with a value, oldest first, and the change between the last two. */
export function bodyweightSummary(
  weeks: readonly { weekStart: string; displayMean: number | null }[],
): BodyweightSummary {
  const points = weeks
    .filter((week) => week.displayMean !== null)
    .map((week) => ({ weekStart: week.weekStart, value: week.displayMean! }));
  const latest = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  return {
    points,
    latest,
    change:
      latest !== null && previous !== null
        ? Math.round((latest.value - previous.value) * 10) / 10
        : null,
  };
}

/**
 * An SVG polyline for the weekly means across `weekCount` slots ending with the last point's week.
 * Missing weeks leave a gap in x rather than being squeezed out, so spacing stays honest.
 */
export function trendPath(
  points: readonly WeeklyMean[],
  firstWeekStart: string,
  weekCount: number,
  width: number,
  height: number,
  inset = 4,
): { path: string; last: { x: number; y: number } | null; min: number; max: number } {
  if (points.length === 0) return { path: '', last: null, min: 0, max: 0 };
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = weekCount > 1 ? (width - inset * 2) / (weekCount - 1) : 0;
  const coordinates = points.map((point) => {
    const index = Math.round(daysBetween(firstWeekStart, point.weekStart) / 7);
    const x = inset + index * stepX;
    const y =
      max === min ? height / 2 : inset + ((max - point.value) / span) * (height - inset * 2);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  });
  return {
    path: coordinates.map((point) => `${point.x},${point.y}`).join(' '),
    last: coordinates.at(-1) ?? null,
    min,
    max,
  };
}
