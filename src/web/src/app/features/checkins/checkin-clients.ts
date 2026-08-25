import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import { clientCheckInDenialMessage } from '../../core/i18n/display-labels';
import type {
  CheckInAnswerView,
  CheckInAssignmentView,
  CheckInComparisonView,
  CheckInFormSummary,
  CheckInResponseDetail,
} from '../../core/api/generated';
import type { ClientSummary } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { validateAssignment, type AssignmentDraft } from './checkin-builder.models';
import { comparisonRows, formatAnswer, type ComparisonRowView } from './checkin-response.models';

/**
 * The coach's client-facing half: assigning a published version, reading what came back, marking it
 * reviewed, and putting two submissions side by side. Nothing here scores or rates an answer.
 */
@Component({
  selector: 'app-checkin-clients',
  imports: [DatePipe, FormsModule],
  templateUrl: './checkin-clients.html',
  styleUrl: './checkins.scss',
})
export class CheckInClients {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private loadedTenantId: string | null = null;

  protected readonly clients = signal<ClientSummary[]>([]);
  protected readonly forms = signal<CheckInFormSummary[]>([]);
  protected readonly assignments = signal<CheckInAssignmentView[]>([]);
  protected readonly responses = signal<Record<string, CheckInResponseDetail>>({});
  protected readonly detail = signal<CheckInResponseDetail | null>(null);
  protected readonly comparison = signal<CheckInComparisonView | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /**
   * Set when the server refused this client's check-ins and said why. It replaces the assignment
   * list, because "nothing assigned yet" and "you may not read what is assigned" are different
   * facts and a blocked coach was being shown the first when the second was true.
   */
  protected readonly denial = signal<string | null>(null);

  protected readonly selectedClientId = signal('');
  /**
   * A signal, not a plain object: `assignmentErrors` is a computed, so a mutated field would never
   * be seen and the Assign button would stay disabled however the form was filled in.
   */
  protected readonly assignment = signal<AssignmentDraft>(emptyAssignment());
  protected firstResponseId = '';
  protected secondResponseId = '';

  /** Only a published version can be assigned, so an unpublished lineage is not offered. */
  protected readonly assignableForms = computed(() =>
    this.forms().filter((form) => !form.isArchived && form.latestPublishedVersionId !== null),
  );

  protected readonly rows = computed<ComparisonRowView[]>(() => {
    const comparison = this.comparison();
    return comparison === null ? [] : comparisonRows(comparison);
  });

  /**
   * Only submitted or reviewed check-ins can be compared, so a draft is never offered as an option
   * the server would then refuse.
   */
  protected readonly comparable = computed(() =>
    this.assignments()
      .map((assignment) => ({
        assignment,
        response: this.responses()[assignment.id]?.response ?? null,
      }))
      .filter((entry) => entry.response !== null && entry.response.status !== 'Draft'),
  );

  protected readonly assignmentValidation = computed(() =>
    validateAssignment(
      { ...this.assignment(), clientProfileId: this.selectedClientId() },
      this.workspaceToday(),
    ),
  );

  protected readonly assignmentErrors = computed(() => this.assignmentValidation().errors);

  /** Decides when each assign-form reason is due on screen. See `FormAttempt` for the rule. */
  protected readonly attempt = new FormAttempt();

  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  protected assignmentFieldErrors(field: string): string[] {
    return this.assignmentValidation().byField[field] ?? [];
  }

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.loadContext();
      }
    });
  }

  /** The recorded answer as text, or an empty string when the question was left unanswered. */
  protected answerText(
    response: { answers: readonly CheckInAnswerView[] },
    questionId: string,
  ): string {
    return formatAnswer(
      response.answers.find((answer) => answer.questionId === questionId) ?? null,
    );
  }

  protected setAssignmentVersion(formVersionId: string): void {
    this.assignment.update((current) => ({ ...current, formVersionId }));
  }

  protected setAssignmentDueDate(dueDate: string): void {
    this.assignment.update((current) => ({ ...current, dueDate }));
  }

  protected async selectClient(clientId: string): Promise<void> {
    this.selectedClientId.set(clientId);
    this.detail.set(null);
    this.comparison.set(null);
    this.firstResponseId = '';
    this.secondResponseId = '';
    // A different client is a different form, so it starts pristine rather than inheriting the
    // reasons the previous client's half-filled form had earned.
    this.attempt.reset();
    await this.loadAssignments();
  }

  /**
   * A refused submit reveals every outstanding reason at once, says so in the summary region, and
   * moves focus there so the refusal is where the user already is. It deliberately does not write
   * into `error`: that channel reports what the server said, and a reason the form worked out for
   * itself has never been near the server.
   *
   * The button stays operable while the form is invalid. A disabled one cannot be clicked, is not
   * reached by Enter, and in Chrome cannot take focus at all, so it can neither be acted on nor
   * explain itself — measured in Phase 6A-6.
   */
  protected async assign(): Promise<void> {
    this.attempt.attempt();
    if (this.assignmentErrors().length > 0) {
      this.summary()?.nativeElement.focus();
      return;
    }

    this.saving.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      const draft = this.assignment();
      await firstValueFrom(
        this.api.assignCheckIn(this.selectedClientId(), {
          formVersionId: draft.formVersionId,
          dueDate: draft.dueDate,
        }),
      );
      this.notice.set($localize`Check-in assigned.`);
      this.assignment.set(emptyAssignment());
      // The form is empty again, so its reasons are not yet owed a second time.
      this.attempt.reset();
      await this.loadAssignments();
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`This check-in could not be assigned.`));
    } finally {
      this.saving.set(false);
    }
  }

  protected async openResponse(assignmentId: string): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    this.comparison.set(null);
    try {
      this.detail.set(
        await firstValueFrom(
          this.api.getClientCheckInResponse(this.selectedClientId(), assignmentId),
        ),
      );
    } catch (error) {
      this.detail.set(null);
      this.error.set(apiErrorMessage(error, $localize`This check-in could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  /** Review records that the coach has read it. It never changes an answer, and happens once. */
  protected async review(): Promise<void> {
    const detail = this.detail();
    if (!detail?.response) {
      return;
    }

    this.saving.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      this.detail.set(
        await firstValueFrom(
          this.api.reviewCheckInResponse(
            this.selectedClientId(),
            detail.assignment.id,
            Number(detail.response.version),
          ),
        ),
      );
      this.notice.set($localize`Marked as reviewed.`);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`This check-in could not be reviewed.`));
    } finally {
      this.saving.set(false);
    }
  }

  protected async compare(): Promise<void> {
    if (!this.firstResponseId || !this.secondResponseId) {
      this.error.set($localize`Choose two submitted check-ins to compare.`);
      return;
    }

    this.loading.set(true);
    this.clearMessages();
    try {
      this.comparison.set(
        await firstValueFrom(
          this.api.compareCheckInResponses(
            this.selectedClientId(),
            this.firstResponseId,
            this.secondResponseId,
          ),
        ),
      );
      this.detail.set(null);
    } catch (error) {
      this.comparison.set(null);
      this.error.set(apiErrorMessage(error, $localize`These check-ins could not be compared.`));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Today in the browser's own calendar. It is only used to keep an obviously past due date out of
   * the form; the server decides the real boundary in the workspace time zone.
   */
  private workspaceToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async loadContext(): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    try {
      const [clients, forms] = await Promise.all([
        firstValueFrom(this.api.getClients()),
        firstValueFrom(this.api.listCheckInForms()),
      ]);
      this.clients.set(clients);
      this.forms.set(forms.items);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Check-in data could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadAssignments(): Promise<void> {
    if (!this.selectedClientId()) {
      this.assignments.set([]);
      this.responses.set({});
      return;
    }

    this.loading.set(true);
    try {
      const list = await firstValueFrom(
        this.api.listClientCheckInAssignments(this.selectedClientId()),
      );
      this.assignments.set(list.assignments);

      // Each assignment's response is loaded so the list can show its real state and the comparison
      // can offer only submitted ones. One that cannot be read is simply left out rather than
      // failing the whole screen.
      const loaded = await Promise.all(
        list.assignments.map(async (assignment) => {
          try {
            return [
              assignment.id,
              await firstValueFrom(
                this.api.getClientCheckInResponse(this.selectedClientId(), assignment.id),
              ),
            ] as const;
          } catch {
            return null;
          }
        }),
      );
      this.responses.set(
        Object.fromEntries(
          loaded.filter((entry) => entry !== null) as (readonly [string, CheckInResponseDetail])[],
        ),
      );
    } catch (error) {
      this.assignments.set([]);
      this.responses.set({});
      const reason = featureAccessReason(error);
      if (reason === null) {
        this.error.set(
          apiErrorMessage(error, $localize`This client's check-ins could not be loaded.`),
        );
      } else {
        this.denial.set(clientCheckInDenialMessage(reason));
      }
    } finally {
      this.loading.set(false);
    }
  }

  protected statusOf(assignmentId: string): string | null {
    return this.responses()[assignmentId]?.response?.status ?? null;
  }

  protected isLate(assignmentId: string): boolean {
    return this.responses()[assignmentId]?.response?.isLate ?? false;
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
    this.denial.set(null);
  }
}

function emptyAssignment(): AssignmentDraft {
  return { clientProfileId: '', formVersionId: '', dueDate: '' };
}
