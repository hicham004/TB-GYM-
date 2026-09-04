import { DatePipe } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type { FeatureAccessReason } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { FormAttempt } from '../../core/forms/form-attempt';
import {
  clientMessagingDenialMessage,
  messageRemovalLabel,
  ownMessagingDenialMessage,
} from '../../core/i18n/display-labels';
import { MessageUnreadStore } from '../../core/messaging/message-unread.store';
import {
  MessagingRealtimeService,
  type ConversationRealtimeSink,
} from '../../core/messaging/messaging-realtime.service';
import { CommandKeys } from './command-keys';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  isNewerProjection,
  mergeNewer,
  mergeOlder,
  type Conversation,
  type Message,
  type MessagePage,
  type RealtimeEvent,
} from './messaging.models';

const conversationPageSize = 25;
const messagePageSize = 50;

/** The same limits the server enforces. Stated once, read by the counters and the guards alike. */
export const maximumMessageLength = 2000;
export const maximumReasonLength = 500;

/**
 * The signed-in member's own conversations, for one workspace.
 *
 * Everything on this screen belongs to one recipient, in one workspace, in one conversation. Every
 * piece of state is discarded the moment any of those three changes, and every asynchronous result
 * checks which of them it was asked for before it writes anything. Without that, a slow history for
 * the conversation the user has just left lands on top of the current one and somebody reads a
 * thread that is not theirs — which the API would never have returned, but the screen would have
 * shown.
 *
 * Message text is rendered by ordinary interpolation. Nothing here builds HTML from a body, and the
 * server stores plain text only, so a message that looks like markup is shown as the characters it
 * is.
 *
 * There is no polling and no realtime channel in this slice: the thread is read when it is opened
 * and when the user asks for it again.
 */
@Component({
  selector: 'app-messages',
  imports: [DatePipe, FormsModule],
  templateUrl: './messages.html',
  styleUrl: './messages.scss',
})
export class Messages {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly unreadStore = inject(MessageUnreadStore);
  private readonly realtime = inject(MessagingRealtimeService);

  /** Bumped whenever the recipient or the workspace changes. */
  private contextGeneration = 0;
  /** Bumped whenever the context or the selected conversation changes. */
  private threadGeneration = 0;
  private listRequest = 0;
  private historyRequest = 0;
  private context: string | null = null;

  protected readonly conversations = signal<readonly Conversation[]>([]);
  protected readonly conversationsHasMore = signal(false);
  private readonly nextActivityCursor = signal<string | null>(null);
  private readonly nextIdCursor = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly messages = signal<readonly Message[]>([]);
  protected readonly hasOlder = signal(false);
  private readonly oldestSequence = signal<number | null>(null);
  protected readonly latestSequence = signal(0);
  protected readonly conversationUnread = signal(0);

  protected readonly draft = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');
  protected readonly moderatingId = signal<string | null>(null);
  protected readonly moderationReason = signal('');

  protected readonly listLoading = signal(false);
  protected readonly listLoadingMore = signal(false);
  protected readonly threadLoading = signal(false);
  protected readonly threadLoadingOlder = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly deniedReason = signal<FeatureAccessReason | null>(null);

  protected readonly maximumLength = maximumMessageLength;
  protected readonly maximumReason = maximumReasonLength;
  protected readonly unread = this.unreadStore.unread;

  /**
   * The channel's state, for the accessible status line.
   *
   * It says whether live updates are arriving, never that messages are missing: everything is
   * persisted, and a reconnect reconciles from the server. A reader who is offline is behind, not
   * short of anything.
   */
  protected readonly realtimeState = this.realtime.state;

  /** How many coalesced refreshes have been consumed, so an invalidation is acted on once. */
  private handledListRefresh = 0;

  // One FormAttempt per form, so leaving the composer never reveals the edit form's reason and a
  // refused edit never fills the composer's summary.
  protected readonly composerAttempt = new FormAttempt();
  protected readonly editAttempt = new FormAttempt();
  protected readonly moderationAttempt = new FormAttempt();

  /**
   * Retained idempotency keys. A key survives a failed attempt so that clicking again after a lost
   * response is recognised by the server as the same command rather than written a second time.
   */
  protected readonly commandKeys = new CommandKeys();

  private readonly composerSummary = viewChild<ElementRef<HTMLElement>>('composerSummary');
  private readonly editSummary = viewChild<ElementRef<HTMLElement>>('editSummary');
  private readonly moderationSummary = viewChild<ElementRef<HTMLElement>>('moderationSummary');

  protected readonly selected = computed(() =>
    this.conversations().find((conversation) => conversation.id === this.selectedId()),
  );

  protected readonly isCoachSide = computed(() => this.selected()?.callerRole === 'Coach');

  protected readonly listIsEmpty = computed(
    () => !this.listLoading() && this.error() === null && this.conversations().length === 0,
  );

  protected readonly remaining = computed(() => this.maximumLength - this.draft().trim().length);

  /** Derived reasons the composer works out for itself; never the channel a server error uses. */
  protected readonly composerIssues = computed(() => bodyIssues(this.draft()));

  protected readonly editIssues = computed(() => bodyIssues(this.editDraft()));

  protected readonly moderationIssues = computed(() => {
    const reason = this.moderationReason().trim();
    if (reason.length === 0) {
      return [$localize`Say why this message is being removed.`];
    }

    return reason.length > maximumReasonLength
      ? [$localize`A reason can be at most ${maximumReasonLength}:max: characters.`]
      : [];
  });

  private readonly contextKey = computed(() => {
    const userId = this.auth.user()?.id ?? null;
    const membership = this.tenants.selectedMembership();
    return userId === null || membership === undefined ? null : `${userId}|${membership.tenantId}`;
  });

  constructor() {
    effect(() => {
      const key = this.contextKey();
      if (key === this.context) {
        return;
      }

      this.context = key;
      const generation = ++this.contextGeneration;
      // Cleared before anything is requested. A thread from the workspace the user has just left
      // must not stay on screen for the length of a request, and a draft written to one person must
      // never appear in a composer addressed to another.
      this.resetAll();
      if (key !== null) {
        void this.loadConversations(generation);
      }
    });

    // A compact invalidation means something changed in a conversation this member is in. The
    // service has already coalesced the burst; this turns one coalesced signal into one bounded
    // list and unread refresh. There is no timer here and nothing polls.
    effect(() => {
      const requests = this.realtime.listRefreshRequests();
      if (requests === this.handledListRefresh) {
        return;
      }

      this.handledListRefresh = requests;
      const generation = this.contextGeneration;
      if (this.contextKey() !== null) {
        void this.refreshList(generation);
      }
    });
  }

  /**
   * Merges one realtime event into the thread on screen.
   *
   * Returns whether the event was actually applied, which is what the service uses to decide whether
   * this application may honestly acknowledge it. Everything about the merge is defensive, because
   * delivery is at least once and out of order: a duplicate after a reclaimed publication, a
   * catch-up page overlapping a live frame, an edit whose event arrives after a later message.
   */
  private readonly threadSink: ConversationRealtimeSink = {
    apply: (event: RealtimeEvent) => this.applyRealtimeEvent(event),
  };

  private applyRealtimeEvent(event: RealtimeEvent): boolean {
    if (event.conversationId !== this.selectedId() || event.message === null) {
      // A conversation-created event carries no message and needs no thread merge; the list refresh
      // the compact signal triggers is what makes the new thread appear.
      return false;
    }

    const incoming = event.message;
    const current = this.messages().find((message) => message.id === incoming.id);
    // Removal is terminal for content and a stale revision loses. Without this, an edit event that
    // arrived late would put back a sentence a later edit replaced, or a body a removal took away.
    if (!isNewerProjection(current, incoming)) {
      return false;
    }

    this.messages.update((loaded) => mergeNewer(loaded, [incoming]));
    this.latestSequence.set(Math.max(this.latestSequence(), incoming.sequence));
    this.applyToPreview(incoming);
    if (this.editingId() === incoming.id && incoming.isDeleted) {
      // The message being edited was removed underneath. Keeping the form open would offer to save
      // an edit the server has already made impossible.
      this.cancelEdit();
    }

    if (this.moderatingId() === incoming.id && incoming.isDeleted) {
      this.cancelModeration();
    }

    return true;
  }

  /** Why this conversation is closed, in the audience's own words. */
  protected denialMessage(): string {
    const reason = this.deniedReason() ?? this.selected()?.accessReason ?? null;
    if (reason === null) {
      return '';
    }

    return this.isCoachSide()
      ? clientMessagingDenialMessage(reason)
      : ownMessagingDenialMessage(reason);
  }

  protected removalLabel(message: Message): string {
    return messageRemovalLabel(message.deletionKind);
  }

  /** Dynamic action labels, built from localizable templates rather than concatenated prose. */
  protected editLabel(message: Message): string {
    return $localize`Edit your message ${message.sequence}:seq:`;
  }

  protected deleteLabel(message: Message): string {
    return $localize`Remove your message ${message.sequence}:seq:`;
  }

  protected moderateLabel(message: Message): string {
    return $localize`Remove message ${message.sequence}:seq: as coach`;
  }

  protected conversationLabel(conversation: Conversation): string {
    return conversation.unreadCount > 0
      ? $localize`${conversation.counterpart.displayName}:name:, ${conversation.unreadCount}:count: unread messages`
      : $localize`${conversation.counterpart.displayName}:name:, no unread messages`;
  }

  protected async refresh(): Promise<void> {
    const generation = this.contextGeneration;
    if (this.contextKey() === null) {
      return;
    }

    await this.loadConversations(generation);
    if (this.contextGeneration !== generation) {
      return;
    }

    const selected = this.selectedId();
    if (selected !== null) {
      await this.loadThread(selected, generation, this.threadGeneration);
    }

    await this.unreadStore.refresh();
  }

  protected async loadMoreConversations(): Promise<void> {
    const generation = this.contextGeneration;
    if (!this.conversationsHasMore() || this.listLoadingMore() || this.listLoading()) {
      return;
    }

    const request = ++this.listRequest;
    this.listLoadingMore.set(true);
    this.error.set(null);
    try {
      const page = await firstValueFrom(
        this.api.listConversations(
          this.nextActivityCursor(),
          this.nextIdCursor(),
          conversationPageSize,
        ),
      );
      if (!this.ownsList(generation, request)) {
        return;
      }

      // Appended by identifier: a conversation whose activity moved between the two requests can
      // appear in both pages, and a duplicated key is a rendering error rather than a cosmetic one.
      const seen = new Set(this.conversations().map((conversation) => conversation.id));
      this.conversations.update((loaded) => [
        ...loaded,
        ...page.items.filter((conversation) => !seen.has(conversation.id)),
      ]);
      this.applyCursor(page);
    } catch (error) {
      if (this.ownsList(generation, request)) {
        this.error.set(apiErrorMessage(error, $localize`More conversations could not be loaded.`));
      }
    } finally {
      if (this.ownsList(generation, request)) {
        this.listLoadingMore.set(false);
      }
    }
  }

  protected async select(conversation: Conversation): Promise<void> {
    if (this.selectedId() === conversation.id) {
      return;
    }

    const generation = this.contextGeneration;
    // The thread generation moves first, so anything already in flight for the previous conversation
    // is invalidated before the new one is asked for.
    const thread = ++this.threadGeneration;
    this.resetThread();
    this.selectedId.set(conversation.id);
    if (!conversation.isAvailable) {
      // The list already carries the decision, so a refused conversation explains itself without a
      // request that would only be refused again.
      this.deniedReason.set(conversation.accessReason);
      return;
    }

    await this.loadThread(conversation.id, generation, thread);
  }

  protected async loadOlder(): Promise<void> {
    const conversationId = this.selectedId();
    const cursor = this.oldestSequence();
    if (
      conversationId === null ||
      cursor === null ||
      !this.hasOlder() ||
      this.threadLoadingOlder()
    ) {
      return;
    }

    const generation = this.contextGeneration;
    const thread = this.threadGeneration;
    const request = ++this.historyRequest;
    this.threadLoadingOlder.set(true);
    this.error.set(null);
    try {
      const page = await firstValueFrom(
        this.api.listConversationMessages(conversationId, cursor, messagePageSize),
      );
      if (!this.ownsThread(generation, thread, request)) {
        return;
      }

      // Merged by identifier and re-sorted by sequence, so an overlapping page cannot duplicate a
      // row and a message that arrived at the tip cannot stall paging backwards.
      this.messages.update((loaded) => mergeOlder(loaded, page.items));
      this.hasOlder.set(page.items.length > 0 && page.hasOlder);
      // The cursor advances only when the page actually contained something older; otherwise Load
      // older would ask for the same position again for ever.
      this.oldestSequence.set(page.items.length > 0 ? page.oldestSequence : null);
      this.latestSequence.set(page.latestSequence);
    } catch (error) {
      if (this.ownsThread(generation, thread, request)) {
        this.error.set(apiErrorMessage(error, $localize`Older messages could not be loaded.`));
      }
    } finally {
      if (this.ownsThread(generation, thread, request)) {
        this.threadLoadingOlder.set(false);
      }
    }
  }

  protected async send(): Promise<void> {
    const conversationId = this.selectedId();
    if (conversationId === null || this.busy()) {
      return;
    }

    // The attempt is recorded first, so every outstanding reason becomes due whether or not the
    // attempt gets as far as the server. A refused send reaches no API and says so out loud.
    this.composerAttempt.attempt();
    if (this.composerIssues().length > 0) {
      this.composerSummary()?.nativeElement.focus();
      return;
    }

    const generation = this.contextGeneration;
    const thread = this.threadGeneration;
    const body = this.draft().trim();
    // Retained across failures. A lost response followed by a second click must reach the server as
    // the same command, or the message it already wrote is written twice.
    const idempotencyKey = this.commandKeys.for('send', conversationId, body);
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      if (!this.owns(generation, thread)) {
        return;
      }

      const sent = await firstValueFrom(
        this.api.sendConversationMessage(conversationId, body, idempotencyKey),
      );
      if (!this.owns(generation, thread)) {
        return;
      }

      this.messages.update((loaded) => mergeNewer(loaded, [sent]));
      this.latestSequence.set(Math.max(this.latestSequence(), sent.sequence));
      this.applyToPreview(sent);
      this.commandKeys.release('send', conversationId);
      this.draft.set('');
      this.composerAttempt.reset();
    } catch (error) {
      if (this.owns(generation, thread)) {
        this.reportFailure(error, $localize`This message could not be sent.`);
      }
    } finally {
      if (this.owns(generation, thread)) {
        this.busy.set(false);
      }
    }
  }

  protected startEdit(message: Message): void {
    this.cancelModeration();
    this.editAttempt.reset();
    this.editingId.set(message.id);
    this.editDraft.set(message.body ?? '');
  }

  protected cancelEdit(): void {
    const editing = this.editingId();
    if (editing !== null) {
      // Walking away ends the attempt, so its key is spent no further.
      this.commandKeys.release('edit', editing);
    }

    this.editingId.set(null);
    this.editDraft.set('');
    this.editAttempt.reset();
  }

  protected async saveEdit(message: Message): Promise<void> {
    const conversationId = this.selectedId();
    if (conversationId === null || this.busy()) {
      return;
    }

    this.editAttempt.attempt();
    if (this.editIssues().length > 0) {
      this.editSummary()?.nativeElement.focus();
      return;
    }

    const generation = this.contextGeneration;
    const thread = this.threadGeneration;
    const body = this.editDraft().trim();
    const idempotencyKey = this.commandKeys.for('edit', message.id, body);
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      if (!this.owns(generation, thread)) {
        return;
      }

      const edited = await firstValueFrom(
        this.api.editConversationMessage(
          conversationId,
          message.id,
          body,
          message.version,
          idempotencyKey,
        ),
      );
      if (!this.owns(generation, thread)) {
        return;
      }

      this.messages.update((loaded) => mergeNewer(loaded, [edited]));
      this.applyToPreview(edited);
      this.commandKeys.release('edit', message.id);
      this.cancelEdit();
    } catch (error) {
      if (this.owns(generation, thread)) {
        // The row keeps what the server still holds. Pretending the edit landed would leave the
        // screen and the workspace disagreeing about what was said.
        this.reportFailure(error, $localize`This message could not be edited.`);
      }
    } finally {
      if (this.owns(generation, thread)) {
        this.busy.set(false);
      }
    }
  }

  protected async remove(message: Message): Promise<void> {
    const conversationId = this.selectedId();
    if (conversationId === null || this.busy()) {
      return;
    }

    const generation = this.contextGeneration;
    const thread = this.threadGeneration;
    // A removal has no payload of its own, so the retained key changes only when the target does.
    const idempotencyKey = this.commandKeys.for('delete', message.id, '');
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      if (!this.owns(generation, thread)) {
        return;
      }

      const removed = await firstValueFrom(
        this.api.deleteConversationMessage(
          conversationId,
          message.id,
          message.version,
          idempotencyKey,
        ),
      );
      if (!this.owns(generation, thread)) {
        return;
      }

      this.messages.update((loaded) => mergeNewer(loaded, [removed]));
      this.applyToPreview(removed);
      this.commandKeys.release('delete', message.id);
      if (this.editingId() === message.id) {
        this.cancelEdit();
      }
    } catch (error) {
      if (this.owns(generation, thread)) {
        this.reportFailure(error, $localize`This message could not be removed.`);
      }
    } finally {
      if (this.owns(generation, thread)) {
        this.busy.set(false);
      }
    }
  }

  protected startModeration(message: Message): void {
    this.cancelEdit();
    this.moderationAttempt.reset();
    this.moderatingId.set(message.id);
    this.moderationReason.set('');
  }

  protected cancelModeration(): void {
    const moderating = this.moderatingId();
    if (moderating !== null) {
      this.commandKeys.release('moderate', moderating);
    }

    this.moderatingId.set(null);
    this.moderationReason.set('');
    this.moderationAttempt.reset();
  }

  protected async moderate(message: Message): Promise<void> {
    const conversationId = this.selectedId();
    if (conversationId === null || this.busy()) {
      return;
    }

    this.moderationAttempt.attempt();
    if (this.moderationIssues().length > 0) {
      this.moderationSummary()?.nativeElement.focus();
      return;
    }

    const generation = this.contextGeneration;
    const thread = this.threadGeneration;
    const reason = this.moderationReason().trim();
    const idempotencyKey = this.commandKeys.for('moderate', message.id, reason);
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      if (!this.owns(generation, thread)) {
        return;
      }

      const removed = await firstValueFrom(
        this.api.moderateConversationMessage(
          conversationId,
          message.id,
          reason,
          message.version,
          idempotencyKey,
        ),
      );
      if (!this.owns(generation, thread)) {
        return;
      }

      this.messages.update((loaded) => mergeNewer(loaded, [removed]));
      this.applyToPreview(removed);
      this.commandKeys.release('moderate', message.id);
      this.cancelModeration();
    } catch (error) {
      if (this.owns(generation, thread)) {
        this.reportFailure(error, $localize`This message could not be removed.`);
      }
    } finally {
      if (this.owns(generation, thread)) {
        this.busy.set(false);
      }
    }
  }

  /**
   * Re-reads the bounded conversation list and the unread badge, and nothing else.
   *
   * This is what a coalesced invalidation and a reconnect both resolve to. It deliberately does not
   * reload the open thread: that thread has its own event cursor and catches up through it, and
   * refetching its history on every arriving message would be a polling loop with extra steps. The
   * badge is not refreshed here either — `MessageUnreadStore` owns that count and reacts to the same
   * coalesced signal, so refreshing it here would send the same request twice.
   */
  private async refreshList(generation: number): Promise<void> {
    await this.loadConversations(generation);
  }

  private async loadConversations(generation: number): Promise<void> {
    const request = ++this.listRequest;
    // This supersedes any Load-more already in flight. Its own `finally` is guarded on being the
    // newest request, so without clearing the flag here the control would stay disabled for ever.
    this.listLoadingMore.set(false);
    this.listLoading.set(true);
    this.error.set(null);
    try {
      const page = await firstValueFrom(
        this.api.listConversations(null, null, conversationPageSize),
      );
      if (!this.ownsList(generation, request)) {
        return;
      }

      this.conversations.set(page.items);
      this.applyCursor(page);
    } catch (error) {
      if (this.ownsList(generation, request)) {
        this.conversations.set([]);
        this.conversationsHasMore.set(false);
        this.error.set(apiErrorMessage(error, $localize`Conversations could not be loaded.`));
      }
    } finally {
      if (this.ownsList(generation, request)) {
        this.listLoading.set(false);
      }
    }
  }

  private async loadThread(
    conversationId: string,
    generation: number,
    thread: number,
  ): Promise<void> {
    const request = ++this.historyRequest;
    // Same reason as the conversation list: a superseded Load-older would otherwise leave its
    // control disabled with nothing left to clear it.
    this.threadLoadingOlder.set(false);
    this.threadLoading.set(true);
    this.error.set(null);
    this.deniedReason.set(null);
    try {
      const page = await firstValueFrom(
        this.api.listConversationMessages(conversationId, null, messagePageSize),
      );
      if (!this.ownsThread(generation, thread, request)) {
        return;
      }

      this.applyPage(page);
      // Subscribe, then catch up from the watermark this read just established. The overlap between
      // the two is deliberate and harmless; the other order leaves a window in which an event
      // committed after the read and before the join reaches nobody and is never asked for again.
      await this.realtime.openConversation(
        conversationId,
        page.latestEventSequence,
        this.threadSink,
      );
      if (!this.ownsThread(generation, thread, request)) {
        return;
      }

      // Read advancement is explicit and happens only after the messages have actually been
      // displayed. Sending, receiving and any future delivery acknowledgement are not reading, and
      // none of them writes this cursor.
      await this.advanceRead(conversationId, page, generation, thread);
    } catch (error) {
      if (this.ownsThread(generation, thread, request)) {
        this.messages.set([]);
        this.reportFailure(error, $localize`This conversation could not be loaded.`);
      }
    } finally {
      if (this.ownsThread(generation, thread, request)) {
        this.threadLoading.set(false);
      }
    }
  }

  private async advanceRead(
    conversationId: string,
    page: MessagePage,
    generation: number,
    thread: number,
  ): Promise<void> {
    const displayed = page.items.reduce(
      (highest, message) => Math.max(highest, message.sequence),
      0,
    );
    if (displayed <= page.readState.lastReadSequence) {
      return;
    }

    try {
      await this.csrf.refresh();
      if (!this.owns(generation, thread)) {
        return;
      }

      const readState = await firstValueFrom(
        this.api.advanceConversationReadCursor(conversationId, displayed),
      );
      if (!this.owns(generation, thread)) {
        return;
      }

      this.conversationUnread.set(readState.unreadCount);
      // The rows the cursor now covers stop being unread. Leaving the marks up would contradict the
      // count beside them, and the server has just said authoritatively where the cursor is.
      this.messages.update((loaded) =>
        loaded.map((message) =>
          message.isUnreadByCaller && message.sequence <= readState.lastReadSequence
            ? { ...message, isUnreadByCaller: false }
            : message,
        ),
      );
      this.conversations.update((loaded) =>
        loaded.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                unreadCount: readState.unreadCount,
                lastReadSequence: readState.lastReadSequence,
                lastReadAtUtc: readState.lastReadAtUtc,
              }
            : conversation,
        ),
      );
      await this.unreadStore.refresh();
    } catch {
      // A failed read report is not worth interrupting the reader for: the messages are on screen,
      // and the cursor is reported again the next time the thread is opened.
    }
  }

  /**
   * Keeps the selected conversation's list row telling the truth about its newest message.
   *
   * The server owns the preview, but the screen has just been told authoritatively what happened to
   * one message. Waiting for a Refresh would leave a removed message's body sitting in the list
   * after the thread has stopped showing it, which is the one place the redaction would visibly
   * fail.
   */
  private applyToPreview(message: Message): void {
    this.conversations.update((loaded) =>
      loaded.map((conversation) => {
        if (conversation.id !== message.conversationId) {
          return conversation;
        }

        const isNewest =
          conversation.lastMessage === null ||
          conversation.lastMessage.messageId === message.id ||
          message.sequence >= conversation.lastMessage.sequence;
        if (!isNewest) {
          return conversation;
        }

        return {
          ...conversation,
          lastSequence: Math.max(conversation.lastSequence, message.sequence),
          lastActivityAtUtc:
            message.sentAtUtc > conversation.lastActivityAtUtc
              ? message.sentAtUtc
              : conversation.lastActivityAtUtc,
          lastMessage: {
            messageId: message.id,
            sequence: message.sequence,
            senderUserId: message.senderUserId,
            isFromCaller: message.isFromCaller,
            sentAtUtc: message.sentAtUtc,
            body: message.body,
            isDeleted: message.isDeleted,
            deletionKind: message.deletionKind,
          },
        };
      }),
    );
  }

  private applyPage(page: MessagePage): void {
    this.messages.set(page.items);
    this.hasOlder.set(page.hasOlder);
    this.oldestSequence.set(page.oldestSequence);
    this.latestSequence.set(page.latestSequence);
    this.conversationUnread.set(page.readState.unreadCount);
  }

  private applyCursor(page: {
    hasMore: boolean;
    nextBeforeActivityAtUtc: string | null;
    nextBeforeConversationId: string | null;
  }): void {
    this.conversationsHasMore.set(page.hasMore);
    this.nextActivityCursor.set(page.nextBeforeActivityAtUtc);
    this.nextIdCursor.set(page.nextBeforeConversationId);
  }

  /**
   * A refusal is rendered from the reason the server sent, in the audience's own words, and replaces
   * the thread rather than sitting above an empty one. Only an unexplained failure falls back to a
   * generic error.
   */
  private reportFailure(error: unknown, fallback: string): void {
    const reason = featureAccessReason(error);
    if (reason !== null) {
      this.deniedReason.set(reason);
      this.messages.set([]);
      return;
    }

    this.error.set(apiErrorMessage(error, fallback));
  }

  private ownsList(generation: number, request: number): boolean {
    return this.contextGeneration === generation && this.listRequest === request;
  }

  private ownsThread(generation: number, thread: number, request: number): boolean {
    return this.owns(generation, thread) && this.historyRequest === request;
  }

  /** A reply may only write if it belongs to the current account, workspace and conversation. */
  private owns(generation: number, thread: number): boolean {
    return this.contextGeneration === generation && this.threadGeneration === thread;
  }

  private resetAll(): void {
    ++this.listRequest;
    this.conversations.set([]);
    this.conversationsHasMore.set(false);
    this.nextActivityCursor.set(null);
    this.nextIdCursor.set(null);
    this.listLoading.set(false);
    this.listLoadingMore.set(false);
    ++this.threadGeneration;
    this.resetThread();
  }

  private resetThread(): void {
    ++this.historyRequest;
    // The socket subscription belongs to the thread, so it goes with it. A connection left in a
    // conversation group the reader has closed would keep receiving frames for a thread nothing is
    // showing, and the next thread's cursor would start behind them.
    void this.realtime.closeConversation();
    this.selectedId.set(null);
    this.messages.set([]);
    this.hasOlder.set(false);
    this.oldestSequence.set(null);
    this.latestSequence.set(0);
    this.conversationUnread.set(0);
    // The draft is part of the thread, not of the screen. A sentence written to one person must
    // never be sitting in a composer addressed to another, and a key retained for a command against
    // that thread must never be spent against this one.
    this.draft.set('');
    this.commandKeys.clear();
    this.composerAttempt.reset();
    this.cancelEdit();
    this.cancelModeration();
    this.threadLoading.set(false);
    this.threadLoadingOlder.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.deniedReason.set(null);
  }
}

/** The two things a body can be wrong about, in the same order the server reports them. */
function bodyIssues(value: string): string[] {
  const body = value.trim();
  if (body.length === 0) {
    return [$localize`Write something before sending.`];
  }

  return body.length > maximumMessageLength
    ? [$localize`A message can be at most ${maximumMessageLength}:max: characters.`]
    : [];
}
