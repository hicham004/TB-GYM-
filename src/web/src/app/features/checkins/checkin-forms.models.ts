import type {
  CheckInFormDetails,
  CheckInFormSummary,
  CheckInQuestionType,
  CheckInQuestionView,
} from '../../core/api/generated';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';
import type { StatusPillTone } from '../../ui/status-pill';
import {
  emptyOption,
  emptyQuestion,
  questionCountText,
  questionTypeLabel,
  statusLabel,
  versionLabel,
  type FormDraft,
  type QuestionDraft,
} from './checkin-builder.models';

/** The workspace's clock a day is read on, so a coach and their team read the same day (COACH-6). */
export interface FormClock {
  readonly locale: string;
  /** Null while the workspace has not been read: the device's zone stands in. */
  readonly timeZone: string | null;
  readonly today: string;
}

/** One form of the library, as its card says it (audit A14b, AUTH-8). */
export interface FormCard {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly link: readonly string[];
  readonly status: string;
  readonly tone: StatusPillTone;
  /** "6 questions": what a client is sent now, or what the draft holds before anything is published. */
  readonly questions: string;
  /** A published form whose next version is still being written. */
  readonly note: string | null;
  readonly line: string;
}

/** "Mon 5 Oct": the day an instant falls on in the workspace, in the house style. */
export function dayOf(instant: string, clock: FormClock): string {
  return houseDay(dayInZone(instant, clock.timeZone), clock.locale, clock.today);
}

export function isReady(form: CheckInFormSummary): boolean {
  return form.latestPublishedVersionId !== null;
}

export function formCard(form: CheckInFormSummary, clock: FormClock): FormCard {
  const ready = isReady(form);
  const published = form.latestPublishedAtUtc ? dayOf(form.latestPublishedAtUtc, clock) : null;
  return {
    id: form.id,
    title: form.title,
    description: form.description?.trim() || null,
    link: ['/checkins/forms', form.id],
    status: form.isArchived
      ? $localize`Archived`
      : ready
        ? $localize`Ready to assign`
        : $localize`Draft`,
    tone: !form.isArchived && ready ? 'success' : 'neutral',
    questions: questionCountText(form.questionCount),
    note:
      !form.isArchived && ready && form.draftVersionId !== null
        ? $localize`Changes not published yet`
        : null,
    line:
      published !== null
        ? $localize`Published ${published}:day:`
        : form.isArchived
          ? $localize`Never published`
          : $localize`Publish it to assign it to clients`,
  };
}

function formsText(count: number): string {
  return count === 1 ? $localize`1 form` : $localize`${count}:count: forms`;
}

/**
 * The line under the title: how many forms are in use and how many can be assigned; archived forms are
 * not in use. A library longer than the pages read says nothing yet, since the server's total counts
 * the archived ones too.
 */
export function libraryLine(forms: readonly CheckInFormSummary[], total: number): string {
  if (forms.length < total) return '';
  const active = forms.filter((form) => !form.isArchived);
  if (active.length === 0) return '';
  const ready = active.filter(isReady).length;
  return ready === 0
    ? $localize`${formsText(active.length)}:forms:, none published yet`
    : $localize`${formsText(active.length)}:forms:, ${ready}:ready: ready to assign`;
}

/** Where a form stands, said once at the top of its page. */
export interface Standing {
  readonly label: string;
  readonly tone: StatusPillTone;
  readonly note: string;
}

/** Where a form stands, by the same facts its card reads, so the card and the page never disagree. */
export function formStanding(form: CheckInFormSummary, clock: FormClock): Standing {
  const card = formCard(form, clock);
  const published = form.latestPublishedAtUtc ? dayOf(form.latestPublishedAtUtc, clock) : null;
  if (form.isArchived) {
    return {
      label: card.status,
      tone: card.tone,
      note: $localize`It can’t be changed or assigned until you restore it. Check-ins already sent from it are kept.`,
    };
  }
  if (!isReady(form)) {
    return {
      label: card.status,
      tone: card.tone,
      note: $localize`Publish it to assign it to clients.`,
    };
  }
  const day = published ?? '';
  return {
    label: card.status,
    tone: card.tone,
    note:
      form.draftVersionId !== null
        ? $localize`Published ${day}:day:. Your changes are not published yet: clients get the published questions until you publish them.`
        : $localize`Published ${day}:day:. Assign it from a client’s Check-ins tab.`,
  };
}

/** One version in the Versions sheet, newest first. */
export interface VersionRow {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly tone: StatusPillTone;
  readonly line: string;
  /** The version a client is assigned now. */
  readonly current: boolean;
}

export function versionRows(details: CheckInFormDetails, clock: FormClock): VersionRow[] {
  return [...details.versions]
    .sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber))
    .map((version) => {
      const questions = questionCountText(version.questionCount);
      const published = version.status === 'Published';
      return {
        id: version.id,
        title: versionLabel(version.versionNumber),
        state: statusLabel(version.status),
        tone: published ? 'success' : 'neutral',
        line:
          published && version.publishedAtUtc
            ? $localize`${dayOf(version.publishedAtUtc, clock)}:day: · ${questions}:questions:`
            : questions,
        current: version.id === details.form.latestPublishedVersionId,
      };
    });
}

/** How a question reads where it cannot be changed: its kind and what it allows, in one line. */
export function questionFacts(question: {
  questionType: CheckInQuestionType;
  isRequired: boolean;
  scaleMinimum: number | string | null;
  scaleMaximum: number | string | null;
  scaleStep: number | string | null;
}): string {
  const kind =
    question.questionType === 'NumericScale' &&
    question.scaleMinimum !== null &&
    question.scaleMaximum !== null
      ? Number(question.scaleStep ?? 1) === 1
        ? $localize`Number scale, ${Number(question.scaleMinimum)}:lowest: to ${Number(question.scaleMaximum)}:highest:`
        : $localize`Number scale, ${Number(question.scaleMinimum)}:lowest: to ${Number(question.scaleMaximum)}:highest: in steps of ${Number(question.scaleStep)}:step:`
      : questionTypeLabel(question.questionType);
  return question.isRequired
    ? $localize`${kind}:kind: · Required`
    : $localize`${kind}:kind: · Optional`;
}

/** A published version's questions as they read, in order. */
export function readQuestions(questions: readonly CheckInQuestionView[]): CheckInQuestionView[] {
  return [...questions].sort((a, b) => Number(a.order) - Number(b.order));
}

function question(
  questionType: CheckInQuestionType,
  prompt: string,
  helpText: string,
  isRequired: boolean,
  options: readonly string[] = [],
): QuestionDraft {
  return {
    ...emptyQuestion(questionType),
    prompt,
    helpText,
    isRequired,
    options:
      options.length > 0
        ? options.map((label) => ({ ...emptyOption(), label }))
        : emptyQuestion(questionType).options,
  };
}

/**
 * A weekly check-in to start from, the demo workspace's own (UI plan R0.1): six questions an empty
 * library offers as its first form. Nothing is saved until the coach saves it, and every word can be
 * changed first.
 */
export function weeklyCheckIn(): FormDraft {
  return {
    title: $localize`Weekly check-in`,
    description: $localize`Takes two minutes. Be honest: it is how I adjust your plan.`,
    questions: [
      question(
        'NumericScale',
        $localize`How was your energy this week?`,
        $localize`1 is exhausted, 10 is unstoppable.`,
        true,
      ),
      question('NumericScale', $localize`How well did you sleep?`, '', true),
      question(
        'NumericScale',
        $localize`How stressed did you feel?`,
        $localize`1 is calm, 10 is overwhelmed.`,
        true,
      ),
      question('SingleChoice', $localize`How closely did you follow your plan?`, '', true, [
        $localize`All of it`,
        $localize`Most of it`,
        $localize`About half`,
        $localize`Not much this week`,
      ]),
      question('LongText', $localize`What was your biggest win this week?`, '', false),
      question('LongText', $localize`Anything else I should know?`, '', false),
    ],
  };
}
