import type {
  CheckInFormVersionView,
  CheckInQuestionRequest,
  CheckInQuestionType,
  CreateCheckInFormRequest,
  SaveCheckInDraftRequest,
} from '../../core/api/generated';

/** Mirrors the server limits so the builder can explain a refusal before it happens. */
export const CHECK_IN_LIMITS = {
  titleLength: 160,
  descriptionLength: 2000,
  promptLength: 500,
  helpTextLength: 1000,
  optionLabelLength: 200,
  maximumQuestions: 100,
  minimumOptions: 2,
  maximumOptions: 30,
  maximumScalePositions: 100,
  scaleDecimals: 3,
} as const;

export interface OptionDraft {
  key: string;
  label: string;
}

export interface QuestionDraft {
  /** Local editing identity only. It is never sent and never persisted. */
  key: string;
  /**
   * The server-owned stable key. Null means "new question": the server generates one. An existing
   * key is echoed back unchanged so the question keeps its identity across versions.
   */
  questionKey: string | null;
  questionType: CheckInQuestionType;
  prompt: string;
  helpText: string;
  isRequired: boolean;
  scaleMinimum: number | null;
  scaleMaximum: number | null;
  scaleStep: number | null;
  options: OptionDraft[];
}

export interface FormDraft {
  title: string;
  description: string;
  questions: QuestionDraft[];
}

export interface DraftValidation {
  formErrors: string[];
  questionErrors: Record<string, string[]>;
  /**
   * The same form-level reasons keyed by the control each belongs to, so a message can wait for its
   * own field to be touched rather than appearing on a pristine form. `form` holds the reasons with
   * no control of their own — how many questions a draft has is not a field anyone can leave.
   */
  byField: Record<string, string[]>;
  isValid: boolean;
}

/** The field key for reasons that belong to the form as a whole rather than to one control. */
export const FORM_LEVEL = 'form';

export interface AssignmentDraft {
  clientProfileId: string;
  formVersionId: string;
  dueDate: string;
}

let fallbackKey = 0;

function localKey(): string {
  fallbackKey += 1;
  return globalThis.crypto?.randomUUID?.() ?? `checkin-${fallbackKey}`;
}

export function emptyForm(): FormDraft {
  return { title: '', description: '', questions: [emptyQuestion('ShortText')] };
}

export function emptyQuestion(questionType: CheckInQuestionType): QuestionDraft {
  return {
    key: localKey(),
    questionKey: null,
    questionType,
    prompt: '',
    helpText: '',
    isRequired: true,
    scaleMinimum: questionType === 'NumericScale' ? 1 : null,
    scaleMaximum: questionType === 'NumericScale' ? 10 : null,
    scaleStep: questionType === 'NumericScale' ? 1 : null,
    options: isChoice(questionType) ? [emptyOption(), emptyOption()] : [],
  };
}

export function emptyOption(): OptionDraft {
  return { key: localKey(), label: '' };
}

export function isChoice(questionType: CheckInQuestionType): boolean {
  return questionType === 'SingleChoice' || questionType === 'MultipleChoice';
}

/**
 * Switching type discards the content the new type cannot carry, because the server refuses a text
 * question that still has options and a choice question that still has scale bounds.
 */
export function withQuestionType(
  question: QuestionDraft,
  questionType: CheckInQuestionType,
): QuestionDraft {
  if (question.questionType === questionType) {
    return question;
  }

  const template = emptyQuestion(questionType);
  return {
    ...question,
    questionType,
    scaleMinimum: template.scaleMinimum,
    scaleMaximum: template.scaleMaximum,
    scaleStep: template.scaleStep,
    options: isChoice(questionType)
      ? question.options.length >= CHECK_IN_LIMITS.minimumOptions
        ? question.options
        : template.options
      : [],
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

/**
 * A numeric scale must be able to step from its minimum onto its maximum exactly. Decimal steps make
 * this unsafe in binary floating point, so both sides are scaled to the integer precision the server
 * stores before the remainder is taken.
 */
export function stepDividesRange(minimum: number, maximum: number, step: number): boolean {
  const scale = 10 ** CHECK_IN_LIMITS.scaleDecimals;
  const range = Math.round((maximum - minimum) * scale);
  const increment = Math.round(step * scale);
  return increment > 0 && range % increment === 0;
}

export function validateDraft(draft: FormDraft): DraftValidation {
  const byField: Record<string, string[]> = {};
  const questionErrors: Record<string, string[]> = {};
  const add = (field: string, message: string): void => {
    byField[field] = [...(byField[field] ?? []), message];
  };

  if (draft.title.trim().length === 0) {
    add('title', $localize`A title is required.`);
  } else if (draft.title.trim().length > CHECK_IN_LIMITS.titleLength) {
    add('title', $localize`The title is too long.`);
  }

  if (draft.description.trim().length > CHECK_IN_LIMITS.descriptionLength) {
    add('description', $localize`The description is too long.`);
  }

  if (draft.questions.length === 0) {
    add(FORM_LEVEL, $localize`Add at least one question.`);
  } else if (draft.questions.length > CHECK_IN_LIMITS.maximumQuestions) {
    add(FORM_LEVEL, $localize`A check-in cannot have more than 100 questions.`);
  }

  for (const question of draft.questions) {
    const errors = validateQuestion(question);
    if (errors.length > 0) {
      questionErrors[question.key] = errors;
    }
  }

  // Field order, not insertion order, so the summary reads the way the form is laid out.
  const formErrors = ['title', 'description', FORM_LEVEL].flatMap((field) => byField[field] ?? []);
  return {
    formErrors,
    questionErrors,
    byField,
    isValid: formErrors.length === 0 && Object.keys(questionErrors).length === 0,
  };
}

function validateQuestion(question: QuestionDraft): string[] {
  const errors: string[] = [];
  if (question.prompt.trim().length === 0) {
    errors.push($localize`A question needs a prompt.`);
  } else if (question.prompt.trim().length > CHECK_IN_LIMITS.promptLength) {
    errors.push($localize`The prompt is too long.`);
  }

  if (question.helpText.trim().length > CHECK_IN_LIMITS.helpTextLength) {
    errors.push($localize`The help text is too long.`);
  }

  if (isChoice(question.questionType)) {
    errors.push(...validateOptions(question.options));
    return errors;
  }

  if (question.questionType !== 'NumericScale') {
    return errors;
  }

  const { scaleMinimum: minimum, scaleMaximum: maximum, scaleStep: step } = question;
  if (minimum === null || maximum === null || step === null) {
    errors.push($localize`A scale needs a minimum, a maximum and a step.`);
    return errors;
  }

  if (minimum >= maximum) {
    errors.push($localize`The scale minimum must be below its maximum.`);
  }

  if (step <= 0) {
    errors.push($localize`The scale step must be greater than zero.`);
  }

  if (minimum < maximum && step > 0) {
    if (!stepDividesRange(minimum, maximum, step)) {
      errors.push($localize`The step must divide the range exactly, ending on the maximum.`);
    } else if ((maximum - minimum) / step > CHECK_IN_LIMITS.maximumScalePositions) {
      errors.push($localize`A scale cannot have more than 100 steps.`);
    }
  }

  return errors;
}

function validateOptions(options: readonly OptionDraft[]): string[] {
  const errors: string[] = [];
  if (options.length < CHECK_IN_LIMITS.minimumOptions) {
    errors.push($localize`A choice question needs at least two options.`);
  }

  if (options.length > CHECK_IN_LIMITS.maximumOptions) {
    errors.push($localize`A choice question cannot have more than 30 options.`);
  }

  if (options.some((option) => option.label.trim().length === 0)) {
    errors.push($localize`Every option needs a label.`);
  }

  if (options.some((option) => option.label.trim().length > CHECK_IN_LIMITS.optionLabelLength)) {
    errors.push($localize`An option label is too long.`);
  }

  const labels = options
    .map((option) => option.label.trim().toLocaleLowerCase())
    .filter((label) => label.length > 0);
  if (new Set(labels).size !== labels.length) {
    errors.push($localize`Options must be distinct.`);
  }

  return errors;
}

export interface AssignmentValidation {
  /** Every outstanding reason, in field order: what a refused submit names in its summary. */
  errors: string[];
  byField: Record<string, string[]>;
  isValid: boolean;
}

/**
 * A due date already past in the workspace's own calendar asks for something undeliverable.
 *
 * The client is validated but keyed as form-level: it is chosen from the list beside the form, not
 * from a control inside it, so there is nothing for the user to leave and no field to describe.
 */
export function validateAssignment(
  draft: AssignmentDraft,
  workspaceToday: string,
): AssignmentValidation {
  const byField: Record<string, string[]> = {};
  const add = (field: string, message: string): void => {
    byField[field] = [...(byField[field] ?? []), message];
  };

  if (draft.clientProfileId.length === 0) {
    add(FORM_LEVEL, $localize`Choose a client.`);
  }

  if (draft.formVersionId.length === 0) {
    add('formVersionId', $localize`Choose a published version to assign.`);
  }

  if (draft.dueDate.length === 0) {
    add('dueDate', $localize`Choose a due date.`);
  } else if (draft.dueDate < workspaceToday) {
    add('dueDate', $localize`The due date cannot be in the past.`);
  }

  const errors = [FORM_LEVEL, 'formVersionId', 'dueDate'].flatMap((field) => byField[field] ?? []);
  return { errors, byField, isValid: errors.length === 0 };
}

export function toCreateRequest(draft: FormDraft): CreateCheckInFormRequest {
  return {
    title: draft.title.trim(),
    description: nullableText(draft.description),
    // A new lineage has no history, so the server owns every key from the start.
    questions: draft.questions.map((question) => toQuestionRequest(question, false)),
  };
}

export function toSaveRequest(draft: FormDraft, version: number): SaveCheckInDraftRequest {
  return {
    questions: draft.questions.map((question) => toQuestionRequest(question, true)),
    version,
  };
}

export function draftFromVersion(version: CheckInFormVersionView): FormDraft {
  return {
    title: version.formTitle,
    description: version.formDescription ?? '',
    questions: version.questions.map((question) => ({
      key: localKey(),
      questionKey: question.questionKey,
      questionType: question.questionType,
      prompt: question.prompt,
      helpText: question.helpText ?? '',
      isRequired: question.isRequired,
      scaleMinimum: nullableNumber(question.scaleMinimum),
      scaleMaximum: nullableNumber(question.scaleMaximum),
      scaleStep: nullableNumber(question.scaleStep),
      options: question.options.map((option) => ({ key: localKey(), label: option.label })),
    })),
  };
}

function toQuestionRequest(question: QuestionDraft, keepKey: boolean): CheckInQuestionRequest {
  const scale = question.questionType === 'NumericScale';
  return {
    questionKey: keepKey ? question.questionKey : null,
    questionType: question.questionType,
    prompt: question.prompt.trim(),
    helpText: nullableText(question.helpText),
    isRequired: question.isRequired,
    scaleMinimum: scale ? question.scaleMinimum : null,
    scaleMaximum: scale ? question.scaleMaximum : null,
    scaleStep: scale ? question.scaleStep : null,
    options: isChoice(question.questionType)
      ? question.options.map((option) => option.label.trim())
      : [],
  };
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableNumber(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
