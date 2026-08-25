import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CheckInFormDetails,
  CheckInFormSummary,
  CheckInFormVersionView,
  CheckInQuestionType,
} from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  CHECK_IN_LIMITS,
  draftFromVersion,
  emptyForm,
  emptyOption,
  emptyQuestion,
  isChoice,
  moveItem,
  toCreateRequest,
  toSaveRequest,
  validateDraft,
  withQuestionType,
  type FormDraft,
  type QuestionDraft,
} from './checkin-builder.models';

/**
 * The coach's check-in form library and builder. Editing published content is not offered as an
 * edit: the only way forward from a published version is to derive a new draft, which is what keeps
 * an assigned client's questions from changing under them.
 */
@Component({
  selector: 'app-checkin-forms',
  imports: [FormsModule],
  templateUrl: './checkin-forms.html',
  styleUrl: './checkins.scss',
})
export class CheckInForms {
  protected readonly limits = CHECK_IN_LIMITS;
  protected readonly questionTypes: readonly CheckInQuestionType[] = [
    'ShortText',
    'LongText',
    'SingleChoice',
    'MultipleChoice',
    'NumericScale',
  ];

  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private loadedTenantId: string | null = null;

  protected readonly forms = signal<CheckInFormSummary[]>([]);
  protected readonly selected = signal<CheckInFormDetails | null>(null);
  protected readonly editingVersion = signal<CheckInFormVersionView | null>(null);
  protected readonly draft = signal<FormDraft>(emptyForm());
  protected readonly creating = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly validation = computed(() => validateDraft(this.draft()));

  /** Decides when each builder reason is due on screen. See `FormAttempt` for the rule. */
  protected readonly attempt = new FormAttempt();

  /**
   * Every outstanding reason in one list, form-level first and then question by question, which is
   * what the summary region names once a save has been refused.
   */
  protected readonly outstanding = computed(() => {
    const validation = this.validation();
    return [
      ...validation.formErrors,
      ...this.draft().questions.flatMap(
        (question) => validation.questionErrors[question.key] ?? [],
      ),
    ];
  });

  /** The open draft of the selected lineage, if it has one. At most one exists by construction. */
  protected readonly openDraft = computed(
    () => this.selected()?.versions.find((version) => version.status === 'Draft') ?? null,
  );

  protected readonly latestPublished = computed(
    () => this.selected()?.form.latestPublishedVersionId ?? null,
  );

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.loadForms();
      }
    });
  }

  protected isChoice(questionType: CheckInQuestionType): boolean {
    return isChoice(questionType);
  }

  protected questionErrors(question: QuestionDraft): string[] {
    return this.validation().questionErrors[question.key] ?? [];
  }

  protected formFieldErrors(field: string): string[] {
    return this.validation().byField[field] ?? [];
  }

  /** One touched-state key per question, kept distinct from the form's own field names. */
  protected questionField(question: QuestionDraft): string {
    return `question:${question.key}`;
  }

  protected startNewForm(): void {
    this.creating.set(true);
    this.selected.set(null);
    this.editingVersion.set(null);
    this.draft.set(emptyForm());
    this.attempt.reset();
    this.clearMessages();
  }

  protected cancelEditing(): void {
    this.creating.set(false);
    this.editingVersion.set(null);
    this.draft.set(emptyForm());
    this.attempt.reset();
    this.clearMessages();
  }

  protected async openForm(formId: string): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    try {
      const details = await firstValueFrom(this.api.getCheckInForm(formId));
      this.selected.set(details);
      this.creating.set(false);
      this.editingVersion.set(null);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`This check-in form could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  /** Opens a version for editing. Only a draft is editable; a published one is read-only. */
  protected async editVersion(versionId: string): Promise<void> {
    const form = this.selected();
    if (!form) {
      return;
    }

    this.loading.set(true);
    this.clearMessages();
    try {
      const version = await firstValueFrom(this.api.getCheckInFormVersion(form.form.id, versionId));
      this.editingVersion.set(version);
      this.draft.set(draftFromVersion(version));
      this.creating.set(false);
      // A different version is a different form: its reasons are earned again from scratch.
      this.attempt.reset();
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`This version could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  protected setTitle(title: string): void {
    this.draft.update((current) => ({ ...current, title }));
  }

  protected setDescription(description: string): void {
    this.draft.update((current) => ({ ...current, description }));
  }

  protected setPrompt(index: number, prompt: string): void {
    this.updateQuestion(index, (question) => ({ ...question, prompt }));
  }

  protected setRequired(index: number, isRequired: boolean): void {
    this.updateQuestion(index, (question) => ({ ...question, isRequired }));
  }

  /** A cleared scale field becomes null rather than 0, which would be a different scale. */
  protected setScale(
    index: number,
    field: 'scaleMinimum' | 'scaleMaximum' | 'scaleStep',
    value: string | number | null,
  ): void {
    const parsed = value === '' || value === null ? null : Number(value);
    this.updateQuestion(index, (question) => ({
      ...question,
      [field]: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    }));
  }

  protected addQuestion(): void {
    this.draft.update((current) => ({
      ...current,
      questions: [...current.questions, emptyQuestion('ShortText')],
    }));
  }

  protected removeQuestion(index: number): void {
    this.draft.update((current) => ({
      ...current,
      questions: current.questions.filter((_, position) => position !== index),
    }));
  }

  protected moveQuestion(index: number, offset: number): void {
    this.draft.update((current) => ({
      ...current,
      questions: moveItem(current.questions, index, index + offset),
    }));
  }

  protected changeQuestionType(index: number, questionType: CheckInQuestionType): void {
    this.draft.update((current) => ({
      ...current,
      questions: current.questions.map((question, position) =>
        position === index ? withQuestionType(question, questionType) : question,
      ),
    }));
  }

  protected addOption(index: number): void {
    this.updateQuestion(index, (question) => ({
      ...question,
      options: [...question.options, emptyOption()],
    }));
  }

  protected removeOption(index: number, optionIndex: number): void {
    this.updateQuestion(index, (question) => ({
      ...question,
      options: question.options.filter((_, position) => position !== optionIndex),
    }));
  }

  protected setOptionLabel(index: number, optionIndex: number, label: string): void {
    this.updateQuestion(index, (question) => ({
      ...question,
      options: question.options.map((option, position) =>
        position === optionIndex ? { ...option, label } : option,
      ),
    }));
  }

  /**
   * A refused save reveals every outstanding reason at once and names them in the summary region,
   * rather than writing a derived reason into `error`, which reports what the server said.
   */
  protected async save(): Promise<void> {
    this.attempt.attempt();
    if (!this.validation().isValid) {
      return;
    }

    this.saving.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      const editing = this.editingVersion();
      if (editing === null) {
        const created = await firstValueFrom(
          this.api.createCheckInForm(toCreateRequest(this.draft())),
        );
        this.selected.set(created);
        this.creating.set(false);
        this.attempt.reset();
        this.notice.set($localize`Check-in form created as a draft.`);
        await this.loadForms();
      } else {
        const saved = await firstValueFrom(
          this.api.saveCheckInDraft(
            editing.formId,
            editing.id,
            toSaveRequest(this.draft(), Number(editing.version)),
          ),
        );
        this.editingVersion.set(saved);
        this.notice.set($localize`Draft saved.`);
        await this.openForm(saved.formId);
        await this.editVersion(saved.id);
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`This draft could not be saved.`));
    } finally {
      this.saving.set(false);
    }
  }

  /** Publishing is one-way and freezes the version permanently, so it is confirmed first. */
  protected async publish(versionId: string, version: number): Promise<void> {
    const form = this.selected();
    if (!form) {
      return;
    }

    this.saving.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.publishCheckInVersion(form.form.id, versionId, version));
      this.editingVersion.set(null);
      this.notice.set($localize`Version published. It can no longer be edited.`);
      await this.openForm(form.form.id);
      await this.loadForms();
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`This version could not be published.`));
    } finally {
      this.saving.set(false);
    }
  }

  /** Carries every question key forward, so a re-worded question stays the same question. */
  protected async deriveDraft(sourceVersionId: string): Promise<void> {
    const form = this.selected();
    if (!form) {
      return;
    }

    this.saving.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      const derived = await firstValueFrom(
        this.api.deriveCheckInDraft(form.form.id, {
          sourceVersionId,
          formVersion: Number(form.form.version),
        }),
      );
      await this.openForm(form.form.id);
      this.editingVersion.set(derived);
      this.draft.set(draftFromVersion(derived));
      this.notice.set($localize`New draft created from the published version.`);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`A new draft could not be created.`));
    } finally {
      this.saving.set(false);
    }
  }

  private updateQuestion(index: number, change: (question: QuestionDraft) => QuestionDraft): void {
    this.draft.update((current) => ({
      ...current,
      questions: current.questions.map((question, position) =>
        position === index ? change(question) : question,
      ),
    }));
  }

  private async loadForms(): Promise<void> {
    this.loading.set(true);
    try {
      const page = await firstValueFrom(this.api.listCheckInForms());
      this.forms.set(page.items);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Check-in forms could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}
