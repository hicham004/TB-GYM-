import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CheckInFormDetails,
  CheckInFormVersionView,
  CheckInQuestionType,
  CheckInQuestionView,
} from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Button, ButtonLink } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { Icon } from '../../ui/icon';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import { selectOptions, UiSelect } from '../../ui/select';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import {
  CHECK_IN_LIMITS,
  draftFromVersion,
  emptyForm,
  emptyOption,
  emptyQuestion,
  isChoice,
  moveItem,
  questionIssues,
  questionTypeLabel,
  toCreateRequest,
  toSaveRequest,
  validateDraft,
  withQuestionType,
  type FormDraft,
  type QuestionDraft,
  type QuestionIssues,
} from './checkin-builder.models';
import { CheckInFormSheets } from './checkin-form-sheets';
import {
  formStanding,
  questionFacts,
  readQuestions,
  weeklyCheckIn,
  type FormClock,
} from './checkin-forms.models';

type PageState = 'loading' | 'ready' | 'missing' | 'error';
type Busy = 'save' | 'publish' | 'change' | 'archive' | 'restore';

/** What the confirmation asks before typed work is lost, and its two answers. */
interface LossQuestion {
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
  readonly cancel: string;
}

const QUESTION_TYPES: readonly CheckInQuestionType[] = [
  'ShortText',
  'LongText',
  'SingleChoice',
  'MultipleChoice',
  'NumericScale',
];

/** How far the editor's sticky bar reaches up the screen: a focused box stops above it. */
const BAR_CLEARANCE = '5.5rem';

/**
 * One check-in form on its own page (audit A14b, AUTH-8), in place of the old library's right-hand pane.
 * A new form and a draft are written here, question by question; Publish is the one action and saves
 * what is typed first. A published form reads as its questions, with Change the questions to start
 * the next version: publishing never changes what a client was already sent (CHK-001, CHK-004). The
 * name and description belong to the form and are changed in a sheet, on their own token.
 *
 * Each write applies what the server answered; the form's own record is read again afterwards, and a
 * failure of that read is said as such, never as a failed write. A write refused because the form
 * changed elsewhere (409) offers to reload it, since every retry on the old token would be refused.
 */
@Component({
  selector: 'app-checkin-form',
  imports: [
    Button,
    ButtonLink,
    CheckInFormSheets,
    Checkbox,
    Control,
    Field,
    FormSummary,
    FormsModule,
    Icon,
    RouterLink,
    Skeleton,
    StatusPill,
    UiConfirm,
    UiMenu,
    UiSelect,
  ],
  templateUrl: './checkin-form.html',
  styleUrl: './checkin-form.scss',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class CheckInForm implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly summary = viewChild(FormSummary);
  private readonly sheets = viewChild(CheckInFormSheets);
  private readonly lossDialog = viewChild.required<TemplateRef<unknown>>('lossDialog');
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private loadedKey: string | null = null;

  protected readonly limits = CHECK_IN_LIMITS;
  protected readonly kinds = selectOptions(QUESTION_TYPES, questionTypeLabel);
  protected readonly kindLabel = $localize`Kind of answer`;
  protected readonly loadingLabel = $localize`Loading the check-in form…`;
  protected readonly isChoice = isChoice;
  private readonly leaving: LossQuestion = {
    title: $localize`Leave without saving?`,
    message: $localize`Your changes to this check-in form aren’t saved. If you leave now, they are lost.`,
    confirm: $localize`Leave without saving`,
    cancel: $localize`Stay`,
  };
  private readonly archiving: LossQuestion = {
    title: $localize`Archive without saving?`,
    message: $localize`Your changes to this check-in form aren’t saved. If you archive it now, they are lost.`,
    confirm: $localize`Archive without saving`,
    cancel: $localize`Keep editing`,
  };
  protected readonly question = signal<LossQuestion>(this.leaving);

  private readonly routeId = computed(() => {
    const id = this.params().get('formId');
    return id && id !== 'new' ? id : null;
  });
  /** The form this page created, until the address names it (and if the move never happens). */
  private readonly createdId = signal<string | null>(null);
  protected readonly formId = computed(() => this.routeId() ?? this.createdId());
  protected readonly state = signal<PageState>('loading');
  protected readonly details = signal<CheckInFormDetails | null>(null);
  /** The version on screen: the draft being written, else the one clients are sent. */
  protected readonly shown = signal<CheckInFormVersionView | null>(null);
  protected readonly draft = signal<FormDraft>(emptyForm());
  private readonly savedDraft = signal(JSON.stringify(this.draft()));
  protected readonly busy = signal<Busy | null>(null);
  /** What the server said when it refused to save or publish; the form's summary says it. */
  protected readonly error = signal<string | null>(null);
  /** A refused change of the whole form (a new draft, archive, restore), said under its standing. */
  protected readonly problem = signal<string | null>(null);
  /** The form changed elsewhere since this page read it: only reloading it can go on. */
  protected readonly stale = signal(false);
  protected readonly attempt = new FormAttempt();

  protected readonly isNew = computed(() => this.formId() === null);
  protected readonly isArchived = computed(() => this.details()?.form.isArchived === true);
  protected readonly editable = computed(
    () => this.isNew() || (this.shown()?.status === 'Draft' && !this.isArchived()),
  );
  private readonly dirty = computed(
    () => this.editable() && JSON.stringify(this.draft()) !== this.savedDraft(),
  );
  protected readonly validation = computed(() => validateDraft(this.draft()));
  /** Each question's reasons, by its key, worked out once a draft changes. */
  protected readonly issues = computed(() => {
    const byKey = new Map<string, QuestionIssues>();
    for (const question of this.draft().questions) {
      byKey.set(question.key, questionIssues(question));
    }
    return byKey;
  });
  /** How many boxes say what is wrong once a save is refused: the summary points at them. */
  protected readonly markedCount = computed(() => {
    const validation = this.validation();
    const boxes = [...this.issues().values()].filter(
      (issues) =>
        issues.prompt.length +
          issues.hint.length +
          Object.keys(issues.choice).length +
          issues.lowest.length +
          issues.highest.length +
          issues.step.length >
        0,
    ).length;
    return (
      (validation.byField['title']?.length ?? 0) +
      (validation.byField['description']?.length ?? 0) +
      boxes
    );
  });
  /** What no box can show (no question at all, or a question's number of choices), said in the summary. */
  protected readonly unmarked = computed(() => [
    ...(this.validation().byField['form'] ?? []),
    ...this.draft().questions.flatMap((question, index) =>
      (this.issues().get(question.key)?.choices ?? []).map(
        (message) => $localize`Question ${index + 1}:number:: ${message}:reason:`,
      ),
    ),
  ]);
  protected readonly clock = computed<FormClock>(() => ({
    locale: this.locale,
    timeZone: this.calendar.timeZone(),
    today: this.calendar.today(),
  }));
  protected readonly standing = computed(() => {
    const details = this.details();
    return details ? formStanding(details.form, this.clock()) : null;
  });
  protected readonly pageTitle = computed(() =>
    this.isNew()
      ? $localize`New check-in form`
      : (this.details()?.form.title ?? $localize`Check-in form`),
  );
  /** Publish names what it does: the first version, or the changes to one clients already get. */
  protected readonly publishLabel = computed(() =>
    this.details()?.form.latestPublishedVersionId ? $localize`Publish changes` : $localize`Publish`,
  );
  protected readonly questionsRead = computed(() => readQuestions(this.shown()?.questions ?? []));
  protected readonly moreItems = computed<UiMenuItem[]>(() => {
    const items: UiMenuItem[] = [];
    if (!this.isNew() && !this.isArchived()) {
      items.push({ label: $localize`Name and description`, action: 'name' });
    }
    if (!this.isNew()) {
      items.push({ label: $localize`Versions`, action: 'versions' });
    }
    if (!this.isNew() && !this.isArchived()) {
      items.push({
        label: $localize`Archive form`,
        hint: $localize`Kept, and no longer offered to assign`,
        action: 'archive',
      });
    }
    return items;
  });

  constructor() {
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(() => unregister());
    this.scope.onReset(() => {
      this.loadedKey = null;
      this.sheets()?.close();
      this.busy.set(null);
      this.state.set('loading');
    });
    // A form created here is named by the address once it moves; any later move starts afresh.
    effect(() => {
      this.routeId();
      untracked(() => this.createdId.set(null));
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const id = this.formId();
      const key = `${tenantId}:${id ?? 'new'}`;
      if (tenantId && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load(id);
      }
    });
    // A box or a question's menu reached by keyboard stops above the editor's bar, never under it
    // (WCAG 2.4.11): the page's root keeps that much room at its foot while the bar is drawn.
    const root = inject(DOCUMENT).documentElement;
    effect(() => {
      root.style.scrollPaddingBlockEnd =
        this.state() === 'ready' && this.editable() ? BAR_CLEARANCE : '';
    });
    inject(DestroyRef).onDestroy(() => (root.style.scrollPaddingBlockEnd = ''));
  }

  // ---------- loading ----------

  protected retry(): void {
    void this.load(this.formId());
  }

  /** The form changed elsewhere: read it as it is now, leaving behind what was typed here. */
  protected reloadForm(): void {
    const id = this.formId();
    this.loadedKey = `${this.tenants.selectedTenantId()}:${id ?? 'new'}`;
    void this.load(id);
  }

  private async load(formId: string | null): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      this.error.set(null);
      this.problem.set(null);
      this.stale.set(false);
      this.attempt.reset();
      try {
        // The workspace's day and zone come with the form, so its publish days read on its clock.
        const today = this.calendar.resolveToday();
        if (formId === null) {
          this.details.set(null);
          this.shown.set(null);
          const start = this.route.snapshot.queryParamMap.get('start');
          this.setCleanDraft(start === 'weekly' ? weeklyCheckIn() : emptyForm());
        } else {
          await owner.wait(Promise.all([this.read(owner, formId), today]));
        }
        this.state.set('ready');
      } catch (error) {
        if (!owner.current) return;
        this.state.set(
          error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error',
        );
      }
      // The heading of whatever the page now says takes focus: the form, or why it is not here.
      this.focusHeading();
    });
  }

  /**
   * Reads the form and the version to show: a form being changed opens on its draft, any other on the
   * version clients are sent; an archived one reads, never writes.
   */
  private async read(owner: TenantOperation, formId: string): Promise<void> {
    const details = await owner.wait(firstValueFrom(this.api.getCheckInForm(formId)));
    const versionId = this.versionToShow(details);
    const version = versionId
      ? await owner.wait(firstValueFrom(this.api.getCheckInFormVersion(formId, versionId)))
      : null;
    this.details.set(details);
    this.shown.set(version);
    this.setCleanDraft(version ? draftFromVersion(version) : emptyForm());
  }

  private versionToShow(details: CheckInFormDetails): string | null {
    const form = details.form;
    return form.isArchived
      ? (form.latestPublishedVersionId ?? form.draftVersionId)
      : (form.draftVersionId ?? form.latestPublishedVersionId);
  }

  // ---------- editing ----------

  protected setTitle(title: string): void {
    this.draft.update((current) => ({ ...current, title }));
  }

  protected setDescription(description: string): void {
    this.draft.update((current) => ({ ...current, description }));
  }

  protected setPrompt(index: number, prompt: string): void {
    this.updateQuestion(index, (question) => ({ ...question, prompt }));
  }

  protected setHint(index: number, helpText: string): void {
    this.updateQuestion(index, (question) => ({ ...question, helpText }));
  }

  protected setRequired(index: number, isRequired: boolean): void {
    this.updateQuestion(index, (question) => ({ ...question, isRequired }));
  }

  /**
   * A cleared number becomes null rather than 0, which would be a different scale. The boxes bind
   * through ngModel, which never writes back the number a box itself reported, so a "-" or a "." typed
   * on the way to "-5" or "0.5" stays in the box.
   */
  protected setScale(
    index: number,
    field: 'scaleMinimum' | 'scaleMaximum' | 'scaleStep',
    value: number | string | null,
  ): void {
    const parsed = value === null || value === '' ? null : Number(value);
    this.updateQuestion(index, (question) => ({
      ...question,
      [field]: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    }));
  }

  protected changeQuestionType(index: number, questionType: string): void {
    if (!QUESTION_TYPES.includes(questionType as CheckInQuestionType)) return;
    this.updateQuestion(index, (question) =>
      withQuestionType(question, questionType as CheckInQuestionType),
    );
  }

  /** A new question is a short answer, its question box takes focus. */
  protected addQuestion(): void {
    const question = emptyQuestion('ShortText');
    this.draft.update((current) => ({ ...current, questions: [...current.questions, question] }));
    this.focus(`q-${question.key}`);
  }

  protected questionMenu(index: number): UiMenuItem[] {
    const count = this.draft().questions.length;
    return [
      { label: $localize`Move up`, action: 'up', disabled: index === 0 },
      { label: $localize`Move down`, action: 'down', disabled: index === count - 1 },
      { label: $localize`Remove question`, action: 'remove', danger: true },
    ];
  }

  protected questionAction(action: string, index: number): void {
    const questions = this.draft().questions;
    const key = questions[index]?.key;
    if (key === undefined) return;
    if (action === 'up' || action === 'down') {
      const target = action === 'up' ? index - 1 : index + 1;
      this.draft.update((current) => ({
        ...current,
        questions: moveItem(current.questions, index, target),
      }));
      // The question keeps focus where it moved to, as its menu did.
      this.focus(`q-menu-${key}`, true);
    } else if (action === 'remove') {
      this.draft.update((current) => ({
        ...current,
        questions: current.questions.filter((_, position) => position !== index),
      }));
      const next = questions[index + 1] ?? questions[index - 1];
      this.focus(next ? `q-${next.key}` : 'add-question');
    }
  }

  protected addChoice(index: number): void {
    const option = emptyOption();
    this.updateQuestion(index, (question) => ({
      ...question,
      options: [...question.options, option],
    }));
    this.focus(`choice-${option.key}`);
  }

  protected removeChoice(index: number, choiceIndex: number): void {
    const question = this.draft().questions[index];
    this.updateQuestion(index, (current) => ({
      ...current,
      options: current.options.filter((_, position) => position !== choiceIndex),
    }));
    const next = question?.options[choiceIndex + 1] ?? question?.options[choiceIndex - 1];
    this.focus(next ? `choice-${next.key}` : `add-choice-${question?.key}`);
  }

  protected setChoice(index: number, choiceIndex: number, label: string): void {
    this.updateQuestion(index, (question) => ({
      ...question,
      options: question.options.map((option, position) =>
        position === choiceIndex ? { ...option, label } : option,
      ),
    }));
  }

  /** The messages due under one box: shown once it is left, or once a save was refused. */
  protected due(field: string, messages: readonly string[] | undefined): string[] | null {
    return messages && this.attempt.shows(field, messages) ? [...messages] : null;
  }

  /** Leaving one choice reveals its own reason, and the group's (how many choices there are). */
  protected leaveChoice(question: QuestionDraft, choiceKey: string): void {
    this.attempt.touch(`choice:${choiceKey}`);
    this.attempt.touch(`choices:${question.key}`);
  }

  /** "Remove choice 2 of question 4": each remove button names what it removes. */
  protected removeChoiceLabel(index: number, choice: number): string {
    return $localize`Remove choice ${choice + 1}:choice: of question ${index + 1}:question:`;
  }

  /** A scale's hint is where a client learns what its ends mean. */
  protected hintHelp(question: QuestionDraft): string {
    return question.questionType === 'NumericScale' &&
      question.scaleMinimum !== null &&
      question.scaleMaximum !== null
      ? $localize`Shown under the question, such as what ${question.scaleMinimum}:lowest: and ${question.scaleMaximum}:highest: mean.`
      : $localize`Shown under the question.`;
  }

  protected facts(question: CheckInQuestionView): string {
    return questionFacts(question);
  }

  protected choicesOf(question: CheckInQuestionView): string[] {
    return [...question.options]
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map((option) => option.label);
  }

  private updateQuestion(index: number, change: (question: QuestionDraft) => QuestionDraft): void {
    this.draft.update((current) => ({
      ...current,
      questions: current.questions.map((question, position) =>
        position === index ? change(question) : question,
      ),
    }));
  }

  // ---------- the page's actions ----------

  protected chosen(action: string): void {
    if (this.busy()) return;
    switch (action) {
      case 'name':
        this.sheets()?.rename();
        break;
      case 'versions':
        this.sheets()?.versions();
        break;
      case 'archive':
        void this.setArchived(true);
        break;
    }
  }

  protected publish(): Promise<void> {
    return this.commit(true);
  }

  protected saveDraft(): Promise<void> {
    return this.commit(false);
  }

  /**
   * Saves what is typed and, when asked, publishes it, applying each answer as it comes. A new form is
   * created, its questions read back for their keys, and the address moves to its own; a changed draft
   * is saved before it is published, each on its own token. A refusal keeps everything typed and says
   * why in the form's summary.
   */
  private async commit(publish: boolean): Promise<void> {
    if (this.busy()) return;
    if (!this.validation().isValid) {
      this.refuse();
      return;
    }
    const existing = this.formId();
    if (!publish && existing !== null && !this.dirty()) {
      // A draft with nothing new is already saved: there is nothing to send.
      this.toast.show(this.savedWords(), { tone: 'success' });
      return;
    }
    return this.scope.run('commit', async (owner) => {
      this.busy.set(publish ? 'publish' : 'save');
      this.error.set(null);
      this.problem.set(null);
      this.stale.set(false);
      let formId = existing;
      try {
        await owner.wait(this.csrf.refresh());
        if (formId === null) {
          const created = await owner.wait(
            firstValueFrom(this.api.createCheckInForm(toCreateRequest(this.draft()))),
          );
          formId = created.form.id;
          if (!(await this.showCreated(owner, created))) {
            this.toast.show(
              publish
                ? $localize`Saved as a draft, not published yet. Publish it once the form has loaded.`
                : this.savedWords(),
              { tone: publish ? 'info' : 'success' },
            );
            return;
          }
        } else if (this.dirty()) {
          const shown = this.shown();
          if (shown === null) return;
          const saved = await owner.wait(
            firstValueFrom(
              this.api.saveCheckInDraft(
                formId,
                shown.id,
                toSaveRequest(this.draft(), Number(shown.version)),
              ),
            ),
          );
          this.showVersion(saved);
        }
        const draft = this.shown();
        if (publish && draft !== null && draft.status === 'Draft') {
          const published = await owner.wait(
            firstValueFrom(this.api.publishCheckInVersion(formId, draft.id, Number(draft.version))),
          );
          this.showVersion(published);
          // The editor gives way to the questions as clients read them: focus starts at the title.
          this.focusHeading();
        }
        this.attempt.reset();
        this.toast.show(
          publish
            ? $localize`Published. Assign it from a client’s Check-ins tab.`
            : this.savedWords(),
          { tone: 'success' },
        );
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          this.refusal(
            error,
            publish
              ? $localize`The form could not be published. Your questions are still here; try again.`
              : $localize`The draft could not be saved. Your questions are still here; try again.`,
          ),
        );
        this.summary()?.focus();
        return;
      } finally {
        if (owner.current) this.busy.set(null);
      }
      // The write is made and shown; the form's own record (its token, versions and standing) follows.
      await this.refreshForm(owner, formId);
    });
  }

  /**
   * A form just created: its draft's questions are read back for the keys the server gave them, and
   * the address moves to the form's own. If they cannot be read, the form's address reads it afresh,
   * with its own Try again, and nothing is ever created twice.
   */
  private async showCreated(owner: TenantOperation, created: CheckInFormDetails): Promise<boolean> {
    const formId = created.form.id;
    const draft = created.versions.find((version) => version.status === 'Draft') ?? null;
    // What was typed is on the server now, so moving to the form's own address asks nothing.
    this.savedDraft.set(JSON.stringify(this.draft()));
    const version =
      draft === null
        ? null
        : await owner.wait(
            firstValueFrom(this.api.getCheckInFormVersion(formId, draft.id)).catch(() => null),
          );
    if (version !== null) {
      this.details.set(created);
      this.showVersion(version);
      this.loadedKey = `${owner.tenantId}:${formId}`;
    } else {
      this.loadedKey = null;
    }
    this.createdId.set(formId);
    await owner.wait(this.router.navigate(['/checkins/forms', formId], { replaceUrl: true }));
    return version !== null;
  }

  /**
   * Starts the next version from the one clients are sent, every question keeping its identity so
   * answers stay comparable across versions (CHK-003). The new draft opens for writing.
   */
  protected async changeQuestions(): Promise<void> {
    const details = this.details();
    const source = details?.form.latestPublishedVersionId;
    if (this.busy() || !details || !source) return;
    return this.scope.run('change', async (owner) => {
      this.busy.set('change');
      this.problem.set(null);
      this.stale.set(false);
      try {
        await owner.wait(this.csrf.refresh());
        const derived = await owner.wait(
          firstValueFrom(
            this.api.deriveCheckInDraft(details.form.id, {
              sourceVersionId: source,
              formVersion: Number(details.form.version),
            }),
          ),
        );
        this.showVersion(derived);
        this.attempt.reset();
        const first = this.draft().questions[0];
        this.focus(first ? `q-${first.key}` : 'add-question');
      } catch (error) {
        if (!owner.current) return;
        this.problem.set(
          apiErrorMessage(
            error,
            $localize`The questions could not be opened for changes. Try again.`,
          ),
        );
        // Refused because the form moved on (a draft opened elsewhere, say): show it as it is now.
        if (error instanceof HttpErrorResponse && error.status === 409) {
          await this.read(owner, details.form.id).catch(() => undefined);
        }
        return;
      } finally {
        if (owner.current) this.busy.set(null);
      }
      await this.refreshForm(owner, details.form.id);
    });
  }

  protected restore(): Promise<void> {
    return this.setArchived(false);
  }

  /** Archiving is reversible and closes the form to changes and to assigning (CHK-013). */
  private async setArchived(archived: boolean): Promise<void> {
    const details = this.details();
    if (this.busy() || !details) return;
    if (this.dirty() && !(await this.ask(this.archiving))) return;
    return this.scope.run('archive', async (owner) => {
      this.busy.set(archived ? 'archive' : 'restore');
      this.problem.set(null);
      this.error.set(null);
      this.stale.set(false);
      let saved: CheckInFormDetails;
      try {
        await owner.wait(this.csrf.refresh());
        const version = Number(details.form.version);
        saved = await owner.wait(
          firstValueFrom(
            archived
              ? this.api.archiveCheckInForm(details.form.id, version)
              : this.api.restoreCheckInForm(details.form.id, version),
          ),
        );
        this.details.set(saved);
        this.attempt.reset();
        this.toast.show(
          archived
            ? $localize`Archived. It’s kept, and no longer offered to assign.`
            : $localize`Restored. You can assign it again.`,
          { tone: 'success' },
        );
        this.focusHeading();
      } catch (error) {
        if (!owner.current) return;
        this.problem.set(
          this.refusal(
            error,
            archived
              ? $localize`The form could not be archived. Try again.`
              : $localize`The form could not be restored. Try again.`,
          ),
        );
        return;
      } finally {
        if (owner.current) this.busy.set(null);
      }
      await this.showVersionOf(owner, saved);
    });
  }

  /** The name sheet saved: the page shows the form as renamed. */
  protected renamed(details: CheckInFormDetails): void {
    this.details.set(details);
    const shown = this.shown();
    if (shown) {
      this.shown.set({
        ...shown,
        formTitle: details.form.title,
        formDescription: details.form.description,
      });
    }
  }

  /** A rename was refused for a stale form: the form is read again so the next save has its token. */
  protected renameStale(): void {
    const id = this.formId();
    if (id === null) return;
    void this.scope.run('refresh', (owner) => this.refreshForm(owner, id));
  }

  /** The words for a refused write; a 409 means the form changed elsewhere, so reloading is offered. */
  private refusal(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.status === 409) {
      this.stale.set(true);
      return $localize`This form was changed somewhere else since you opened it, so this was not saved. Reload the form to carry on from its newest version; what you typed here since is not kept.`;
    }
    return apiErrorMessage(error, fallback);
  }

  private savedWords(): string {
    return $localize`Saved as a draft. Clients aren’t sent it until you publish it.`;
  }

  /** The form's own record read again after a write; a failure says so and calls nothing failed. */
  private async refreshForm(owner: TenantOperation, formId: string): Promise<void> {
    try {
      this.details.set(await owner.wait(firstValueFrom(this.api.getCheckInForm(formId))));
    } catch (error) {
      if (!owner.current) throw error;
      this.problem.set(this.lostTrack());
    }
  }

  /** After archive or restore, the version to show may be another one: it is read if so. */
  private async showVersionOf(owner: TenantOperation, details: CheckInFormDetails): Promise<void> {
    const versionId = this.versionToShow(details);
    const shown = this.shown();
    if (versionId === null || versionId === shown?.id) {
      // The same version: anything typed before archiving was given up, so it reads as stored.
      if (shown) this.showVersion(shown);
      return;
    }
    try {
      this.showVersion(
        await owner.wait(
          firstValueFrom(this.api.getCheckInFormVersion(details.form.id, versionId)),
        ),
      );
    } catch (error) {
      if (!owner.current) throw error;
      this.problem.set(this.lostTrack());
    }
  }

  private lostTrack(): string {
    return $localize`Done, but this page could not catch up with the form. Reload it before you change anything else.`;
  }

  /** Shows a version the server answered with, keeping the editor's own keys so no box is redrawn. */
  private showVersion(version: CheckInFormVersionView): void {
    this.shown.set(version);
    this.setCleanDraft(this.keepingKeys(draftFromVersion(version)));
  }

  /**
   * The server's draft with the editor's own keys where the questions are the same ones (by the
   * server's question key, or by place for questions it has just keyed), so the boxes stay drawn and
   * focus stays where it was.
   */
  private keepingKeys(next: FormDraft): FormDraft {
    const before = this.draft().questions;
    const used = new Set<string>();
    return {
      ...next,
      questions: next.questions.map((question, index) => {
        const same =
          before.find(
            (candidate) =>
              candidate.questionKey !== null && candidate.questionKey === question.questionKey,
          ) ?? (before[index]?.questionKey === null ? before[index] : undefined);
        if (!same || used.has(same.key)) return question;
        used.add(same.key);
        return {
          ...question,
          key: same.key,
          options: question.options.map((option, position) =>
            same.options[position] ? { ...option, key: same.options[position].key } : option,
          ),
        };
      }),
    };
  }

  /**
   * A refused save: every reason shows under its box, the first wrong box takes focus, and the summary
   * does when none is wrong (no question at all, say).
   */
  private refuse(): void {
    this.error.set(null);
    this.attempt.attempt();
    afterNextRender(
      () => {
        const wrong = this.host.querySelector<HTMLElement>('.editor [aria-invalid="true"]');
        if (wrong) {
          wrong.focus();
          wrong.scrollIntoView?.({ block: 'center' });
        } else {
          this.summary()?.focus();
        }
      },
      { injector: this.injector },
    );
  }

  private setCleanDraft(draft: FormDraft): void {
    this.draft.set(draft);
    this.savedDraft.set(JSON.stringify(draft));
  }

  private focus(id: string, inside = false): void {
    afterNextRender(
      () => {
        // An attribute selector: a question key may start with a digit, which an id selector refuses.
        const target = this.host.querySelector<HTMLElement>(`[id="${id}"]`);
        const focusable = inside ? target?.querySelector<HTMLElement>('button') : target;
        focusable?.focus();
        focusable?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this.injector },
    );
  }

  private focusHeading(): void {
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  // ---------- leaving ----------

  async canLeave(): Promise<boolean> {
    if (!this.dirty() || this.state() !== 'ready') return true;
    return this.ask(this.leaving);
  }

  private async ask(question: LossQuestion): Promise<boolean> {
    const tenantId = this.tenants.selectedTenantId();
    this.question.set(question);
    const dialog = this.dialogs.open<boolean>(this.lossDialog(), {
      title: question.title,
      closeLabel: $localize`Close`,
      closeOnNavigation: false,
    });
    return (
      (await firstValueFrom(dialog.closed)) === true && tenantId === this.tenants.selectedTenantId()
    );
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty() && this.state() === 'ready') {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
