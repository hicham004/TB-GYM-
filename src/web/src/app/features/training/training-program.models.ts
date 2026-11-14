import type {
  ClientProgramPhase,
  ClientProgramView,
  ClientSessionState,
  ClientTrainingProgramView,
  ClientWorkoutHistoryPage,
  TrainingLoadUnit,
} from '../../core/api/generated';

/** One session as the Training page lists it; its state comes from the server (TRN-020). */
export interface ProgramSession {
  readonly sessionId: string;
  readonly name: string;
  readonly date: string;
  readonly state: ClientSessionState;
  readonly exerciseCount: number;
  readonly setCount: number;
  /**
   * The workout player opens today's sessions and unfinished ones. A finished workout from an
   * earlier day has no page of its own yet; a missed one is started from here (`canDoNow`).
   */
  readonly opensPlayer: boolean;
  /** The day its workout was started, on the program's calendar; null before. */
  readonly startedOn: string | null;
  /** Its workout was started on a day after the session's own (TRN-020 v2). */
  readonly isLate: boolean;
  /** A missed session of the program running now, which the client may still do ("Do it now"). */
  readonly canDoNow: boolean;
  /**
   * A later session of this week that a trainee of TB Gym's own space may start before its day
   * ("Start now", TRN-020, notes plan N9c3): the server says so only while the program's plan grants.
   */
  readonly canStartEarly: boolean;
}

export interface ProgramWeek {
  readonly number: number;
  readonly startDate: string;
  /** The week's last day: weeks run seven days from the program's start (TRN-007). */
  readonly lastDate: string;
  /** False for a week not shared yet or still locked: the server sent none of its sessions. */
  readonly visible: boolean;
  readonly shared: boolean;
  readonly isCurrent: boolean;
  readonly sessions: readonly ProgramSession[];
  readonly done: number;
  readonly missed: number;
}

export interface TrainingProgram {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  /** The last calendar day of the program (the server's end is exclusive). */
  readonly lastDate: string;
  readonly phase: ClientProgramPhase;
  readonly weekCount: number;
  readonly currentWeek: number | null;
  readonly sessionCount: number;
  readonly completedCount: number;
  readonly missedCount: number;
  readonly weeks: readonly ProgramWeek[];
}

export interface TrainingProgramRead {
  readonly isAllowed: boolean;
  readonly accessReason: string;
  readonly localDate: string;
  /** With training closed today, only a program the coach shows before its first day (TRN-023). */
  readonly program: TrainingProgram | null;
  /** A later program the coach shows before its first day, beside the one above (TRN-023). */
  readonly nextProgram: TrainingProgram | null;
  readonly nextProgramStart: string | null;
}

export interface HistoryRecord {
  readonly id: string;
  readonly exercise: string;
  readonly reps: number;
  readonly load: number;
  readonly unit: TrainingLoadUnit;
}

export interface HistoryWorkout {
  readonly id: string;
  readonly name: string;
  /** Empty on a workout of one's own, which no program holds (TRN-033). */
  readonly programName: string;
  readonly isOwn: boolean;
  readonly date: string;
  /** Whole minutes, or null when the workout was opened and finished within a minute. */
  readonly minutes: number | null;
  readonly completedSets: number;
  readonly totalSets: number;
  readonly volume: readonly { readonly unit: TrainingLoadUnit; readonly amount: number }[];
  readonly records: readonly HistoryRecord[];
  /** The notes on the workout, the coach's and the client's, oldest first (P4). */
  readonly notes: readonly HistoryNote[];
}

export interface HistoryNote {
  readonly id: string;
  readonly fromCoach: boolean;
  readonly text: string;
}

export interface WorkoutHistory {
  readonly isAllowed: boolean;
  readonly accessReason: string;
  readonly items: readonly HistoryWorkout[];
  readonly nextSkip: number | null;
}

/** What the hero card asks of the client: one action at most (§2 rule 5). */
export type ProgramAction =
  | { readonly kind: 'start' | 'continue' | 'view'; readonly session: ProgramSession }
  | { readonly kind: 'next'; readonly session: ProgramSession }
  | { readonly kind: 'none' };

export function mapTrainingProgram(value: ClientTrainingProgramView): TrainingProgramRead {
  const today = value.localDate;
  return {
    isAllowed: value.isAllowed,
    accessReason: value.accessReason,
    localDate: today,
    nextProgramStart: value.nextProgramStartDate,
    program: value.program === null ? null : mapProgram(value.program, today),
    nextProgram: value.nextProgram ? mapProgram(value.nextProgram, today) : null,
  };
}

function mapProgram(program: ClientProgramView, today: string): TrainingProgram {
  return {
    id: program.id,
    name: program.name,
    startDate: program.startDate,
    lastDate: addDays(program.endDateExclusive, -1),
    phase: program.phase,
    weekCount: Number(program.weekCount),
    currentWeek: program.currentWeekNumber == null ? null : Number(program.currentWeekNumber),
    sessionCount: Number(program.sessionCount),
    completedCount: Number(program.completedCount),
    missedCount: Number(program.missedCount),
    weeks: program.weeks.map((week) => {
      const sessions = week.sessions.map((session) => ({
        sessionId: session.sessionId,
        name: session.name,
        date: session.scheduledDate,
        state: session.state,
        exerciseCount: Number(session.exerciseCount),
        setCount: Number(session.setCount),
        opensPlayer:
          session.state === 'Today' ||
          session.state === 'InProgress' ||
          (session.state === 'Completed' && session.scheduledDate === today),
        startedOn: session.startedOn ?? null,
        isLate: session.isLate ?? false,
        canDoNow: session.state === 'Missed' && program.phase === 'Current',
        // A read from before early starts carries no flag: nothing starts before its day.
        canStartEarly: session.state === 'Upcoming' && session.canStartEarly === true,
      }));
      return {
        number: Number(week.weekNumber),
        startDate: week.startDate,
        lastDate: addDays(week.startDate, 6),
        visible: week.isVisible,
        shared: week.isShared,
        isCurrent:
          program.phase === 'Current' &&
          Number(week.weekNumber) === Number(program.currentWeekNumber),
        sessions,
        done: sessions.filter((session) => session.state === 'Completed').length,
        missed: sessions.filter((session) => session.state === 'Missed').length,
      };
    }),
  };
}

export function mapWorkoutHistory(value: ClientWorkoutHistoryPage): WorkoutHistory {
  return {
    isAllowed: value.isAllowed,
    accessReason: value.accessReason,
    nextSkip: value.nextSkip == null ? null : Number(value.nextSkip),
    items: value.items.map((item) => {
      const seconds = Number(item.durationSeconds);
      return {
        id: item.workoutExecutionId,
        name: item.name,
        programName: item.programName,
        // A read from before workouts of one's own carries no flag: every item was a program's.
        isOwn: item.isOwnWorkout === true,
        date: item.date,
        minutes: seconds >= 60 ? Math.round(seconds / 60) : null,
        completedSets: Number(item.completedSetCount),
        totalSets: Number(item.totalSetCount),
        volume: item.volume.map((volume) => ({
          unit: volume.unit,
          amount: Number(volume.loadTimesRepetitions),
        })),
        records: item.personalRecords.map((record) => ({
          id: record.setPerformanceId,
          exercise: record.exerciseName,
          reps: Number(record.repetitions),
          load: Number(record.load),
          unit: record.unit,
        })),
        // A history read from before notes were sent has none.
        notes: (item.notes ?? []).map((note) => ({
          id: note.id,
          fromCoach: note.authorRole === 'Coach',
          text: note.text,
        })),
      };
    }),
  };
}

/**
 * The hero's single action: today's session first (started or not), then one left unfinished on
 * an earlier day, then today's finished one, then a look at what comes next.
 */
export function programAction(program: TrainingProgram, today: string): ProgramAction {
  const sessions = program.weeks.flatMap((week) => week.sessions);
  const find = (test: (session: ProgramSession) => boolean) => sessions.find(test);
  // A session started before its day (TRN-020) was started today when its start day is today.
  const startedToday = find(
    (session) =>
      session.state === 'InProgress' && (session.date === today || session.startedOn === today),
  );
  if (startedToday) return { kind: 'continue', session: startedToday };
  const dueToday = find((session) => session.state === 'Today');
  if (dueToday) return { kind: 'start', session: dueToday };
  const unfinished = find((session) => session.state === 'InProgress');
  if (unfinished) return { kind: 'continue', session: unfinished };
  const doneToday = find((session) => session.state === 'Completed' && session.date === today);
  if (doneToday) return { kind: 'view', session: doneToday };
  const next = find((session) => session.state === 'Upcoming');
  return next ? { kind: 'next', session: next } : { kind: 'none' };
}

/**
 * The week shown open above the others: this week while the program runs, its first week before
 * it starts. A finished program has none; all its weeks list closed.
 */
export function focusWeek(program: TrainingProgram): ProgramWeek | null {
  switch (program.phase) {
    case 'Current':
      return program.weeks.find((week) => week.isCurrent) ?? null;
    case 'Upcoming':
      return program.weeks[0] ?? null;
    default:
      return null;
  }
}

/** Share of a week's sessions done, 0–100, for its segment of the hero bar. */
export function weekFill(week: ProgramWeek): number {
  return week.sessions.length === 0 ? 0 : Math.round((100 * week.done) / week.sessions.length);
}

export function unitLabel(unit: TrainingLoadUnit): string {
  return unit === 'Pound' ? 'lb' : 'kg';
}

/** Calendar arithmetic on `YYYY-MM-DD` values, in UTC so no local offset shifts the day. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
