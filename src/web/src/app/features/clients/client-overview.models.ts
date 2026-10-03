import type { ClientEnrollment } from '../../core/api/api.models';
import type { DayOfWeek, MesocycleSummary } from '../../core/api/generated';

/**
 * What a client's page reads from data other screens already own. Everything here is a pure
 * function of server responses and the workspace's own date, so the page never works out "today"
 * from the browser clock and every rule has a fixed test.
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

/** How close to its last day an active plan must be before the header offers a renewal. */
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
// Training
// ------------------------------------------------------------------------------------------------

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
