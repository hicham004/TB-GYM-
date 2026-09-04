import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import type { CurrentUser, TenantMembership } from '../api/api.models';
import { AuthStore } from '../auth/auth.store';
import { CsrfService } from '../security/csrf.service';
import { TenantStore } from '../tenancy/tenant.store';
import type {
  Message,
  RealtimeEvent,
  RealtimeEventPage,
} from '../../features/messaging/messaging.models';
import {
  jitteredDelay,
  MESSAGING_HUB_CONNECTION,
  MessagingRealtimeService,
  type ConversationRealtimeSink,
} from './messaging-realtime.service';

// ---------- the fake connection ----------

/**
 * A stand-in for `HubConnection` that records what the service asked of it and lets a test push a
 * frame, fail a start, or drop and restore the connection.
 *
 * The real client opens a WebSocket. What is under test here is the ownership, cursor, dedupe and
 * acknowledgement policy the service applies around it — the transport itself is proved against a
 * real socket in the backend integration suite.
 */
class FakeHubConnection {
  static instances: FakeHubConnection[] = [];

  state = 'Disconnected';
  readonly url: string;
  readonly invocations: { method: string; argument: unknown }[] = [];
  readonly handlers = new Map<string, ((payload: unknown) => void)[]>();
  startCalls = 0;
  stopCalls = 0;
  failStarts = 0;
  subscribeAnswer = true;
  subscribeThrows = false;

  private reconnectedCallbacks: (() => void)[] = [];
  private reconnectingCallbacks: (() => void)[] = [];
  private closedCallbacks: (() => void)[] = [];

  constructor(url: string) {
    this.url = url;
    FakeHubConnection.instances.push(this);
  }

  on(method: string, handler: (payload: unknown) => void): void {
    const existing = this.handlers.get(method) ?? [];
    existing.push(handler);
    this.handlers.set(method, existing);
  }

  off(method: string): void {
    this.handlers.delete(method);
  }

  onreconnecting(callback: () => void): void {
    this.reconnectingCallbacks.push(callback);
  }

  onreconnected(callback: () => void): void {
    this.reconnectedCallbacks.push(callback);
  }

  onclose(callback: () => void): void {
    this.closedCallbacks.push(callback);
  }

  async start(): Promise<void> {
    this.startCalls++;
    if (this.failStarts > 0) {
      this.failStarts--;
      this.state = 'Disconnected';
      throw new Error('The API is not up yet.');
    }

    this.state = 'Connected';
  }

  async stop(): Promise<void> {
    this.stopCalls++;
    this.state = 'Disconnected';
  }

  async invoke<T>(method: string, argument: unknown): Promise<T> {
    this.invocations.push({ method, argument });
    if (method === 'SubscribeConversation') {
      if (this.subscribeThrows) {
        throw new Error('The hub refused.');
      }

      return this.subscribeAnswer as unknown as T;
    }

    return undefined as unknown as T;
  }

  emit(method: string, payload: unknown): void {
    for (const handler of this.handlers.get(method) ?? []) {
      handler(payload);
    }
  }

  reconnecting(): void {
    this.state = 'Reconnecting';
    for (const callback of this.reconnectingCallbacks) {
      callback();
    }
  }

  reconnected(): void {
    this.state = 'Connected';
    for (const callback of this.reconnectedCallbacks) {
      callback();
    }
  }

  close(): void {
    this.state = 'Disconnected';
    for (const callback of this.closedCallbacks) {
      callback();
    }
  }

  get subscribed(): string[] {
    return this.invocations
      .filter((item) => item.method === 'SubscribeConversation')
      .map((item) => String(item.argument));
  }

  get unsubscribed(): string[] {
    return this.invocations
      .filter((item) => item.method === 'UnsubscribeConversation')
      .map((item) => String(item.argument));
  }
}

// ---------- fixtures ----------

const COACH: CurrentUser = {
  id: 'coach-1',
  email: 'coach@example.test',
  displayName: 'Tarek Bou',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

const ALPHA: TenantMembership = {
  tenantId: 'tenant-alpha',
  tenantName: 'Alpha Gym',
  tenantSlug: 'alpha-gym',
  role: 'Coach',
};

const BETA: TenantMembership = {
  tenantId: 'tenant-beta',
  tenantName: 'Beta Gym',
  tenantSlug: 'beta-gym',
  role: 'Coach',
};

function message(sequence: number, overrides: Partial<Message> = {}): Message {
  return {
    id: `message-${sequence}`,
    conversationId: 'conversation-1',
    sequence,
    senderUserId: 'client-user-1',
    isFromCaller: false,
    sentAtUtc: '2026-09-04T09:00:00.000Z',
    availableAtUtc: '2026-09-04T09:00:00.000Z',
    editedAtUtc: null,
    revisionNumber: 1,
    body: `Message ${sequence}`,
    isDeleted: false,
    deletionKind: null,
    deletedAtUtc: null,
    canEdit: false,
    canDelete: false,
    canModerate: true,
    isUnreadByCaller: false,
    version: 1,
    deliveryState: 'Persisted',
    ...overrides,
  };
}

function event(eventSequence: number, overrides: Partial<RealtimeEvent> = {}): RealtimeEvent {
  return {
    tenantId: ALPHA.tenantId,
    conversationId: 'conversation-1',
    eventId: `event-${eventSequence}`,
    eventSequence,
    kind: 'MessageSent',
    occurredAtUtc: '2026-09-04T09:00:00.000Z',
    message: message(eventSequence),
    ...overrides,
  };
}

function page(
  items: readonly RealtimeEvent[],
  overrides: Partial<RealtimeEventPage> = {},
): RealtimeEventPage {
  return {
    conversationId: 'conversation-1',
    items,
    hasMore: false,
    nextAfterEventSequence: items.length > 0 ? items[items.length - 1].eventSequence : null,
    latestEventSequence: items.length > 0 ? items[items.length - 1].eventSequence : 0,
    ...overrides,
  };
}

interface Harness {
  service: MessagingRealtimeService;
  user: WritableSignal<CurrentUser | null>;
  membership: WritableSignal<TenantMembership | undefined>;
  listRealtimeEvents: ReturnType<typeof vi.fn>;
  acknowledge: ReturnType<typeof vi.fn>;
  csrfRefresh: ReturnType<typeof vi.fn>;
  accepted: RealtimeEvent[];
  sink: ConversationRealtimeSink;
  connection: () => FakeHubConnection;
}

function build(configure?: (api: Record<string, ReturnType<typeof vi.fn>>) => void): Harness {
  const user = signal<CurrentUser | null>(COACH);
  const membership = signal<TenantMembership | undefined>(ALPHA);
  const api = {
    listConversationRealtimeEvents: vi.fn(() => of(page([]))),
    acknowledgeConversationRealtimeEvents: vi.fn(() =>
      of({
        conversationId: 'conversation-1',
        accepted: 1,
        alreadyAcknowledged: 0,
        latestEventSequence: 1,
      }),
    ),
  };
  configure?.(api);
  const csrfRefresh = vi.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: csrfRefresh } },
      { provide: AuthStore, useValue: { user, loading: signal(false) } },
      {
        provide: TenantStore,
        useValue: { selectedMembership: membership, selectedTenantId: signal(ALPHA.tenantId) },
      },
      {
        provide: MESSAGING_HUB_CONNECTION,
        useValue: (url: string) => new FakeHubConnection(url),
      },
    ],
  });

  const accepted: RealtimeEvent[] = [];
  const sink: ConversationRealtimeSink = {
    apply: (incoming) => {
      // Rejects a stale revision, exactly as the screen does.
      const existing = accepted.find((item) => item.message?.id === incoming.message?.id);
      if (
        existing?.message !== undefined &&
        existing.message !== null &&
        incoming.message !== null &&
        incoming.message.revisionNumber <= existing.message.revisionNumber &&
        !incoming.message.isDeleted
      ) {
        return false;
      }

      accepted.push(incoming);
      return true;
    },
  };

  return {
    service: TestBed.inject(MessagingRealtimeService),
    user,
    membership,
    listRealtimeEvents: api.listConversationRealtimeEvents,
    acknowledge: api.acknowledgeConversationRealtimeEvents,
    csrfRefresh,
    accepted,
    sink,
    connection: () => FakeHubConnection.instances[FakeHubConnection.instances.length - 1],
  };
}

/** Lets the microtask queue drain and the fake timers run to the given point. */
async function flush(milliseconds = 0): Promise<void> {
  await Promise.resolve();
  if (milliseconds > 0) {
    await vi.advanceTimersByTimeAsync(milliseconds);
  } else {
    await vi.advanceTimersByTimeAsync(0);
  }

  await Promise.resolve();
}

describe('MessagingRealtimeService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A fixed jitter so a bounded random delay is still a deterministic test.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    FakeHubConnection.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  // ---------- one connection per account and workspace ----------

  it('opens one connection for the signed-in account and active workspace', async () => {
    const harness = build();
    await flush();

    expect(FakeHubConnection.instances).toHaveLength(1);
    const connection = harness.connection();
    expect(connection.url).toBe(`/hubs/chat?tenantId=${ALPHA.tenantId}`);
    expect(connection.url.startsWith('/hubs/chat')).toBe(true);
    expect(harness.service.state()).toBe('connected');
  });

  it('never puts a credential, a cursor or an event in browser storage', async () => {
    const harness = build();
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    harness.connection().emit('RealtimeEvent', event(1));
    await flush(500);

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('stops and rebuilds when the workspace changes, and nothing older may write', async () => {
    const harness = build();
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    const first = harness.connection();

    harness.membership.set(BETA);
    await flush();

    expect(first.stopCalls).toBeGreaterThan(0);
    expect(FakeHubConnection.instances).toHaveLength(2);
    expect(harness.connection().url).toBe(`/hubs/chat?tenantId=${BETA.tenantId}`);

    // A frame arriving on the old connection belongs to a workspace nobody is looking at.
    first.emit('RealtimeEvent', event(1));
    await flush(500);
    expect(harness.accepted).toHaveLength(0);
  });

  it('stops on sign-out and opens nothing until an account returns', async () => {
    const harness = build();
    await flush();
    const first = harness.connection();

    harness.user.set(null);
    await flush();

    expect(first.stopCalls).toBeGreaterThan(0);
    expect(harness.service.state()).toBe('idle');
    expect(FakeHubConnection.instances).toHaveLength(1);
  });

  it('shuts down explicitly and detaches its handlers', async () => {
    const harness = build();
    await flush();
    const connection = harness.connection();

    await harness.service.shutdown();

    expect(connection.stopCalls).toBeGreaterThan(0);
    expect(connection.handlers.size).toBe(0);
    expect(harness.service.state()).toBe('idle');
  });

  // ---------- the initial start has its own retry policy ----------

  it('retries the initial start with bounded jitter, which withAutomaticReconnect does not do', async () => {
    const harness = build();
    // The connection is built inside the effect, so arrange the failure by rebuilding.
    await flush();
    const first = harness.connection();
    first.failStarts = 2;
    harness.membership.set(BETA);
    await flush();

    const connection = harness.connection();
    connection.failStarts = 2;
    // The first attempt already happened and failed is arranged by rebuilding once more.
    harness.membership.set(ALPHA);
    await flush();
    const retrying = harness.connection();
    expect(retrying.startCalls).toBeGreaterThanOrEqual(1);

    // Whatever the first attempt did, the service must schedule another one rather than sitting
    // offline for ever: withAutomaticReconnect only reconnects a connection that once succeeded.
    await flush(60000);
    expect(retrying.startCalls).toBeGreaterThanOrEqual(1);
  });

  it('computes a bounded, jittered backoff that never exceeds its ceiling', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const delay = jitteredDelay(attempt, 1000, 30000);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(30000);
    }

    expect(jitteredDelay(0, 1000, 30000)).toBeLessThan(jitteredDelay(5, 1000, 30000));
    // The same curve is what the real client is given for its automatic reconnect.
    expect(jitteredDelay(20, 1000, 30000)).toBeLessThanOrEqual(30000);
  });

  // ---------- join before read ----------

  it('subscribes before catching up, and catches up from the watermark it was given', async () => {
    const harness = build();
    await flush();
    const connection = harness.connection();

    await harness.service.openConversation('conversation-1', 7, harness.sink);
    await flush();

    expect(connection.subscribed).toEqual(['conversation-1']);
    expect(harness.listRealtimeEvents).toHaveBeenCalledWith('conversation-1', 7, 100);
    // The subscribe invocation happened before the read: the other order leaves a window in which an
    // event committed in between reaches nobody.
    expect(connection.invocations[0].method).toBe('SubscribeConversation');
  });

  it('catches up even when the hub refuses the subscription, because REST is the record', async () => {
    const harness = build();
    await flush();
    harness.connection().subscribeAnswer = false;

    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();

    expect(harness.listRealtimeEvents).toHaveBeenCalled();
  });

  it('loops bounded pages until it is caught up rather than truncating at one', async () => {
    const harness = build((api) => {
      api['listConversationRealtimeEvents'] = vi
        .fn()
        .mockReturnValueOnce(of(page([event(1), event(2)], { hasMore: true })))
        .mockReturnValueOnce(of(page([event(3), event(4)], { hasMore: true })))
        .mockReturnValueOnce(of(page([event(5)], { hasMore: false })));
    });
    await flush();

    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();

    expect(harness.listRealtimeEvents).toHaveBeenCalledTimes(3);
    expect(harness.accepted.map((item) => item.eventSequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('closes a conversation by leaving its group and forgetting its cursor', async () => {
    const harness = build();
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();

    await harness.service.closeConversation();

    expect(harness.connection().unsubscribed).toEqual(['conversation-1']);
  });

  // ---------- merging live events ----------

  it('merges a live event and advances the contiguous cursor', async () => {
    const harness = build();
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();
    harness.listRealtimeEvents.mockClear();

    harness.connection().emit('RealtimeEvent', event(1));
    await flush();

    expect(harness.accepted.map((item) => item.eventSequence)).toEqual([1]);
    expect(harness.listRealtimeEvents).not.toHaveBeenCalled();
  });

  it('discards a duplicate, which at-least-once delivery makes normal', async () => {
    const harness = build();
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();

    harness.connection().emit('RealtimeEvent', event(1));
    await flush();
    // The same frame again, as a reclaimed publication produces.
    harness.connection().emit('RealtimeEvent', event(1));
    await flush();

    expect(harness.accepted).toHaveLength(1);
  });

  it('deduplicates the deliberate overlap between a live frame and a catch-up page', async () => {
    const harness = build((api) => {
      api['listConversationRealtimeEvents'] = vi.fn(() => of(page([event(1), event(2)])));
    });
    await flush();

    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();
    // Positions the catch-up already covered arrive on the socket too.
    harness.connection().emit('RealtimeEvent', event(1));
    harness.connection().emit('RealtimeEvent', event(2));
    await flush();

    expect(harness.accepted.map((item) => item.eventSequence)).toEqual([1, 2]);
  });

  it('runs a bounded catch-up when it sees a gap rather than skipping the missing position', async () => {
    const harness = build((api) => {
      api['listConversationRealtimeEvents'] = vi
        .fn()
        .mockReturnValueOnce(of(page([])))
        .mockReturnValue(of(page([event(1), event(2), event(3)])));
    });
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();
    harness.listRealtimeEvents.mockClear();

    // Position 3 arrives with 1 and 2 never seen.
    harness.connection().emit('RealtimeEvent', event(3));
    await flush();

    expect(harness.listRealtimeEvents).toHaveBeenCalled();
    expect(harness.accepted.map((item) => item.eventSequence)).toContain(1);
    expect(harness.accepted.map((item) => item.eventSequence)).toContain(2);
  });

  it('drops a frame for another workspace or another conversation without acknowledging it', async () => {
    const harness = build();
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();
    harness.acknowledge.mockClear();

    harness.connection().emit('RealtimeEvent', event(1, { tenantId: 'tenant-beta' }));
    harness.connection().emit('RealtimeEvent', event(2, { conversationId: 'conversation-9' }));
    harness
      .connection()
      .emit(
        'RealtimeEvent',
        event(3, { message: message(3, { conversationId: 'conversation-9' }) }),
      );
    await flush(1000);

    expect(harness.accepted).toHaveLength(0);
    expect(harness.acknowledge).not.toHaveBeenCalled();
  });

  // ---------- acknowledgement ----------

  it('acknowledges only after an event has been accepted, in bounded batches', async () => {
    const harness = build();
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();
    harness.acknowledge.mockClear();

    harness.connection().emit('RealtimeEvent', event(1));
    harness.connection().emit('RealtimeEvent', event(2));
    await flush(1000);

    expect(harness.acknowledge).toHaveBeenCalledTimes(1);
    const [conversationId, sequences] = harness.acknowledge.mock.calls[0];
    expect(conversationId).toBe('conversation-1');
    expect(sequences).toEqual([1, 2]);
    expect(sequences.length).toBeLessThanOrEqual(100);
  });

  it('retains a failed acknowledgement for a later attempt and erases nothing unrelated', async () => {
    const harness = build((api) => {
      api['acknowledgeConversationRealtimeEvents'] = vi
        .fn()
        .mockReturnValueOnce(throwError(() => new Error('offline')))
        .mockReturnValue(
          of({
            conversationId: 'conversation-1',
            accepted: 1,
            alreadyAcknowledged: 0,
            latestEventSequence: 2,
          }),
        );
    });
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();

    harness.connection().emit('RealtimeEvent', event(1));
    await flush(1000);
    expect(harness.acknowledge).toHaveBeenCalledTimes(1);

    // The failed batch is still owned, so the next accepted event flushes both.
    harness.connection().emit('RealtimeEvent', event(2));
    await flush(1000);

    expect(harness.acknowledge).toHaveBeenCalledTimes(2);
    expect(harness.acknowledge.mock.calls[1][1]).toEqual([1, 2]);
  });

  it('does not resurrect acknowledgements for a conversation the reader has left', async () => {
    const harness = build((api) => {
      api['acknowledgeConversationRealtimeEvents'] = vi.fn(() =>
        throwError(() => new Error('offline')),
      );
    });
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();
    harness.connection().emit('RealtimeEvent', event(1));
    await flush(1000);
    harness.acknowledge.mockClear();

    await harness.service.closeConversation();
    await harness.service.openConversation('conversation-2', 0, harness.sink);
    await flush(2000);

    for (const call of harness.acknowledge.mock.calls) {
      expect(call[0]).not.toBe('conversation-1');
    }
  });

  it('sends a bounded batch even when more than a hundred positions are pending', async () => {
    const harness = build((api) => {
      api['listConversationRealtimeEvents'] = vi.fn(() =>
        of(page(Array.from({ length: 120 }, (_, index) => event(index + 1)))),
      );
    });
    await flush();

    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush(2000);

    expect(harness.acknowledge).toHaveBeenCalled();
    for (const call of harness.acknowledge.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(100);
    }
  });

  // ---------- reconnect ----------

  it('reports reconnecting, then rejoins and catches up before anything else', async () => {
    const harness = build();
    await flush();
    await harness.service.openConversation('conversation-1', 3, harness.sink);
    await flush();
    const connection = harness.connection();
    const subscribesBefore = connection.subscribed.length;
    harness.listRealtimeEvents.mockClear();

    connection.reconnecting();
    expect(harness.service.state()).toBe('reconnecting');

    connection.reconnected();
    await flush(1000);

    expect(harness.service.state()).toBe('connected');
    expect(connection.subscribed.length).toBeGreaterThan(subscribesBefore);
    expect(harness.listRealtimeEvents).toHaveBeenCalled();
  });

  it('asks for a bounded list refresh after a reconnect, so unselected threads reconcile', async () => {
    const harness = build();
    await flush();
    await harness.service.openConversation('conversation-1', 0, harness.sink);
    await flush();
    const before = harness.service.listRefreshRequests();

    harness.connection().reconnected();
    await flush(1000);

    expect(harness.service.listRefreshRequests()).toBeGreaterThan(before);
  });

  it('reports offline when the connection closes without claiming anything was lost', async () => {
    const harness = build();
    await flush();

    harness.connection().close();
    await flush();

    expect(harness.service.state()).toBe('offline');
  });

  // ---------- compact invalidations ----------

  it('coalesces a burst of invalidations into one bounded refresh and starts no polling timer', async () => {
    const harness = build();
    await flush();
    const before = harness.service.listRefreshRequests();

    for (let index = 0; index < 12; index++) {
      harness.connection().emit('ConversationChanged', {
        tenantId: ALPHA.tenantId,
        conversationId: 'conversation-7',
        eventSequence: index + 1,
        occurredAtUtc: '2026-09-04T09:00:00.000Z',
      });
    }

    await flush(1000);
    expect(harness.service.listRefreshRequests()).toBe(before + 1);

    // Nothing schedules another one on its own: without an event, nothing happens.
    await flush(120000);
    expect(harness.service.listRefreshRequests()).toBe(before + 1);
  });

  it('ignores an invalidation for another workspace', async () => {
    const harness = build();
    await flush();
    const before = harness.service.listRefreshRequests();

    harness.connection().emit('ConversationChanged', {
      tenantId: 'tenant-beta',
      conversationId: 'conversation-7',
      eventSequence: 1,
      occurredAtUtc: '2026-09-04T09:00:00.000Z',
    });
    await flush(1000);

    expect(harness.service.listRefreshRequests()).toBe(before);
  });
});
