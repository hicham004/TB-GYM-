import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  InjectionToken,
  signal,
} from '@angular/core';
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { AuthStore } from '../auth/auth.store';
import { CsrfService } from '../security/csrf.service';
import { TenantStore } from '../tenancy/tenant.store';
import type { RealtimeEvent } from '../../features/messaging/messaging.models';

/**
 * The part of a hub connection this service uses.
 *
 * Narrowed to what is actually called so a test can supply a controllable one. The alternative —
 * mocking the transport package — depends on module-registry behaviour that changes between running
 * one spec file and running the suite, and a seam that only works in isolation is not a seam.
 */
export interface MessagingHubConnection {
  readonly state: string;
  on(method: string, handler: (payload: unknown) => void): void;
  off(method: string): void;
  onreconnecting(callback: () => void): void;
  onreconnected(callback: () => void): void;
  onclose(callback: () => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  invoke<T>(method: string, argument: unknown): Promise<T>;
}

export type MessagingHubConnectionFactory = (url: string) => MessagingHubConnection;

/**
 * How a hub connection is built.
 *
 * The default is the real `@microsoft/signalr` client, configured for the browser session: a
 * relative same-origin URL, the HTTP-only cookie the browser already holds, a logging level that
 * cannot record payload content, and automatic reconnect with bounded jitter.
 */
export const MESSAGING_HUB_CONNECTION = new InjectionToken<MessagingHubConnectionFactory>(
  'messaging hub connection factory',
  {
    providedIn: 'root',
    factory: () => (url: string) =>
      new HubConnectionBuilder()
        // A relative, same-origin URL with the session cookie the browser already holds. There is no
        // access token: the cookie is HTTP-only for a reason, and an accessTokenFactory would mean
        // holding a credential in JavaScript that the existing session deliberately does not expose.
        .withUrl(url, { withCredentials: true })
        // Warnings and errors only. Information level logs every invocation and every frame, which
        // for this hub means message projections in the browser console.
        .configureLogging(LogLevel.Warning)
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (context) =>
            jitteredDelay(
              context.previousRetryCount,
              initialStartBaseDelayMs,
              initialStartMaximumDelayMs,
            ),
        })
        .build(),
  },
);

/**
 * What the user can honestly be told about the channel.
 *
 * None of these says anything about whether messages exist. The record is in PostgreSQL and is read
 * over REST; this is only whether the convenience channel is currently up.
 */
export type RealtimeConnectionState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

/** Where a thread's accepted events go. Returns whether the event was actually merged. */
export interface ConversationRealtimeSink {
  apply(event: RealtimeEvent): boolean;
}

/** The most acknowledgements one request may carry, matching the server bound. */
const acknowledgementBatchSize = 100;

/** The largest catch-up page the server will serve. */
const catchUpPageSize = 100;

/** Never loop forever on a server that keeps saying there is more. */
const maximumCatchUpPages = 200;

const initialStartBaseDelayMs = 1000;
const initialStartMaximumDelayMs = 30000;
const invalidationDebounceMs = 400;
const acknowledgementDebounceMs = 250;
const retryBaseDelayMs = 1000;
const retryMaximumDelayMs = 30000;

/**
 * The one realtime connection for the signed-in account and the active workspace.
 *
 * Everything here belongs to one account, in one workspace, and — for a thread — one conversation.
 * Each of those is a generation, and every asynchronous result checks the generation it was asked
 * for before it writes anything. Without that, a delayed start, a reconnect callback, a catch-up
 * page, an acknowledgement reply or a socket frame for the workspace the user has just left lands on
 * top of the current one, and somebody sees a thread that is not theirs — which the server would
 * never have sent them, but the screen would have shown.
 *
 * **The socket is a convenience, never the record.** Every event it carries is also in PostgreSQL and
 * can be re-read by event position, which is why losing frames, receiving them twice or receiving
 * them out of order are all recoverable here rather than fatal. Delivery is deliberately at least
 * once: a publication that crashed after the hub accepted it is republished after its lease expires,
 * and this service is what makes that duplicate harmless.
 *
 * **The join happens before the read.** Subscribing to a conversation and then catching up overlaps
 * deliberately — the events between the two are received twice — because the other order has a window
 * in which an event committed after the read and before the join reaches nobody and is never asked
 * for again. Duplicates are cheap; a silently missing message is not.
 *
 * Nothing is written to local or session storage: not a body, not an event, not a cursor, not a
 * pending acknowledgement, and certainly not a credential. All of it is in-memory and owned by a
 * generation, so signing out ends it rather than leaving it on the machine.
 */
@Injectable({ providedIn: 'root' })
export class MessagingRealtimeService {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly csrf = inject(CsrfService);
  private readonly connectionFactory = inject(MESSAGING_HUB_CONNECTION);

  private readonly connectionState = signal<RealtimeConnectionState>('idle');
  /** Bumped when a bounded conversation-list and unread refresh is due. Never a polling timer. */
  private readonly listRefreshState = signal(0);

  readonly state = this.connectionState.asReadonly();
  readonly listRefreshRequests = this.listRefreshState.asReadonly();
  readonly isConnected = computed(() => this.connectionState() === 'connected');

  /** Bumped whenever the account or the workspace changes. Owns the connection. */
  private contextGeneration = 0;
  /** Bumped whenever the context or the selected conversation changes. Owns the thread state. */
  private conversationGeneration = 0;
  private context: string | null = null;

  private connection: MessagingHubConnection | null = null;
  private startAttempt = 0;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

  private conversationId: string | null = null;
  private sink: ConversationRealtimeSink | null = null;
  /** The highest position for which every earlier position has been accepted. */
  private contiguousCursor = 0;
  /** The exact thread generation currently reading catch-up pages. */
  private catchUpOwner: string | null = null;
  /** A gap noticed during an in-flight read must cause one more read after that result settles. */
  private catchUpRequestedAgain: string | null = null;
  private catchUpTimer: ReturnType<typeof setTimeout> | null = null;
  private catchUpAttempt = 0;

  private readonly pendingAcknowledgements = new Set<number>();
  private acknowledgementTimer: ReturnType<typeof setTimeout> | null = null;
  private flushingAcknowledgements = false;
  private acknowledgementAttempt = 0;

  private invalidationTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly contextKey = computed(() => {
    const userId = this.auth.user()?.id ?? null;
    const membership = this.tenants.selectedMembership();
    return userId === null || membership === undefined ? null : `${userId}|${membership.tenantId}`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => void this.shutdown());
    effect(() => {
      const key = this.contextKey();
      if (key === this.context) {
        return;
      }

      this.context = key;
      // Torn down before anything is opened. A connection authorized for the workspace the user has
      // just left must not stay open for the length of a handshake, and the server would refuse to
      // change its workspace anyway: a hub connection's tenant binding is fixed at connection.
      void this.rebuild(key);
    });
  }

  /**
   * Opens a thread: join the conversation group first, then catch up from the given cursor.
   *
   * @param conversationId the conversation now on screen.
   * @param fromEventSequence the watermark the initial REST load established. A conversation that
   * predates realtime events reports zero, which is honest: it has no events, and its current state
   * came from the full read that just happened.
   * @param sink where accepted events are merged.
   */
  async openConversation(
    conversationId: string,
    fromEventSequence: number,
    sink: ConversationRealtimeSink,
  ): Promise<void> {
    const context = this.contextGeneration;
    const conversation = ++this.conversationGeneration;
    await this.leaveCurrentConversation();
    if (!this.ownsContext(context) || this.conversationGeneration !== conversation) {
      return;
    }

    this.conversationId = conversationId;
    this.sink = sink;
    this.contiguousCursor = Math.max(0, fromEventSequence);
    this.pendingAcknowledgements.clear();

    await this.joinThenCatchUp(conversationId, context, conversation);
  }

  /** Closes the thread and forgets everything that belonged to it. */
  async closeConversation(): Promise<void> {
    ++this.conversationGeneration;
    await this.leaveCurrentConversation();
  }

  /** Signing out ends the connection immediately rather than waiting for the next effect pass. */
  async shutdown(): Promise<void> {
    ++this.contextGeneration;
    ++this.conversationGeneration;
    this.context = null;
    await this.teardown();
    this.connectionState.set('idle');
  }

  // ---------- connection ----------

  private async rebuild(key: string | null): Promise<void> {
    const context = ++this.contextGeneration;
    ++this.conversationGeneration;
    await this.teardown();
    if (key === null || !this.ownsContext(context)) {
      this.connectionState.set('idle');
      return;
    }

    const tenantId = this.tenants.selectedMembership()?.tenantId;
    if (tenantId === undefined) {
      this.connectionState.set('idle');
      return;
    }

    // The workspace travels in the query string because a browser cannot put a custom header on a
    // WebSocket. It is routing input, not authorization: the server verifies membership from
    // PostgreSQL before the connection is usable and binds the workspace to it thereafter.
    const connection = this.connectionFactory(
      `/hubs/chat?tenantId=${encodeURIComponent(tenantId)}`,
    );

    connection.on('RealtimeEvent', (event: unknown) => this.onRealtimeEvent(context, event));
    connection.on('ConversationChanged', (invalidation: unknown) =>
      this.onConversationChanged(context, invalidation),
    );
    connection.onreconnecting(() => {
      if (this.ownsContext(context)) {
        this.connectionState.set('reconnecting');
      }
    });
    // An ordinary reconnect is a new connection with a new identity, and every group it was in is
    // gone. The server rejoins the tenant-user group in its own connect handler; the conversation
    // group is this client's to ask for again, and only then is it safe to catch up.
    connection.onreconnected(() => void this.onReconnected(context));
    connection.onclose(() => {
      if (this.ownsContext(context)) {
        this.connectionState.set('offline');
      }
    });

    this.connection = connection;
    this.startAttempt = 0;
    await this.start(context);
  }

  /**
   * Starts the connection, retrying with bounded jittered backoff until it works or the generation
   * is invalidated.
   *
   * `withAutomaticReconnect` deliberately does not retry the initial `start()`: it reconnects a
   * connection that was once established. A first attempt that fails because the API is still
   * starting, or the network is not up yet, would otherwise leave the client permanently offline
   * with no error anybody sees, so the initial attempt has its own policy.
   */
  private async start(context: number): Promise<void> {
    const connection = this.connection;
    if (connection === null || !this.ownsContext(context)) {
      return;
    }

    this.connectionState.set('connecting');
    try {
      await connection.start();
      if (!this.ownsContext(context)) {
        // The workspace changed while the handshake was in flight. This connection is authorized for
        // a workspace nobody is looking at any more.
        await stopQuietly(connection);
        return;
      }

      this.startAttempt = 0;
      this.connectionState.set('connected');
      // A thread may have been opened while the socket was down. Rejoining and catching up here is
      // what makes an initial-start failure recoverable rather than a thread that silently never
      // receives anything.
      if (this.conversationId !== null) {
        await this.joinThenCatchUp(this.conversationId, context, this.conversationGeneration);
      }
    } catch {
      if (!this.ownsContext(context)) {
        return;
      }

      this.connectionState.set('offline');
      const delay = jitteredDelay(
        this.startAttempt++,
        initialStartBaseDelayMs,
        initialStartMaximumDelayMs,
      );
      this.clearStartTimer();
      this.startTimer = setTimeout(() => {
        this.startTimer = null;
        void this.start(context);
      }, delay);
    }
  }

  private async onReconnected(context: number): Promise<void> {
    if (!this.ownsContext(context)) {
      return;
    }

    this.connectionState.set('connected');
    const conversation = this.conversationGeneration;
    if (this.conversationId !== null) {
      await this.joinThenCatchUp(this.conversationId, context, conversation);
    }

    // Events for threads that were not open are not replayed to anybody. They are reconciled from
    // PostgreSQL by refreshing the bounded list and the unread count, which is also what keeps the
    // badge honest after a disconnect nobody noticed.
    if (this.ownsContext(context)) {
      this.requestListRefresh();
    }
  }

  private async teardown(): Promise<void> {
    this.clearStartTimer();
    this.clearCatchUpTimer();
    this.clearAcknowledgementTimer();
    this.clearInvalidationTimer();
    this.pendingAcknowledgements.clear();
    this.conversationId = null;
    this.sink = null;
    this.contiguousCursor = 0;
    this.catchUpOwner = null;
    this.catchUpRequestedAgain = null;
    this.catchUpAttempt = 0;
    this.acknowledgementAttempt = 0;

    const connection = this.connection;
    this.connection = null;
    if (connection !== null) {
      connection.off('RealtimeEvent');
      connection.off('ConversationChanged');
      await stopQuietly(connection);
    }
  }

  // ---------- thread ----------

  private async joinThenCatchUp(
    conversationId: string,
    context: number,
    conversation: number,
  ): Promise<void> {
    // Join first. The other order leaves a window in which an event committed after the catch-up
    // query and before the join reaches nobody, and nothing afterwards asks for it.
    const joined = await this.subscribe(conversationId);
    if (!this.owns(context, conversation)) {
      return;
    }

    if (!joined) {
      // The socket is not up, or the server refused. Catch-up still runs: the REST read is
      // authorized on its own terms and is the thing that actually keeps the thread correct.
      this.connectionState.set(
        this.connection?.state === HubConnectionState.Connected ? 'connected' : 'offline',
      );
    }

    await this.catchUp(conversationId, context, conversation);
  }

  private async subscribe(conversationId: string): Promise<boolean> {
    const connection = this.connection;
    if (connection === null || connection.state !== HubConnectionState.Connected) {
      return false;
    }

    try {
      // The client passes a conversation identifier and nothing else. There is no group name and no
      // user identifier to supply: the server computes both from the connection it verified.
      return await connection.invoke<boolean>('SubscribeConversation', conversationId);
    } catch {
      return false;
    }
  }

  private async leaveCurrentConversation(): Promise<void> {
    const conversationId = this.conversationId;
    this.conversationId = null;
    this.sink = null;
    this.contiguousCursor = 0;
    this.pendingAcknowledgements.clear();
    this.clearCatchUpTimer();
    this.clearAcknowledgementTimer();
    this.catchUpOwner = null;
    this.catchUpRequestedAgain = null;
    this.catchUpAttempt = 0;
    this.acknowledgementAttempt = 0;

    const connection = this.connection;
    if (
      conversationId === null ||
      connection === null ||
      connection.state !== HubConnectionState.Connected
    ) {
      return;
    }

    try {
      await connection.invoke('UnsubscribeConversation', conversationId);
    } catch {
      // Leaving a group is a courtesy, not a security boundary. The server re-authorizes every
      // dispatched frame, so a group this connection failed to leave delivers nothing it should not.
    }
  }

  /**
   * Reads forward from the contiguous cursor until there is nothing left.
   *
   * Bounded pages, looped until `hasMore` is false, so a client that has been away for a thousand
   * events ends up with all of them rather than silently stopping at the first page.
   */
  private async catchUp(
    conversationId: string,
    context: number,
    conversation: number,
  ): Promise<void> {
    const owner = this.catchUpOwnerKey(conversationId, context, conversation);
    if (this.catchUpOwner === owner) {
      // A frame can expose a gap while an older REST response is still in flight. Remember that
      // wake-up: the response may have taken its database snapshot before the frame committed.
      this.catchUpRequestedAgain = owner;
      return;
    }

    // A superseded conversation must not prevent its replacement from catching up. Both requests may
    // briefly exist, but every result is generation-checked before it can write.
    this.catchUpOwner = owner;
    let retry = false;
    let continueAfterBound = false;
    try {
      for (let page = 0; page < maximumCatchUpPages; page++) {
        const result = await firstValueFrom(
          this.api.listConversationRealtimeEvents(
            conversationId,
            this.contiguousCursor,
            catchUpPageSize,
          ),
        );
        if (!this.owns(context, conversation) || this.conversationId !== conversationId) {
          return;
        }

        for (const event of result.items) {
          this.accept(event, conversationId);
        }

        if (!result.hasMore) {
          this.catchUpAttempt = 0;
          return;
        }
      }

      // Yield after a defensive bound, then continue from the durable cursor. The bound protects the
      // browser from a pathological synchronous loop; it is not permission to truncate history.
      continueAfterBound = true;
    } catch {
      // The thread on screen came from the full REST read and the cursor never passes unseen data.
      // Retry from that cursor even if no later socket frame arrives to wake the service up.
      retry = true;
    } finally {
      if (this.catchUpOwner === owner) {
        this.catchUpOwner = null;
        const requestedAgain = this.catchUpRequestedAgain === owner;
        if (requestedAgain) {
          this.catchUpRequestedAgain = null;
        }

        if (this.owns(context, conversation) && this.conversationId === conversationId) {
          if (continueAfterBound || requestedAgain) {
            this.scheduleCatchUp(conversationId, context, conversation, 0);
          } else if (retry) {
            this.scheduleCatchUp(
              conversationId,
              context,
              conversation,
              jitteredDelay(this.catchUpAttempt++, retryBaseDelayMs, retryMaximumDelayMs),
            );
          }
        }
      }
    }
  }

  // ---------- events ----------

  private onRealtimeEvent(context: number, payload: unknown): void {
    const event = payload as RealtimeEvent | null;
    const conversationId = this.conversationId;
    if (event === null || conversationId === null || !this.ownsContext(context)) {
      return;
    }

    const conversation = this.conversationGeneration;
    if (!this.accept(event, conversationId)) {
      return;
    }

    // A gap means something was missed — a frame lost, a publication suppressed for a moment, an
    // out-of-order arrival. The cursor is not advanced past it and a bounded catch-up fills it in,
    // because skipping the missing position is how a client permanently loses a message.
    if (event.eventSequence > this.contiguousCursor + 1) {
      void this.catchUp(conversationId, context, conversation);
    }
  }

  /**
   * Validates one event's ownership, merges it, advances the cursor and queues its acknowledgement.
   *
   * @returns whether the caller should look for a gap after it.
   */
  private accept(event: RealtimeEvent, conversationId: string): boolean {
    const tenantId = this.tenants.selectedMembership()?.tenantId;
    // Ownership, checked on the event itself rather than trusted from the transport. A frame for
    // another workspace or another conversation is dropped without being merged and without being
    // acknowledged, because acknowledging it would be this application claiming it accepted
    // something it refused.
    if (
      tenantId === undefined ||
      event.tenantId !== tenantId ||
      event.conversationId !== conversationId ||
      (event.message !== null && event.message.conversationId !== conversationId)
    ) {
      return false;
    }

    // Already merged. Delivery is at least once, so this is normal: a duplicate after a reclaimed
    // publication, or the deliberate overlap between a live frame and a catch-up page.
    if (event.eventSequence <= this.contiguousCursor) {
      return false;
    }

    const merged = this.sink?.apply(event) ?? false;
    if (!merged) {
      // The screen rejected it — a stale revision, or a body a removal has already made terminal.
      // The position is still contiguous knowledge: it was received and evaluated, so the cursor may
      // advance and the acknowledgement is honest.
      if (event.eventSequence === this.contiguousCursor + 1) {
        this.contiguousCursor = event.eventSequence;
        this.queueAcknowledgement(event.eventSequence);
      }

      return true;
    }

    if (event.eventSequence === this.contiguousCursor + 1) {
      this.contiguousCursor = event.eventSequence;
      this.queueAcknowledgement(event.eventSequence);
      return true;
    }

    // Merged but ahead of the cursor. It is acknowledged, because this application really did accept
    // it; the cursor stays put so the gap behind it is still fetched.
    this.queueAcknowledgement(event.eventSequence);
    return true;
  }

  private onConversationChanged(context: number, payload: unknown): void {
    const invalidation = payload as { tenantId?: string } | null;
    const tenantId = this.tenants.selectedMembership()?.tenantId;
    if (
      invalidation === null ||
      tenantId === undefined ||
      invalidation.tenantId !== tenantId ||
      !this.ownsContext(context)
    ) {
      return;
    }

    this.requestListRefresh();
  }

  /**
   * Coalesces invalidations into one bounded refresh.
   *
   * A burst of messages must not become a burst of list requests, and the debounce is a trailing one
   * so the refresh reads state after the burst rather than in the middle of it. This is not a polling
   * timer: nothing schedules it except an event that actually arrived.
   */
  private requestListRefresh(): void {
    this.clearInvalidationTimer();
    this.invalidationTimer = setTimeout(() => {
      this.invalidationTimer = null;
      this.listRefreshState.update((count) => count + 1);
    }, invalidationDebounceMs);
  }

  // ---------- acknowledgement ----------

  private queueAcknowledgement(eventSequence: number): void {
    this.pendingAcknowledgements.add(eventSequence);
    if (this.acknowledgementTimer !== null) {
      return;
    }

    this.scheduleAcknowledgementFlush(
      this.contextGeneration,
      this.conversationGeneration,
      acknowledgementDebounceMs,
    );
  }

  /**
   * Sends what this application has accepted, in bounded batches.
   *
   * Idempotent by construction: the server keys an acknowledgement on the event and the participant,
   * so a retry after a lost response is the same fact rather than a second one. A failed batch is put
   * back — but only if the generation that queued it still owns the thread, so a failure cannot
   * resurrect acknowledgements for a conversation or workspace the user has left.
   */
  private async flushAcknowledgements(context: number, conversation: number): Promise<void> {
    if (this.flushingAcknowledgements || !this.owns(context, conversation)) {
      return;
    }

    const conversationId = this.conversationId;
    if (conversationId === null || this.pendingAcknowledgements.size === 0) {
      return;
    }

    this.flushingAcknowledgements = true;
    let retry = false;
    try {
      while (this.pendingAcknowledgements.size > 0 && this.owns(context, conversation)) {
        const batch = [...this.pendingAcknowledgements]
          .sort((left, right) => left - right)
          .slice(0, acknowledgementBatchSize);
        for (const sequence of batch) {
          this.pendingAcknowledgements.delete(sequence);
        }

        try {
          await this.csrf.refresh();
          if (!this.owns(context, conversation) || this.conversationId !== conversationId) {
            return;
          }

          await firstValueFrom(
            this.api.acknowledgeConversationRealtimeEvents(conversationId, batch),
          );
        } catch {
          // Retained for a later attempt, and only for the generation that owns them. Nothing about
          // an acknowledgement is worth showing the reader: the messages are on screen either way,
          // and this records delivery rather than anything the person did.
          if (this.owns(context, conversation) && this.conversationId === conversationId) {
            for (const sequence of batch) {
              this.pendingAcknowledgements.add(sequence);
            }
            retry = true;
          }

          return;
        }
      }

      this.acknowledgementAttempt = 0;
    } finally {
      this.flushingAcknowledgements = false;
      if (retry && this.owns(context, conversation) && this.conversationId === conversationId) {
        this.scheduleAcknowledgementFlush(
          context,
          conversation,
          jitteredDelay(this.acknowledgementAttempt++, retryBaseDelayMs, retryMaximumDelayMs),
        );
      }
    }
  }

  // ---------- ownership ----------

  private ownsContext(context: number): boolean {
    return this.contextGeneration === context;
  }

  private owns(context: number, conversation: number): boolean {
    return this.contextGeneration === context && this.conversationGeneration === conversation;
  }

  private catchUpOwnerKey(conversationId: string, context: number, conversation: number): string {
    return `${context}|${conversation}|${conversationId}`;
  }

  private scheduleCatchUp(
    conversationId: string,
    context: number,
    conversation: number,
    delay: number,
  ): void {
    this.clearCatchUpTimer();
    this.catchUpTimer = setTimeout(() => {
      this.catchUpTimer = null;
      if (this.owns(context, conversation) && this.conversationId === conversationId) {
        void this.catchUp(conversationId, context, conversation);
      }
    }, delay);
  }

  private scheduleAcknowledgementFlush(context: number, conversation: number, delay: number): void {
    this.clearAcknowledgementTimer();
    this.acknowledgementTimer = setTimeout(() => {
      this.acknowledgementTimer = null;
      void this.flushAcknowledgements(context, conversation);
    }, delay);
  }

  private clearStartTimer(): void {
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }

  private clearAcknowledgementTimer(): void {
    if (this.acknowledgementTimer !== null) {
      clearTimeout(this.acknowledgementTimer);
      this.acknowledgementTimer = null;
    }
  }

  private clearCatchUpTimer(): void {
    if (this.catchUpTimer !== null) {
      clearTimeout(this.catchUpTimer);
      this.catchUpTimer = null;
    }
  }

  private clearInvalidationTimer(): void {
    if (this.invalidationTimer !== null) {
      clearTimeout(this.invalidationTimer);
      this.invalidationTimer = null;
    }
  }
}

/**
 * Exponential backoff with bounded jitter.
 *
 * The jitter matters more than the curve: without it, every browser that lost the same deployment
 * reconnects at the same instant, and the retry storm is worse than the outage was.
 */
export function jitteredDelay(attempt: number, baseMs: number, maximumMs: number): number {
  const exponential = Math.min(maximumMs, baseMs * 2 ** Math.min(attempt, 10));
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}

async function stopQuietly(connection: MessagingHubConnection): Promise<void> {
  try {
    await connection.stop();
  } catch {
    // Stopping a connection that has already failed is not itself a failure worth reporting.
  }
}
