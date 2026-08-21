import type {
  ExertionDisplayPreference,
  PrescriptionModificationPolicy,
  ProgramTemplateVersionView,
  SaveProgramTemplateRequest,
  SavedSessionView,
  TrainingLoadStrategy,
  TrainingLoadUnit,
  TrainingSessionRequest,
  TrainingSetType,
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

export function emptyExercise(exerciseId: string, isMainLift = false): DraftExercise {
  return {
    key: key(),
    exerciseId,
    isMainLift,
    modificationPolicy: isMainLift ? 'Locked' : 'CoachApprovedSwap',
    coachNotes: '',
    approvedAlternativeExerciseIds: [],
    sets: [emptySet()],
  };
}

export function emptySet(): DraftSet {
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
    restSeconds: null,
    tempo: '',
    coachNotes: '',
    manualLoadOverride: null,
  };
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
    weeks: draft.weeks.map((week) => ({
      label: nullableText(week.label),
      isPublished: week.isPublished,
      sessions: week.sessions.map(toTrainingSessionRequest),
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
