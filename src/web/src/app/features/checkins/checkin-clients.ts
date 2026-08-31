import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import { clientCheckInDenialMessage } from '../../core/i18n/display-labels';
import type {
  CheckInAnswerView,
  CheckInAssignmentListItem,
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
  private contextGeneration = 0;
  private selectionGeneration = 0;
  private listGeneration = 0;
  private detailGeneration = 0;
  private comparisonGeneration = 0;
  private loadingGeneration = 0;
  private savingGeneration = 0;

  private readonly workspaceToday = signal('');
  protected readonly clients = signal<ClientSummary[]>([]);
  protected readonly forms = signal<CheckInFormSummary[]>([]);
  protected readonly assignments = signal<CheckInAssignmentListItem[]>([]);
  /** How many assignments exist beyond the page that was loaded, so the list can say so. */
  protected readonly assignmentTotal = signal(0);
  protected readonly assignmentPageSize = 50;
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
   * the server would then refuse. The status comes from the list itself, so nothing has to be
   * fetched to work this out.
   */
  protected readonly comparable = computed(() =>
    this.assignments().filter((item) => item.response !== null && item.response.status !== 'Draft'),
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
      if (tenantId === this.loadedTenantId) {
        return;
      }

      this.loadedTenantId = tenantId;
      const generation = ++this.contextGeneration;
      this.resetActiveClient();
      if (tenantId !== null) {
        void this.loadContext(tenantId, generation);
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
    const tenantId = this.loadedTenantId;
    const generation = ++this.selectionGeneration;
    ++this.savingGeneration;
    this.saving.set(false);
    this.selectedClientId.set(clientId);
    this.assignments.set([]);
    this.assignmentTotal.set(0);
    this.detail.set(null);
    this.comparison.set(null);
    this.firstResponseId = '';
    this.secondResponseId = '';
    // A different client is a different form, so it starts pristine rather than inheriting the
    // reasons the previous client's half-filled form had earned.
    this.attempt.reset();
    this.clearMessages();
    await this.loadAssignments(clientId, tenantId, generation, true);
  }

  protected async loadMoreAssignments(): Promise<void> {
    const clientId = this.selectedClientId();
    const tenantId = this.loadedTenantId;
    const generation = this.selectionGeneration;
    if (!clientId || this.assignments().length >= this.assignmentTotal()) {
      return;
    }

    await this.loadAssignments(clientId, tenantId, generation, false);
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

    const tenantId = this.loadedTenantId;
    const clientId = this.selectedClientId();
    const selectionGeneration = this.selectionGeneration;
    const draft = { ...this.assignment() };
    const operation = ++this.savingGeneration;
    this.saving.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      if (!this.ownsSelection(tenantId, clientId, selectionGeneration)) {
        return;
      }

      await firstValueFrom(
        this.api.assignCheckIn(clientId, {
          formVersionId: draft.formVersionId,
          dueDate: draft.dueDate,
        }),
      );
      if (!this.ownsSaving(operation, tenantId, clientId, selectionGeneration)) {
        return;
      }

      this.notice.set($localize`Check-in assigned.`);
      this.assignment.set(emptyAssignment());
      // The form is empty again, so its reasons are not yet owed a second time.
      this.attempt.reset();
      await this.loadAssignments(clientId, tenantId, selectionGeneration, true);
    } catch (error) {
      if (this.ownsSaving(operation, tenantId, clientId, selectionGeneration)) {
        this.error.set(apiErrorMessage(error, $localize`This check-in could not be assigned.`));
      }
    } finally {
      if (this.savingGeneration === operation) {
        this.saving.set(false);
      }
    }
  }

  /**
   * The only place a full response is read, and only for the one check-in the coach opened. The
   * list gets its statuses from the list endpoint, so nothing here runs per assignment.
   */
  protected async openResponse(assignmentId: string): Promise<void> {
    const tenantId = this.loadedTenantId;
    const clientId = this.selectedClientId();
    const selectionGeneration = this.selectionGeneration;
    const request = ++this.detailGeneration;
    ++this.comparisonGeneration;
    const loading = this.beginLoading();
    this.clearMessages();
    this.comparison.set(null);
    try {
      const detail = await firstValueFrom(
        this.api.getClientCheckInResponse(clientId, assignmentId),
      );
      if (this.ownsDetail(request, tenantId, clientId, selectionGeneration)) {
        this.detail.set(detail);
      }
    } catch (error) {
      if (this.ownsDetail(request, tenantId, clientId, selectionGeneration)) {
        this.detail.set(null);
        this.error.set(apiErrorMessage(error, $localize`This check-in could not be loaded.`));
      }
    } finally {
      this.endLoading(loading);
    }
  }

  /** Review records that the coach has read it. It never changes an answer, and happens once. */
  protected async review(): Promise<void> {
    const detail = this.detail();
    if (!detail?.response) {
      return;
    }

    const tenantId = this.loadedTenantId;
    const clientId = this.selectedClientId();
    const selectionGeneration = this.selectionGeneration;
    const assignmentId = detail.assignment.id;
    const responseVersion = Number(detail.response.version);
    const operation = ++this.savingGeneration;
    ++this.detailGeneration;
    this.saving.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      if (!this.ownsSelection(tenantId, clientId, selectionGeneration)) {
        return;
      }

      const reviewed = await firstValueFrom(
        this.api.reviewCheckInResponse(clientId, assignmentId, responseVersion),
      );
      if (this.ownsSaving(operation, tenantId, clientId, selectionGeneration)) {
        this.detail.set(reviewed);
        this.notice.set($localize`Marked as reviewed.`);
      }
    } catch (error) {
      if (this.ownsSaving(operation, tenantId, clientId, selectionGeneration)) {
        this.error.set(apiErrorMessage(error, $localize`This check-in could not be reviewed.`));
      }
    } finally {
      if (this.savingGeneration === operation) {
        this.saving.set(false);
      }
    }
  }

  protected async compare(): Promise<void> {
    if (!this.firstResponseId || !this.secondResponseId) {
      this.error.set($localize`Choose two submitted check-ins to compare.`);
      return;
    }

    const tenantId = this.loadedTenantId;
    const clientId = this.selectedClientId();
    const selectionGeneration = this.selectionGeneration;
    const firstResponseId = this.firstResponseId;
    const secondResponseId = this.secondResponseId;
    const request = ++this.comparisonGeneration;
    ++this.detailGeneration;
    const loading = this.beginLoading();
    this.clearMessages();
    try {
      const comparison = await firstValueFrom(
        this.api.compareCheckInResponses(clientId, firstResponseId, secondResponseId),
      );
      if (this.ownsComparison(request, tenantId, clientId, selectionGeneration)) {
        this.comparison.set(comparison);
        this.detail.set(null);
      }
    } catch (error) {
      if (this.ownsComparison(request, tenantId, clientId, selectionGeneration)) {
        this.comparison.set(null);
        this.error.set(apiErrorMessage(error, $localize`These check-ins could not be compared.`));
      }
    } finally {
      this.endLoading(loading);
    }
  }

  private async loadContext(tenantId: string, generation: number): Promise<void> {
    const loading = this.beginLoading();
    this.clearMessages();
    try {
      // The workspace's own current date comes with its settings. The browser's calendar is not
      // the workspace calendar, and a due date is judged in the workspace's time zone by the
      // server, so deriving "today" here from `new Date()` disagreed with it around midnight.
      const [clients, forms, workspace] = await Promise.all([
        firstValueFrom(this.api.getClients()),
        firstValueFrom(this.api.listCheckInForms()),
        firstValueFrom(this.api.getWorkspace()),
      ]);
      if (this.loadedTenantId !== tenantId || this.contextGeneration !== generation) {
        return;
      }

      this.clients.set(clients);
      this.forms.set(forms.items);
      this.workspaceToday.set(workspace.currentDate);
    } catch (error) {
      if (this.loadedTenantId === tenantId && this.contextGeneration === generation) {
        this.error.set(apiErrorMessage(error, $localize`Check-in data could not be loaded.`));
      }
    } finally {
      this.endLoading(loading);
    }
  }

  /**
   * One request per client, not one per assignment. The list carries each response's status, which
   * is everything the badges and the comparison picker need; draft answers are not in it and are
   * not the coach's to read until the client submits.
   */
  private async loadAssignments(
    clientId: string,
    tenantId: string | null,
    selectionGeneration: number,
    reset: boolean,
  ): Promise<void> {
    if (!clientId) {
      if (reset) {
        this.assignments.set([]);
        this.assignmentTotal.set(0);
      }
      return;
    }

    const skip = reset ? 0 : this.assignments().length;
    const request = ++this.listGeneration;
    const loading = this.beginLoading();
    try {
      const list = await firstValueFrom(
        this.api.listClientCheckInAssignments(clientId, skip, this.assignmentPageSize),
      );
      if (!this.ownsList(request, tenantId, clientId, selectionGeneration)) {
        return;
      }

      this.assignments.set(reset ? list.items : appendUnique(this.assignments(), list.items));
      this.assignmentTotal.set(Number(list.total));
    } catch (error) {
      // A refusal that arrives after the coach moved on belongs to the client they left, so it must
      // not blank or explain away the one they are looking at now.
      if (!this.ownsList(request, tenantId, clientId, selectionGeneration)) {
        return;
      }

      const reason = featureAccessReason(error);
      if (reason === null) {
        if (reset) {
          this.assignments.set([]);
          this.assignmentTotal.set(0);
        }
        this.error.set(
          apiErrorMessage(error, $localize`This client's check-ins could not be loaded.`),
        );
      } else {
        this.assignments.set([]);
        this.assignmentTotal.set(0);
        this.denial.set(clientCheckInDenialMessage(reason));
      }
    } finally {
      this.endLoading(loading);
    }
  }

  private resetActiveClient(): void {
    ++this.selectionGeneration;
    ++this.listGeneration;
    ++this.detailGeneration;
    ++this.comparisonGeneration;
    ++this.savingGeneration;
    ++this.loadingGeneration;
    this.selectedClientId.set('');
    this.clients.set([]);
    this.forms.set([]);
    this.assignments.set([]);
    this.assignmentTotal.set(0);
    this.detail.set(null);
    this.comparison.set(null);
    this.loading.set(false);
    this.saving.set(false);
    this.clearMessages();
  }

  private ownsSelection(
    tenantId: string | null,
    clientId: string,
    selectionGeneration: number,
  ): boolean {
    return (
      tenantId !== null &&
      this.loadedTenantId === tenantId &&
      this.selectedClientId() === clientId &&
      this.selectionGeneration === selectionGeneration
    );
  }

  private ownsList(
    request: number,
    tenantId: string | null,
    clientId: string,
    selectionGeneration: number,
  ): boolean {
    return (
      this.listGeneration === request && this.ownsSelection(tenantId, clientId, selectionGeneration)
    );
  }

  private ownsDetail(
    request: number,
    tenantId: string | null,
    clientId: string,
    selectionGeneration: number,
  ): boolean {
    return (
      this.detailGeneration === request &&
      this.ownsSelection(tenantId, clientId, selectionGeneration)
    );
  }

  private ownsComparison(
    request: number,
    tenantId: string | null,
    clientId: string,
    selectionGeneration: number,
  ): boolean {
    return (
      this.comparisonGeneration === request &&
      this.ownsSelection(tenantId, clientId, selectionGeneration)
    );
  }

  private ownsSaving(
    operation: number,
    tenantId: string | null,
    clientId: string,
    selectionGeneration: number,
  ): boolean {
    return (
      this.savingGeneration === operation &&
      this.ownsSelection(tenantId, clientId, selectionGeneration)
    );
  }

  private beginLoading(): number {
    const generation = ++this.loadingGeneration;
    this.loading.set(true);
    return generation;
  }

  private endLoading(generation: number): void {
    if (this.loadingGeneration === generation) {
      this.loading.set(false);
    }
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

function appendUnique(
  current: readonly CheckInAssignmentListItem[],
  incoming: readonly CheckInAssignmentListItem[],
): CheckInAssignmentListItem[] {
  const ids = new Set(current.map((item) => item.assignment.id));
  return [
    ...current,
    ...incoming.filter((item) => {
      if (ids.has(item.assignment.id)) {
        return false;
      }

      ids.add(item.assignment.id);
      return true;
    }),
  ];
}
