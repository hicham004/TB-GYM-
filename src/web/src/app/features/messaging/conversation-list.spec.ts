import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { button, menuChoices, press, query, settle } from '../../../testing/dom';
import { ConversationList } from './conversation-list';
import type { Conversation, MessagePreview } from './messaging.models';

// Local wall-clock times, so the labels under test read the same in every time zone.
const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute);
const NOW = at(10, 22, 18);

const LEA = { userId: 'client-user-1', displayName: 'Lea Haddad', role: 'Client' as const };

function preview(overrides: Partial<MessagePreview> = {}): MessagePreview {
  return {
    messageId: 'message-1',
    sequence: 1,
    senderUserId: LEA.userId,
    isFromCaller: false,
    sentAtUtc: at(10, 22, 9, 5).toISOString(),
    body: 'Can we move Thursday?',
    isDeleted: false,
    deletionKind: null,
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    clientProfileId: 'client-1',
    counterpart: LEA,
    callerRole: 'Coach',
    canModerate: true,
    startedAtUtc: at(9, 1, 8).toISOString(),
    lastActivityAtUtc: at(10, 22, 9, 5).toISOString(),
    lastSequence: 1,
    unreadCount: 0,
    lastReadSequence: 1,
    lastReadAtUtc: at(10, 22, 9, 5).toISOString(),
    isAvailable: true,
    accessReason: 'Granted',
    lastMessage: preview(),
    isReadOnly: false,
    isMarkedUnread: false,
    latestFromCounterpart: null,
    ...overrides,
  };
}

interface Options {
  readonly selectedId?: string | null;
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly now?: Date;
}

async function render(conversations: readonly Conversation[], options: Options = {}) {
  TestBed.configureTestingModule({ imports: [ConversationList] });
  const fixture = TestBed.createComponent(ConversationList);
  fixture.componentRef.setInput('conversations', conversations);
  fixture.componentRef.setInput('now', options.now ?? NOW);
  fixture.componentRef.setInput('selectedId', options.selectedId ?? null);
  fixture.componentRef.setInput('hasMore', options.hasMore ?? false);
  fixture.componentRef.setInput('loadingMore', options.loadingMore ?? false);
  const chosen: Conversation[] = [];
  let loadMore = 0;
  fixture.componentInstance.choose.subscribe((picked) => chosen.push(picked));
  fixture.componentInstance.loadMore.subscribe(() => loadMore++);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    chosen,
    loadMoreCount: () => loadMore,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const rows = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button.conversation'));

describe('ConversationList', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows each conversation as a face, a name, when it last moved and the last line said', async () => {
    const { host } = await render([
      conversation(),
      conversation({
        id: 'conversation-2',
        counterpart: { userId: 'client-user-2', displayName: 'Rami Tabet', role: 'Client' },
        lastActivityAtUtc: at(10, 21, 20).toISOString(),
        lastMessage: preview({ body: 'Done with week 3.' }),
      }),
    ]);

    const [lea, rami] = rows(host);
    expect(rows(host)).toHaveLength(2);
    expect(textOf(lea.querySelector('app-avatar'))).toBe('LH');
    expect(textOf(lea.querySelector('.who'))).toBe('Lea Haddad');
    // Angular's en-US time puts a narrow no-break space before AM and PM.
    expect(textOf(lea.querySelector('.when time'))).toBe('9:05 AM');
    expect(lea.querySelector('.when time')?.getAttribute('datetime')).toBe(
      at(10, 22, 9, 5).toISOString(),
    );
    expect(textOf(lea.querySelector('.preview'))).toBe('Can we move Thursday?');
    expect(lea.dataset['conversationId']).toBe('conversation-1');
    expect(textOf(rami.querySelector('.who'))).toBe('Rami Tabet');
    expect(textOf(rami.querySelector('.when time'))).toBe('Yesterday');
    expect(textOf(rami.querySelector('.preview'))).toBe('Done with week 3.');
  });

  it('says when each thread moved against the time it is given, not the device’s clock', async () => {
    const { fixture, host } = await render([
      conversation({ id: 'today' }),
      conversation({ id: 'this-week', lastActivityAtUtc: at(10, 19, 12).toISOString() }),
      conversation({ id: 'this-year', lastActivityAtUtc: at(9, 1, 12).toISOString() }),
      conversation({ id: 'last-year', lastActivityAtUtc: new Date(2025, 5, 3, 12).toISOString() }),
    ]);
    const labels = () => rows(host).map((row) => textOf(row.querySelector('.when time')));

    expect(labels()).toEqual(['9:05 AM', 'Mon', '1 Sep', '3 Jun 2025']);

    // The next morning the same thread is yesterday's.
    fixture.componentRef.setInput('now', at(10, 23, 8));
    await settle(fixture);
    expect(labels()[0]).toBe('Yesterday');
  });

  it('marks the caller’s own last line, and says when there is nothing to read', async () => {
    const { host } = await render([
      conversation({ id: 'mine', lastMessage: preview({ isFromCaller: true, body: 'See you.' }) }),
      conversation({ id: 'empty', lastMessage: null }),
      conversation({
        id: 'removed',
        lastMessage: preview({ body: null, isDeleted: true, deletionKind: 'SenderRemoved' }),
      }),
      conversation({ id: 'closed', isAvailable: false, accessReason: 'Expired' }),
    ]);
    const [mine, empty, removed, closed] = rows(host);

    expect(textOf(mine.querySelector('.preview .you'))).toBe('You:');
    expect(textOf(mine.querySelector('.preview'))).toBe('You: See you.');
    expect(textOf(empty.querySelector('.preview'))).toBe('No messages yet');
    expect(textOf(removed.querySelector('.preview'))).toBe('Message removed');
    // A thread that cannot be opened any more says so in place of its last line.
    expect(textOf(closed.querySelector('.preview'))).toBe('Closed');
    expect(closed.textContent).not.toContain('Can we move Thursday?');
    expect(closed.closest('li')?.classList).toContain('unavailable');
  });

  it('shows the unread count to the eye and says it in the row’s name', async () => {
    const { host } = await render([
      conversation({ unreadCount: 3 }),
      conversation({
        id: 'conversation-2',
        counterpart: { userId: 'client-user-2', displayName: 'Rami Tabet', role: 'Client' },
      }),
    ]);
    const [lea, rami] = rows(host);

    const count = lea.querySelector('.count');
    expect(textOf(count)).toBe('3');
    expect(count?.getAttribute('aria-hidden')).toBe('true');
    expect(lea.getAttribute('aria-label')).toBe('Lea Haddad, 3 unread messages');
    expect(rami.querySelector('.count')).toBeNull();
    expect(rami.getAttribute('aria-label')).toBe('Rami Tabet, no unread messages');
  });

  it('draws a chat marked unread as a dot with no number, and says so in words (critique B3b)', async () => {
    const { host } = await render([
      conversation({ isMarkedUnread: true }),
      conversation({ id: 'conversation-2', isMarkedUnread: true, unreadCount: 2 }),
    ]);
    const [marked, both] = rows(host);

    const dot = marked.querySelector('.count.marked');
    expect(dot).not.toBeNull();
    expect(textOf(dot)).toBe('');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(marked.getAttribute('aria-label')).toBe('Lea Haddad, marked unread');
    expect(marked.closest('li')?.classList).toContain('waiting');
    // With messages unread too, the number is the cue and the mark adds nothing to it.
    expect(textOf(both.querySelector('.count'))).toBe('2');
    expect(both.querySelector('.count.marked')).toBeNull();
    expect(both.getAttribute('aria-label')).toBe('Lea Haddad, 2 unread messages');
  });

  it('offers Mark as unread in a read row’s menu only, and hands the chat to the screen', async () => {
    const { fixture, host } = await render([
      conversation(),
      conversation({ id: 'conversation-2', unreadCount: 1 }),
      conversation({ id: 'conversation-3', isMarkedUnread: true }),
      conversation({ id: 'conversation-4', isAvailable: false }),
    ]);
    const marked: Conversation[] = [];
    fixture.componentInstance.markUnread.subscribe((chat) => marked.push(chat));

    const menus = Array.from(host.querySelectorAll('li')).map(
      (row) => row.querySelector('app-menu.row-menu') !== null,
    );
    expect(menus).toEqual([true, false, false, false]);

    const trigger = query<HTMLButtonElement>(host, 'app-menu.row-menu button');
    expect(trigger.getAttribute('aria-label')).toBe('More for Lea Haddad');
    trigger.click();
    await settle(fixture);
    menuChoices(trigger)
      .find((item) => textOf(item).includes('Mark as unread'))!
      .click();
    await settle(fixture);
    expect(marked.map((chat) => chat.id)).toEqual(['conversation-1']);
  });

  it('tags a thread nobody can write in: a former coach for a client, read-only for staff', async () => {
    const { host } = await render([
      conversation({
        id: 'former',
        callerRole: 'Client',
        isReadOnly: true,
        counterpart: { userId: 'coach-old', displayName: 'Omar Nasser', role: 'Coach' },
      }),
      conversation({ id: 'staff', callerRole: 'Coach', isReadOnly: true }),
      conversation({ id: 'unread', callerRole: 'Client', isReadOnly: true, unreadCount: 1 }),
    ]);
    const [former, staff, unread] = rows(host);

    expect(textOf(former.querySelector('.tag'))).toBe('Former coach');
    expect(textOf(staff.querySelector('.tag'))).toBe('Read-only');
    // Something unread still shows its count first.
    expect(unread.querySelector('.tag')).toBeNull();
    expect(textOf(unread.querySelector('.count'))).toBe('1');
  });

  it('marks the open conversation as current and reports the one chosen', async () => {
    const second = conversation({
      id: 'conversation-2',
      counterpart: { userId: 'client-user-2', displayName: 'Rami Tabet', role: 'Client' },
    });
    const { fixture, host, chosen } = await render([conversation(), second], {
      selectedId: 'conversation-1',
    });
    const [lea, rami] = rows(host);

    expect(lea.getAttribute('aria-current')).toBe('true');
    expect(lea.closest('li')?.classList).toContain('selected');
    expect(rami.hasAttribute('aria-current')).toBe(false);

    rami.click();
    await settle(fixture);
    expect(chosen).toEqual([second]);
    expect(chosen[0]).toBe(second);
  });

  it('offers Show more conversations only while there are more, and not twice at once', async () => {
    const { fixture, host, loadMoreCount } = await render([conversation()]);
    expect(host.textContent).not.toContain('Show more conversations');

    fixture.componentRef.setInput('hasMore', true);
    await settle(fixture);
    press(host, 'Show more conversations');
    await settle(fixture);
    expect(loadMoreCount()).toBe(1);

    fixture.componentRef.setInput('loadingMore', true);
    await settle(fixture);
    expect(button(host, 'Show more conversations').disabled).toBe(true);
  });
});
