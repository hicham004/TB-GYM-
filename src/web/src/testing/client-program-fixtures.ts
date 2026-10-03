import type {
  ClientSessionState,
  CoachClientProgramView,
  CoachProgramBlockView,
  CoachProgramSessionView,
  CoachProgramWeekView,
  MesocycleStatus,
} from '../app/core/api/generated';
import { COACH_TODAY } from './coach-today-fixtures';

/**
 * Maya Fakhoury's programs for her coach on Thu 1 Oct 2026, the same day and people as the other
 * coach fixtures. "Lean & Strong" is six weeks from Mon 14 Sep with four sessions a week (Monday,
 * Tuesday, Thursday and Friday), so today is the third session of its third week.
 */
export const BLOCK_START = '2026-09-14';

const SESSION_NAMES = ['Lower A', 'Upper A', 'Lower B', 'Upper B'] as const;
const SESSION_OFFSETS = [0, 1, 3, 4] as const;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export type SessionStates = readonly (ClientSessionState | null)[];

export interface WeekOptions {
  isShared?: boolean;
  isVisible?: boolean;
}

/** One week of a block: its sessions take the given states in order (null: no state). */
export function programWeek(
  blockId: string,
  blockStart: string,
  weekNumber: number,
  states: SessionStates,
  options: WeekOptions = {},
): CoachProgramWeekView {
  const start = addDays(blockStart, 7 * (weekNumber - 1));
  const sessions: CoachProgramSessionView[] = states.map((state, index) => ({
    sessionId: `${blockId}-s${weekNumber}${index + 1}`,
    name: SESSION_NAMES[index],
    scheduledDate: addDays(start, SESSION_OFFSETS[index]),
    state,
    workoutExecutionId:
      state === 'Completed' || state === 'InProgress'
        ? `${blockId}-w${weekNumber}${index + 1}`
        : null,
    exerciseCount: 4,
    setCount: 12,
  }));
  return {
    id: `${blockId}-week${weekNumber}`,
    weekNumber,
    label: null,
    startDate: start,
    isShared: options.isShared ?? true,
    isVisible: options.isVisible ?? true,
    unlockDate: start,
    sessions,
  };
}

export interface BlockOptions {
  id?: string;
  name?: string;
  start?: string;
  status?: MesocycleStatus;
  currentWeekNumber?: number | null;
  revealAllWeeks?: boolean;
  version?: number;
}

/** A block from its weeks; the counts and end date follow from them, as the server derives them. */
export function programBlock(
  weeks: readonly CoachProgramWeekView[],
  options: BlockOptions = {},
): CoachProgramBlockView {
  const sessions = weeks.flatMap((week) => week.sessions);
  const start = options.start ?? BLOCK_START;
  return {
    id: options.id ?? 'block-lean',
    enrollmentId: 'enrollment-1',
    name: options.name ?? 'Lean & Strong · Phase 2',
    startDate: start,
    endDateExclusive: addDays(start, 7 * weeks.length),
    status: options.status ?? 'Active',
    revealAllWeeks: options.revealAllWeeks ?? false,
    version: options.version ?? 4,
    weekCount: weeks.length,
    currentWeekNumber: options.currentWeekNumber ?? null,
    sessionCount: sessions.length,
    completedCount: sessions.filter((session) => session.state === 'Completed').length,
    missedCount: sessions.filter((session) => session.state === 'Missed').length,
    weeks: [...weeks],
  };
}

/**
 * The running block: weeks 1 and 2 done but for one missed session, week 3 under way, week 4 shared
 * and still locked for Maya, weeks 5 and 6 not shared yet.
 */
export function runningBlock(options: BlockOptions = {}): CoachProgramBlockView {
  const id = options.id ?? 'block-lean';
  return programBlock(
    [
      programWeek(id, BLOCK_START, 1, ['Completed', 'Completed', 'Completed', 'Completed']),
      programWeek(id, BLOCK_START, 2, ['Completed', 'Completed', 'Missed', 'Completed']),
      programWeek(id, BLOCK_START, 3, ['Completed', 'Completed', 'Today', 'Upcoming']),
      programWeek(id, BLOCK_START, 4, ['Upcoming', 'Upcoming', 'Upcoming', 'Upcoming'], {
        isVisible: false,
      }),
      programWeek(id, BLOCK_START, 5, [null, null, null, null], {
        isShared: false,
        isVisible: false,
      }),
      programWeek(id, BLOCK_START, 6, [null, null, null, null], {
        isShared: false,
        isVisible: false,
      }),
    ],
    { id, status: 'Active', currentWeekNumber: 3, ...options },
  );
}

/** A block that starts later: every session still to come, none started. */
export function plannedBlock(options: BlockOptions = {}): CoachProgramBlockView {
  const id = options.id ?? 'block-next';
  const start = options.start ?? '2026-10-26';
  return programBlock(
    [
      programWeek(id, start, 1, ['Upcoming', 'Upcoming', 'Upcoming', 'Upcoming'], {
        isVisible: false,
      }),
      programWeek(id, start, 2, ['Upcoming', 'Upcoming', 'Upcoming', 'Upcoming'], {
        isVisible: false,
      }),
    ],
    { id, name: 'Strength Base', start, status: 'Planned', version: 1, ...options },
  );
}

/**
 * A block past its last day that never closed: two sessions of its last week were missed, which
 * keeps a program from completing, so it is still active but nothing about it is current.
 */
export function endedBlock(options: BlockOptions = {}): CoachProgramBlockView {
  const id = options.id ?? 'block-phase-1';
  const start = options.start ?? '2026-08-01';
  const done: SessionStates = ['Completed', 'Completed', 'Completed', 'Completed'];
  return programBlock(
    [
      ...[1, 2, 3, 4, 5].map((week) => programWeek(id, start, week, done)),
      programWeek(id, start, 6, ['Completed', 'Completed', 'Missed', 'Missed']),
    ],
    {
      id,
      name: 'Lean & Strong · Phase 1',
      start,
      status: 'Active',
      currentWeekNumber: null,
      version: 6,
      ...options,
    },
  );
}

/** A block that ran to the end, every session done. */
export function completedBlock(options: BlockOptions = {}): CoachProgramBlockView {
  const id = options.id ?? 'block-first';
  const start = options.start ?? '2026-07-20';
  const done: SessionStates = ['Completed', 'Completed', 'Completed', 'Completed'];
  return programBlock(
    [1, 2, 3, 4].map((week) => programWeek(id, start, week, done)),
    { id, name: 'Foundations', start, status: 'Completed', version: 9, ...options },
  );
}

/** A block the coach cancelled after two sessions: what was never trained has no state. */
export function cancelledBlock(options: BlockOptions = {}): CoachProgramBlockView {
  const id = options.id ?? 'block-stopped';
  const start = options.start ?? '2026-05-04';
  return programBlock(
    [
      programWeek(id, start, 1, ['Completed', 'Completed', null, null]),
      programWeek(id, start, 2, [null, null, null, null]),
    ],
    { id, name: 'Summer Reset', start, status: 'Cancelled', version: 3, ...options },
  );
}

export function coachProgram(
  blocks: readonly CoachProgramBlockView[] = [runningBlock()],
  overrides: Partial<CoachClientProgramView> = {},
): CoachClientProgramView {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: COACH_TODAY,
    blocks: [...blocks],
    sessionStateRuleKey: 'WorkoutThenScheduledDate',
    sessionStateRuleVersion: 1,
    ...overrides,
  };
}

/** The read for a client whose training is closed: the reason, and no blocks. */
export function closedProgram(accessReason: string): CoachClientProgramView {
  return coachProgram([], { isAllowed: false, accessReason });
}
