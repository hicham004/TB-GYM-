import { DatePipe } from '@angular/common';
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
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type {
  CheckInQuestionView,
  CheckInResponseDetail,
  ProgressPhotoPose,
} from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import { ownCheckInDenialMessage } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink, IconButton } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { isChoice } from './checkin-builder.models';
import {
  answerText,
  dayBefore,
  flowSteps,
  PHOTO_POSES,
  poseLabel,
  resumeStep,
  scalePositions,
  stepIssues,
  stepOfQuestion,
  stepScale,
} from './checkin-flow.models';
import {
  CHECK_IN_ANSWER_LIMITS,
  isEditable,
  issuesByQuestion,
  issuesFromServer,
  responseDraftFromDetail,
  submitGuard,
  toSaveRequest,
  withSelection,
  type AnswerDraft,
  type ResponseDraft,
  type ServerSubmissionFailure,
  type SubmissionIssue,
} from './checkin-response.models';

type Phase = 'loading' | 'ready' | 'sent' | 'denied' | 'missing' | 'failed';
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

interface PhotoSlot {
  state: 'empty' | 'saving' | 'added' | 'failed';
  message: string | null;
}

/** Long enough that a pause mid-sentence is not a save; short enough that little is ever at risk. */
const AUTOSAVE_DELAY_MS = 1200;

/**
 * The client's check-in (M6): one question per screen, an optional photo step, a review, and a
 * confirmation. The draft is saved as-is on every step and after a pause in typing, because the
 * server keeps a partial draft (CHK-008) and losing what someone wrote is the one thing a form must
 * never do. Submission is still measured whole, by the server, with every refusal shown at once.
 */
@Component({
  selector: 'app-checkin-flow',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    Button,
    ButtonLink,
    IconButton,
    Icon,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './checkin-flow.html',
  styleUrls: ['./checkin-flow.scss', './checkin-answer.scss'],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class CheckInFlow {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly router = inject(Router);
  private readonly tenants = inject(TenantStore);
  private readonly injector = inject(Injector);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly assignmentId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('assignmentId'))),
    { initialValue: null },
  );

  private readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');
  private readonly pageHeading = viewChild<ElementRef<HTMLElement>>('pageHeading');
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  protected readonly phase = signal<Phase>('loading');
  protected readonly detail = signal<CheckInResponseDetail | null>(null);
  protected readonly draft = signal<ResponseDraft | null>(null);
  protected readonly stepIndex = signal(0);
  protected readonly offerPhotos = signal(false);
  protected readonly photos = signal<Record<ProgressPhotoPose, PhotoSlot>>(emptySlots());
  protected readonly photoNotice = signal('');
  protected readonly coachName = signal<string | null>(null);
  protected readonly saveState = signal<SaveState>('idle');
  protected readonly loadError = signal<string | null>(null);
  protected readonly denial = signal<string | null>(null);
  protected readonly sendError = signal<string | null>(null);
  protected readonly serverIssues = signal<SubmissionIssue[]>([]);
  protected readonly sending = signal(false);
  /** Set when a question was opened from the review, so its button leads straight back there. */
  protected readonly returnToReview = signal(false);
  /** The destination a failed save held back, offered again as "Leave without saving". */
  protected readonly blockedLeave = signal<string | null>(null);

  /** Decides when a question's reason is due on screen. See `FormAttempt` for the rule. */
  protected readonly attempt = new FormAttempt();
  protected readonly poses = PHOTO_POSES;
  protected readonly poseLabel = poseLabel;
  protected readonly isChoice = isChoice;
  protected readonly limits = CHECK_IN_ANSWER_LIMITS;

  protected readonly editable = computed(() => isEditable(this.detail()?.response ?? null));
  protected readonly questions = computed(() => this.detail()?.version.questions ?? []);
  protected readonly steps = computed(() => flowSteps(this.questions(), this.offerPhotos()));
  protected readonly step = computed(() => this.steps()[this.stepIndex()] ?? null);
  /** Counts the step on screen, so the first question already shows the way ahead has begun. */
  protected readonly progress = computed(() =>
    Math.round(((this.stepIndex() + 1) / Math.max(1, this.steps().length)) * 100),
  );
  protected readonly photosAdded = computed(
    () => PHOTO_POSES.filter((pose) => this.photos()[pose].state === 'added').length,
  );
  /** On the review: how many questions have an answer, so the send bar shows how complete it is. */
  protected readonly answeredCount = computed(
    () => this.questions().filter((question) => this.answerOf(question) !== null).length,
  );

  /** On the review: the server's verdict once it has spoken, the local rules until then. */
  protected readonly reviewIssues = computed(() => {
    const draft = this.draft();
    if (draft === null) return {};
    const fromServer = this.serverIssues();
    return issuesByQuestion(
      fromServer.length > 0 ? fromServer : submitGuard(this.questions(), draft).issues,
    );
  });

  private loadedKey: string | null = null;
  private loadedTenantId: string | null = null;
  private editRevision = 0;
  private savedRevision = 0;
  private saveQueue: Promise<unknown> = Promise.resolve();
  private autosave: ReturnType<typeof setTimeout> | null = null;
  private leaveAnyway = false;
  /** Set once the workspace or session changed under this page: nothing may be written from it. */
  private discarded = false;

  constructor() {
    this.scope.onReset(() => this.discard());
    inject(DestroyRef).onDestroy(() => this.clearAutosave());
    effect(() => {
      this.scope.epoch();
      const id = this.assignmentId();
      const tenantId = this.tenants.selectedTenantId();
      const key = id === null || tenantId === null ? null : `${tenantId}:${id}`;
      if (key === null || key === this.loadedKey) return;
      this.loadedKey = key;
      untracked(() => void this.load(id!, tenantId!));
    });
  }

  /** The answer draft for a question, which the template reads for its current value. */
  protected answerFor(questionId: string): AnswerDraft | null {
    return this.draft()?.answers.find((answer) => answer.questionId === questionId) ?? null;
  }

  protected isSelected(questionId: string, optionId: string): boolean {
    return this.answerFor(questionId)?.selectedOptionIds.includes(optionId) ?? false;
  }

  protected answerOf(question: CheckInQuestionView): string | null {
    return answerText(question, this.answerFor(question.id));
  }

  protected scaleChips(question: CheckInQuestionView): number[] | null {
    return scalePositions(question);
  }

  /** On a phone a long scale splits into two even rows (1–5, 6–10) rather than leaving one over. */
  protected scaleRowLength(count: number): number {
    return count > 6 ? Math.ceil(count / 2) : count;
  }

  /** One touched-state key per question, so each reason waits for its own question. */
  protected field(question: CheckInQuestionView): string {
    return `question:${question.questionKey}`;
  }

  /** The help text and, once due, the reason: what a screen reader hears after the prompt. */
  protected describedByFor(question: CheckInQuestionView, showsReasons: boolean): string | null {
    const ids = [question.helpText ? 'step-help' : null, showsReasons ? 'step-reason' : null];
    return ids.filter((id) => id !== null).join(' ') || null;
  }

  protected questionIssues(question: CheckInQuestionView): string[] {
    const draft = this.draft();
    return draft === null ? [] : stepIssues(question, draft);
  }

  protected setText(questionId: string, value: string): void {
    this.updateAnswer(questionId, (answer) => ({ ...answer, textValue: value }));
  }

  protected setNumber(questionId: string, value: number | null): void {
    this.updateAnswer(questionId, (answer) => ({ ...answer, numericValue: value }));
  }

  protected setNumberText(questionId: string, value: string | number | null): void {
    const parsed = value === '' || value === null ? null : Number(value);
    this.setNumber(questionId, parsed !== null && Number.isFinite(parsed) ? parsed : null);
  }

  protected stepNumber(question: CheckInQuestionView, direction: 1 | -1): void {
    const current = this.answerFor(question.id)?.numericValue ?? null;
    this.setNumber(question.id, stepScale(question, current, direction));
  }

  protected clearAnswer(question: CheckInQuestionView): void {
    this.updateAnswer(question.id, (answer) => ({
      ...answer,
      textValue: '',
      numericValue: null,
      selectedOptionIds: [],
    }));
  }

  protected toggleOption(questionId: string, optionId: string): void {
    this.updateAnswer(questionId, (answer) => withSelection(answer, optionId));
  }

  /** The form's one submit: Next on a question or the photos, Send on the review. */
  protected primary(): void {
    const step = this.step();
    if (step?.kind === 'review') {
      void this.send();
      return;
    }

    if (step?.kind === 'question') {
      const draft = this.draft();
      if (draft !== null && stepIssues(step.question, draft).length > 0) {
        // A refused Next shows the reason and keeps the client on the question it is about.
        this.attempt.touch(this.field(step.question));
        return;
      }
    }

    void this.persist();
    this.goTo(this.returnToReview() ? this.steps().length - 1 : this.stepIndex() + 1);
  }

  protected back(): void {
    void this.persist();
    this.goTo(this.stepIndex() - 1);
  }

  /** From the review: open one question, then come straight back. */
  protected edit(questionKey: string): void {
    const index = stepOfQuestion(this.steps(), questionKey);
    if (index === -1) return;
    this.returnToReview.set(true);
    this.goTo(index);
  }

  protected editPhotos(): void {
    const index = this.steps().findIndex((step) => step.kind === 'photos');
    if (index === -1) return;
    this.returnToReview.set(true);
    this.goTo(index);
  }

  protected showAnswers(): void {
    this.phase.set('ready');
    this.focus(() => this.pageHeading());
  }

  /**
   * A progress photo is its own record (ADR 0011), saved the moment it is chosen and dated today in
   * the workspace's calendar. It is not part of the check-in, so sending or abandoning the check-in
   * never changes it.
   */
  protected async addPhoto(pose: ProgressPhotoPose, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file === null || this.discarded) return;
    this.setSlot(pose, { state: 'saving', message: null });
    this.photoNotice.set($localize`Saving your ${poseLabel(pose)} photo…`);
    return this.scope.run(`photo-${pose}`, async (owner) => {
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(firstValueFrom(this.api.recordMyProgressPhoto(pose, null, file)));
        this.setSlot(pose, { state: 'added', message: null });
        this.photoNotice.set($localize`${poseLabel(pose)} photo added.`);
      } catch (error) {
        if (!owner.current) return;
        if (errorCode(error) === 'ProgressPhotoAlreadyExists') {
          const message = $localize`You already added a ${poseLabel(pose)} photo today.`;
          this.setSlot(pose, { state: 'added', message });
          this.photoNotice.set(message);
        } else {
          const message = apiErrorMessage(
            error,
            $localize`This photo could not be saved. Try again.`,
          );
          this.setSlot(pose, { state: 'failed', message });
          this.photoNotice.set(message);
        }
      } finally {
        // Clear the picker so choosing the same file again still raises a change event.
        input.value = '';
      }
    });
  }

  /**
   * The route's leave guard. Pending typing is saved first; if that save fails the client stays,
   * with the choice to try again or to leave without it, rather than losing it silently.
   */
  async canLeave(destination = '/checkins/me'): Promise<boolean> {
    if (this.leaveAnyway || this.discarded || !this.editable() || this.phase() !== 'ready') {
      return true;
    }

    this.clearAutosave();
    if (await this.persist()) {
      this.blockedLeave.set(null);
      return true;
    }

    this.blockedLeave.set(destination);
    return false;
  }

  protected leaveWithoutSaving(): void {
    const destination = this.blockedLeave();
    this.leaveAnyway = true;
    this.blockedLeave.set(null);
    void this.router.navigateByUrl(destination ?? '/checkins/me');
  }

  protected retryLeave(): void {
    const destination = this.blockedLeave();
    this.blockedLeave.set(null);
    void this.router.navigateByUrl(destination ?? '/checkins/me');
  }

  protected retryLoad(): void {
    const id = this.assignmentId();
    const tenantId = this.tenants.selectedTenantId();
    if (id !== null && tenantId !== null) void this.load(id, tenantId);
  }

  /** A reload or closed tab cannot be held for a save, so the browser asks first. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (
      !this.discarded &&
      (this.editRevision > this.savedRevision || this.saveState() === 'saving')
    ) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  private async load(assignmentId: string, tenantId: string): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.resetState();
      this.loadedTenantId = tenantId;
      this.discarded = false;
      const [detail, photos, coach] = await owner.wait(
        Promise.allSettled([
          firstValueFrom(this.api.getOwnCheckInResponse(assignmentId)),
          firstValueFrom(this.api.getMyProgressPhotos()),
          firstValueFrom(this.api.getOwnCoach()),
        ]),
      );

      if (detail.status === 'rejected') {
        const reason = featureAccessReason(detail.reason);
        if (reason !== null) {
          this.denial.set(ownCheckInDenialMessage(reason));
          this.phase.set('denied');
        } else if (detail.reason instanceof HttpErrorResponse && detail.reason.status === 404) {
          this.phase.set('missing');
        } else {
          this.loadError.set(
            apiErrorMessage(detail.reason, $localize`Your check-in could not be opened.`),
          );
          this.phase.set('failed');
        }
        this.focus(() => this.pageHeading());
        return;
      }

      this.coachName.set(coach.status === 'fulfilled' ? coach.value.name : null);
      const response = detail.value;
      const editable = isEditable(response.response);
      // The photo step is offered only when the client's own photos could be read: a refusal or an
      // outage there leaves the questions untouched and simply drops the optional step.
      if (editable && photos.status === 'fulfilled') {
        const today = dayBefore(photos.value.toExclusive);
        const added = new Set(
          photos.value.photos
            .filter((photo) => photo.photoDate === today)
            .map((photo) => photo.pose),
        );
        this.photos.set(
          Object.fromEntries(
            PHOTO_POSES.map((pose) => [
              pose,
              { state: added.has(pose) ? 'added' : 'empty', message: null },
            ]),
          ) as Record<ProgressPhotoPose, PhotoSlot>,
        );
        this.offerPhotos.set(true);
      }

      const draft = responseDraftFromDetail(response);
      this.detail.set(response);
      this.draft.set(draft);
      this.stepIndex.set(editable ? resumeStep(this.steps(), draft) : 0);
      this.phase.set('ready');
      this.focus(() => (editable ? this.stepHeading() : this.pageHeading()));
    });
  }

  /**
   * Saves the draft as it stands, one save at a time: each save carries the version the previous
   * one returned, and answers typed while a save is in flight stay unsaved until the next one.
   * Resolves true when nothing is left unsaved.
   */
  private persist(force = false): Promise<boolean> {
    const run = this.saveQueue.then(() => this.saveNow(force));
    this.saveQueue = run.catch(() => undefined);
    return run;
  }

  private async saveNow(force: boolean): Promise<boolean> {
    this.clearAutosave();
    const draft = this.draft();
    // Nothing on screen can be written (sent already, or the workspace changed): nothing is lost.
    if (draft === null || !this.editable() || this.discarded) return true;
    const revision = this.editRevision;
    if (!force && revision === this.savedRevision) return true;
    // The tenant is re-read here: a save queued before a workspace switch must never be sent with
    // the next workspace's header.
    const tenantId = this.loadedTenantId;
    if (tenantId === null || this.tenants.selectedTenantId() !== tenantId) return false;

    this.saveState.set('saving');
    return this.scope
      .run(
        'save',
        async (owner) => {
          try {
            await owner.wait(this.csrf.refresh());
            const saved = await owner.wait(
              firstValueFrom(
                this.api.saveOwnCheckInDraftResponse(draft.assignmentId, toSaveRequest(draft)),
              ),
            );
            this.savedRevision = Math.max(this.savedRevision, revision);
            this.detail.set(saved);
            // Only the server's bookkeeping is taken back; the answers on screen may already be newer.
            this.draft.update((current) =>
              current === null
                ? current
                : {
                    ...current,
                    status: saved.response?.status ?? current.status,
                    version:
                      saved.response === null ? current.version : Number(saved.response.version),
                  },
            );
            this.saveState.set(this.editRevision === this.savedRevision ? 'saved' : 'idle');
            return true;
          } catch (error) {
            if (owner.current) this.saveState.set('failed');
            throw error;
          }
        },
        false,
      )
      .catch(() => false);
  }

  /**
   * Saves first so the submitted record matches the screen, then submits. A refusal keeps every
   * answer and lists every reason; tapping one opens its question.
   */
  private async send(): Promise<void> {
    this.attempt.attempt();
    const draft = this.draft();
    if (draft === null || !this.editable() || this.sending() || this.discarded) return;
    this.sendError.set(null);
    this.serverIssues.set([]);
    if (!submitGuard(this.questions(), draft).canSubmit) {
      this.sendError.set($localize`Some answers still need you before this can be sent.`);
      this.summary()?.nativeElement.focus();
      return;
    }

    this.sending.set(true);
    try {
      if (!(await this.persist(true))) {
        this.sendError.set(
          $localize`Your answers could not be saved, so nothing was sent. Try again.`,
        );
        this.summary()?.nativeElement.focus();
        return;
      }

      const version = this.draft()?.version ?? null;
      if (version === null) return;
      await this.scope.run('send', async (owner) => {
        try {
          await owner.wait(this.csrf.refresh());
          const submitted = await owner.wait(
            firstValueFrom(this.api.submitOwnCheckInResponse(draft.assignmentId, version)),
          );
          this.detail.set(submitted);
          this.draft.set(responseDraftFromDetail(submitted));
          this.attempt.reset();
          this.phase.set('sent');
          this.focus(() => this.pageHeading());
        } catch (error) {
          if (!owner.current) return;
          const failures = submissionFailures(error);
          if (failures.length > 0) {
            this.serverIssues.set(issuesFromServer(failures));
            this.sendError.set($localize`Some answers still need you before this can be sent.`);
          } else {
            this.sendError.set(
              apiErrorMessage(error, $localize`This check-in could not be sent. Try again.`),
            );
          }
          this.summary()?.nativeElement.focus();
        }
      });
    } finally {
      this.sending.set(false);
    }
  }

  private updateAnswer(questionId: string, change: (answer: AnswerDraft) => AnswerDraft): void {
    if (!this.editable()) return;
    // A local edit invalidates the server's last verdict, so stale reasons are cleared.
    this.serverIssues.set([]);
    this.sendError.set(null);
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
    ++this.editRevision;
    this.saveState.set('idle');
    this.clearAutosave();
    this.autosave = setTimeout(() => void this.persist(), AUTOSAVE_DELAY_MS);
  }

  private goTo(index: number): void {
    const last = this.steps().length - 1;
    const next = Math.max(0, Math.min(last, index));
    if (next === last) this.returnToReview.set(false);
    this.stepIndex.set(next);
    this.focus(() => this.stepHeading());
  }

  /** Moves focus to the new heading once it is on screen, so a screen reader starts there. */
  private focus(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus({ preventScroll: false }), {
      injector: this.injector,
    });
  }

  private setSlot(pose: ProgressPhotoPose, slot: PhotoSlot): void {
    this.photos.update((current) => ({ ...current, [pose]: slot }));
  }

  private clearAutosave(): void {
    if (this.autosave !== null) {
      clearTimeout(this.autosave);
      this.autosave = null;
    }
  }

  private resetState(): void {
    this.clearAutosave();
    this.phase.set('loading');
    this.detail.set(null);
    this.draft.set(null);
    this.stepIndex.set(0);
    this.offerPhotos.set(false);
    this.photos.set(emptySlots());
    this.photoNotice.set('');
    this.saveState.set('idle');
    this.loadError.set(null);
    this.denial.set(null);
    this.sendError.set(null);
    this.serverIssues.set([]);
    this.returnToReview.set(false);
    this.blockedLeave.set(null);
    this.attempt.reset();
    this.editRevision = 0;
    this.savedRevision = 0;
  }

  /** The workspace or session changed: drop everything and never write from this page again. */
  private discard(): void {
    this.discarded = true;
    this.loadedKey = null;
    this.loadedTenantId = null;
    this.resetState();
    this.sending.set(false);
    this.phase.set('missing');
  }
}

function emptySlots(): Record<ProgressPhotoPose, PhotoSlot> {
  return {
    Front: { state: 'empty', message: null },
    Side: { state: 'empty', message: null },
    Back: { state: 'empty', message: null },
  };
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const code = (error.error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * The submit route reports every refusal at once in a `failures` extension alongside the standard
 * validation problem, so the review can place each message on its own question.
 */
function submissionFailures(error: unknown): ServerSubmissionFailure[] {
  if (!(error instanceof HttpErrorResponse)) return [];
  const failures = (error.error as { failures?: unknown } | undefined)?.failures;
  return Array.isArray(failures) ? (failures as ServerSubmissionFailure[]) : [];
}
