import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import { ownCheckInDenialMessage } from '../../core/i18n/display-labels';
import type { CheckInAssignmentView, CheckInResponseDetail } from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { isChoice } from './checkin-builder.models';
import {
  issuesByQuestion,
  issuesFromServer,
  isEditable,
  responseDraftFromDetail,
  submitGuard,
  toSaveRequest,
  withSelection,
  type AnswerDraft,
  type ResponseDraft,
  type ServerSubmissionFailure,
  type SubmissionIssue,
} from './checkin-response.models';

/**
 * The client's own check-ins. A draft is saved as-is, however incomplete, because losing what
 * someone typed is worse than storing something not yet valid; submission is where the whole
 * response is measured, and every refusal is shown at once rather than one at a time.
 */
@Component({
  selector: 'app-my-checkins',
  imports: [DatePipe, FormsModule],
  templateUrl: './my-checkins.html',
  styleUrl: './checkins.scss',
})
export class MyCheckIns {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private loadedTenantId: string | null = null;

  protected readonly assignments = signal<CheckInAssignmentView[]>([]);
  protected readonly detail = signal<CheckInResponseDetail | null>(null);
  protected readonly draft = signal<ResponseDraft | null>(null);
  protected readonly serverIssues = signal<SubmissionIssue[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /**
   * Set when the server closed check-ins for this workspace and said why. It replaces the list
   * rather than sitting above it: "you may not read these" must never be shown as "you have none".
   */
  protected readonly denial = signal<string | null>(null);

  protected readonly editable = computed(() => isEditable(this.detail()?.response ?? null));

  protected readonly guard = computed(() => {
    const detail = this.detail();
    const draft = this.draft();
    return detail && draft
      ? submitGuard(detail.version.questions, draft)
      : { canSubmit: false, issues: [] };
  });

  /**
   * Local refusals while editing; once the server has spoken, its answer is shown instead, because
   * it may know something the form could not predict.
   */
  protected readonly issues = computed(() => {
    const fromServer = this.serverIssues();
    return issuesByQuestion(fromServer.length > 0 ? fromServer : this.guard().issues);
  });

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.loadAssignments();
      }
    });
  }

  protected isChoice = isChoice;

  /** Decides when each question's reason is due on screen. See `FormAttempt` for the rule. */
  protected readonly attempt = new FormAttempt();

  /**
   * Every outstanding reason paired with the question it belongs to. The summary names the question
   * as well as the rule, because "this question has to be answered" does not say which one when two
   * of them are outstanding.
   */
  protected readonly outstanding = computed(() => {
    const detail = this.detail();
    if (detail === null) {
      return [];
    }

    const prompts = new Map(
      detail.version.questions.map((question) => [question.questionKey, question.prompt]),
    );
    const fromServer = this.serverIssues();
    const source = fromServer.length > 0 ? fromServer : this.guard().issues;
    return source.map((issue) => ({
      questionKey: issue.questionKey,
      prompt: prompts.get(issue.questionKey) ?? '',
      message: issue.message,
    }));
  });

  protected questionIssues(questionKey: string): string[] {
    return this.issues()[questionKey] ?? [];
  }

  /** One touched-state key per question, matching the key its reasons are grouped under. */
  protected questionField(questionKey: string): string {
    return `question:${questionKey}`;
  }

  protected answerFor(questionId: string): AnswerDraft | null {
    return this.draft()?.answers.find((answer) => answer.questionId === questionId) ?? null;
  }

  protected isSelected(questionId: string, optionId: string): boolean {
    return this.answerFor(questionId)?.selectedOptionIds.includes(optionId) ?? false;
  }

  protected async open(assignmentId: string): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    try {
      const detail = await firstValueFrom(this.api.getOwnCheckInResponse(assignmentId));
      this.detail.set(detail);
      this.draft.set(responseDraftFromDetail(detail));
      // A newly opened check-in is pristine, whatever the last one had earned.
      this.attempt.reset();
    } catch (error) {
      this.detail.set(null);
      this.draft.set(null);
      const reason = featureAccessReason(error);
      if (reason === null) {
        this.error.set(apiErrorMessage(error, $localize`This check-in could not be opened.`));
      } else {
        this.denial.set(ownCheckInDenialMessage(reason));
      }
    } finally {
      this.loading.set(false);
    }
  }

  protected setText(questionId: string, value: string): void {
    this.updateAnswer(questionId, (answer) => ({ ...answer, textValue: value }));
  }

  protected setNumber(questionId: string, value: string): void {
    const parsed = value === '' ? null : Number(value);
    this.updateAnswer(questionId, (answer) => ({
      ...answer,
      numericValue: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    }));
  }

  protected toggleOption(questionId: string, optionId: string): void {
    this.updateAnswer(questionId, (answer) => withSelection(answer, optionId));
  }

  protected async saveDraft(): Promise<void> {
    const draft = this.draft();
    if (!draft || !this.editable()) {
      return;
    }

    this.saving.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      const saved = await firstValueFrom(
        this.api.saveOwnCheckInDraftResponse(draft.assignmentId, toSaveRequest(draft)),
      );
      this.detail.set(saved);
      this.draft.set(responseDraftFromDetail(saved));
      this.notice.set($localize`Draft saved. You can come back and finish it later.`);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`This draft could not be saved.`));
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Saves first so the submitted record matches what is on screen, then submits. A refusal keeps
   * the draft exactly as it was and lists every reason.
   */
  protected async submit(): Promise<void> {
    // Recorded before the guards: trying to send an incomplete check-in is exactly the moment every
    // outstanding reason becomes due, whether or not the attempt gets as far as the server.
    this.attempt.attempt();
    const draft = this.draft();
    if (!draft || !this.editable() || !this.guard().canSubmit) {
      return;
    }

    this.saving.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      const saved = await firstValueFrom(
        this.api.saveOwnCheckInDraftResponse(draft.assignmentId, toSaveRequest(draft)),
      );
      this.detail.set(saved);
      this.draft.set(responseDraftFromDetail(saved));

      const version = saved.response === null ? null : Number(saved.response.version);
      if (version === null) {
        this.error.set($localize`There is nothing to submit yet.`);
        return;
      }

      const submitted = await firstValueFrom(
        this.api.submitOwnCheckInResponse(draft.assignmentId, version),
      );
      this.detail.set(submitted);
      this.draft.set(responseDraftFromDetail(submitted));
      this.attempt.reset();
      this.notice.set($localize`Check-in submitted. It can no longer be changed.`);
    } catch (error) {
      const failures = submissionFailures(error);
      if (failures.length > 0) {
        this.serverIssues.set(issuesFromServer(failures));
        this.error.set($localize`This check-in is not complete yet.`);
      } else {
        this.error.set(apiErrorMessage(error, $localize`This check-in could not be submitted.`));
      }
    } finally {
      this.saving.set(false);
    }
  }

  private updateAnswer(questionId: string, change: (answer: AnswerDraft) => AnswerDraft): void {
    // A local edit invalidates the server's last verdict, so stale messages are cleared.
    this.serverIssues.set([]);
    this.draft.update((current) =>
      current === null
        ? current
        : {
            ...current,
            answers: current.answers.map((answer) =>
              answer.questionId === questionId ? change(answer) : answer,
            ),
          },
    );
  }

  private async loadAssignments(): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    // This runs on a workspace switch, so an answer sheet opened in the previous workspace must
    // not survive into the next one. The shell also routes away, but that is its choice, not ours.
    this.detail.set(null);
    this.draft.set(null);
    try {
      const list = await firstValueFrom(this.api.listOwnCheckInAssignments());
      this.assignments.set(list.assignments);
    } catch (error) {
      this.assignments.set([]);
      const reason = featureAccessReason(error);
      if (reason === null) {
        this.error.set(apiErrorMessage(error, $localize`Your check-ins could not be loaded.`));
      } else {
        this.denial.set(ownCheckInDenialMessage(reason));
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Including the denial, so a refusal from one workspace is not still on screen in the next. */
  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
    this.denial.set(null);
    this.serverIssues.set([]);
  }
}

/**
 * The submit route reports every refusal at once in a `failures` extension alongside the standard
 * validation problem, so the form can place each message on its own question.
 */
function submissionFailures(error: unknown): ServerSubmissionFailure[] {
  if (!(error instanceof HttpErrorResponse)) {
    return [];
  }

  const failures = (error.error as { failures?: unknown } | undefined)?.failures;
  return Array.isArray(failures) ? (failures as ServerSubmissionFailure[]) : [];
}
