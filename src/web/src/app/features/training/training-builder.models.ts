import type {
  ExertionDisplayPreference,
  PrescriptionModificationPolicy,
  ProgramDraftContent,
  ProgramDraftView,
  ProgramTemplateVersionView,
  SaveProgramTemplateRequest,
  SavedSessionView,
  TrainingLoadStrategy,
  TrainingLoadUnit,
  TrainingSessionRequest,
  TrainingSetType,
  TrainingWeekRequest,
} from '../../core/api/generated';

export interface ProgramDraft {
  templateId: string | null;
  sourceVersion: number | null;
  sourceVersionId: string | null;
  name: string;
  description: string;
  publish: boolean;
  weeks: DraftWeek[];
}

export interface DraftWeek {
  key: string;
  sourceId: string | null;
  label: string;
  isPublished: boolean;
  sessions: DraftSession[];
}

export interface DraftSession {
  key: string;
  sourceId: string | null;
  name: string;
  dayOffset: number;
  coachNotes: string;
  exercises: DraftExercise[];
}

export interface DraftExercise {
  key: string;
  exerciseId: string;
  /** The library name when it was added or read; shown on the builder's grid. */
  exerciseName: string;
  isMainLift: boolean;
  modificationPolicy: PrescriptionModificationPolicy;
  coachNotes: string;
  approvedAlternativeExerciseIds: string[];
  sets: DraftSet[];
}

export interface DraftSet {
  key: string;
  setType: TrainingSetType;
  repetitionsMinimum: number | null;
  repetitionsMaximum: number | null;
  loadStrategy: TrainingLoadStrategy;
  loadValue: number | null;
  loadUnit: TrainingLoadUnit;
  exertionDisplayPreference: ExertionDisplayPreference;
  exertionTarget: number | null;
  restSeconds: number | null;
  tempo: string;
  coachNotes: string;
  manualLoadOverride: number | null;
}

let fallbackKey = 0;

function key(): string {
  fallbackKey += 1;
  return globalThis.crypto?.randomUUID?.() ?? `draft-${fallbackKey}`;
}

export function emptyProgram(): ProgramDraft {
  return {
    templateId: null,
    sourceVersion: null,
    sourceVersionId: null,
    name: '',
    description: '',
    publish: false,
    weeks: [emptyWeek(1)],
  };
}

export function emptyWeek(number: number): DraftWeek {
  return {
    key: key(),
    sourceId: null,
    label: `Week ${number}`,
    isPublished: true,
    sessions: [emptySession(0)],
  };
}

export function emptySession(dayOffset: number): DraftSession {
  return {
    key: key(),
    sourceId: null,
    name: 'Training day',
    dayOffset,
    coachNotes: '',
    exercises: [],
  };
}

export function emptyExercise(
  exerciseId: string,
  isMainLift = false,
  exerciseName = '',
): DraftExercise {
  return {
    key: key(),
    exerciseId,
    exerciseName,
    isMainLift,
    modificationPolicy: isMainLift ? 'Locked' : 'CoachApprovedSwap',
    coachNotes: '',
    approvedAlternativeExerciseIds: [],
    sets: [emptySet(isMainLift)],
  };
}

/**
 * The rest a set made from scratch starts with (C1): 3:00 between sets of a main lift, 1:30 for any
 * other exercise, in line with ACSM (2009: 2 to 3 minutes for heavy core lifts, 1 to 2 for assistance
 * work) and NSCA (2 to 5 minutes for strength). The coach can change or clear it; empty means no rest.
 */
export function defaultRestSeconds(isMainLift: boolean): number {
  return isMainLift ? 180 : 90;
}

export function emptySet(isMainLift = false): DraftSet {
  return {
    key: key(),
    setType: 'Normal',
    repetitionsMinimum: 5,
    repetitionsMaximum: 5,
    loadStrategy: 'None',
    loadValue: null,
    loadUnit: 'Kilogram',
    exertionDisplayPreference: 'Rpe',
    exertionTarget: null,
    restSeconds: defaultRestSeconds(isMainLift),
    tempo: '',
    coachNotes: '',
    manualLoadOverride: null,
  };
}

/**
 * After Main lift is ticked or unticked, moves the exercise's sets still on the other default rest to
 * its own default. A rest the coach chose stays, the way a week label they wrote does.
 */
export function followMainLiftRest(exercise: DraftExercise): void {
  const previous = defaultRestSeconds(!exercise.isMainLift);
  for (const set of exercise.sets) {
    if (set.restSeconds === previous) {
      set.restSeconds = defaultRestSeconds(exercise.isMainLift);
    }
  }
}

export function withExertionPreference(
  set: DraftSet,
  preference: ExertionDisplayPreference,
): DraftSet {
  if (set.exertionDisplayPreference === preference) {
    return set;
  }

  return {
    ...set,
    exertionDisplayPreference: preference,
    exertionTarget: set.exertionTarget === null ? null : 10 - set.exertionTarget,
  };
}

export function draftFromVersion(version: ProgramTemplateVersionView): ProgramDraft {
  return {
    templateId: version.templateId,
    sourceVersion: numeric(version.versionNumber),
    sourceVersionId: version.id,
    name: version.name,
    description: version.description ?? '',
    publish: false,
    weeks: version.weeks.map((week) => ({
      key: key(),
      sourceId: week.id,
      label: week.label ?? '',
      isPublished: week.isPublished,
      sessions: week.sessions.map(sessionFromView),
    })),
  };
}

export function sessionFromSaved(saved: SavedSessionView): DraftSession {
  const session = sessionFromView(saved.session);
  session.sourceId = null;
  return session;
}

export function duplicateWeek(week: DraftWeek): DraftWeek {
  return {
    ...week,
    key: key(),
    sourceId: null,
    sessions: week.sessions.map(duplicateSession),
  };
}

export function duplicateSession(session: DraftSession): DraftSession {
  return {
    ...session,
    key: key(),
    sourceId: null,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      key: key(),
      approvedAlternativeExerciseIds: [...exercise.approvedAlternativeExerciseIds],
      sets: exercise.sets.map((set) => ({ ...set, key: key() })),
    })),
  };
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }

  const result = [...items];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

export function toProgramRequest(draft: ProgramDraft): SaveProgramTemplateRequest {
  return {
    name: draft.name.trim(),
    description: nullableText(draft.description),
    publish: draft.publish,
    templateVersion: draft.sourceVersion,
    weeks: draft.weeks.map(toWeekRequest),
  };
}

export function toWeekRequest(week: DraftWeek): TrainingWeekRequest {
  return {
    label: nullableText(week.label),
    isPublished: week.isPublished,
    sessions: week.sessions.map(toTrainingSessionRequest),
  };
}

/**
 * The program as the server keeps it mid-edit (TRN-024): the shape of a save, whose values are
 * checked only when it is published, so a half-typed number travels as it is.
 */
export function toDraftContent(draft: ProgramDraft): ProgramDraftContent {
  const { name, description, weeks } = toProgramRequest(draft);
  return { name, description, weeks };
}

/**
 * A draft read back from the server. Exercise names come from the workspace's library as it is now;
 * an exercise it no longer has keeps an empty name, and publishing says so.
 */
export function draftFromContent(view: ProgramDraftView): ProgramDraft {
  const names = new Map(view.exercises.map((exercise) => [exercise.id, exercise.name]));
  const content = view.content;
  return {
    templateId: view.templateId,
    sourceVersion: null,
    sourceVersionId: view.sourceVersionId,
    name: content.name,
    description: content.description ?? '',
    publish: false,
    weeks: content.weeks.map((week) => weekFromRequest(week, names)),
  };
}

/**
 * A week in a save's shape (a draft read back, or the copies a progression preview returns) as the
 * builder holds it. A name the library no longer has stays empty.
 */
export function weekFromRequest(
  week: TrainingWeekRequest,
  names: ReadonlyMap<string, string>,
): DraftWeek {
  return {
    key: key(),
    sourceId: null,
    label: week.label ?? '',
    isPublished: week.isPublished,
    sessions: week.sessions.map((session) => ({
      key: key(),
      sourceId: null,
      name: session.name,
      dayOffset: numeric(session.dayOffset),
      coachNotes: session.coachNotes ?? '',
      exercises: session.exercises.map((exercise) => ({
        key: key(),
        exerciseId: exercise.exerciseId,
        exerciseName: names.get(exercise.exerciseId) ?? '',
        isMainLift: exercise.isMainLift,
        modificationPolicy: exercise.modificationPolicy,
        coachNotes: exercise.coachNotes ?? '',
        approvedAlternativeExerciseIds: [...exercise.approvedAlternativeExerciseIds],
        sets: exercise.sets.map((set) => ({
          key: key(),
          setType: set.setType,
          repetitionsMinimum: nullableNumeric(set.repetitionsMinimum ?? null),
          repetitionsMaximum: nullableNumeric(set.repetitionsMaximum ?? null),
          loadStrategy: set.loadStrategy,
          loadValue:
            set.loadStrategy === 'Direct'
              ? nullableNumeric(set.directLoad ?? null)
              : nullableNumeric(set.percentageWorkingMax ?? null),
          loadUnit: set.loadUnit ?? 'Kilogram',
          exertionDisplayPreference: set.exertionDisplayPreference,
          exertionTarget:
            set.exertionDisplayPreference === 'Rir'
              ? nullableNumeric(set.targetRir ?? null)
              : nullableNumeric(set.targetRpe ?? null),
          restSeconds: nullableNumeric(set.restSeconds ?? null),
          tempo: set.tempo ?? '',
          coachNotes: set.coachNotes ?? '',
          manualLoadOverride: nullableNumeric(set.manualLoadOverride ?? null),
        })),
      })),
    })),
  };
}

export function toTrainingSessionRequest(session: DraftSession): TrainingSessionRequest {
  return {
    name: session.name.trim(),
    dayOffset: session.dayOffset,
    coachNotes: nullableText(session.coachNotes),
    exercises: session.exercises.map((exercise, exerciseIndex) => ({
      exerciseId: exercise.exerciseId,
      position: exerciseIndex + 1,
      isMainLift: exercise.isMainLift,
      modificationPolicy: exercise.isMainLift ? 'Locked' : exercise.modificationPolicy,
      coachNotes: nullableText(exercise.coachNotes),
      approvedAlternativeExerciseIds:
        exercise.modificationPolicy === 'CoachApprovedSwap'
          ? exercise.approvedAlternativeExerciseIds
          : [],
      sets: exercise.sets.map((set, setIndex) => ({
        position: setIndex + 1,
        setType: set.setType,
        repetitionsMinimum: set.repetitionsMinimum,
        repetitionsMaximum: set.repetitionsMaximum,
        loadStrategy: set.loadStrategy,
        directLoad: set.loadStrategy === 'Direct' ? set.loadValue : null,
        loadUnit: set.loadStrategy === 'None' ? null : set.loadUnit,
        percentageWorkingMax: set.loadStrategy === 'PercentageWorkingMax' ? set.loadValue : null,
        targetRpe: set.exertionDisplayPreference === 'Rpe' ? set.exertionTarget : null,
        targetRir: set.exertionDisplayPreference === 'Rir' ? set.exertionTarget : null,
        exertionDisplayPreference: set.exertionDisplayPreference,
        restSeconds: set.restSeconds,
        tempo: nullableText(set.tempo),
        coachNotes: nullableText(set.coachNotes),
        manualLoadOverride: set.manualLoadOverride,
      })),
    })),
  };
}

export function numeric(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

export function nullableNumeric(value: null | number | string): number | null {
  return value === null ? null : numeric(value);
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sessionFromView(
  session: ProgramTemplateVersionView['weeks'][number]['sessions'][number],
): DraftSession {
  return {
    key: key(),
    sourceId: session.id,
    name: session.name,
    dayOffset: numeric(session.dayOffset),
    coachNotes: session.coachNotes ?? '',
    exercises: session.exercises.map((exercise) => ({
      key: key(),
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      isMainLift: exercise.isMainLift,
      modificationPolicy: exercise.modificationPolicy,
      coachNotes: exercise.coachNotes ?? '',
      approvedAlternativeExerciseIds: [...exercise.approvedAlternativeExerciseIds],
      sets: exercise.sets.map((set) => ({
        key: key(),
        setType: set.setType,
        repetitionsMinimum: nullableNumeric(set.repetitionsMinimum),
        repetitionsMaximum: nullableNumeric(set.repetitionsMaximum),
        loadStrategy: set.loadStrategy,
        loadValue:
          set.loadStrategy === 'Direct'
            ? nullableNumeric(set.directLoad)
            : nullableNumeric(set.percentageWorkingMax),
        loadUnit: set.loadUnit ?? 'Kilogram',
        exertionDisplayPreference: set.exertionDisplayPreference,
        exertionTarget:
          set.exertionDisplayPreference === 'Rpe'
            ? nullableNumeric(set.targetRpe)
            : nullableNumeric(set.targetRir),
        restSeconds: nullableNumeric(set.restSeconds),
        tempo: set.tempo ?? '',
        coachNotes: set.coachNotes ?? '',
        manualLoadOverride: set.isManualLoadOverride ? nullableNumeric(set.prescribedLoad) : null,
      })),
    })),
  };
}
