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
  minimumScaleValue: -1_000_000,
  maximumScaleValue: 1_000_000,
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

  const names = nameIssues(draft.title, draft.description);
  names.title.forEach((message) => add('title', message));
  names.description.forEach((message) => add('description', message));

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

/**
 * What is wrong with one question, said under the box it is about (audit A14b): the question itself,
 * its hint, the choices as a group or one choice, and each number of a scale. Every message names the
 * fix in a coach's words. The server checks the same rules again.
 */
export interface QuestionIssues {
  readonly prompt: string[];
  readonly hint: string[];
  /** How many choices there are. */
  readonly choices: string[];
  /** One choice's own problem, by its key: empty, too long, or the same as an earlier one. */
  readonly choice: Readonly<Record<string, string[]>>;
  readonly lowest: string[];
  readonly highest: string[];
  readonly step: string[];
}

export function questionIssues(question: QuestionDraft): QuestionIssues {
  const issues = {
    prompt: [] as string[],
    hint: [] as string[],
    choices: [] as string[],
    choice: {} as Record<string, string[]>,
    lowest: [] as string[],
    highest: [] as string[],
    step: [] as string[],
  };
  const prompt = question.prompt.trim();
  if (prompt.length === 0) {
    issues.prompt.push($localize`Write the question.`);
  } else if (prompt.length > CHECK_IN_LIMITS.promptLength) {
    issues.prompt.push($localize`Keep the question under 500 characters.`);
  }

  if (question.helpText.trim().length > CHECK_IN_LIMITS.helpTextLength) {
    issues.hint.push($localize`Keep the hint under 1,000 characters.`);
  }

  if (isChoice(question.questionType)) {
    choiceIssues(question.options, issues);
  } else if (question.questionType === 'NumericScale') {
    scaleIssues(question, issues);
  }

  return issues;
}

function choiceIssues(
  options: readonly OptionDraft[],
  issues: { choices: string[]; choice: Record<string, string[]> },
): void {
  if (options.length < CHECK_IN_LIMITS.minimumOptions) {
    issues.choices.push($localize`Give at least two choices.`);
  } else if (options.length > CHECK_IN_LIMITS.maximumOptions) {
    issues.choices.push($localize`Keep it to 30 choices or fewer.`);
  }

  const seen = new Set<string>();
  for (const option of options) {
    const label = option.label.trim();
    // The server compares choices ignoring case by each letter's own mapping (OrdinalIgnoreCase); the
    // browser's language must not change the answer (Turkish lowercases "I" to "ı").
    const comparable = label.toUpperCase();
    const reasons: string[] = [];
    if (label.length === 0) {
      reasons.push($localize`Write this choice, or remove it.`);
    } else if (label.length > CHECK_IN_LIMITS.optionLabelLength) {
      reasons.push($localize`Keep this choice under 200 characters.`);
    } else if (seen.has(comparable)) {
      reasons.push($localize`An earlier choice says the same.`);
    }
    if (label.length > 0) seen.add(comparable);
    if (reasons.length > 0) issues.choice[option.key] = reasons;
  }
}

function scaleIssues(
  question: QuestionDraft,
  issues: { lowest: string[]; highest: string[]; step: string[] },
): void {
  const { scaleMinimum: lowest, scaleMaximum: highest, scaleStep: step } = question;
  if (lowest === null) issues.lowest.push($localize`Enter the lowest number.`);
  if (highest === null) issues.highest.push($localize`Enter the highest number.`);
  if (step === null) issues.step.push($localize`Enter the step.`);
  // The server keeps three decimal places and numbers within a million either way (CheckInForm).
  for (const [value, list] of [
    [lowest, issues.lowest],
    [highest, issues.highest],
    [step, issues.step],
  ] as const) {
    if (value === null) continue;
    if (!hasAtMostDecimals(value, CHECK_IN_LIMITS.scaleDecimals)) {
      list.push($localize`Use at most 3 decimal places.`);
    } else if (
      value < CHECK_IN_LIMITS.minimumScaleValue ||
      value > CHECK_IN_LIMITS.maximumScaleValue
    ) {
      list.push($localize`Keep it between -1,000,000 and 1,000,000.`);
    }
  }
  if (lowest === null || highest === null || step === null) return;
  if (issues.lowest.length + issues.highest.length + issues.step.length > 0) return;

  if (lowest >= highest) {
    issues.highest.push($localize`Make it more than the lowest number.`);
  }

  if (step <= 0) {
    issues.step.push($localize`The step must be more than 0.`);
  } else if (lowest < highest) {
    if (!stepDividesRange(lowest, highest, step)) {
      issues.step.push(
        $localize`Counting from ${lowest}:lowest: in steps of ${step}:step: never lands on ${highest}:highest:.`,
      );
    } else if ((highest - lowest) / step > CHECK_IN_LIMITS.maximumScalePositions) {
      issues.step.push($localize`That is more than 100 steps. Use a bigger step.`);
    }
  }
}

/** Whether a number is written with at most `places` decimal places, as the server stores it. */
function hasAtMostDecimals(value: number, places: number): boolean {
  const scaled = value * 10 ** places;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/**
 * A form's name and description, the same rule wherever they are typed: the new form's page and the
 * Name and description sheet.
 */
export function nameIssues(
  title: string,
  description: string,
): Record<'title' | 'description', string[]> {
  const name = title.trim();
  return {
    title:
      name.length === 0
        ? [$localize`Give the form a name.`]
        : name.length > CHECK_IN_LIMITS.titleLength
          ? [$localize`The name is too long.`]
          : [],
    description:
      description.trim().length > CHECK_IN_LIMITS.descriptionLength
        ? [$localize`The description is too long.`]
        : [],
  };
}

/** Every reason one question has, in the order its boxes are laid out. */
function validateQuestion(question: QuestionDraft): string[] {
  const issues = questionIssues(question);
  return [
    ...issues.prompt,
    ...issues.hint,
    ...issues.choices,
    ...question.options.flatMap((option) => issues.choice[option.key] ?? []),
    ...issues.lowest,
    ...issues.highest,
    ...issues.step,
  ];
}

export interface AssignmentValidation {
  /** Every outstanding reason, in field order. */
  errors: string[];
  byField: Record<string, string[]>;
  isValid: boolean;
}

/**
 * What the Assign a check-in sheet needs (audit A14b): a published form, and a due date that is not
 * already past in the workspace's own calendar, which would ask for something undeliverable. The
 * client is the record the sheet was opened on.
 */
export function validateAssignment(
  draft: AssignmentDraft,
  workspaceToday: string,
): AssignmentValidation {
  const byField: Record<string, string[]> = {};
  const add = (field: string, message: string): void => {
    byField[field] = [...(byField[field] ?? []), message];
  };

  if (draft.formVersionId.length === 0) {
    add('formVersionId', $localize`Choose the form to send.`);
  }

  if (draft.dueDate.length === 0) {
    add('dueDate', $localize`Choose the day it is due.`);
  } else if (draft.dueDate < workspaceToday) {
    add('dueDate', $localize`Choose today or a later day.`);
  }

  const errors = ['formVersionId', 'dueDate'].flatMap((field) => byField[field] ?? []);
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

/** What a coach calls each kind of question, rather than the name the server gives it. */
export function questionTypeLabel(type: CheckInQuestionType): string {
  switch (type) {
    case 'ShortText':
      return $localize`Short answer`;
    case 'LongText':
      return $localize`Long answer`;
    case 'SingleChoice':
      return $localize`Choose one`;
    case 'MultipleChoice':
      return $localize`Choose several`;
    case 'NumericScale':
      return $localize`Number scale`;
  }
}

/** A form or a version is a draft the coach is still writing, or published and in use. */
export function statusLabel(status: 'Draft' | 'Published'): string {
  return status === 'Published' ? $localize`Published` : $localize`Draft`;
}

export function questionCountText(count: number | string): string {
  const total = Number(count);
  return total === 1 ? $localize`1 question` : $localize`${total}:count: questions`;
}

export function versionLabel(number: number | string | null): string {
  return $localize`Version ${Number(number)}:number:`;
}
