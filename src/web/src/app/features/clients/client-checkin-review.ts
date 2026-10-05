import { NgTemplateOutlet } from '@angular/common';
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
  linkedSignal,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type {
  CheckInAssignmentListItem,
  CheckInComparisonView,
  CheckInQuestionView,
  CheckInResponseDetail,
  FeatureAccessReason,
} from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { FormAttempt } from '../../core/forms/form-attempt';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import { PhotoCompare } from '../../ui/photo-compare';
import { SegmentedControl } from '../../ui/segmented-control';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { Sparkline } from '../../ui/sparkline';
import { StatusPill } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import { CommandKeys } from '../messaging/command-keys';
import { SavedRepliesSheet } from '../messaging/saved-replies';
import { insertReply } from '../messaging/saved-replies.models';
import { previewAssetIds, type ProgressDashboard } from '../progress/progress-dashboard.models';
import {
  changedCount,
  checkInFacts,
  checkInsClosed,
  dayLabel,
  earlierCheckIns,
  MAXIMUM_REPLY_LENGTH,
  primaryReplyAction,
  REVIEW_WINDOW_WEEKS,
  replyIssues,
  reviewPhotos,
  reviewRows,
  reviewStage,
  reviewWeight,
  reviewWindow,
  type CheckInContext,
  type PosePhotos,
} from './client-checkins.models';
import { ClientWorkspaceContext } from './client-workspace.context';

type LoadState = 'loading' | 'ready' | 'denied' | 'missing' | 'error';
type PartState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * One check-in under review (C5, R4.3): "review and reply in under two minutes". The answers sit
 * beside the same form's previous check-in with what differs marked, the weight and progress photos
 * up to the day it was sent are beside them, and one button marks it reviewed, sending the reply
 * first when one is written. The reply goes into the coach's chat with the client; a check-in has
 * no comments of its own. The server decides access, review and sending; nothing here interprets an
 * answer (CHK-012).
 */
@Component({
  selector: 'app-client-checkin-review',
  imports: [
    Button,
    ButtonLink,
    Control,
    Field,
    Icon,
    NgTemplateOutlet,
    PhotoCompare,
    RouterLink,
    SavedRepliesSheet,
    SegmentedControl,
    Skeleton,
    Sparkline,
    StatusPill,
    UiConfirm,
    UiMenu,
  ],
  templateUrl: './client-checkin-review.html',
  styleUrl: './client-checkin-review.scss',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class ClientCheckInReview implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly dialogs = inject(UiDialog);
  private readonly sheets = inject(UiSheet);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly commandKeys = new CommandKeys();
  private conversationKey: string | null = null;
  private conversationId: string | null = null;
  private loadedKey: string | null = null;
  private savedRepliesRef: { close(): void } | null = null;

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly assignmentId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('assignmentId') ?? '')),
    { initialValue: '' },
  );

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');
  private readonly replyField = viewChild<ElementRef<HTMLTextAreaElement>>('replyField');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private readonly savedRepliesSheet = viewChild.required<TemplateRef<unknown>>('savedReplies');

  protected readonly state = signal<LoadState>('loading');
  protected readonly deniedReason = signal<FeatureAccessReason | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly detail = signal<CheckInResponseDetail | null>(null);
  protected readonly items = signal<readonly CheckInAssignmentListItem[]>([]);
  /** The earlier check-in the answers are read beside; the newest earlier one unless changed. */
  protected readonly comparedWith = signal<string | null>(null);
  protected readonly comparison = signal<CheckInComparisonView | null>(null);
  protected readonly earlierQuestions = signal<readonly CheckInQuestionView[] | null>(null);
  protected readonly comparisonState = signal<PartState>('idle');
  protected readonly dashboard = signal<ProgressDashboard | null>(null);
  protected readonly dashboardState = signal<PartState>('idle');
  protected readonly grantedIds = signal<ReadonlySet<string>>(new Set());
  /** The pose shown; it starts on the first one there is, and again whenever the photos change. */
  protected readonly pose = linkedSignal(() => this.photos()[0]?.pose ?? '');

  protected readonly reply = signal('');
  protected readonly attempt = new FormAttempt();
  protected readonly sending = signal(false);
  protected readonly reviewing = signal(false);
  protected readonly actionError = signal<string | null>(null);
  /** The reply just sent, so the coach sees where it went. */
  protected readonly sent = signal<{ conversationId: string } | null>(null);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );

  protected readonly maximumReply = MAXIMUM_REPLY_LENGTH;
  protected readonly loadingLabel = $localize`Loading the check-in`;
  protected readonly closeLabel = $localize`Close`;

  protected readonly firstName = computed(() => this.context.profile()?.firstName ?? '');

  private readonly checkInContext = computed<CheckInContext | null>(() => {
    const workspace = this.context.workspace();
    return workspace
      ? {
          today: workspace.currentDate,
          locale: this.locale,
          timeZone: workspace.timeZoneId,
          userId: this.auth.user()?.id ?? null,
        }
      : null;
  });

  protected readonly stage = computed(() => {
    const detail = this.detail();
    return detail ? reviewStage(detail) : null;
  });

  protected readonly sentStage = computed(
    () => this.stage() === 'waiting' || this.stage() === 'reviewed',
  );

  protected readonly facts = computed(() => {
    const detail = this.detail();
    const context = this.checkInContext();
    return detail && context ? checkInFacts(detail, context, this.firstName()) : null;
  });

  protected readonly earlier = computed(() => {
    const detail = this.detail();
    return detail ? earlierCheckIns(this.items(), detail) : [];
  });

  protected readonly compared = computed(
    () => this.earlier().find((item) => item.assignment.id === this.comparedWith()) ?? null,
  );

  protected readonly comparedLabel = computed(() => {
    const sent = this.compared()?.response?.submittedDate;
    const context = this.checkInContext();
    return sent && context ? dayLabel(sent, context) : '';
  });

  /** "Sent Wed 23 Sep" for each earlier check-in the answers can be read beside. */
  protected readonly compareItems = computed<UiMenuItem[]>(() => {
    const context = this.checkInContext();
    if (!context) return [];
    return this.earlier()
      .slice(0, 12)
      .map((item) => ({
        label: $localize`Sent ${dayLabel(item.response!.submittedDate ?? item.assignment.dueDate, context)}:date:`,
        hint:
          item.assignment.id === this.comparedWith()
            ? $localize`Shown now`
            : $localize`Due ${dayLabel(item.assignment.dueDate, context)}:date:`,
        action: item.assignment.id,
      }));
  });

  protected readonly rows = computed(() => {
    const detail = this.detail();
    if (!detail || !this.sentStage()) return [];
    const comparison = this.comparisonState() === 'ready' ? this.comparison() : null;
    return reviewRows(detail, comparison, comparison ? this.earlierQuestions() : null);
  });

  protected readonly changes = computed(() => changedCount(this.rows()));

  protected readonly beside = computed(
    () => this.comparisonState() === 'ready' && this.comparison() !== null,
  );

  protected readonly weight = computed(() => {
    const dashboard = this.dashboard();
    const context = this.checkInContext();
    return dashboard && context ? reviewWeight(dashboard, context) : null;
  });

  private readonly allPhotos = computed<PosePhotos[]>(() => {
    const dashboard = this.dashboard();
    return dashboard
      ? reviewPhotos(dashboard, this.compared()?.response?.submittedDate ?? null)
      : [];
  });

  /** Only photos the browser was granted can be drawn; the rest are said to be unavailable. */
  protected readonly photos = computed<PosePhotos[]>(() => {
    const granted = this.grantedIds();
    return this.allPhotos().filter((pose) => granted.has(pose.latest.mediaAssetId));
  });

  protected readonly photosUnavailable = computed(
    () => this.allPhotos().length > 0 && this.photos().length === 0,
  );

  protected readonly poseOptions = computed(() =>
    this.photos().map((pose) => ({ value: pose.pose, label: pose.label })),
  );

  protected readonly shownPose = computed(
    () => this.photos().find((pose) => pose.pose === this.pose()) ?? this.photos()[0] ?? null,
  );

  protected readonly photoDay = (date: string) => {
    const context = this.checkInContext();
    return context ? dayLabel(date, context) : date;
  };

  protected readonly windowWeeks = REVIEW_WINDOW_WEEKS;

  /** "Thu 1 Oct": the day it was sent, which the weight and photos run up to. */
  protected readonly sentDay = computed(() => {
    const sent = this.detail()?.response?.submittedDate;
    return sent ? this.photoDay(sent) : '';
  });

  protected readonly replyLabel = computed(
    () => $localize`Your reply to ${this.firstName()}:name:`,
  );

  protected compareLabel(pose: PosePhotos): string {
    return $localize`Compare ${this.firstName()}:name:’s ${pose.label}:pose: photos from ${this.photoDay(pose.earlier?.photoDate ?? pose.latest.photoDate)}:earlier: and ${this.photoDay(pose.latest.photoDate)}:latest:`;
  }

  protected photoAlt(pose: PosePhotos): string {
    return $localize`${this.firstName()}:name:, ${pose.label}:pose:, ${this.photoDay(pose.latest.photoDate)}:date:`;
  }

  /** Messaging is offered unless the plan is known not to include it, as in the header. */
  private readonly messagingDecision = computed(
    () => this.context.plans()?.featureAccess.find((item) => item.feature === 'Messaging') ?? null,
  );

  protected readonly canReply = computed(() => this.messagingDecision()?.isAllowed ?? true);

  protected readonly replyClosed = computed(() => {
    const decision = this.messagingDecision();
    if (!decision || decision.isAllowed) return null;
    return decision.reason === 'NoEntitlement'
      ? $localize`Messaging isn’t part of ${this.firstName()}:name:’s plan, so you can’t reply here.`
      : $localize`Messaging with ${this.firstName()}:name: is closed right now, so you can’t reply here.`;
  });

  protected readonly issues = computed(() => replyIssues(this.reply()));

  protected readonly action = computed(() =>
    this.stage() === null
      ? null
      : primaryReplyAction(this.stage()!, this.reply().trim() !== '', this.canReply()),
  );

  protected readonly busy = computed(() => this.sending() || this.reviewing());

  protected readonly closedMessage = computed(() => {
    const reason = this.deniedReason();
    return reason ? checkInsClosed(reason, this.firstName() || $localize`This client`) : '';
  });

  constructor() {
    this.scope.onReset(() => this.reset());
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.savedRepliesRef?.close();
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const workspace = this.context.workspace();
      const assignmentId = this.assignmentId();
      const key =
        tenantId && clientId && workspace && assignmentId && !this.context.isFormer()
          ? `${tenantId}:${clientId}:${assignmentId}`
          : null;
      if (key && key !== this.loadedKey) {
        // A reply belongs to one check-in. Going to another one (the leave guard asked first)
        // starts with an empty reply; a retry of the same one keeps what was written.
        if (this.loadedKey !== null) this.clearReply();
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected retry(): void {
    void this.load();
  }

  /** The check-in, and the list it sits in for the earlier ones. Weight and photos follow apart. */
  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const clientId = this.context.clientId();
      const assignmentId = this.assignmentId();
      this.clearCheckIn();
      // The plan already says whether check-ins are included, so a client without them is not
      // asked: the API would refuse with the same reason (CHK-011).
      const decision = this.context
        .plans()
        ?.featureAccess.find((item) => item.feature === 'CheckIns');
      if (decision && !decision.isAllowed) {
        this.deniedReason.set(decision.reason);
        this.state.set('denied');
        return;
      }

      this.state.set('loading');
      try {
        const [detail, list] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getClientCheckInResponse(clientId, assignmentId)),
            firstValueFrom(this.api.listClientCheckInAssignments(clientId, 0, 50)),
          ]),
        );
        this.detail.set(detail);
        this.items.set(list.items);
        this.state.set('ready');
        this.focusHeading();
        const stage = reviewStage(detail);
        if (stage !== 'waiting' && stage !== 'reviewed') return;
        this.comparedWith.set(earlierCheckIns(list.items, detail)[0]?.assignment.id ?? null);
        void this.loadComparison();
        void this.loadDashboard();
      } catch (error) {
        if (!owner.current) return;
        const reason = featureAccessReason(error);
        if (reason !== null) {
          this.deniedReason.set(reason);
          this.state.set('denied');
        } else if (error instanceof HttpErrorResponse && error.status === 404) {
          this.state.set('missing');
        } else {
          this.loadError.set(apiErrorMessage(error, $localize`This check-in could not be loaded.`));
          this.state.set('error');
        }
      }
    });
  }

  /**
   * The server lines the two up by question (CHK-010), this check-in first so its order leads. An
   * earlier check-in on another version of the form brings that version's scales with it.
   */
  protected async loadComparison(): Promise<void> {
    return this.scope.run('comparison', async (owner) => {
      const detail = this.detail();
      const earlier = this.compared();
      if (!detail?.response || !earlier?.response) {
        this.comparison.set(null);
        this.comparisonState.set('idle');
        return;
      }

      this.comparisonState.set('loading');
      try {
        const comparison = await owner.wait(
          firstValueFrom(
            this.api.compareCheckInResponses(
              this.context.clientId(),
              detail.response.id,
              earlier.response.responseId,
            ),
          ),
        );
        let questions: readonly CheckInQuestionView[] | null = detail.version.questions;
        if (comparison.second.formVersionId !== detail.version.id) {
          try {
            const version = await owner.wait(
              firstValueFrom(
                this.api.getCheckInFormVersion(comparison.formId, comparison.second.formVersionId),
              ),
            );
            questions = version.questions;
          } catch {
            if (!owner.current) return;
            // Without that version the earlier scale is written without its end; nothing is lost.
            questions = null;
          }
        }
        this.earlierQuestions.set(questions);
        this.comparison.set(comparison);
        this.comparisonState.set('ready');
      } catch {
        if (!owner.current) return;
        this.comparison.set(null);
        this.comparisonState.set('error');
      }
    });
  }

  protected compareWith(assignmentId: string): void {
    if (assignmentId === this.comparedWith()) return;
    this.comparedWith.set(assignmentId);
    void this.loadComparison();
  }

  /** Weigh-ins and photos for the weeks up to the day it was sent, in one read. */
  protected async loadDashboard(): Promise<void> {
    return this.scope.run('dashboard', async (owner) => {
      const sentDate = this.detail()?.response?.submittedDate;
      if (!sentDate) return;
      const window = reviewWindow(sentDate);
      this.dashboardState.set('loading');
      try {
        const dashboard = await owner.wait(
          firstValueFrom(
            this.api.getClientProgressDashboard(
              this.context.clientId(),
              window.from,
              window.toExclusive,
            ),
          ),
        );
        this.dashboard.set(dashboard);
        this.dashboardState.set('ready');
      } catch {
        if (!owner.current) return;
        this.dashboardState.set('error');
        return;
      }
      await this.grantPhotos(owner, this.dashboard()!);
    });
  }

  /**
   * A thumbnail path is not a public address: each one needs a short-lived, path-scoped grant, asked
   * for together. Every previewed photo is granted, so choosing another earlier check-in can pair a
   * different one without asking again. A refusal leaves the photos out, not the page.
   */
  private async grantPhotos(owner: TenantOperation, dashboard: ProgressDashboard): Promise<void> {
    const assetIds = previewAssetIds(dashboard);
    if (assetIds.length === 0) return;
    try {
      await owner.wait(this.csrf.refresh());
      const batch = await owner.wait(firstValueFrom(this.api.createMediaAccessBatch(assetIds)));
      this.grantedIds.set(new Set(batch.items.map((item) => item.assetId)));
    } catch {
      if (owner.current) this.grantedIds.set(new Set());
    }
  }

  // ----------------------------------------------------------------------------------------------
  // The reply and the review
  // ----------------------------------------------------------------------------------------------

  protected act(): void {
    switch (this.action()) {
      case 'review':
        void this.markReviewed(false);
        break;
      case 'send-and-review':
        void this.send(true);
        break;
      case 'send':
        void this.send(false);
        break;
    }
  }

  protected sendOnly(): void {
    void this.send(false);
  }

  /**
   * Into the coach's chat with the client, which is opened (or found) first. A retry after a lost
   * response carries the same key, so the message is never written twice.
   */
  private async send(thenReview: boolean): Promise<void> {
    return this.scope.run('send', async (owner) => {
      if (this.busy()) return;
      this.attempt.attempt();
      if (this.issues().length > 0) {
        // After the reason is drawn, so the summary is read as focus arrives.
        afterNextRender(() => this.summary()?.nativeElement.focus(), { injector: this.injector });
        return;
      }

      const body = this.reply().trim();
      this.sending.set(true);
      this.actionError.set(null);
      this.sent.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const conversationId = await owner.wait(this.openConversation());
        const key = this.commandKeys.for('send', conversationId, body);
        await owner.wait(
          firstValueFrom(this.api.sendConversationMessage(conversationId, body, key)),
        );
        this.commandKeys.release('send', conversationId);
        this.reply.set('');
        this.attempt.reset();
        this.sent.set({ conversationId });
      } catch (error) {
        if (!owner.current) return;
        this.actionError.set(this.replyFailure(error));
        return;
      } finally {
        if (owner.current) this.sending.set(false);
      }

      if (thenReview) {
        await owner.wait(this.markReviewed(true));
      } else {
        this.toast.show($localize`Reply sent to ${this.firstName()}:name:.`, { tone: 'success' });
      }
    });
  }

  private async openConversation(): Promise<string> {
    if (this.conversationId) return this.conversationId;
    this.conversationKey ??= crypto.randomUUID();
    const detail = await firstValueFrom(
      this.api.createDirectConversation(this.context.clientId(), this.conversationKey),
    );
    this.conversationId = detail.conversation.id;
    return this.conversationId;
  }

  private replyFailure(error: unknown): string {
    const reason = featureAccessReason(error);
    if (reason === 'NoEntitlement') {
      return $localize`Messaging isn’t part of ${this.firstName()}:name:’s plan, so the reply was not sent.`;
    }
    if (reason !== null) {
      return $localize`Messaging with ${this.firstName()}:name: is closed right now, so the reply was not sent.`;
    }
    return apiErrorMessage(
      error,
      $localize`Your reply could not be sent. Check the connection and try again.`,
    );
  }

  /** Review records that the coach has read it (CHK-009). It never changes an answer. */
  private async markReviewed(afterReply: boolean): Promise<void> {
    return this.scope.run('review', async (owner) => {
      const detail = this.detail();
      if (!detail?.response || reviewStage(detail) !== 'waiting') return;
      this.reviewing.set(true);
      this.actionError.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const reviewed = await owner.wait(
          firstValueFrom(
            this.api.reviewCheckInResponse(
              this.context.clientId(),
              detail.assignment.id,
              Number(detail.response.version),
            ),
          ),
        );
        this.detail.set(reviewed);
        this.markListed(reviewed);
        this.toast.show(
          afterReply
            ? $localize`Reply sent and check-in marked reviewed.`
            : $localize`Check-in marked reviewed.`,
          { tone: 'success' },
        );
      } catch (error) {
        if (!owner.current) return;
        const conflict = error instanceof HttpErrorResponse && error.status === 409;
        const lead = afterReply ? $localize`Your reply was sent. ` : '';
        if (conflict) {
          // Someone reviewed it first, or it changed: read it again rather than guess.
          this.actionError.set(
            lead + $localize`This check-in changed while it was open, so it has been read again.`,
          );
          await owner.wait(this.reread());
        } else {
          this.actionError.set(
            lead +
              apiErrorMessage(
                error,
                $localize`The check-in could not be marked reviewed. Try again.`,
              ),
          );
        }
      } finally {
        if (owner.current) this.reviewing.set(false);
      }
    });
  }

  private async reread(): Promise<void> {
    try {
      const detail = await firstValueFrom(
        this.api.getClientCheckInResponse(this.context.clientId(), this.assignmentId()),
      );
      this.detail.set(detail);
      this.markListed(detail);
    } catch {
      // The message already says it changed; the next visit reads it fresh.
    }
  }

  /** Keeps the earlier list's copy of this check-in in step with the one on screen. */
  private markListed(detail: CheckInResponseDetail): void {
    const response = detail.response;
    if (!response) return;
    this.items.update((items) =>
      items.map((item) =>
        item.assignment.id === detail.assignment.id && item.response
          ? {
              ...item,
              response: {
                ...item.response,
                status: response.status,
                reviewedAtUtc: response.reviewedAtUtc,
              },
            }
          : item,
      ),
    );
  }

  protected openSavedReplies(): void {
    const ref = this.sheets.open(this.savedRepliesSheet(), {
      title: $localize`Saved replies`,
      closeLabel: this.closeLabel,
    });
    this.savedRepliesRef = ref;
    ref.closed.subscribe(() => {
      if (this.savedRepliesRef === ref) this.savedRepliesRef = null;
    });
  }

  /** A chosen saved reply joins the reply after what is written, and waits there to be read. */
  protected useSavedReply(body: string): void {
    this.reply.set(insertReply(this.reply(), body));
    this.savedRepliesRef?.close();
    this.savedRepliesRef = null;
    afterNextRender(
      () => {
        const field = this.replyField()?.nativeElement;
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      },
      { injector: this.injector },
    );
  }

  // ----------------------------------------------------------------------------------------------
  // Leaving
  // ----------------------------------------------------------------------------------------------

  /** An unsent reply is asked about before the page goes; nothing else here is unsaved. */
  async canLeave(): Promise<boolean> {
    if (this.reply().trim() === '') return true;
    this.asking.set({
      message: $localize`Your reply to ${this.firstName()}:name: has not been sent. If you leave now, it is lost.`,
      confirm: $localize`Leave without sending`,
      cancel: $localize`Stay`,
    });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title: $localize`Leave without sending?`,
      closeLabel: this.closeLabel,
      closeOnNavigation: false,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.reply().trim() !== '') {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  private focusHeading(): void {
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  private clearCheckIn(): void {
    this.state.set('loading');
    this.deniedReason.set(null);
    this.loadError.set(null);
    this.detail.set(null);
    this.items.set([]);
    this.comparedWith.set(null);
    this.comparison.set(null);
    this.earlierQuestions.set(null);
    this.comparisonState.set('idle');
    this.dashboard.set(null);
    this.dashboardState.set('idle');
    this.grantedIds.set(new Set());
    this.actionError.set(null);
    this.sent.set(null);
  }

  private clearReply(): void {
    this.reply.set('');
    this.attempt.reset();
    this.sent.set(null);
    this.actionError.set(null);
  }

  private reset(): void {
    this.loadedKey = null;
    this.conversationKey = null;
    this.conversationId = null;
    this.commandKeys.clear();
    this.clearCheckIn();
    this.clearReply();
    this.sending.set(false);
    this.reviewing.set(false);
  }
}
