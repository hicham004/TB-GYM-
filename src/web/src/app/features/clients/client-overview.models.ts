import type { ClientEnrollment } from '../../core/api/api.models';
import type { CoachAttentionItemView, DayOfWeek, MesocycleSummary } from '../../core/api/generated';

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

/** The one covering today (an active one first), else the next one to start. */
function livePlan(
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
  return upcoming[0] ?? null;
}

/**
 * The plan the header describes: the one covering today (an active one first), else the next one
 * to start, else the one that ended most recently. Cancelled plans are history, not the plan. A pack
 * runs beside a plan (ADR 0038), so it stands for the plan only with no coaching plan live.
 */
export function currentEnrollment(
  enrollments: readonly ClientEnrollment[],
  today: string,
): ClientEnrollment | null {
  const live =
    livePlan(
      enrollments.filter((item) => !item.sessions),
      today,
    ) ??
    livePlan(
      enrollments.filter((item) => item.sessions),
      today,
    );
  if (live) return live;
  const ended = [...enrollments].sort((a, b) =>
    b.endDateExclusive.localeCompare(a.endDateExclusive),
  );
  return ended[0] ?? null;
}

/**
 * The server's flag for a plan ending soon (CLI-018 v4: its last covered day within 14 days, today
 * counted; a renewal already paid moves that day, one still waiting for payment does not), read from
 * the client's attention items. The client's page shows it and counts no days of its own (critique B4a).
 */
export interface PlanEnding {
  /** The last covered day the flag is about. */
  readonly lastDay: string;
  /** The plan to renew, or null while a renewal of it still waits for its payment (BEB-7). */
  readonly renewId: string | null;
}

export function planEnding(
  attention: readonly CoachAttentionItemView[] | null | undefined,
): PlanEnding | null {
  const item = attention?.find((entry) => entry.kind === 'PlanEndingSoon');
  if (!item?.date) return null;
  return { lastDay: item.date, renewId: Number(item.count ?? 0) > 0 ? null : item.subjectId };
}

export interface RenewalPrompt {
  enrollment: ClientEnrollment;
  /** 0 on the plan's last day. */
  daysLeft: number;
}

/**
 * Offer a renewal while the server flags the active plan ending soon ({@link PlanEnding}) and nothing
 * already follows it: no renewal of it, and no other live plan starting when it ends.
 */
export function renewalPrompt(
  enrollments: readonly ClientEnrollment[],
  today: string,
  ending: PlanEnding | null,
): RenewalPrompt | null {
  // The plan the server flagged, which a pack running beside it is not (ADR 0038).
  const current = enrollments.find(
    (item) =>
      item.effectiveStatus === 'Active' &&
      covers(item, today) &&
      item.lastActiveDate === ending?.lastDay,
  );
  if (!current) return null;
  const daysLeft = daysBetween(today, current.lastActiveDate);
  if (daysLeft < 0) return null;
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
