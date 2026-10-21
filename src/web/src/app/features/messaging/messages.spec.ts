import { signal, type WritableSignal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiClient } from '../../core/api/api-client';
import type { CurrentUser, TenantMembership } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { MessageUnreadStore } from '../../core/messaging/message-unread.store';
import {
  MessagingRealtimeService,
  type ConversationRealtimeSink,
} from '../../core/messaging/messaging-realtime.service';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { profileOverview } from '../../../testing/client-profile-fixtures';
import { MAYA } from '../../../testing/coach-today-fixtures';
import { button, field, press, query, settle } from '../../../testing/dom';
import { ConversationLaunch } from './conversation-launch';
import { SavedRepliesApi } from './saved-replies-api';
import { messagingRoutes } from './messages.routes';
import type { ConversationPage as ServerConversationPage } from '../../core/api/generated';
import type { Conversation, ConversationReadState, Message, MessagePage } from './messaging.models';
import { Messages } from './messages';

const COACH: CurrentUser = {
  id: 'coach-1',
  email: 'coach@example.test',
  displayName: 'Tarek Bou',
  preferredCulture: 'en-LB',
  preferredThemeMode: 'system',
  preferredWeightUnit: 'Kilogram',
  emailConfirmed: true,
  roles: [],
};

const OTHER_USER: CurrentUser = { ...COACH, id: 'coach-2', displayName: 'Other Coach' };

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

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    clientProfileId: 'client-1',
    counterpart: { userId: 'client-user-1', displayName: 'Rania Haddad', role: 'Client' },
    callerRole: 'Coach',
    canModerate: true,
    startedAtUtc: '2026-09-01T08:00:00.000Z',
    lastActivityAtUtc: '2026-09-01T09:00:00.000Z',
    lastSequence: 2,
    unreadCount: 0,
    lastReadSequence: 2,
    lastReadAtUtc: '2026-09-01T09:00:00.000Z',
    isAvailable: true,
    accessReason: 'Granted',
    lastMessage: null,
    isReadOnly: false,
    isAwaitingReply: false,
    latestFromCounterpart: null,
    ...overrides,
  };
}

/** A page of the list as the server sends it, its counts saying "awaiting reply"; the page maps it. */
function conversationPage(
  items: readonly Conversation[],
  overrides: Partial<ServerConversationPage> = {},
): ServerConversationPage {
  return {
    items: [...items],
    hasMore: false,
    nextBeforeActivityAtUtc: null,
    nextBeforeConversationId: null,
    counts: null,
    ...overrides,
  };
}

function message(sequence: number, overrides: Partial<Message> = {}): Message {
  return {
    id: `message-${sequence}`,
    conversationId: 'conversation-1',
    sequence,
    senderUserId: 'client-user-1',
    isFromCaller: false,
    sentAtUtc: `2026-09-01T09:0${sequence}:00.000Z`,
    availableAtUtc: `2026-09-01T09:0${sequence}:00.000Z`,
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

const SECOND = {
  id: 'conversation-2',
  counterpart: { userId: 'client-user-2', displayName: 'Nadia Khoury', role: 'Client' as const },
};

function readState(overrides: Partial<ConversationReadState> = {}): ConversationReadState {
  return {
    conversationId: 'conversation-1',
    userId: 'coach-1',
    role: 'Coach',
    lastReadSequence: 99,
    lastReadAtUtc: '2026-09-01T09:00:00.000Z',
    unreadCount: 0,
    latestSequence: 99,
    ...overrides,
  };
}

function messagePage(items: readonly Message[], overrides: Partial<MessagePage> = {}): MessagePage {
  return {
    conversationId: 'conversation-1',
    items,
    hasOlder: false,
    oldestSequence: items.length > 0 ? items[0].sequence : null,
    latestSequence: items.length > 0 ? items[items.length - 1].sequence : 0,
    latestEventSequence: items.length > 0 ? items[items.length - 1].sequence : 0,
    readState: readState(),
    ...overrides,
  };
}

function denied(reason = 'Expired'): HttpErrorResponse {
  return new HttpErrorResponse({ status: 403, error: { accessReason: reason } });
}

/** The server's answer when a command carried a version the message has since moved past. */
function stale(): HttpErrorResponse {
  return new HttpErrorResponse({
    status: 409,
    error: {
      code: 'messaging_stale_message_version',
      title: 'This message changed since it was read. Reload the conversation and try again.',
    },
  });
}

/**
 * The thread's first page for the initial read, and `again` for the screen's one-message re-read of
 * a message after a stale version (NCM-12), which asks for the page just above that message.
 */
function pages(first: MessagePage, again: () => MessagePage) {
  return (_conversationId: string, beforeSequence?: number | null) =>
    of(beforeSequence === null || beforeSequence === undefined ? first : again());
}

/** A thread scrolled back through history, so the newest message is out of view. */
function scrolledBack(harness: { host: HTMLElement }): (atNewest: boolean) => void {
  const feed = query(harness.host, '.feed');
  let top = 0;
  Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => 2000 });
  Object.defineProperty(feed, 'clientHeight', { configurable: true, get: () => 500 });
  Object.defineProperty(feed, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: () => undefined,
  });
  return (atNewest) => {
    top = atNewest ? 1500 : 0;
  };
}

interface ApiMocks {
  listConversations: ReturnType<typeof vi.fn>;
  listConversationMessages: ReturnType<typeof vi.fn>;
  sendConversationMessage: ReturnType<typeof vi.fn>;
  editConversationMessage: ReturnType<typeof vi.fn>;
  deleteConversationMessage: ReturnType<typeof vi.fn>;
  moderateConversationMessage: ReturnType<typeof vi.fn>;
  advanceConversationReadCursor: ReturnType<typeof vi.fn>;
  getClientOverview: ReturnType<typeof vi.fn>;
}

interface Harness extends ApiMocks {
  host: HTMLElement;
  realtime: RealtimeStub;
  fixture: ComponentFixture<unknown>;
  user: WritableSignal<CurrentUser | null>;
  membership: WritableSignal<TenantMembership | undefined>;
  unreadRefresh: ReturnType<typeof vi.fn>;
  conversationLaunch: ConversationLaunch;
}

/**
 * A stand-in for the realtime service that records what the screen asked it to do and lets a test
 * push an event through the sink the screen handed over.
 *
 * The real service opens a socket. What these tests are about is what the screen does with an event
 * once it has one, so the transport is replaced and the connection behaviour is proved separately in
 * `messaging-realtime.service.spec.ts`.
 */
class RealtimeStub {
  readonly state = signal<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline'>(
    'connected',
  );
  readonly listRefreshRequests = signal(0);
  readonly opened: { conversationId: string; fromEventSequence: number }[] = [];
  closed = 0;
  private sink: ConversationRealtimeSink | null = null;

  async openConversation(
    conversationId: string,
    fromEventSequence: number,
    sink: ConversationRealtimeSink,
  ): Promise<void> {
    this.opened.push({ conversationId, fromEventSequence });
    this.sink = sink;
  }

  async closeConversation(): Promise<void> {
    this.closed++;
    this.sink = null;
  }

  async shutdown(): Promise<void> {
    await this.closeConversation();
  }

  /** Delivers one event to the screen and reports whether it merged it. */
  deliver(event: Parameters<ConversationRealtimeSink['apply']>[0]): boolean {
    if (this.sink === null) {
      throw new Error('No conversation is open.');
    }

    return this.sink.apply(event);
  }

  get isOpen(): boolean {
    return this.sink !== null;
  }

  /** Coalesced invalidation, as the real service emits it after debouncing. */
  invalidate(): void {
    this.listRefreshRequests.update((count) => count + 1);
  }
}

async function render(
  configure?: (api: ApiMocks) => void,
  prepareLaunch?: (launch: ConversationLaunch) => void,
  /** Opens the page through the router at this URL, so its query string is real. */
  url?: string,
): Promise<Harness> {
  const user = signal<CurrentUser | null>(COACH);
  const membership = signal<TenantMembership | undefined>(ALPHA);
  const realtime = new RealtimeStub();
  const api: ApiMocks = {
    listConversations: vi.fn(() => of(conversationPage([]))),
    listConversationMessages: vi.fn(() => of(messagePage([]))),
    sendConversationMessage: vi.fn(),
    editConversationMessage: vi.fn(),
    deleteConversationMessage: vi.fn(),
    moderateConversationMessage: vi.fn(),
    advanceConversationReadCursor: vi.fn(() => of(readState())),
    getClientOverview: vi.fn(() =>
      of(
        profileOverview({
          client: { ...MAYA, clientProfileId: 'client-1', firstName: 'Rania', lastName: 'Haddad' },
        }),
      ),
    ),
  };
  configure?.(api);
  const unreadRefresh = vi.fn().mockResolvedValue(undefined);

  await TestBed.configureTestingModule({
    imports: [Messages],
    providers: [
      provideRouter(url ? [{ path: 'messages', component: Messages }] : []),
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: AuthStore, useValue: { user, loading: signal(false) } },
      {
        provide: TenantStore,
        useValue: { selectedMembership: membership, selectedTenantId: signal(ALPHA.tenantId) },
      },
      {
        provide: MessageUnreadStore,
        useValue: {
          unread: signal(0),
          loading: signal(false),
          isAvailable: signal(true),
          refresh: unreadRefresh,
          set: vi.fn(),
          clear: vi.fn(),
        },
      },
      { provide: MessagingRealtimeService, useValue: realtime },
      {
        provide: SavedRepliesApi,
        useValue: {
          list: vi.fn(() =>
            of({
              items: [
                {
                  id: 'reply-1',
                  title: 'Check-in reminder',
                  body: 'Your check-in is due today.',
                  version: 1,
                },
              ],
              maximum: 100,
            }),
          ),
          create: vi.fn(),
          edit: vi.fn(),
          delete: vi.fn(),
        },
      },
    ],
  }).compileComponents();

  const conversationLaunch = TestBed.inject(ConversationLaunch);
  prepareLaunch?.(conversationLaunch);
  let fixture: ComponentFixture<unknown>;
  let host: HTMLElement;
  if (url) {
    const router = await RouterTestingHarness.create();
    await router.navigateByUrl(url, Messages);
    fixture = router.fixture;
    host = router.routeNativeElement!;
  } else {
    fixture = TestBed.createComponent(Messages);
    host = fixture.nativeElement as HTMLElement;
  }
  await settle(fixture);
  return {
    ...api,
    unreadRefresh,
    realtime,
    fixture,
    host,
    user,
    membership,
    conversationLaunch,
  };
}

/** The bodies actually rendered in the thread, in the order a reader sees them. */
function bodies(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('.feed li .body')).map((element) =>
    (element.textContent ?? '').trim(),
  );
}

function rowKeys(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('.feed li h4')).map((element) =>
    (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

/**
 * Presses one of a message's actions the way a reader reaches it: through the message's options
 * button, unless those options are already open.
 */
async function messageAction(harness: Harness, label: string): Promise<void> {
  if (harness.host.querySelector(`button[aria-label="${label}"]`) === null) {
    const sequence = /\d+/.exec(label)?.[0];
    press(
      harness.host,
      label.includes('your')
        ? `Options for your message ${sequence}`
        : `Options for message ${sequence}`,
    );
    await settle(harness.fixture);
  }

  query<HTMLButtonElement>(harness.host, `button[aria-label="${label}"]`).click();
}

/** Takes the live channel offline, which is the one state that offers a manual check. */
async function goOffline(harness: Harness): Promise<void> {
  harness.realtime.state.set('offline');
  await settle(harness.fixture);
}

async function open(harness: Harness, name = 'Rania Haddad'): Promise<void> {
  const target = Array.from(harness.host.querySelectorAll<HTMLButtonElement>('.conversation')).find(
    (candidate) => (candidate.textContent ?? '').includes(name),
  );
  if (target === undefined) {
    throw new Error(`No conversation named "${name}".`);
  }

  target.click();
  await settle(harness.fixture);
}

describe('Messages', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('is a lazy route', () => {
    expect(messagingRoutes).toHaveLength(1);
    expect(messagingRoutes[0].loadComponent).toBeTypeOf('function');
    expect(messagingRoutes[0].component).toBeUndefined();
  });

  it('renders an accessible empty state when there are no conversations', async () => {
    const { host } = await render();

    expect(host.querySelector('.inbox .empty')?.textContent).toContain('No conversations yet');
    // The coach is told where a conversation starts, and offered the way there.
    expect(host.querySelector('.inbox .empty a')?.getAttribute('href')).toBe('/clients');
    expect(host.querySelector('.feed')).toBeNull();
    // The live region exists from first render so a later message can be announced at all, and it
    // says nothing until something has happened.
    expect(query(host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
  });

  it('lists conversations with their counterpart, preview and unread count', async () => {
    const { host } = await render(({ listConversations }) => {
      listConversations.mockReturnValue(
        of(
          conversationPage([
            conversation({
              unreadCount: 3,
              lastMessage: {
                messageId: 'm-2',
                sequence: 2,
                senderUserId: 'client-user-1',
                isFromCaller: false,
                sentAtUtc: '2026-09-01T09:00:00.000Z',
                body: 'See you tomorrow',
                isDeleted: false,
                deletionKind: null,
              },
            }),
          ]),
        ),
      );
    });

    const row = query(host, '.conversation-list li');
    expect(row.textContent).toContain('Rania Haddad');
    expect(row.textContent).toContain('See you tomorrow');
    // The count is the visible cue and the row's name says it in words; the row is also heavier.
    expect(query(row, '.count').textContent?.trim()).toBe('3');
    expect(row.classList).toContain('waiting');
    expect(query(host, '.conversation').getAttribute('aria-label')).toBe(
      'Rania Haddad, 3 unread messages',
    );
  });

  it('opens a same-workspace conversation handoff outside the bounded first page', async () => {
    const launched = conversation({
      id: 'conversation-created',
      clientProfileId: 'client-created',
      counterpart: { userId: 'client-user-created', displayName: 'Maya Khoury', role: 'Client' },
    });
    const harness = await render(
      ({ listConversations }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
      },
      (launch) => launch.open(ALPHA.tenantId, launched),
    );

    expect(harness.host.querySelectorAll('.conversation')).toHaveLength(2);
    expect(query(harness.host, '.conversation[aria-current="true"]').textContent).toContain(
      'Maya Khoury',
    );
    expect(harness.listConversationMessages).toHaveBeenCalledWith('conversation-created', null, 50);
    expect(harness.conversationLaunch.take(ALPHA.tenantId)).toBeNull();
  });

  it("opens the thread Coach Today's Reply links to", async () => {
    const harness = await render(
      ({ listConversations }) => {
        listConversations.mockReturnValue(
          of(
            conversationPage([
              conversation(),
              conversation({
                id: 'conversation-2',
                clientProfileId: 'client-2',
                counterpart: {
                  userId: 'client-user-2',
                  displayName: 'Sara Mansour',
                  role: 'Client',
                },
              }),
            ]),
          ),
        );
      },
      undefined,
      '/messages?conversation=conversation-2',
    );

    expect(query(harness.host, '.conversation[aria-current="true"]').textContent).toContain(
      'Sara Mansour',
    );
    expect(harness.listConversationMessages).toHaveBeenCalledWith('conversation-2', null, 50);
  });

  it('opens nothing for a linked thread that is not in the inbox', async () => {
    const harness = await render(
      ({ listConversations }) => {
        listConversations.mockReturnValue(
          of(conversationPage([conversation(), conversation({ id: 'conversation-2' })])),
        );
      },
      undefined,
      '/messages?conversation=someone-elses',
    );

    expect(harness.host.querySelector('.conversation[aria-current="true"]')).toBeNull();
    expect(harness.listConversationMessages).not.toHaveBeenCalled();
  });

  it('says a removed last message is removed rather than showing nothing', async () => {
    const { host } = await render(({ listConversations }) => {
      listConversations.mockReturnValue(
        of(
          conversationPage([
            conversation({
              lastMessage: {
                messageId: 'm-2',
                sequence: 2,
                senderUserId: 'client-user-1',
                isFromCaller: false,
                sentAtUtc: '2026-09-01T09:00:00.000Z',
                body: null,
                isDeleted: true,
                deletionKind: 'SenderRemoved',
              },
            }),
          ]),
        ),
      );
    });

    expect(query(host, '.conversation .preview').textContent?.trim()).toBe('Message removed');
  });

  it('opens the selected thread oldest first', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
      listConversationMessages.mockReturnValue(
        of(messagePage([message(1), message(2, { body: 'Second' })])),
      );
    });

    await open(harness);

    expect(bodies(harness.host)).toEqual(['Message 1', 'Second']);
    expect(harness.listConversationMessages).toHaveBeenCalledWith('conversation-1', null, 50);
    expect(query(harness.host, '#thread-heading').textContent).toContain('Rania Haddad');
    expect(query(harness.host, '.thread-role').textContent).toContain('Client');
  });

  /**
   * The defect a sequence cursor exists to avoid: a message arriving at the tip between two pages
   * must not duplicate, skip or stall paging backwards.
   */
  it('loads older messages without duplicating a row when a new one arrives between pages', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
      listConversationMessages
        .mockReturnValueOnce(
          of(messagePage([message(3), message(4)], { hasOlder: true, oldestSequence: 3 })),
        )
        // A fifth message arrived at the tip; the older page is unaffected, and page 1 is re-sent
        // overlapping on sequence 3 as a re-fetch would.
        .mockReturnValueOnce(
          of(
            messagePage([message(1), message(2), message(3)], {
              hasOlder: false,
              oldestSequence: 1,
              latestSequence: 5,
            }),
          ),
        );
    });

    await open(harness);
    press(harness.host, 'Show earlier messages');
    await settle(harness.fixture);

    expect(bodies(harness.host)).toEqual(['Message 1', 'Message 2', 'Message 3', 'Message 4']);
    expect(harness.listConversationMessages).toHaveBeenLastCalledWith('conversation-1', 3, 50);
    // Nothing appears twice, so no `@for` key is duplicated.
    const ids = Array.from(harness.host.querySelectorAll('.feed li')).length;
    expect(ids).toBe(4);
    expect(rowKeys(harness.host)).toHaveLength(4);
    // Everything is loaded, so the control is gone rather than left offering nothing.
    expect(harness.host.textContent).not.toContain('Show earlier messages');
  });

  it('stops offering earlier messages when an older page comes back empty', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
      listConversationMessages
        .mockReturnValueOnce(of(messagePage([message(2)], { hasOlder: true, oldestSequence: 2 })))
        .mockReturnValueOnce(of(messagePage([], { hasOlder: true, oldestSequence: null })));
    });

    await open(harness);
    press(harness.host, 'Show earlier messages');
    await settle(harness.fixture);

    expect(harness.host.textContent).not.toContain('Show earlier messages');
  });

  it('renders a body that looks like markup as the characters it is', async () => {
    const hostile = '<img src=x onerror="alert(1)"> **bold** <b>b</b>';
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
      listConversationMessages.mockReturnValue(of(messagePage([message(1, { body: hostile })])));
    });

    await open(harness);

    const body = query(harness.host, '.feed li .body');
    expect(body.textContent).toBe(hostile);
    // Nothing was parsed as markup: no element, and no attribute, came out of the message.
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('b')).toBeNull();
    expect(body.children).toHaveLength(0);
  });

  /**
   * ADR 0026: after a client moves to another coach, their old thread stays readable to them and
   * nobody can write to it. Offering a composer the server will refuse would invite a message that
   * can never be delivered.
   */
  it('shows a read-only thread without a composer or message actions', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(
        of(conversationPage([conversation({ isReadOnly: true, callerRole: 'Client' })])),
      );
      listConversationMessages.mockReturnValue(
        of(
          messagePage([
            message(1, { body: 'Welcome aboard' }),
            message(2, { isFromCaller: true, canEdit: true, canDelete: true }),
          ]),
        ),
      );
    });

    expect(bodies(harness.host)).toContain('Welcome aboard');
    expect(harness.host.textContent).toContain('This conversation is read-only');
    expect(query(harness.host, '.thread-role').textContent).toContain('Your former coach');
    expect(harness.host.querySelector('form.composer')).toBeNull();
    expect(harness.host.querySelector('.actions')).toBeNull();
    expect(harness.host.querySelector('.options')).toBeNull();
    expect(harness.sendConversationMessage).not.toHaveBeenCalled();
    // With nothing in it to focus, the history itself can be focused and scrolled by keyboard.
    expect(query(harness.host, '.feed').getAttribute('tabindex')).toBe('0');
  });

  it('leaves a writable thread’s history out of the tab order, since its messages take focus', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
      listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
    });
    await open(harness);

    expect(query(harness.host, '.feed').hasAttribute('tabindex')).toBe(false);
  });

  it('sends a message and clears the composer', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, sendConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(of(messagePage([])));
        sendConversationMessage.mockReturnValue(
          of(message(1, { body: 'Hello there', isFromCaller: true, senderUserId: 'coach-1' })),
        );
      },
    );
    await open(harness);

    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'Hello there';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    expect(harness.sendConversationMessage).toHaveBeenCalledWith(
      'conversation-1',
      'Hello there',
      expect.any(String),
    );
    expect(bodies(harness.host)).toEqual(['Hello there']);
    expect(field<HTMLTextAreaElement>(harness.host, 'Write a message').value).toBe('');
  });

  /**
   * The 6A-6 rule: a submit control is disabled only while a request is in flight. An invalid form
   * lets the attempt happen and refuses it out loud, because a disabled button can be neither
   * pressed nor focused and so can never explain itself.
   */
  it('refuses an empty message out loud rather than disabling the button', async () => {
    const harness = await render(({ listConversations }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
    });
    await open(harness);

    expect(button(harness.host, 'Send message').disabled).toBe(false);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    expect(harness.sendConversationMessage).not.toHaveBeenCalled();
    expect(query(harness.host, '#composer-summary').textContent).toContain('cannot be sent yet');
    expect(query(harness.host, '#draft-reason').textContent).toContain('Write something');
    expect(field(harness.host, 'Write a message').getAttribute('aria-invalid')).toBe('true');
  });

  it('reports a failed send in its live region and keeps the draft', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, sendConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(of(messagePage([])));
        sendConversationMessage.mockReturnValue(throwError(() => new Error('offline')));
      },
    );
    await open(harness);

    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'Please keep me';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    expect(query(harness.host, 'p.error[role="alert"]').textContent).toContain('could not be sent');
    expect(field<HTMLTextAreaElement>(harness.host, 'Write a message').value).toBe(
      'Please keep me',
    );
  });

  it('edits the sender’s own message', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, editConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(
          of(
            messagePage([
              message(1, {
                body: 'frist',
                isFromCaller: true,
                senderUserId: 'coach-1',
                canEdit: true,
                canDelete: true,
                canModerate: false,
              }),
            ]),
          ),
        );
        editConversationMessage.mockReturnValue(
          of(
            message(1, {
              body: 'first',
              isFromCaller: true,
              senderUserId: 'coach-1',
              canEdit: true,
              canDelete: true,
              canModerate: false,
              revisionNumber: 2,
              editedAtUtc: '2026-09-01T09:05:00.000Z',
              version: 2,
            }),
          ),
        );
      },
    );
    await open(harness);

    await messageAction(harness, 'Edit your message 1');
    await settle(harness.fixture);
    const editor = field<HTMLTextAreaElement>(harness.host, 'Edit message');
    expect(editor.value).toBe('frist');
    editor.value = 'first';
    editor.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Save changes');
    await settle(harness.fixture);

    expect(harness.editConversationMessage).toHaveBeenCalledWith(
      'conversation-1',
      'message-1',
      'first',
      1,
      expect.any(String),
    );
    expect(bodies(harness.host)).toEqual(['first']);
    expect(harness.host.textContent).toContain('Edited');
  });

  it('reads a message again after a stale version and keeps the typed words when it really changed', async () => {
    const original = message(1, {
      body: 'original',
      isFromCaller: true,
      senderUserId: 'coach-1',
      canEdit: true,
      canDelete: true,
      canModerate: false,
    });
    const harness = await render(
      ({ listConversations, listConversationMessages, editConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockImplementation(
          pages(messagePage([original]), () =>
            messagePage([
              {
                ...original,
                body: 'changed on the phone',
                revisionNumber: 2,
                editedAtUtc: '2026-09-01T09:06:00.000Z',
                version: 7,
              },
            ]),
          ),
        );
        editConversationMessage
          .mockReturnValueOnce(throwError(stale))
          .mockReturnValueOnce(
            of({ ...original, body: 'from this screen', revisionNumber: 3, version: 8 }),
          );
      },
    );
    await open(harness);

    await messageAction(harness, 'Edit your message 1');
    await settle(harness.fixture);
    const editor = field<HTMLTextAreaElement>(harness.host, 'Edit message');
    editor.value = 'from this screen';
    editor.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Save changes');
    await settle(harness.fixture);

    // The message really changed elsewhere, so nothing is overwritten unseen: one attempt only, the
    // person is told, and the editor keeps what they typed.
    expect(harness.editConversationMessage).toHaveBeenCalledTimes(1);
    expect(harness.listConversationMessages).toHaveBeenLastCalledWith('conversation-1', 2, 1);
    expect(query(harness.host, 'p.error[role="alert"]').textContent).toContain(
      'This message was changed on another phone or tab while you were editing. Save again to use your words, or cancel to keep what it says now.',
    );
    expect(field<HTMLTextAreaElement>(harness.host, 'Edit message').value).toBe('from this screen');

    // Saving again is the person's choice, against the version the server now holds.
    press(harness.host, 'Save changes');
    await settle(harness.fixture);
    const [first, second] = harness.editConversationMessage.mock.calls;
    expect(second).toEqual(['conversation-1', 'message-1', 'from this screen', 7, first[4]]);
    expect(bodies(harness.host)).toEqual(['from this screen']);
  });

  it('retries an edit once with the version the server holds when the words are unchanged (NCM-12)', async () => {
    const original = message(1, {
      body: 'original',
      isFromCaller: true,
      senderUserId: 'coach-1',
      canEdit: true,
      canDelete: true,
      canModerate: false,
    });
    const harness = await render(
      ({ listConversations, listConversationMessages, editConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        // The other side's app acknowledged it, which once moved the version and nothing else.
        listConversationMessages.mockImplementation(
          pages(messagePage([original]), () => messagePage([{ ...original, version: 5 }])),
        );
        editConversationMessage.mockReturnValueOnce(throwError(stale)).mockReturnValueOnce(
          of({
            ...original,
            body: 'fixed',
            revisionNumber: 2,
            editedAtUtc: '2026-09-01T09:06:00.000Z',
            version: 6,
          }),
        );
      },
    );
    await open(harness);

    await messageAction(harness, 'Edit your message 1');
    await settle(harness.fixture);
    const editor = field<HTMLTextAreaElement>(harness.host, 'Edit message');
    editor.value = 'fixed';
    editor.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Save changes');
    await settle(harness.fixture);

    const [first, second] = harness.editConversationMessage.mock.calls;
    expect(first).toEqual(['conversation-1', 'message-1', 'fixed', 1, expect.any(String)]);
    // The same command once more: the same key, the version the server holds now.
    expect(second).toEqual(['conversation-1', 'message-1', 'fixed', 5, first[4]]);
    expect(harness.editConversationMessage).toHaveBeenCalledTimes(2);
    expect(bodies(harness.host)).toEqual(['fixed']);
    expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
    expect(harness.host.querySelector('#edit-draft')).toBeNull();
  });

  it('says so when a message being edited was removed elsewhere, and closes the editor', async () => {
    const original = message(1, {
      body: 'original',
      isFromCaller: true,
      senderUserId: 'coach-1',
      canEdit: true,
      canDelete: true,
      canModerate: false,
    });
    const harness = await render(
      ({ listConversations, listConversationMessages, editConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockImplementation(
          pages(messagePage([original]), () =>
            messagePage([
              {
                ...original,
                body: null,
                isDeleted: true,
                deletionKind: 'SenderRemoved',
                deletedAtUtc: '2026-09-01T09:06:00.000Z',
                canEdit: false,
                canDelete: false,
                version: 9,
              },
            ]),
          ),
        );
        editConversationMessage.mockReturnValue(throwError(stale));
      },
    );
    await open(harness);

    await messageAction(harness, 'Edit your message 1');
    await settle(harness.fixture);
    press(harness.host, 'Save changes');
    await settle(harness.fixture);

    expect(harness.editConversationMessage).toHaveBeenCalledTimes(1);
    expect(query(harness.host, 'p.error[role="alert"]').textContent).toContain(
      'This message was removed on another phone or tab, so your edit wasn’t saved.',
    );
    expect(harness.host.querySelector('#edit-draft')).toBeNull();
    expect(query(harness.host, '.feed li .removed-body').textContent).toContain('removed');
  });

  it('removes the sender’s own message and keeps its place with no body', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, deleteConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(
          of(
            messagePage([
              message(1, {
                body: 'regrettable',
                isFromCaller: true,
                senderUserId: 'coach-1',
                canEdit: true,
                canDelete: true,
                canModerate: false,
              }),
              message(2, { body: 'kept' }),
            ]),
          ),
        );
        deleteConversationMessage.mockReturnValue(
          of(
            message(1, {
              body: null,
              isFromCaller: true,
              senderUserId: 'coach-1',
              isDeleted: true,
              deletionKind: 'SenderRemoved',
              deletedAtUtc: '2026-09-01T09:10:00.000Z',
              canEdit: false,
              canDelete: false,
              canModerate: false,
              version: 2,
            }),
          ),
        );
      },
    );
    await open(harness);

    await messageAction(harness, 'Remove your message 1');
    await settle(harness.fixture);

    expect(harness.deleteConversationMessage).toHaveBeenCalledWith(
      'conversation-1',
      'message-1',
      1,
      expect.any(String),
    );
    // The row is still there, in place, saying what happened rather than showing a body.
    expect(harness.host.querySelectorAll('.feed li')).toHaveLength(2);
    expect(query(harness.host, '.feed li .removed-body').textContent).toContain(
      'removed by its sender',
    );
    expect(bodies(harness.host)).toEqual(['kept']);
    expect(harness.host.querySelector('button[aria-label="Edit your message 1"]')).toBeNull();
  });

  it('lets the coach participant moderate with a required reason', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, moderateConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(
          of(messagePage([message(1, { body: 'unacceptable' })])),
        );
        moderateConversationMessage.mockReturnValue(
          of(
            message(1, {
              body: null,
              isDeleted: true,
              deletionKind: 'CoachModerated',
              deletedAtUtc: '2026-09-01T09:10:00.000Z',
              canModerate: false,
              version: 2,
            }),
          ),
        );
      },
    );
    await open(harness);

    await messageAction(harness, 'Remove message 1 as coach');
    await settle(harness.fixture);

    // A reason is required, and a refused confirmation says so instead of disabling the button.
    press(harness.host, 'Confirm removal');
    await settle(harness.fixture);
    expect(harness.moderateConversationMessage).not.toHaveBeenCalled();
    expect(query(harness.host, '#moderation-summary').textContent).toContain(
      'cannot be removed yet',
    );

    const reason = field<HTMLInputElement>(harness.host, 'Reason for removing this message');
    reason.value = 'Abusive language';
    reason.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Confirm removal');
    await settle(harness.fixture);

    expect(harness.moderateConversationMessage).toHaveBeenCalledWith(
      'conversation-1',
      'message-1',
      'Abusive language',
      1,
      expect.any(String),
    );
    expect(query(harness.host, '.feed li .removed-body').textContent).toContain(
      'removed by the coach',
    );
    // The reason the coach typed is not left on screen for the other participant to read.
    expect(harness.host.textContent).not.toContain('Abusive language');
  });

  it('removes as coach only the words the coach read, and says when they changed (NCM-12)', async () => {
    const theirs = message(1, { body: 'first words' });
    const harness = await render(
      ({ listConversations, listConversationMessages, moderateConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockImplementation(
          pages(messagePage([theirs]), () =>
            messagePage([
              {
                ...theirs,
                body: 'rewritten words',
                revisionNumber: 2,
                editedAtUtc: '2026-09-01T09:06:00.000Z',
                version: 4,
              },
            ]),
          ),
        );
        moderateConversationMessage.mockReturnValue(throwError(stale));
      },
    );
    await open(harness);

    await messageAction(harness, 'Remove message 1 as coach');
    await settle(harness.fixture);
    const reason = field<HTMLInputElement>(harness.host, 'Reason for removing this message');
    reason.value = 'Off topic';
    reason.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Confirm removal');
    await settle(harness.fixture);

    expect(harness.moderateConversationMessage).toHaveBeenCalledTimes(1);
    expect(query(harness.host, 'p.error[role="alert"]').textContent).toContain(
      'Rania Haddad changed this message after you opened it. Read it again, then confirm the removal if you still want it gone.',
    );
    // The new words are on screen beside the open form, which keeps the coach's reason.
    expect(bodies(harness.host)).toEqual(['rewritten words']);
    expect(field<HTMLInputElement>(harness.host, 'Reason for removing this message').value).toBe(
      'Off topic',
    );
  });

  it('takes a removal as done when the message was already removed elsewhere', async () => {
    const mine = message(1, {
      body: 'regrettable',
      isFromCaller: true,
      senderUserId: 'coach-1',
      canEdit: true,
      canDelete: true,
      canModerate: false,
    });
    const harness = await render(
      ({ listConversations, listConversationMessages, deleteConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockImplementation(
          pages(messagePage([mine]), () =>
            messagePage([
              {
                ...mine,
                body: null,
                isDeleted: true,
                deletionKind: 'SenderRemoved',
                deletedAtUtc: '2026-09-01T09:06:00.000Z',
                canEdit: false,
                canDelete: false,
                version: 3,
              },
            ]),
          ),
        );
        deleteConversationMessage.mockReturnValue(throwError(stale));
      },
    );
    await open(harness);

    await messageAction(harness, 'Remove your message 1');
    await settle(harness.fixture);

    expect(harness.deleteConversationMessage).toHaveBeenCalledTimes(1);
    expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
    expect(query(harness.host, '.feed li .removed-body').textContent).toContain(
      'removed by its sender',
    );
  });

  it('offers no moderation control to a participant the server did not grant it to', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(
        of(conversationPage([conversation({ callerRole: 'Client', canModerate: false })])),
      );
      listConversationMessages.mockReturnValue(
        of(
          messagePage([
            message(1, { canModerate: false }),
            message(2, { isFromCaller: true, senderUserId: 'coach-1', canModerate: false }),
          ]),
        ),
      );
    });

    expect(harness.host.querySelector('button[aria-label^="Remove message"]')).toBeNull();
    expect(harness.host.textContent).not.toContain('Remove as coach');
    // With nothing to offer, the other person's message has no options button at all.
    expect(harness.host.textContent).not.toContain('Options for message 1');
  });

  it('advances the read cursor after the messages are displayed', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation({ unreadCount: 2 })])));
      listConversationMessages.mockReturnValue(
        of(
          messagePage([message(1), message(2)], {
            latestSequence: 2,
            readState: readState({ lastReadSequence: 0, unreadCount: 2, latestSequence: 2 }),
          }),
        ),
      );
    });

    await open(harness);

    expect(harness.advanceConversationReadCursor).toHaveBeenCalledWith('conversation-1', 2);
    expect(harness.unreadRefresh).toHaveBeenCalled();
    // The list row reflects the authoritative answer the server gave, not a guess.
    expect(query(harness.host, '.conversation').getAttribute('aria-label')).toBe(
      'Rania Haddad, no unread messages',
    );
  });

  it('does not report a read cursor that is already current', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
      listConversationMessages.mockReturnValue(
        of(
          messagePage([message(1), message(2)], {
            readState: readState({ lastReadSequence: 2, unreadCount: 0, latestSequence: 2 }),
          }),
        ),
      );
    });

    await open(harness);

    expect(harness.advanceConversationReadCursor).not.toHaveBeenCalled();
  });

  it('explains a refused conversation instead of rendering an empty thread', async () => {
    const harness = await render(({ listConversations }) => {
      listConversations.mockReturnValue(
        of(
          conversationPage([
            conversation({ isAvailable: false, accessReason: 'Expired', lastMessage: null }),
          ]),
        ),
      );
    });

    await open(harness);

    const denialText = query(harness.host, '.denied').textContent ?? '';
    expect(denialText).toContain('plan has ended');
    expect(harness.host.querySelector('.feed li')).toBeNull();
    expect(harness.host.querySelector('.composer')).toBeNull();
    // A conversation the server already refused is not asked for again.
    expect(harness.listConversationMessages).not.toHaveBeenCalled();
  });

  it('renders a refusal that arrives from the history request itself', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
      listConversationMessages.mockReturnValue(throwError(() => denied('Paused')));
    });

    await open(harness);

    expect(query(harness.host, '.denied').textContent).toContain('paused');
    expect(harness.host.querySelector('.feed li')).toBeNull();
  });

  it('reports a failed conversation list in its live region and shows no rows', async () => {
    const { host } = await render(({ listConversations }) => {
      listConversations.mockReturnValue(throwError(() => new Error('offline')));
    });

    expect(query(host, 'p.error[role="alert"]').textContent).toContain('could not be loaded');
    expect(host.querySelectorAll('.conversation-list li')).toHaveLength(0);
  });

  it('says a lost connection in the app’s words and reads the list again on Try again', async () => {
    const harness = await render(({ listConversations }) => {
      // Angular's fetch backend: status 0 and the browser's TypeError (audit UIQ-2).
      listConversations.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') }),
        ),
      );
    });

    const line = query(harness.host, 'p.error[role="alert"]');
    expect(line.textContent?.trim()).toBe(
      'The app couldn’t connect. Check your connection and try again.',
    );
    expect(harness.host.textContent).not.toContain('Failed to fetch');

    harness.listConversations.mockReturnValue(of(conversationPage([conversation()])));
    press(harness.host, 'Try again');
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.conversation')).toHaveLength(1);
    expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
    expect(() => button(harness.host, 'Try again')).toThrow();
  });

  it('offers Try again for a thread that failed to load, and not for a refused send', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
      listConversationMessages.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500, error: { title: 'boom' } })),
      );
    });
    await open(harness);

    // The screen's own sentence, never the title "boom" (audit UIQ-2).
    expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe(
      'This conversation could not be loaded.',
    );
    harness.listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
    press(harness.host, 'Try again');
    await settle(harness.fixture);
    expect(harness.host.querySelectorAll('.feed li').length).toBeGreaterThan(0);
    expect(() => button(harness.host, 'Try again')).toThrow();

    harness.sendConversationMessage.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'A message can only contain ordinary text.' },
          }),
      ),
    );
    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'Hello';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);
    expect(query(harness.host, 'p.error[role="alert"]').textContent).toContain('ordinary text');
    expect(() => button(harness.host, 'Try again')).toThrow();
  });

  // ---------- context ownership ----------

  it('clears the list, the thread and the draft when the workspace changes', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations
        .mockReturnValueOnce(of(conversationPage([conversation()])))
        .mockReturnValue(of(conversationPage([])));
      listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
    });
    await open(harness);
    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'half a sentence';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);

    harness.membership.set(BETA);
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.conversation-list li')).toHaveLength(0);
    expect(harness.host.querySelector('.feed li')).toBeNull();
    expect(harness.host.querySelector('.composer')).toBeNull();
    expect(harness.host.querySelector('.inbox .empty')).not.toBeNull();
  });

  it('clears everything when the signed-in account changes', async () => {
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations
        .mockReturnValueOnce(of(conversationPage([conversation()])))
        .mockReturnValue(of(conversationPage([])));
      listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
    });
    await open(harness);

    harness.user.set(OTHER_USER);
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.conversation-list li')).toHaveLength(0);
    expect(harness.host.querySelector('.feed li')).toBeNull();
  });

  it('clears everything and asks for nothing more when the membership goes', async () => {
    const harness = await render(({ listConversations }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
    });
    const callsBefore = harness.listConversations.mock.calls.length;

    harness.membership.set(undefined);
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.conversation-list li')).toHaveLength(0);
    expect(harness.listConversations.mock.calls.length).toBe(callsBefore);
  });

  it('clears the thread and the draft when a different conversation is selected', async () => {
    const second = conversation({
      id: 'conversation-2',
      counterpart: { userId: 'client-user-2', displayName: 'Nadia Khoury', role: 'Client' },
    });
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation(), second])));
      listConversationMessages
        .mockReturnValueOnce(of(messagePage([message(1, { body: 'first thread' })])))
        .mockReturnValue(
          of(
            messagePage([
              message(9, {
                id: 'message-9',
                conversationId: 'conversation-2',
                body: 'second thread',
              }),
            ]),
          ),
        );
    });
    await open(harness);
    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'meant for Rania';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);

    await open(harness, 'Nadia Khoury');

    expect(bodies(harness.host)).toEqual(['second thread']);
    // A sentence written to one person must never sit in a composer addressed to another.
    expect(field<HTMLTextAreaElement>(harness.host, 'Write a message').value).toBe('');
  });

  /**
   * The four discard tests below exist for one defect: a reply for the context the user has just
   * left arriving after the current one and being written on top of it. Each resolves the two
   * requests deliberately out of order, oldest last.
   */
  it('discards a conversation list that resolves after the workspace has changed', async () => {
    const stale = new Subject<ServerConversationPage>();
    const fresh = new Subject<ServerConversationPage>();
    const harness = await render(({ listConversations }) => {
      listConversations.mockReturnValueOnce(stale).mockReturnValueOnce(fresh);
    });

    harness.membership.set(BETA);
    await settle(harness.fixture);

    fresh.next(
      conversationPage([
        conversation({
          id: 'beta-1',
          counterpart: { userId: 'beta-user', displayName: 'Beta Client', role: 'Client' },
        }),
      ]),
    );
    fresh.complete();
    await settle(harness.fixture);
    expect(harness.host.textContent).toContain('Beta Client');

    stale.next(conversationPage([conversation()]));
    stale.complete();
    await settle(harness.fixture);

    expect(harness.host.textContent).toContain('Beta Client');
    expect(harness.host.textContent).not.toContain('Rania Haddad');
  });

  it('discards a history page that resolves after another conversation was opened', async () => {
    const second = conversation({
      id: 'conversation-2',
      counterpart: { userId: 'client-user-2', displayName: 'Nadia Khoury', role: 'Client' },
    });
    const stale = new Subject<MessagePage>();
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation(), second])));
      listConversationMessages
        .mockReturnValueOnce(stale)
        .mockReturnValue(of(messagePage([message(9, { id: 'message-9', body: 'second thread' })])));
    });

    await open(harness);
    await open(harness, 'Nadia Khoury');
    expect(bodies(harness.host)).toEqual(['second thread']);

    stale.next(messagePage([message(1, { body: 'first thread' })]));
    stale.complete();
    await settle(harness.fixture);

    expect(bodies(harness.host)).toEqual(['second thread']);
  });

  it('discards a history failure that resolves after another conversation was opened', async () => {
    const second = conversation({
      id: 'conversation-2',
      counterpart: { userId: 'client-user-2', displayName: 'Nadia Khoury', role: 'Client' },
    });
    const stale = new Subject<MessagePage>();
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation(), second])));
      listConversationMessages
        .mockReturnValueOnce(stale)
        .mockReturnValue(of(messagePage([message(9, { id: 'message-9', body: 'second thread' })])));
    });

    await open(harness);
    await open(harness, 'Nadia Khoury');

    stale.error(denied('Expired'));
    await settle(harness.fixture);

    // The refusal belonged to a conversation that is no longer on screen, so it announces nothing
    // and replaces nothing here.
    expect(harness.host.querySelector('.denied')).toBeNull();
    expect(bodies(harness.host)).toEqual(['second thread']);
    expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
  });

  it('discards a send success that resolves after another conversation was opened', async () => {
    const pending = new Subject<Message>();
    const harness = await render(
      ({ listConversations, listConversationMessages, sendConversationMessage }) => {
        listConversations.mockReturnValue(
          of(conversationPage([conversation(), conversation(SECOND)])),
        );
        listConversationMessages
          .mockReturnValueOnce(of(messagePage([])))
          .mockReturnValue(
            of(messagePage([message(9, { id: 'message-9', body: 'second thread' })])),
          );
        sendConversationMessage.mockReturnValue(pending);
      },
    );
    await open(harness);
    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'meant for Rania';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    // Settled first, so the request is genuinely in flight before the selection moves.
    await settle(harness.fixture);
    expect(harness.sendConversationMessage).toHaveBeenCalled();

    await open(harness, 'Nadia Khoury');
    expect(bodies(harness.host)).toEqual(['second thread']);

    pending.next(message(1, { body: 'meant for Rania', isFromCaller: true }));
    pending.complete();
    await settle(harness.fixture);

    // A sentence sent to one person must never appear in somebody else's thread.
    expect(bodies(harness.host)).toEqual(['second thread']);
  });

  it('discards a send failure that resolves after the workspace has changed', async () => {
    const pending = new Subject<Message>();
    const harness = await render(
      ({ listConversations, listConversationMessages, sendConversationMessage }) => {
        listConversations
          .mockReturnValueOnce(of(conversationPage([conversation()])))
          .mockReturnValue(of(conversationPage([])));
        listConversationMessages.mockReturnValue(of(messagePage([])));
        sendConversationMessage.mockReturnValue(pending);
      },
    );
    await open(harness);
    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'for alpha';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    harness.membership.set(BETA);
    await settle(harness.fixture);
    pending.error(new Error('offline'));
    await settle(harness.fixture);

    expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
  });

  it('discards edit, delete and moderation replies that resolve after another conversation was opened', async () => {
    const edit = new Subject<Message>();
    const remove = new Subject<Message>();
    const moderate = new Subject<Message>();
    const harness = await render((api) => {
      api.listConversations.mockReturnValue(
        of(conversationPage([conversation(), conversation(SECOND)])),
      );
      api.listConversationMessages
        .mockReturnValueOnce(
          of(
            messagePage([
              message(1, {
                body: 'mine',
                isFromCaller: true,
                senderUserId: 'coach-1',
                canEdit: true,
                canDelete: true,
                canModerate: false,
              }),
              message(2, { body: 'theirs', canModerate: true }),
            ]),
          ),
        )
        .mockReturnValue(of(messagePage([message(9, { id: 'message-9', body: 'second thread' })])));
      api.editConversationMessage.mockReturnValue(edit);
      api.deleteConversationMessage.mockReturnValue(remove);
      api.moderateConversationMessage.mockReturnValue(moderate);
    });
    await open(harness);

    await messageAction(harness, 'Remove your message 1');
    await settle(harness.fixture);
    await open(harness, 'Nadia Khoury');
    expect(bodies(harness.host)).toEqual(['second thread']);

    // Every reply belongs to a conversation that is no longer on screen. None of them may write a
    // row into the thread that is.
    remove.next(message(1, { isDeleted: true, deletionKind: 'SenderRemoved', body: null }));
    remove.complete();
    edit.next(message(1, { body: 'edited elsewhere' }));
    edit.complete();
    moderate.next(message(2, { isDeleted: true, deletionKind: 'CoachModerated', body: null }));
    moderate.complete();
    await settle(harness.fixture);

    expect(bodies(harness.host)).toEqual(['second thread']);
    expect(harness.host.querySelectorAll('.feed li')).toHaveLength(1);
    expect(harness.host.querySelector('.feed li .removed-body')).toBeNull();
    expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
  });

  it('discards an edit failure that resolves after another conversation was opened', async () => {
    const edit = new Subject<Message>();
    const harness = await render((api) => {
      api.listConversations.mockReturnValue(
        of(conversationPage([conversation(), conversation(SECOND)])),
      );
      api.listConversationMessages
        .mockReturnValueOnce(
          of(
            messagePage([
              message(1, {
                body: 'mine',
                isFromCaller: true,
                senderUserId: 'coach-1',
                canEdit: true,
                canModerate: false,
              }),
            ]),
          ),
        )
        .mockReturnValue(of(messagePage([message(9, { id: 'message-9', body: 'second thread' })])));
      api.editConversationMessage.mockReturnValue(edit);
    });
    await open(harness);

    await messageAction(harness, 'Edit your message 1');
    await settle(harness.fixture);
    const editor = field<HTMLTextAreaElement>(harness.host, 'Edit message');
    editor.value = 'corrected';
    editor.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Save changes');
    await settle(harness.fixture);

    await open(harness, 'Nadia Khoury');
    edit.error(new Error('offline'));
    await settle(harness.fixture);

    // The failure belonged to the previous conversation, so it announces nothing over this one.
    expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
    expect(bodies(harness.host)).toEqual(['second thread']);
  });

  // ---------- retained command keys ----------

  /**
   * The defect these exist for: a key minted fresh on every click is not an idempotency key. After a
   * lost response the user clicks again, the server sees a different command, and the message it
   * already wrote is written a second time.
   */
  it('reuses the same send key when a lost response is retried', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, sendConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(of(messagePage([])));
        sendConversationMessage
          .mockReturnValueOnce(throwError(() => new Error('the reply never arrived')))
          .mockReturnValueOnce(
            of(message(1, { body: 'once', isFromCaller: true, senderUserId: 'coach-1' })),
          );
      },
    );
    await open(harness);
    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'once';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);

    press(harness.host, 'Send message');
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    const [firstCall, secondCall] = harness.sendConversationMessage.mock.calls;
    expect(firstCall[2]).toBe(secondCall[2]);
    expect(firstCall[1]).toBe('once');
    expect(secondCall[1]).toBe('once');
  });

  it('mints a new send key once the payload has actually changed', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, sendConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(of(messagePage([])));
        sendConversationMessage.mockReturnValue(throwError(() => new Error('offline')));
      },
    );
    await open(harness);
    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'first thought';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    composer.value = 'second thought';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    const [firstCall, secondCall] = harness.sendConversationMessage.mock.calls;
    // A different sentence is a different command, and reusing the key would make the server refuse
    // it as a conflicting reuse rather than send it.
    expect(firstCall[2]).not.toBe(secondCall[2]);
  });

  it('mints a new send key after a success rather than spending the old one twice', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, sendConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(of(messagePage([])));
        sendConversationMessage
          .mockReturnValueOnce(
            of(message(1, { body: 'same words', isFromCaller: true, senderUserId: 'coach-1' })),
          )
          .mockReturnValueOnce(
            of(message(2, { body: 'same words', isFromCaller: true, senderUserId: 'coach-1' })),
          );
      },
    );
    await open(harness);

    for (let attempt = 0; attempt < 2; attempt++) {
      const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
      composer.value = 'same words';
      composer.dispatchEvent(new Event('input'));
      await settle(harness.fixture);
      press(harness.host, 'Send message');
      await settle(harness.fixture);
    }

    const [firstCall, secondCall] = harness.sendConversationMessage.mock.calls;
    // Deliberately sending the same sentence twice is two messages, not one retried command.
    expect(firstCall[2]).not.toBe(secondCall[2]);
  });

  it('reuses the same edit key when a lost response is retried, and a new one when the text changes', async () => {
    const editable = message(1, {
      body: 'frist',
      isFromCaller: true,
      senderUserId: 'coach-1',
      canEdit: true,
      canModerate: false,
    });
    const harness = await render(
      ({ listConversations, listConversationMessages, editConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(of(messagePage([editable])));
        editConversationMessage.mockReturnValue(throwError(() => new Error('offline')));
      },
    );
    await open(harness);
    await messageAction(harness, 'Edit your message 1');
    await settle(harness.fixture);

    const editor = field<HTMLTextAreaElement>(harness.host, 'Edit message');
    editor.value = 'first';
    editor.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Save changes');
    await settle(harness.fixture);
    press(harness.host, 'Save changes');
    await settle(harness.fixture);

    editor.value = 'first, actually';
    editor.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Save changes');
    await settle(harness.fixture);

    const calls = harness.editConversationMessage.mock.calls;
    expect(calls[0][4]).toBe(calls[1][4]);
    expect(calls[2][4]).not.toBe(calls[1][4]);
  });

  it('reuses the same delete key when a lost response is retried', async () => {
    const removable = message(1, {
      body: 'regrettable',
      isFromCaller: true,
      senderUserId: 'coach-1',
      canDelete: true,
      canModerate: false,
    });
    const harness = await render(
      ({ listConversations, listConversationMessages, deleteConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(of(messagePage([removable])));
        deleteConversationMessage.mockReturnValue(throwError(() => new Error('offline')));
      },
    );
    await open(harness);

    for (let attempt = 0; attempt < 2; attempt++) {
      await messageAction(harness, 'Remove your message 1');
      await settle(harness.fixture);
    }

    const calls = harness.deleteConversationMessage.mock.calls;
    expect(calls[0][3]).toBe(calls[1][3]);
  });

  it('reuses the same moderation key for the same reason and rotates it when the reason changes', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, moderateConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(
          of(messagePage([message(1, { canModerate: true })])),
        );
        moderateConversationMessage.mockReturnValue(throwError(() => new Error('offline')));
      },
    );
    await open(harness);
    await messageAction(harness, 'Remove message 1 as coach');
    await settle(harness.fixture);

    const reason = field<HTMLInputElement>(harness.host, 'Reason for removing this message');
    reason.value = 'Off topic';
    reason.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Confirm removal');
    await settle(harness.fixture);
    press(harness.host, 'Confirm removal');
    await settle(harness.fixture);

    reason.value = 'Abusive language';
    reason.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Confirm removal');
    await settle(harness.fixture);

    const calls = harness.moderateConversationMessage.mock.calls;
    expect(calls[0][4]).toBe(calls[1][4]);
    expect(calls[2][4]).not.toBe(calls[1][4]);
  });

  it('drops retained keys when the conversation or the workspace changes', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, sendConversationMessage }) => {
        listConversations.mockReturnValue(
          of(conversationPage([conversation(), conversation(SECOND)])),
        );
        listConversationMessages.mockReturnValue(of(messagePage([])));
        sendConversationMessage.mockReturnValue(throwError(() => new Error('offline')));
      },
    );
    await open(harness);
    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'shared words';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    await open(harness, 'Nadia Khoury');
    const second = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    second.value = 'shared words';
    second.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    const calls = harness.sendConversationMessage.mock.calls;
    // The same sentence to a different person is a different command, whatever it says.
    expect(calls[0][2]).not.toBe(calls[1][2]);
  });

  // ---------- superseded loaders ----------

  it('does not leave Show more disabled when a manual check supersedes it', async () => {
    const pending = new Subject<ServerConversationPage>();
    const harness = await render(({ listConversations }) => {
      listConversations
        .mockReturnValueOnce(
          of(
            conversationPage([conversation()], {
              hasMore: true,
              nextBeforeActivityAtUtc: '2026-09-01T09:00:00.000Z',
              nextBeforeConversationId: 'conversation-1',
            }),
          ),
        )
        .mockReturnValueOnce(pending)
        .mockReturnValue(
          of(
            conversationPage([conversation()], {
              hasMore: true,
              nextBeforeActivityAtUtc: '2026-09-01T09:00:00.000Z',
              nextBeforeConversationId: 'conversation-1',
            }),
          ),
        );
    });

    press(harness.host, 'Show more conversations');
    await settle(harness.fixture);
    await goOffline(harness);
    press(harness.host, 'Check for new messages');
    await settle(harness.fixture);

    // The superseded page will never write, and its own cleanup is guarded on being the newest
    // request — so without clearing the flag the control would stay disabled for ever.
    expect(button(harness.host, 'Show more conversations').disabled).toBe(false);
    pending.next(conversationPage([]));
    pending.complete();
    await settle(harness.fixture);
    expect(button(harness.host, 'Show more conversations').disabled).toBe(false);
  });

  it('does not leave Show earlier disabled when a manual check supersedes it', async () => {
    const pending = new Subject<MessagePage>();
    const harness = await render(({ listConversations, listConversationMessages }) => {
      listConversations.mockReturnValue(of(conversationPage([conversation()])));
      listConversationMessages
        .mockReturnValueOnce(of(messagePage([message(3)], { hasOlder: true, oldestSequence: 3 })))
        .mockReturnValueOnce(pending)
        .mockReturnValue(of(messagePage([message(3)], { hasOlder: true, oldestSequence: 3 })));
    });
    await open(harness);

    press(harness.host, 'Show earlier messages');
    await settle(harness.fixture);
    await goOffline(harness);
    press(harness.host, 'Check for new messages');
    await settle(harness.fixture);

    expect(button(harness.host, 'Show earlier messages').disabled).toBe(false);
    pending.next(messagePage([]));
    pending.complete();
    await settle(harness.fixture);
    expect(button(harness.host, 'Show earlier messages').disabled).toBe(false);
  });

  // ---------- authoritative unread and preview ----------

  it('clears the unread mark on every message the read cursor now covers', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, advanceConversationReadCursor }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation({ unreadCount: 2 })])));
        listConversationMessages.mockReturnValue(
          of(
            messagePage(
              [message(1, { isUnreadByCaller: true }), message(2, { isUnreadByCaller: true })],
              {
                latestSequence: 2,
                readState: readState({ lastReadSequence: 0, unreadCount: 2, latestSequence: 2 }),
              },
            ),
          ),
        );
        advanceConversationReadCursor.mockReturnValue(
          of(readState({ lastReadSequence: 2, unreadCount: 0, latestSequence: 2 })),
        );
      },
    );

    await open(harness);

    // The marks and the count must agree: the server has just said where the cursor is.
    expect(harness.host.querySelectorAll('.feed li.unread')).toHaveLength(0);
    expect(query(harness.host, '.feed').textContent).not.toContain('Unread');
    expect(query(harness.host, '.thread-unread').textContent).toContain('Nothing unread');
  });

  it('leaves a message beyond the cursor still marked unread', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, advanceConversationReadCursor }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation({ unreadCount: 2 })])));
        listConversationMessages.mockReturnValue(
          of(
            messagePage(
              [message(1, { isUnreadByCaller: true }), message(2, { isUnreadByCaller: true })],
              {
                latestSequence: 2,
                readState: readState({ lastReadSequence: 0, unreadCount: 2, latestSequence: 2 }),
              },
            ),
          ),
        );
        // The server clamped or the cursor only reached the first message.
        advanceConversationReadCursor.mockReturnValue(
          of(readState({ lastReadSequence: 1, unreadCount: 1, latestSequence: 2 })),
        );
      },
    );

    await open(harness);

    expect(harness.host.querySelectorAll('.feed li.unread')).toHaveLength(1);
    expect(query(harness.host, '.thread-unread').textContent).toContain('1 unread');
  });

  it('updates the conversation preview when the newest message is sent', async () => {
    const harness = await render(
      ({ listConversations, listConversationMessages, sendConversationMessage }) => {
        listConversations.mockReturnValue(
          of(
            conversationPage([
              conversation({
                lastMessage: {
                  messageId: 'message-1',
                  sequence: 1,
                  senderUserId: 'client-user-1',
                  isFromCaller: false,
                  sentAtUtc: '2026-09-01T09:01:00.000Z',
                  body: 'the old preview',
                  isDeleted: false,
                  deletionKind: null,
                },
              }),
            ]),
          ),
        );
        listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
        sendConversationMessage.mockReturnValue(
          of(message(2, { body: 'the new preview', isFromCaller: true, senderUserId: 'coach-1' })),
        );
      },
    );
    await open(harness);

    const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
    composer.value = 'the new preview';
    composer.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Send message');
    await settle(harness.fixture);

    expect(query(harness.host, '.conversation .preview').textContent).toContain('the new preview');
  });

  /**
   * The one place the redaction would visibly fail: a body removed from the thread but still sitting
   * in the list beside it until somebody refreshes.
   */
  it('hides the removed body from the conversation preview immediately', async () => {
    const own = message(1, {
      body: 'regrettable',
      isFromCaller: true,
      senderUserId: 'coach-1',
      canDelete: true,
      canModerate: false,
    });
    const harness = await render(
      ({ listConversations, listConversationMessages, deleteConversationMessage }) => {
        listConversations.mockReturnValue(
          of(
            conversationPage([
              conversation({
                lastMessage: {
                  messageId: 'message-1',
                  sequence: 1,
                  senderUserId: 'coach-1',
                  isFromCaller: true,
                  sentAtUtc: '2026-09-01T09:01:00.000Z',
                  body: 'regrettable',
                  isDeleted: false,
                  deletionKind: null,
                },
              }),
            ]),
          ),
        );
        listConversationMessages.mockReturnValue(of(messagePage([own])));
        deleteConversationMessage.mockReturnValue(
          of(
            message(1, {
              body: null,
              isFromCaller: true,
              senderUserId: 'coach-1',
              isDeleted: true,
              deletionKind: 'SenderRemoved',
              deletedAtUtc: '2026-09-01T09:10:00.000Z',
              canEdit: false,
              canDelete: false,
              canModerate: false,
            }),
          ),
        );
      },
    );
    await open(harness);
    expect(harness.host.textContent).toContain('regrettable');

    await messageAction(harness, 'Remove your message 1');
    await settle(harness.fixture);

    expect(query(harness.host, '.conversation .preview').textContent?.trim()).toBe(
      'Message removed',
    );
    expect(harness.host.textContent).not.toContain('regrettable');
  });

  it('updates the preview when the newest message is edited', async () => {
    const own = message(1, {
      body: 'frist',
      isFromCaller: true,
      senderUserId: 'coach-1',
      canEdit: true,
      canModerate: false,
    });
    const harness = await render(
      ({ listConversations, listConversationMessages, editConversationMessage }) => {
        listConversations.mockReturnValue(
          of(
            conversationPage([
              conversation({
                lastMessage: {
                  messageId: 'message-1',
                  sequence: 1,
                  senderUserId: 'coach-1',
                  isFromCaller: true,
                  sentAtUtc: '2026-09-01T09:01:00.000Z',
                  body: 'frist',
                  isDeleted: false,
                  deletionKind: null,
                },
              }),
            ]),
          ),
        );
        listConversationMessages.mockReturnValue(of(messagePage([own])));
        editConversationMessage.mockReturnValue(
          of({
            ...own,
            body: 'first',
            revisionNumber: 2,
            editedAtUtc: '2026-09-01T09:05:00.000Z',
            version: 2,
          }),
        );
      },
    );
    await open(harness);

    await messageAction(harness, 'Edit your message 1');
    await settle(harness.fixture);
    const editor = field<HTMLTextAreaElement>(harness.host, 'Edit message');
    editor.value = 'first';
    editor.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    press(harness.host, 'Save changes');
    await settle(harness.fixture);

    expect(query(harness.host, '.conversation .preview').textContent).toContain('first');
    expect(query(harness.host, '.conversation .preview').textContent).not.toContain('frist');
  });

  it('discards a read-cursor reply that resolves after another conversation was opened', async () => {
    const pending = new Subject<ConversationReadState>();
    const harness = await render((api) => {
      api.listConversations.mockReturnValue(
        of(
          conversationPage([
            conversation({ unreadCount: 5 }),
            conversation({ ...SECOND, unreadCount: 4 }),
          ]),
        ),
      );
      api.listConversationMessages
        .mockReturnValueOnce(
          of(
            messagePage([message(1)], {
              readState: readState({ lastReadSequence: 0, unreadCount: 5, latestSequence: 1 }),
            }),
          ),
        )
        .mockReturnValue(
          of(
            messagePage([message(9, { id: 'message-9', body: 'second thread' })], {
              // Already current, so opening the second conversation reports no cursor of its own
              // and the only reply in flight is the stale one.
              readState: readState({
                conversationId: 'conversation-2',
                lastReadSequence: 9,
                unreadCount: 4,
                latestSequence: 9,
              }),
            }),
          ),
        );
      api.advanceConversationReadCursor.mockReturnValue(pending);
    });
    await open(harness);
    expect(harness.advanceConversationReadCursor).toHaveBeenCalledWith('conversation-1', 1);

    await open(harness, 'Nadia Khoury');
    expect(query(harness.host, '.thread-unread').textContent).toContain('4 unread');

    pending.next(readState({ lastReadSequence: 1, unreadCount: 0 }));
    pending.complete();
    await settle(harness.fixture);

    // The reply describes a conversation that is no longer open, so it must not rewrite this one's
    // unread count, and it must not clear the other row's badge either.
    expect(query(harness.host, '.thread-unread').textContent).toContain('4 unread');
    expect(harness.unreadRefresh).not.toHaveBeenCalled();
    expect(
      query(harness.host, '.conversation[data-conversation-id="conversation-1"]').getAttribute(
        'aria-label',
      ),
    ).toBe('Rania Haddad, 5 unread messages');
  });

  // ---------- the coach's inbox and the client beside the thread (C6, R3.5b) ----------

  describe('coach inbox', () => {
    const COUNTS = { all: 5, unread: 2, awaitingReply: 3 };
    const waitingRow = conversation({ isAwaitingReply: true });

    afterEach(() => {
      document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    });

    function chip(host: HTMLElement, label: string): HTMLInputElement {
      const found = Array.from(host.querySelectorAll<HTMLLabelElement>('.chip')).find((candidate) =>
        (candidate.textContent ?? '').trim().startsWith(label),
      );
      if (found === undefined) throw new Error(`No chip "${label}".`);
      return query<HTMLInputElement>(found, 'input');
    }

    function chips(host: HTMLElement): string[] {
      return Array.from(host.querySelectorAll('.chip')).map((element) =>
        (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
    }

    async function choose(harness: Harness, label: string): Promise<void> {
      chip(harness.host, label).dispatchEvent(new Event('change'));
      await settle(harness.fixture);
    }

    async function search(harness: Harness, value: string): Promise<void> {
      const box = query<HTMLInputElement>(harness.host, '#conversation-search');
      box.value = value;
      box.dispatchEvent(new Event('input'));
      // The search waits for typing to pause before it asks.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await settle(harness.fixture);
    }

    function lastQuery(harness: Harness): unknown {
      return harness.listConversations.mock.calls.at(-1)?.[3];
    }

    it('counts each chip from the server and asks the server for what a chip names', async () => {
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
      });

      expect(chips(harness.host)).toEqual(['All 5', 'Unread 2', 'Waiting for reply 3']);
      expect(chip(harness.host, 'All').checked).toBe(true);
      expect(lastQuery(harness)).toEqual({ filter: 'All', search: '' });

      await choose(harness, 'Waiting for reply');
      // Every conversation is searched by the server, not only the page already loaded.
      expect(harness.listConversations).toHaveBeenLastCalledWith(null, null, 25, {
        filter: 'AwaitingReply',
        search: '',
      });

      await search(harness, 'rania');
      expect(lastQuery(harness)).toEqual({ filter: 'AwaitingReply', search: 'rania' });
      const calls = harness.listConversations.mock.calls.length;
      await search(harness, '');
      expect(harness.listConversations.mock.calls.length).toBe(calls + 1);
      expect(lastQuery(harness)).toEqual({ filter: 'AwaitingReply', search: '' });
    });

    it('keeps the chip in the address, so Back returns to the same list', async () => {
      const harness = await render(
        ({ listConversations }) => {
          listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
        },
        undefined,
        '/messages?show=unread',
      );

      expect(lastQuery(harness)).toEqual({ filter: 'Unread', search: '' });
      expect(chip(harness.host, 'Unread').checked).toBe(true);

      await choose(harness, 'All');
      expect(TestBed.inject(Router).url).toBe('/messages');
    });

    it('says why a narrowed list is empty and offers the way back', async () => {
      const harness = await render(({ listConversations }) => {
        listConversations.mockImplementation(
          (
            _before: unknown,
            _id: unknown,
            _take: unknown,
            wanted?: { filter: string; search: string },
          ) =>
            of(
              conversationPage(
                wanted?.filter === 'All' && wanted.search === '' ? [waitingRow] : [],
                { counts: COUNTS },
              ),
            ),
        );
      });

      await choose(harness, 'Waiting for reply');
      expect(query(harness.host, '.inbox .empty').textContent).toContain(
        'Nobody is waiting for a reply',
      );
      // Not the invitation a coach with no conversations at all is given.
      expect(harness.host.textContent).not.toContain('No conversations yet');

      await search(harness, 'zz');
      expect(query(harness.host, '.inbox .empty').textContent).toContain(
        'No conversation matches “zz”',
      );
      press(harness.host, 'Clear search');
      await settle(harness.fixture);
      expect(lastQuery(harness)).toEqual({ filter: 'AwaitingReply', search: '' });

      press(harness.host, 'Show all conversations');
      await settle(harness.fixture);
      expect(harness.host.querySelectorAll('.conversation')).toHaveLength(1);
    });

    it('marks a thread whose client spoke last, until the coach answers', async () => {
      const harness = await render(({ listConversations, sendConversationMessage }) => {
        listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
        sendConversationMessage.mockReturnValue(
          of(message(3, { isFromCaller: true, senderUserId: 'coach-1', body: 'Friday at 7.' })),
        );
      });

      const row = query(harness.host, '.conversation');
      expect(query(row, '.tag.waiting').textContent).toContain('Waiting');
      expect(row.getAttribute('aria-label')).toBe('Rania Haddad, waiting for your reply');

      await open(harness);
      const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
      composer.value = 'Friday at 7.';
      composer.dispatchEvent(new Event('input'));
      await settle(harness.fixture);
      press(harness.host, 'Send message');
      await settle(harness.fixture);

      expect(harness.host.querySelector('.conversation .tag.waiting')).toBeNull();
      expect(chips(harness.host)).toContain('Waiting for reply 2');
    });

    it('keeps the open thread when answering takes it out of the filtered list', async () => {
      const harness = await render(({ listConversations, listConversationMessages }) => {
        listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
        listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
      });
      await choose(harness, 'Waiting for reply');
      await open(harness);

      // The list is read again and the thread no longer answers the chip.
      harness.listConversations.mockReturnValue(
        of(conversationPage([], { counts: { ...COUNTS, awaitingReply: 2 } })),
      );
      harness.realtime.invalidate();
      await settle(harness.fixture);

      expect(harness.host.querySelectorAll('.conversation')).toHaveLength(0);
      expect(query(harness.host, '#thread-heading').textContent).toContain('Rania Haddad');
      expect(bodies(harness.host)).toEqual(['Message 1']);
    });

    it('keeps the open thread’s row read when a live list read the server just before the cursor moved', async () => {
      const harness = await render(
        ({ listConversations, listConversationMessages, advanceConversationReadCursor }) => {
          listConversations.mockReturnValue(
            of(conversationPage([conversation()], { counts: { ...COUNTS, unread: 1 } })),
          );
          listConversationMessages.mockReturnValue(
            of(
              messagePage([message(1)], {
                readState: readState({ lastReadSequence: 1, unreadCount: 0, latestSequence: 1 }),
              }),
            ),
          );
          advanceConversationReadCursor.mockReturnValue(
            of(readState({ lastReadSequence: 2, unreadCount: 0, latestSequence: 2 })),
          );
        },
      );
      await open(harness);
      harness.realtime.deliver({
        tenantId: ALPHA.tenantId,
        conversationId: 'conversation-1',
        eventId: 'event-2',
        eventSequence: 2,
        kind: 'MessageSent',
        occurredAtUtc: '2026-09-01T09:05:00.000Z',
        message: message(2, { isUnreadByCaller: true }),
      });
      await settle(harness.fixture);

      // The live refresh was read before the cursor move landed and still counts message 2.
      harness.listConversations.mockReturnValue(
        of(
          conversationPage([conversation({ unreadCount: 1, lastReadSequence: 1 })], {
            counts: { ...COUNTS, unread: 2 },
          }),
        ),
      );
      harness.realtime.invalidate();
      await settle(harness.fixture);

      const row = query(harness.host, '.conversation[data-conversation-id="conversation-1"]');
      expect(row.querySelector('.count')).toBeNull();
      expect(chips(harness.host)).toContain('Unread 1');
    });

    it('takes a read thread off the unread count', async () => {
      const harness = await render(({ listConversations, listConversationMessages }) => {
        listConversations.mockReturnValue(
          of(
            conversationPage([conversation({ unreadCount: 1, lastReadSequence: 0 })], {
              counts: COUNTS,
            }),
          ),
        );
        listConversationMessages.mockReturnValue(
          of(
            messagePage([message(1, { isUnreadByCaller: true })], {
              readState: readState({ lastReadSequence: 0, unreadCount: 1 }),
            }),
          ),
        );
      });

      await open(harness);

      expect(chips(harness.host)).toContain('Unread 1');
    });

    it('shows the client beside the coach’s thread, from the read their page uses', async () => {
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
      });
      await open(harness);

      expect(harness.getClientOverview).toHaveBeenCalledWith('client-1');
      const panel = query(harness.host, 'app-chat-client-panel.client-column');
      expect(panel.getAttribute('role')).toBe('complementary');
      expect(panel.getAttribute('aria-label')).toBe('About Rania Haddad');
      expect(panel.textContent).toContain('Online coaching');
      expect(panel.textContent).toContain('Lower A');
      expect(panel.textContent).toContain('Back squat 85 kg × 5');
      expect(query(panel, 'a.open').getAttribute('href')).toBe('/clients/client-1');
    });

    it('opens the same panel as a sheet where the column does not fit', async () => {
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
      });
      await open(harness);

      press(harness.host, 'Client details');
      await settle(harness.fixture);

      const sheet = query(document.body, '.tb-modal-pane--sheet');
      expect(sheet.textContent).toContain('About Rania Haddad');
      expect(sheet.textContent).toContain('Online coaching');
      expect(harness.getClientOverview).toHaveBeenCalledTimes(1);
    });

    it('says when the client could not be read, and leaves the chat working', async () => {
      const harness = await render(
        ({ listConversations, listConversationMessages, getClientOverview }) => {
          listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
          listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
          getClientOverview.mockReturnValue(
            throwError(() => new HttpErrorResponse({ status: 404 })),
          );
        },
      );
      await open(harness);

      const panel = query(harness.host, 'app-chat-client-panel.client-column');
      expect(panel.textContent).toContain('Their details could not be loaded.');
      expect(query(panel, 'a.open').getAttribute('href')).toBe('/clients/client-1');
      expect(bodies(harness.host)).toEqual(['Message 1']);
      expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
    });

    it('gives a client no search, chips, waiting marks or client panel', async () => {
      const LEA = { userId: 'coach-user', displayName: 'Lea Haddad', role: 'Coach' as const };
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(
          of(
            conversationPage([
              conversation({ callerRole: 'Client', counterpart: LEA, isAwaitingReply: true }),
              conversation({ ...SECOND, callerRole: 'Client', isReadOnly: true, counterpart: LEA }),
            ]),
          ),
        );
      });
      harness.membership.set({ ...ALPHA, role: 'Client' });
      await settle(harness.fixture);

      expect(harness.host.querySelector('app-inbox-toolbar')).toBeNull();
      expect(harness.host.querySelector('.tag.waiting')).toBeNull();
      await open(harness, 'Lea Haddad');
      expect(harness.getClientOverview).not.toHaveBeenCalled();
      expect(harness.host.querySelector('app-chat-client-panel')).toBeNull();
      expect(harness.host.textContent).not.toContain('Client details');
    });

    it('puts focus back in the search box when the search is cleared', async () => {
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
      });
      await search(harness, 'rania');

      query<HTMLButtonElement>(harness.host, 'app-inbox-toolbar button.clear').click();
      await settle(harness.fixture);

      const box = query<HTMLInputElement>(harness.host, '#conversation-search');
      expect(box.value).toBe('');
      expect(document.activeElement).toBe(box);
      expect(lastQuery(harness)).toEqual({ filter: 'All', search: '' });
    });

    it('drops a saved reply into the coach’s draft and sends nothing', async () => {
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
      });
      await open(harness);
      const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
      composer.value = 'Hi Rania!';
      composer.dispatchEvent(new Event('input'));
      await settle(harness.fixture);

      press(harness.host, 'Saved replies');
      await settle(harness.fixture);
      const sheet = query(document.body, '.tb-modal-pane--sheet');
      expect(sheet.textContent).toContain('Check-in reminder');
      query<HTMLButtonElement>(sheet, '.use').click();
      await settle(harness.fixture);

      expect(composer.value).toBe('Hi Rania!\nYour check-in is due today.');
      expect(harness.sendConversationMessage).not.toHaveBeenCalled();
      expect(document.body.querySelector('.tb-modal-pane--sheet')).toBeNull();
      expect(document.activeElement).toBe(composer);
    });

    it('offers saved replies on the coach’s side only', async () => {
      const LEA = { userId: 'coach-user', displayName: 'Lea Haddad', role: 'Coach' as const };
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(
          of(conversationPage([conversation({ callerRole: 'Client', counterpart: LEA })])),
        );
      });

      expect(harness.host.querySelector('app-chat-composer')).not.toBeNull();
      expect(harness.host.textContent).not.toContain('Saved replies');
    });

    it('forgets the search when the workspace changes', async () => {
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(of(conversationPage([waitingRow], { counts: COUNTS })));
      });
      await search(harness, 'rania');
      expect(lastQuery(harness)).toEqual({ filter: 'All', search: 'rania' });

      harness.membership.set(BETA);
      await settle(harness.fixture);

      expect(lastQuery(harness)).toEqual({ filter: 'All', search: '' });
      expect(query<HTMLInputElement>(harness.host, '#conversation-search').value).toBe('');
    });
  });

  // ---------- realtime, from the screen's side ----------

  describe('chat', () => {
    const LEA = { userId: 'coach-user', displayName: 'Lea Haddad', role: 'Coach' as const };
    const withCoach = conversation({ callerRole: 'Client', canModerate: false, counterpart: LEA });

    /** Answers `(pointer: fine)` the way a desktop or a phone would, for the composer's Enter key. */
    function pointer(fine: boolean): () => void {
      const view = document.defaultView as Window & { matchMedia?: Window['matchMedia'] };
      const original = view.matchMedia;
      view.matchMedia = ((query: string) =>
        ({
          matches: fine && query === '(pointer: fine)',
          media: query,
        }) as MediaQueryList) as Window['matchMedia'];
      return () => {
        view.matchMedia = original as Window['matchMedia'];
      };
    }

    async function typeDraft(harness: Harness, value: string): Promise<HTMLTextAreaElement> {
      const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
      composer.value = value;
      composer.dispatchEvent(new Event('input'));
      await settle(harness.fixture);
      return composer;
    }

    it('opens a client’s only conversation by itself, with no inbox to choose from', async () => {
      const harness = await render(({ listConversations, listConversationMessages }) => {
        listConversations.mockReturnValue(of(conversationPage([withCoach])));
        listConversationMessages.mockReturnValue(
          of(messagePage([message(1, { body: 'Hi Maya! Lower A today.' })])),
        );
      });

      expect(bodies(harness.host)).toEqual(['Hi Maya! Lower A today.']);
      expect(harness.host.querySelector('.inbox')).toBeNull();
      expect(harness.host.textContent).not.toContain('All conversations');
      expect(query(harness.host, '#thread-heading').textContent).toContain('Lea Haddad');
      expect(query(harness.host, '.thread-role').textContent).toContain('Your coach');
      // The page keeps its name for assistive technology even though the thread fills it.
      expect(query(harness.host, 'h1').textContent).toContain('Messages');
      expect(harness.realtime.opened).toEqual([
        { conversationId: 'conversation-1', fromEventSequence: 1 },
      ]);
    });

    it('brings the inbox back when a client also has a former coach’s thread', async () => {
      const former = conversation({
        ...SECOND,
        callerRole: 'Client',
        canModerate: false,
        isReadOnly: true,
        counterpart: { userId: 'coach-old', displayName: 'Omar Nasser', role: 'Coach' },
      });
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(of(conversationPage([withCoach, former])));
      });

      expect(harness.host.querySelectorAll('.conversation')).toHaveLength(2);
      expect(query(harness.host, '.conversation-list .tag').textContent).toContain('Former coach');
      // Choosing is the client's to do; nothing is opened, and nothing marked read, on their behalf.
      expect(harness.listConversationMessages).not.toHaveBeenCalled();
    });

    it('tells a client with no conversation that their coach writes first', async () => {
      const harness = await render();
      harness.membership.set({ ...ALPHA, role: 'Client' });
      await settle(harness.fixture);

      const empty = query(harness.host, '.inbox .empty');
      expect(empty.textContent).toContain('Your coach starts the conversation');
      expect(query(empty, 'a').getAttribute('href')).toBe('/');
    });

    it('groups the thread by day and keeps the new-messages line where it was after reading', async () => {
      const harness = await render(
        ({ listConversations, listConversationMessages, advanceConversationReadCursor }) => {
          listConversations.mockReturnValue(
            of(conversationPage([conversation({ unreadCount: 1 })])),
          );
          listConversationMessages.mockReturnValue(
            of(
              messagePage([message(1), message(2, { isUnreadByCaller: true })], {
                readState: readState({ lastReadSequence: 1, unreadCount: 1, latestSequence: 2 }),
              }),
            ),
          );
          advanceConversationReadCursor.mockReturnValue(
            of(readState({ lastReadSequence: 2, unreadCount: 0, latestSequence: 2 })),
          );
        },
      );

      await open(harness);

      // Both messages were sent on the same day, so one labelled day holds them both.
      const days = harness.host.querySelectorAll('.feed .day');
      expect(days).toHaveLength(1);
      expect(query(days[0], '.day-label').textContent?.trim()).not.toBe('');
      // The cursor has moved past message 2, so it is no longer unread, but the line stays put.
      expect(harness.host.querySelectorAll('.feed li.unread')).toHaveLength(0);
      const rows = harness.host.querySelectorAll('.feed li');
      expect(rows[0].querySelector('.new-divider')).toBeNull();
      expect(rows[1].querySelector('.new-divider')?.textContent).toContain('New messages');
    });

    it('keeps a message’s actions behind its options button, one message at a time', async () => {
      const harness = await render(({ listConversations, listConversationMessages }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
        listConversationMessages.mockReturnValue(
          of(
            messagePage([
              message(1, {
                isFromCaller: true,
                senderUserId: 'coach-1',
                canEdit: true,
                canDelete: true,
                canModerate: false,
              }),
              message(2, { canModerate: true }),
            ]),
          ),
        );
      });
      await open(harness);
      expect(harness.host.querySelector('.actions')).toBeNull();

      press(harness.host, 'Options for your message 1');
      await settle(harness.fixture);
      const own = query(harness.host, '.actions');
      expect(own.textContent).toContain('Edit');
      expect(own.textContent).toContain('Remove');
      expect(button(harness.host, 'Options for your message 1').getAttribute('aria-expanded')).toBe(
        'true',
      );

      press(harness.host, 'Options for message 2');
      await settle(harness.fixture);
      expect(harness.host.querySelectorAll('.actions')).toHaveLength(1);
      expect(query(harness.host, '.actions').textContent).toContain('Remove as coach');
      expect(button(harness.host, 'Options for your message 1').getAttribute('aria-expanded')).toBe(
        'false',
      );

      query(harness.host, '.actions').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle(harness.fixture);
      expect(harness.host.querySelector('.actions')).toBeNull();
    });

    it('goes back from a thread to the inbox and leaves the thread’s live subscription', async () => {
      const harness = await render(({ listConversations, listConversationMessages }) => {
        listConversations.mockReturnValue(
          of(conversationPage([conversation(), conversation(SECOND)])),
        );
        listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
      });
      await open(harness);
      await typeDraft(harness, 'half a thought');
      expect(harness.realtime.isOpen).toBe(true);

      press(harness.host, 'All conversations');
      await settle(harness.fixture);

      expect(harness.host.querySelector('.feed')).toBeNull();
      expect(harness.host.querySelector('.composer')).toBeNull();
      expect(harness.realtime.isOpen).toBe(false);
      expect(harness.host.querySelectorAll('.conversation')).toHaveLength(2);
      expect(harness.host.querySelector('.conversation[aria-current="true"]')).toBeNull();

      // The draft was addressed to that thread, so it went with it.
      await open(harness);
      expect(field<HTMLTextAreaElement>(harness.host, 'Write a message').value).toBe('');
    });

    it('sends with Enter on a desktop keyboard, and keeps Shift+Enter and phones for new lines', async () => {
      const harness = await render(
        ({ listConversations, listConversationMessages, sendConversationMessage }) => {
          listConversations.mockReturnValue(of(conversationPage([conversation()])));
          listConversationMessages.mockReturnValue(of(messagePage([])));
          sendConversationMessage.mockReturnValue(
            of(message(1, { body: 'On my way', isFromCaller: true, senderUserId: 'coach-1' })),
          );
        },
      );
      await open(harness);
      const enter = (init: KeyboardEventInit = {}) =>
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });

      const restorePhone = pointer(false);
      try {
        const composer = await typeDraft(harness, 'On my way');
        composer.dispatchEvent(enter());
        await settle(harness.fixture);
        expect(harness.sendConversationMessage).not.toHaveBeenCalled();
      } finally {
        restorePhone();
      }

      const restoreDesktop = pointer(true);
      try {
        const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
        composer.dispatchEvent(enter({ shiftKey: true }));
        await settle(harness.fixture);
        expect(harness.sendConversationMessage).not.toHaveBeenCalled();

        const plain = enter();
        composer.dispatchEvent(plain);
        await settle(harness.fixture);
        expect(plain.defaultPrevented).toBe(true);
        expect(harness.sendConversationMessage).toHaveBeenCalledWith(
          'conversation-1',
          'On my way',
          expect.any(String),
        );
      } finally {
        restoreDesktop();
      }
    });

    it('shows how many characters are left only when the limit is near', async () => {
      const harness = await render(({ listConversations }) => {
        listConversations.mockReturnValue(of(conversationPage([conversation()])));
      });
      await open(harness);

      await typeDraft(harness, 'Short and sweet');
      expect(query(harness.host, '.composer .count').textContent?.trim()).toBe('');

      await typeDraft(harness, 'x'.repeat(1850));
      expect(query(harness.host, '.composer .count').textContent).toContain(
        '150 of 2000 characters left.',
      );
    });
  });

  describe('realtime', () => {
    it('subscribes before catching up, from the watermark the thread read established', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
        api.listConversationMessages.mockReturnValue(
          of(messagePage([message(1)], { latestEventSequence: 12 })),
        );
      });

      await open(harness);

      expect(harness.realtime.opened).toEqual([
        { conversationId: 'conversation-1', fromEventSequence: 12 },
      ]);
    });

    it('merges a live event into the thread and the list preview', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
        api.listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
      });
      await open(harness);

      const accepted = harness.realtime.deliver({
        tenantId: ALPHA.tenantId,
        conversationId: 'conversation-1',
        eventId: 'event-2',
        eventSequence: 2,
        kind: 'MessageSent',
        occurredAtUtc: '2026-09-01T09:05:00.000Z',
        message: message(2, { body: 'Arrived over the socket' }),
      });
      await settle(harness.fixture);

      expect(accepted).toBe(true);
      expect(bodies(harness.host)).toContain('Arrived over the socket');
    });

    it('rejects a stale revision so an old edit cannot replace a newer one', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
        api.listConversationMessages.mockReturnValue(
          of(messagePage([message(1, { body: 'The newest text', revisionNumber: 3 })])),
        );
      });
      await open(harness);

      const accepted = harness.realtime.deliver({
        tenantId: ALPHA.tenantId,
        conversationId: 'conversation-1',
        eventId: 'event-2',
        eventSequence: 2,
        kind: 'MessageEdited',
        occurredAtUtc: '2026-09-01T09:05:00.000Z',
        message: message(1, { body: 'An older text', revisionNumber: 2 }),
      });
      await settle(harness.fixture);

      expect(accepted).toBe(false);
      expect(bodies(harness.host)).toContain('The newest text');
      expect(harness.host.textContent).not.toContain('An older text');
    });

    it('treats a removal as terminal, so no later event puts the body back', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
        api.listConversationMessages.mockReturnValue(
          of(messagePage([message(1, { body: 'Taken back' })])),
        );
      });
      await open(harness);

      harness.realtime.deliver({
        tenantId: ALPHA.tenantId,
        conversationId: 'conversation-1',
        eventId: 'event-2',
        eventSequence: 2,
        kind: 'MessageCoachModerated',
        occurredAtUtc: '2026-09-01T09:05:00.000Z',
        message: message(1, {
          body: null,
          isDeleted: true,
          deletionKind: 'CoachModerated',
          deletedAtUtc: '2026-09-01T09:05:00.000Z',
          revisionNumber: 1,
        }),
      });
      await settle(harness.fixture);
      expect(harness.host.textContent).not.toContain('Taken back');

      // A late edit event for the same message, carrying the body again.
      const resurrect = harness.realtime.deliver({
        tenantId: ALPHA.tenantId,
        conversationId: 'conversation-1',
        eventId: 'event-3',
        eventSequence: 3,
        kind: 'MessageEdited',
        occurredAtUtc: '2026-09-01T09:06:00.000Z',
        message: message(1, { body: 'Taken back', revisionNumber: 5 }),
      });
      await settle(harness.fixture);

      expect(resurrect).toBe(false);
      expect(harness.host.textContent).not.toContain('Taken back');
    });

    it('ignores an event for a conversation that is not the one on screen', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
        api.listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
      });
      await open(harness);

      const accepted = harness.realtime.deliver({
        tenantId: ALPHA.tenantId,
        conversationId: 'conversation-9',
        eventId: 'event-2',
        eventSequence: 2,
        kind: 'MessageSent',
        occurredAtUtc: '2026-09-01T09:05:00.000Z',
        message: message(2, { conversationId: 'conversation-9', body: 'Somebody else' }),
      });
      await settle(harness.fixture);

      expect(accepted).toBe(false);
      expect(harness.host.textContent).not.toContain('Somebody else');
    });

    it('closes the subscription when the thread changes and when the workspace changes', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(
          of(conversationPage([conversation(), conversation(SECOND)])),
        );
        api.listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
      });
      await open(harness);
      const closedAfterFirst = harness.realtime.closed;

      await open(harness, 'Nadia Khoury');
      expect(harness.realtime.closed).toBeGreaterThan(closedAfterFirst);
      expect(harness.realtime.opened.map((item) => item.conversationId)).toEqual([
        'conversation-1',
        'conversation-2',
      ]);

      harness.membership.set(BETA);
      await settle(harness.fixture);
      expect(harness.realtime.isOpen).toBe(false);
    });

    it('refreshes the bounded list once per coalesced invalidation and never polls', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
      });
      const initialCalls = harness.listConversations.mock.calls.length;

      harness.realtime.invalidate();
      await settle(harness.fixture);

      expect(harness.listConversations.mock.calls.length).toBe(initialCalls + 1);

      // Nothing schedules another read on its own.
      await settle(harness.fixture);
      expect(harness.listConversations.mock.calls.length).toBe(initialCalls + 1);
    });

    function arrival(sequence: number, overrides: Partial<Message> = {}) {
      return {
        tenantId: ALPHA.tenantId,
        conversationId: 'conversation-1',
        eventId: `event-${sequence}`,
        eventSequence: sequence,
        kind: 'MessageSent' as const,
        occurredAtUtc: '2026-09-01T09:05:00.000Z',
        message: message(sequence, { isUnreadByCaller: true, ...overrides }),
      };
    }

    async function openRead(configure?: (api: ApiMocks) => void): Promise<Harness> {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
        api.listConversationMessages.mockReturnValue(
          of(
            messagePage([message(1)], {
              readState: readState({ lastReadSequence: 1, unreadCount: 0, latestSequence: 1 }),
            }),
          ),
        );
        api.advanceConversationReadCursor.mockReturnValue(
          of(readState({ lastReadSequence: 2, unreadCount: 0, latestSequence: 2 })),
        );
        configure?.(api);
      });
      await open(harness);
      return harness;
    }

    it('reads a message that arrives in front of the reader, and the badge and status agree (NCM-4)', async () => {
      const harness = await openRead();
      harness.unreadRefresh.mockClear();

      harness.realtime.deliver(arrival(2));
      await settle(harness.fixture);

      expect(harness.advanceConversationReadCursor).toHaveBeenLastCalledWith('conversation-1', 2);
      expect(harness.unreadRefresh).toHaveBeenCalled();
      expect(harness.host.querySelectorAll('.feed li.unread')).toHaveLength(0);
      expect(query(harness.host, '.thread-unread').textContent).toContain('Nothing unread');
      // Read as it arrived, so no "New messages" line is drawn above it.
      expect(harness.host.querySelector('.new-divider')).toBeNull();
    });

    it('never reads the other person’s words for them in a tab that is not shown', async () => {
      let visibility: DocumentVisibilityState = 'hidden';
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibility,
      });
      try {
        const harness = await openRead();
        const before = harness.advanceConversationReadCursor.mock.calls.length;

        harness.realtime.deliver(arrival(2));
        await settle(harness.fixture);

        expect(harness.advanceConversationReadCursor.mock.calls.length).toBe(before);
        expect(query(harness.host, '.thread-unread').textContent).toContain(
          '1 unread in this conversation',
        );
        expect(harness.host.querySelectorAll('.feed li.unread')).toHaveLength(1);

        // Coming back to the tab with the thread at its newest message reads it.
        visibility = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
        await settle(harness.fixture);
        expect(harness.advanceConversationReadCursor).toHaveBeenLastCalledWith('conversation-1', 2);
        expect(query(harness.host, '.thread-unread').textContent).toContain('Nothing unread');
      } finally {
        delete (document as { visibilityState?: unknown }).visibilityState;
      }
    });

    it('leaves an arrival unread while the reader is back in history, and reads it once they reach it', async () => {
      const harness = await openRead();
      const scrollTo = scrolledBack(harness);
      const before = harness.advanceConversationReadCursor.mock.calls.length;

      harness.realtime.deliver(arrival(2));
      await settle(harness.fixture);

      expect(harness.advanceConversationReadCursor.mock.calls.length).toBe(before);
      expect(query(harness.host, '.thread-unread').textContent).toContain(
        '1 unread in this conversation',
      );
      // It waits below where they are, under a "New messages" line.
      expect(query(harness.host, '.new-divider').textContent).toContain('New messages');

      scrollTo(true);
      query(harness.host, '.feed').dispatchEvent(new Event('scroll'));
      await settle(harness.fixture);
      expect(harness.advanceConversationReadCursor).toHaveBeenLastCalledWith('conversation-1', 2);

      // Scrolling on asks nothing more: it is read already.
      const after = harness.advanceConversationReadCursor.mock.calls.length;
      query(harness.host, '.feed').dispatchEvent(new Event('scroll'));
      await settle(harness.fixture);
      expect(harness.advanceConversationReadCursor.mock.calls.length).toBe(after);
    });

    it('marks nothing read for the reader’s own message arriving from another tab', async () => {
      const harness = await openRead();
      const before = harness.advanceConversationReadCursor.mock.calls.length;

      harness.realtime.deliver(
        arrival(2, { isFromCaller: true, senderUserId: 'coach-1', isUnreadByCaller: false }),
      );
      await settle(harness.fixture);

      expect(harness.advanceConversationReadCursor.mock.calls.length).toBe(before);
      expect(query(harness.host, '.thread-unread').textContent).toContain('Nothing unread');
    });

    it('keeps a refused send on screen through the live refresh the other person’s message causes', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
        api.listConversationMessages.mockReturnValue(of(messagePage([message(1)])));
        api.sendConversationMessage.mockReturnValue(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: { errors: { body: ['A message can only contain ordinary text.'] } },
              }),
          ),
        );
      });
      await open(harness);
      const composer = field<HTMLTextAreaElement>(harness.host, 'Write a message');
      composer.value = 'odd text';
      composer.dispatchEvent(new Event('input'));
      await settle(harness.fixture);
      press(harness.host, 'Send message');
      await settle(harness.fixture);
      const refused = 'A message can only contain ordinary text.';
      expect(query(harness.host, 'p.error[role="alert"]').textContent).toContain(refused);

      // The other person writes; the list refreshes live (VER3A-NEW-1).
      harness.realtime.invalidate();
      await settle(harness.fixture);

      expect(harness.listConversations.mock.calls.length).toBeGreaterThan(1);
      expect(query(harness.host, 'p.error[role="alert"]').textContent).toContain(refused);
    });

    it('keeps the list when a live refresh fails, and clears the list’s own failure when one works', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
      });
      expect(harness.host.querySelectorAll('.conversation')).toHaveLength(1);

      harness.listConversations.mockReturnValue(throwError(() => new Error('offline')));
      harness.realtime.invalidate();
      await settle(harness.fixture);
      expect(harness.host.querySelectorAll('.conversation')).toHaveLength(1);
      expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');

      // A failed read of the list that the person asked for says so, and a later live read that
      // works takes that sentence away, because it was about the list.
      await goOffline(harness);
      press(harness.host, 'Check for new messages');
      await settle(harness.fixture);
      expect(query(harness.host, 'p.error[role="alert"]').textContent).toContain(
        'Conversations could not be loaded.',
      );
      harness.listConversations.mockReturnValue(of(conversationPage([conversation()])));
      harness.realtime.invalidate();
      await settle(harness.fixture);
      expect(query(harness.host, 'p.error[role="alert"]').textContent?.trim()).toBe('');
      expect(harness.host.querySelectorAll('.conversation')).toHaveLength(1);
    });

    it('shows the channel state without claiming anything was lost', async () => {
      const harness = await render((api) => {
        api.listConversations.mockReturnValue(of(conversationPage([conversation()])));
      });

      harness.realtime.state.set('reconnecting');
      await settle(harness.fixture);
      const state = query(harness.host, '[data-testid="realtime-state"]');
      expect(state.textContent).toContain('Reconnecting');
      expect(state.textContent).toContain('Nothing has been lost');
      expect(state.getAttribute('role')).toBe('status');

      harness.realtime.state.set('offline');
      await settle(harness.fixture);
      expect(query(harness.host, '[data-testid="realtime-state"]').textContent).toContain(
        "You're offline",
      );
      // Offline is the one state that offers a manual check; nothing else ever shows Refresh.
      expect(button(harness.host, 'Check for new messages')).toBeTruthy();

      harness.realtime.state.set('connected');
      await settle(harness.fixture);
      // A working channel says nothing at all, and is never rendered as delivery or a read receipt.
      const connected = query(harness.host, '[data-testid="realtime-state"]').textContent ?? '';
      expect(connected.trim()).toBe('');
      expect(query(harness.host, '.live').classList).not.toContain('shown');
      expect(harness.host.textContent).not.toContain('Check for new messages');
      expect(harness.host.textContent).not.toContain('Refresh');
    });
  });
});
