import { formatDate, formatNumber } from '@angular/common';
import type {
  ClientSessionState,
  CoachProgramBlockView,
  CoachProgramSessionView,
  CoachProgramWeekView,
  MesocycleLifecycleEventView,
  MesocycleStatus,
  SetPrescriptionView,
  TrainingLoadUnit,
  TrainingSessionView,
} from '../../core/api/generated';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';
import type { StatusPillTone } from '../../ui/status-pill';
import { unitLabel } from '../training/training-program.models';
import type { ClientAction } from './client-actions';
import { addDays } from './client-overview.models';

/**
 * A client's program in coach words (C3 Training). The server decides every fact here: which block
 * is running, the state of each session (TRN-020, TRN-022) and what has been shared. This only
 * phrases it. Workspace dates ("today", "in 5 days") are measured against the date the server sent,
 * never the browser's.
 */

export interface ProgramContext {
  locale: string;
  /** The workspace's own date, from the server. */
  today: string;
  /** The name the sentences use: "Maya sees every shared week now". */
  firstName: string;
  /** The workspace's time zone, for the day each history event happened on; the device's when unknown. */
  timeZone?: string | null;
}

function count(value: number | string): number {
  return Number(value);
}

function sessionsLabel(total: number): string {
  return total === 1 ? $localize`1 session` : $localize`${total}:count: sessions`;
}

// ------------------------------------------------------------------------------------------------
// Sessions
// ------------------------------------------------------------------------------------------------

/** What a session card says about itself; every mark also has words, never colour alone. */
export type SessionMark =
  'done' | 'progress' | 'missed' | 'today' | 'upcoming' | 'unshared' | 'closed';

export interface SessionCard {
  readonly id: string;
  readonly name: string;
  readonly date: string;
  /** "Mon 12 Oct". */
  readonly day: string;
  readonly mark: SessionMark;
  readonly markLabel: string;
  /** "4 exercises · 12 sets". */
  readonly detail: string;
  /** The client's workout when one was started; the card then shows what they did. */
  readonly workoutId: string | null;
}

function sessionMark(
  state: ClientSessionState | null,
  blockStatus: MesocycleStatus,
): { mark: SessionMark; label: string } {
  switch (state) {
    case 'Completed':
      return { mark: 'done', label: $localize`Done` };
    case 'InProgress':
      return { mark: 'progress', label: $localize`In progress` };
    case 'Missed':
      return { mark: 'missed', label: $localize`Missed` };
    case 'Today':
      return { mark: 'today', label: $localize`Today` };
    case 'Upcoming':
      return { mark: 'upcoming', label: $localize`Upcoming` };
    default:
      // No state: the client could not train it, because its week was never shared or the whole
      // block was cancelled. It is neither missed nor still to come.
      return blockStatus === 'Cancelled'
        ? { mark: 'closed', label: $localize`Cancelled` }
        : { mark: 'unshared', label: $localize`Not shared` };
  }
}

/** The tone of the pill that names a session's mark. */
export function markTone(mark: SessionMark): StatusPillTone {
  switch (mark) {
    case 'done':
      return 'success';
    case 'progress':
      return 'info';
    case 'missed':
      return 'warm';
    case 'unshared':
      return 'warning';
    default:
      return 'neutral';
  }
}

function exerciseSetDetail(exercises: number, sets: number): string {
  const exerciseText =
    exercises === 1 ? $localize`1 exercise` : $localize`${exercises}:count: exercises`;
  const setText = sets === 1 ? $localize`1 set` : $localize`${sets}:count: sets`;
  return `${exerciseText} · ${setText}`;
}

function sessionCard(
  session: CoachProgramSessionView,
  blockStatus: MesocycleStatus,
  context: ProgramContext,
): SessionCard {
  const { mark, label } = sessionMark(session.state, blockStatus);
  return {
    id: session.sessionId,
    name: session.name,
    date: session.scheduledDate,
    day: formatDate(session.scheduledDate, 'EEE d MMM', context.locale),
    mark,
    markLabel: label,
    detail: exerciseSetDetail(count(session.exerciseCount), count(session.setCount)),
    workoutId: session.workoutExecutionId,
  };
}

// ------------------------------------------------------------------------------------------------
// Weeks
// ------------------------------------------------------------------------------------------------

/** Whether the client can open the week: shared and open, shared and still locked, or not shared. */
export type ShareState = 'shared' | 'locked' | 'unshared';

export interface WeekColumn {
  readonly id: string;
  readonly number: number;
  /** "Week 3". */
  readonly title: string;
  /** "12–18 Oct". */
  readonly range: string;
  readonly isCurrent: boolean;
  readonly sessions: readonly SessionCard[];
  readonly done: number;
  readonly missed: number;
  /** "2 of 4 done" once the week has begun, else "4 sessions". */
  readonly summary: string;
  readonly share: ShareState;
  /** "Shared", "Shared · opens Thu 15 Oct" or "Not shared". */
  readonly shareLabel: string;
  /** How much of the week is done, 0 to 100, for its segment of the bar. */
  readonly fill: number;
}

function weekRange(start: string, locale: string): string {
  const last = addDays(start, 6);
  return start.slice(0, 7) === last.slice(0, 7)
    ? $localize`${formatDate(start, 'd', locale)}:from:–${formatDate(last, 'd MMM', locale)}:to:`
    : $localize`${formatDate(start, 'd MMM', locale)}:from: – ${formatDate(last, 'd MMM', locale)}:to:`;
}

function shareState(week: CoachProgramWeekView): ShareState {
  return !week.isShared ? 'unshared' : week.isVisible ? 'shared' : 'locked';
}

function weekColumn(
  week: CoachProgramWeekView,
  block: CoachProgramBlockView,
  context: ProgramContext,
): WeekColumn {
  const number = count(week.weekNumber);
  const sessions = week.sessions.map((session) => sessionCard(session, block.status, context));
  const done = sessions.filter((session) => session.mark === 'done').length;
  const missed = sessions.filter((session) => session.mark === 'missed').length;
  const isCurrent =
    block.status === 'Active' &&
    block.currentWeekNumber !== null &&
    number === count(block.currentWeekNumber);
  const begun =
    isCurrent || sessions.some((session) => ['done', 'progress', 'missed'].includes(session.mark));
  const share = shareState(week);
  return {
    id: week.id,
    number,
    title: $localize`Week ${number}:week:`,
    range: weekRange(week.startDate, context.locale),
    isCurrent,
    sessions,
    done,
    missed,
    summary:
      sessions.length === 0
        ? $localize`No sessions`
        : begun
          ? $localize`${done}:done: of ${sessions.length}:total: done`
          : sessionsLabel(sessions.length),
    share,
    shareLabel:
      share === 'unshared'
        ? $localize`Not shared`
        : share === 'locked'
          ? $localize`Shared · opens ${formatDate(week.unlockDate, 'EEE d MMM', context.locale)}:date:`
          : $localize`Shared`,
    fill: sessions.length === 0 ? 0 : Math.round((100 * done) / sessions.length),
  };
}

// ------------------------------------------------------------------------------------------------
// Blocks
// ------------------------------------------------------------------------------------------------

export interface BlockPill {
  readonly label: string;
  readonly tone: StatusPillTone;
}

export interface BlockFact {
  readonly text: string;
  /** A miss is told in the warm colour, as it is on the client's own page. */
  readonly warm: boolean;
}

/** One program block, drawn as the page's header and timeline. */
export interface BlockCard {
  readonly id: string;
  readonly name: string;
  /** The first day, `YYYY-MM-DD`: what rescheduling starts from. */
  readonly startDate: string;
  /** The last day, `YYYY-MM-DD`: after it a program with missed sessions may be closed. */
  readonly lastDay: string;
  /** The token the block's changes send back, so a stale screen conflicts instead of overwriting. */
  readonly version: number;
  readonly status: MesocycleStatus;
  /** "Week 3 of 6", "Starts Mon 12 Oct", "Completed" or "Cancelled". */
  readonly eyebrow: string;
  readonly pill: BlockPill;
  /** The dates, the sessions done and the misses, as short facts. */
  readonly facts: readonly BlockFact[];
  readonly weeks: readonly WeekColumn[];
  readonly weekCount: number;
  readonly currentWeek: number | null;
  readonly sessionCount: number;
  readonly doneCount: number;
  readonly missedCount: number;
  /** Completed or cancelled: its programming and sharing can no longer change. */
  readonly terminal: boolean;
  /**
   * Past its last day but never closed: a missed session keeps a program from completing, so it
   * stays active. Nothing about it is current any more.
   */
  readonly ended: boolean;
  readonly revealAll: boolean;
  /** A workout has been started in it, so its dates can no longer move. */
  readonly started: boolean;
  /** A workout is open right now, so it cannot be cancelled. */
  readonly inProgress: boolean;
  /** The week a phone shows first: this week while it runs, else the first. */
  readonly openWeek: number;
  /** What happened to the program, oldest first, with the coach's reason for a cancel (LOST-6). */
  readonly history: readonly HistoryRow[];
}

/** One event in a program's History fold: what happened, on which workspace day, and why. */
export interface HistoryRow {
  readonly id: string;
  /** "Assigned", "Renamed from “Strength block”", "Cancelled", "Finished · every session done". */
  readonly what: string;
  readonly day: string;
  /** The coach's own words, typed when they cancelled it; null for every other event. */
  readonly reason: string | null;
}

/**
 * A program's lifecycle (assigned, renamed, cancelled, completed) in the app's words. The server's text is
 * read only for the earlier name and the sessions not done, and a cancel shows the reason as it was typed.
 */
export function historyRows(
  events: readonly MesocycleLifecycleEventView[],
  context: ProgramContext,
): HistoryRow[] {
  return events.map((event) => ({
    id: event.id,
    what: historyWords(event),
    day: houseDay(
      dayInZone(event.occurredAtUtc, context.timeZone ?? null),
      context.locale,
      context.today,
    ),
    reason: event.eventType === 'Cancelled' ? event.reason.trim() || null : null,
  }));
}

function historyWords(event: MesocycleLifecycleEventView): string {
  switch (event.eventType) {
    case 'Assigned':
      return $localize`Assigned`;
    case 'Renamed': {
      const earlier = /^Renamed from "(.+)" to ".+"\.$/s.exec(event.reason)?.[1];
      return earlier ? $localize`Renamed from “${earlier}:name:”` : $localize`Renamed`;
    }
    case 'Cancelled':
      return $localize`Cancelled`;
    case 'Completed': {
      const notDone = /^Closed after its last day with (\d+) programmed session/.exec(
        event.reason,
      )?.[1];
      if (notDone) {
        return Number(notDone) === 1
          ? $localize`Closed after its last day · 1 session not done`
          : $localize`Closed after its last day · ${notDone}:count: sessions not done`;
      }
      return $localize`Finished · every session done`;
    }
  }
}

function dateRange(start: string, lastDay: string, context: ProgramContext): string {
  const thisYear = context.today.slice(0, 4);
  const sameYear = start.slice(0, 4) === thisYear && lastDay.slice(0, 4) === thisYear;
  const pattern = sameYear ? 'EEE d MMM' : 'd MMM y';
  return $localize`${formatDate(start, pattern, context.locale)}:from: – ${formatDate(lastDay, pattern, context.locale)}:to:`;
}

function startsOn(startDate: string, context: ProgramContext): string {
  return $localize`Starts ${formatDate(startDate, 'EEE d MMM', context.locale)}:date:`;
}

/** Running now, as opposed to active on paper after its last day. */
function isRunning(block: CoachProgramBlockView): boolean {
  return block.status === 'Active' && block.currentWeekNumber !== null;
}

function hasEnded(block: CoachProgramBlockView): boolean {
  return block.status === 'Active' && block.currentWeekNumber === null;
}

function blockStatusWords(
  block: CoachProgramBlockView,
  context: ProgramContext,
): { eyebrow: string; pill: BlockPill } {
  switch (block.status) {
    case 'Active': {
      if (hasEnded(block)) {
        const last = formatDate(addDays(block.endDateExclusive, -1), 'EEE d MMM', context.locale);
        return {
          eyebrow: $localize`Ended ${last}:date:`,
          pill: { label: $localize`Ended`, tone: 'neutral' },
        };
      }
      const weeks = count(block.weekCount);
      const week = count(block.currentWeekNumber ?? 1);
      const text = $localize`Week ${week}:week: of ${weeks}:weeks:`;
      return { eyebrow: text, pill: { label: text, tone: 'success' } };
    }
    case 'Planned': {
      const text = startsOn(block.startDate, context);
      return { eyebrow: text, pill: { label: text, tone: 'info' } };
    }
    case 'Completed':
      return {
        eyebrow: $localize`Completed`,
        pill: { label: $localize`Completed`, tone: 'neutral' },
      };
    case 'Cancelled':
      return {
        eyebrow: $localize`Cancelled`,
        pill: { label: $localize`Cancelled`, tone: 'neutral' },
      };
  }
}

export function blockCard(block: CoachProgramBlockView, context: ProgramContext): BlockCard {
  const weeks = block.weeks.map((week) => weekColumn(week, block, context));
  const sessions = block.weeks.flatMap((week) => week.sessions);
  const total = count(block.sessionCount);
  const done = count(block.completedCount);
  const missed = count(block.missedCount);
  const weekCount = count(block.weekCount);
  const status = blockStatusWords(block, context);
  const range = dateRange(block.startDate, addDays(block.endDateExclusive, -1), context);
  const progress =
    block.status === 'Planned'
      ? $localize`${weekCount}:weeks: weeks · ${sessionsLabel(total)}:sessions:`
      : total === 1
        ? $localize`${done}:done: of 1 session done`
        : $localize`${done}:done: of ${total}:total: sessions done`;
  const current = block.currentWeekNumber === null ? null : count(block.currentWeekNumber);
  return {
    id: block.id,
    name: block.name,
    startDate: block.startDate,
    lastDay: addDays(block.endDateExclusive, -1),
    version: count(block.version),
    status: block.status,
    eyebrow: status.eyebrow,
    pill: status.pill,
    facts: [
      { text: range, warm: false },
      { text: progress, warm: false },
      ...(missed > 0 ? [{ text: $localize`${missed}:count: missed`, warm: true }] : []),
    ],
    weeks,
    weekCount,
    currentWeek: current,
    sessionCount: total,
    doneCount: done,
    missedCount: missed,
    terminal: block.status === 'Completed' || block.status === 'Cancelled',
    ended: hasEnded(block),
    revealAll: block.revealAllWeeks,
    started: sessions.some((session) => session.workoutExecutionId !== null),
    inProgress: sessions.some((session) => session.state === 'InProgress'),
    openWeek: current ?? weeks[0]?.number ?? 1,
    history: historyRows(block.lifecycle ?? [], context),
  };
}

/** A block in the list of the others: enough to recognise it and open it. */
export interface BlockRow {
  readonly id: string;
  readonly name: string;
  readonly pill: BlockPill;
  readonly range: string;
  readonly summary: string;
}

export interface OtherBlocks {
  /** Planned blocks, soonest first. */
  readonly coming: readonly BlockRow[];
  /** Completed and cancelled blocks, newest first. */
  readonly earlier: readonly BlockRow[];
}

function blockRow(block: CoachProgramBlockView, context: ProgramContext): BlockRow {
  const total = count(block.sessionCount);
  const done = count(block.completedCount);
  return {
    id: block.id,
    name: block.name,
    pill: blockStatusWords(block, context).pill,
    range: dateRange(block.startDate, addDays(block.endDateExclusive, -1), context),
    summary:
      block.status === 'Planned'
        ? sessionsLabel(total)
        : total === 1
          ? $localize`${done}:done: of 1 session done`
          : $localize`${done}:done: of ${total}:total: sessions done`,
  };
}

/**
 * The block the page opens on: the one running, else the one starting soonest, else the newest that
 * ended. The server sends them newest first.
 */
export function focusBlockId(blocks: readonly CoachProgramBlockView[]): string | null {
  const running = blocks.find(isRunning);
  if (running) return running.id;
  const next = blocks
    .filter((block) => block.status === 'Planned')
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return next?.id ?? blocks[0]?.id ?? null;
}

export function otherBlocks(
  blocks: readonly CoachProgramBlockView[],
  focusId: string | null,
  context: ProgramContext,
): OtherBlocks {
  const rest = blocks.filter((block) => block.id !== focusId);
  return {
    coming: rest
      .filter((block) => block.status === 'Planned' || isRunning(block))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((block) => blockRow(block, context)),
    earlier: rest
      .filter((block) => !(block.status === 'Planned' || isRunning(block)))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map((block) => blockRow(block, context)),
  };
}

// ------------------------------------------------------------------------------------------------
// The Actions menu
// ------------------------------------------------------------------------------------------------

export type ProgramActionId =
  | 'assign'
  | 'rename'
  | 'next-block'
  | 'edit-weeks'
  | 'reschedule'
  | 'reveal-all'
  | 'reveal-weekly'
  | 'complete'
  | 'cancel';

/**
 * What a coach can do about the block in front of them. Which ones are offered only follows the
 * block's state, to spare a trip to an error; the server decides every one of them again.
 */
export function programMenu(
  block: BlockCard | null,
  canAssign: boolean,
  context: ProgramContext,
): ClientAction[] {
  const items: ClientAction[] = [];
  if (canAssign) {
    items.push({
      label: $localize`Assign program`,
      hint: $localize`Choose a program and a start date`,
      action: 'assign',
    });
  }
  if (!block || block.terminal) return items;

  // The name is the one thing about a running program that is always the coach's to change (TRN-002).
  items.push({
    label: $localize`Rename program`,
    hint: $localize`Change what it is called`,
    action: 'rename',
  });

  // A program past its last day can only be closed, or replaced by another.
  if (!block.ended) {
    items.push({
      label: $localize`Build next block`,
      hint: $localize`Add weeks that build on this one`,
      action: 'next-block',
    });
    // The weeks still to come, in the builder's grid (TRN-028); what started or passed stays locked.
    items.push({
      label: $localize`Edit weeks`,
      hint: $localize`Change the sessions still to come`,
      action: 'edit-weeks',
    });
    items.push(
      block.started
        ? {
            label: $localize`Reschedule`,
            hint: $localize`Not possible once a workout has started`,
            action: 'reschedule',
            disabled: true,
          }
        : {
            label: $localize`Reschedule`,
            hint: $localize`Move the start date`,
            action: 'reschedule',
          },
    );
    items.push(
      block.revealAll
        ? {
            label: $localize`Open weeks as they start`,
            hint: $localize`Each shared week opens on its first day`,
            action: 'reveal-weekly',
          }
        : {
            label: $localize`Open every shared week now`,
            hint: $localize`${context.firstName}:name: sees every shared week now, not only the ones that have started`,
            action: 'reveal-all',
          },
    );
  }
  if (block.status === 'Active') {
    // Closing finishes it (TRN-013): once every session is done, or after its last day with the
    // missed ones kept on record. A workout still open blocks it either way.
    const allDone = block.doneCount === block.sessionCount;
    items.push(
      block.inProgress
        ? {
            label: $localize`Close program`,
            hint: $localize`A workout is in progress`,
            action: 'complete',
            disabled: true,
          }
        : allDone || block.ended
          ? {
              label: $localize`Close program`,
              hint: allDone
                ? $localize`Every session is done`
                : $localize`Missed sessions stay on record`,
              action: 'complete',
            }
          : {
              label: $localize`Close program`,
              hint: $localize`Possible after its last day, ${formatDate(block.lastDay, 'EEE d MMM', context.locale)}:date:`,
              action: 'complete',
              disabled: true,
            },
    );
  }
  items.push(
    block.inProgress
      ? {
          label: $localize`Cancel program`,
          hint: $localize`A workout is in progress`,
          action: 'cancel',
          disabled: true,
        }
      : {
          label: $localize`Cancel program`,
          hint: $localize`Stop the sessions still to come`,
          action: 'cancel',
        },
  );
  return items;
}

// ------------------------------------------------------------------------------------------------
// What a session prescribes
// ------------------------------------------------------------------------------------------------

export interface ExerciseLine {
  readonly id: string;
  readonly name: string;
  /** "3 × 8–10 reps · 60 kg · RPE 8": equal sets are told once. */
  readonly sets: readonly string[];
  readonly notes: string | null;
  /** The demos the client was given for it (P4), in order. */
  readonly media: readonly string[];
}

function setText(set: SetPrescriptionView, fallbackUnit: TrainingLoadUnit, locale: string): string {
  const minimum = set.repetitionsMinimum === null ? null : count(set.repetitionsMinimum);
  const maximum = set.repetitionsMaximum === null ? null : count(set.repetitionsMaximum);
  const reps =
    minimum === null && maximum === null
      ? null
      : minimum === maximum || maximum === null
        ? $localize`${minimum}:reps: reps`
        : minimum === null
          ? $localize`${maximum}:reps: reps`
          : $localize`${minimum}:min:–${maximum}:max: reps`;
  const load = set.prescribedLoad ?? set.directLoad;
  const unit = unitLabel(set.loadUnit ?? fallbackUnit);
  const weight =
    load !== null
      ? `${formatNumber(count(load), locale, '1.0-2')} ${unit}`
      : set.percentageWorkingMax !== null
        ? $localize`${formatNumber(count(set.percentageWorkingMax), locale, '1.0-2')}:percent:% of training max`
        : null;
  const effort =
    set.targetRpe === null ? null : `RPE ${formatNumber(count(set.targetRpe), locale, '1.0-1')}`;
  return [reps, weight, effort].filter((part): part is string => part !== null).join(' · ');
}

/** The sets of one exercise, equal neighbours counted together: "3 × 8–10 reps · 60 kg · RPE 8". */
export function setLines(
  sets: readonly SetPrescriptionView[],
  unit: TrainingLoadUnit,
  locale: string,
): string[] {
  const lines: { text: string; times: number }[] = [];
  for (const set of sets) {
    const text = setText(set, unit, locale) || $localize`Set`;
    const last = lines.at(-1);
    if (last && last.text === text) last.times += 1;
    else lines.push({ text, times: 1 });
  }
  return lines.map((line) => (line.times > 1 ? `${line.times} × ${line.text}` : line.text));
}

export function exerciseLines(
  session: TrainingSessionView,
  unit: TrainingLoadUnit,
  locale: string,
): ExerciseLine[] {
  return session.exercises.map((exercise) => ({
    id: exercise.id,
    name: exercise.exerciseName,
    sets: setLines(exercise.sets, unit, locale),
    notes: exercise.coachNotes,
    media: exercise.mediaAssetIds ?? [],
  }));
}
