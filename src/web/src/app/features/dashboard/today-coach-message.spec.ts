import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import { MessagingRealtimeService } from '../../core/messaging/messaging-realtime.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ConversationLaunch } from '../messaging/conversation-launch';
import type { Conversation, MessagePreview } from '../messaging/messaging.models';
import { press, settle } from '../../../testing/dom';
import { fakeClientAccess } from '../../../testing/today-fixtures';
import { TodayCoachMessage } from './today-coach-message';

// 14:20 on the device's calendar day, whatever zone the test runs in.
const sentAt = new Date(2026, 8, 20, 14, 20).toISOString();

function preview(message: Partial<MessagePreview> = {}): MessagePreview {
  return {
    messageId: 'm1',
    sequence: 2,
    senderUserId: 'hicham',
    isFromCaller: false,
    sentAtUtc: sentAt,
    body: 'Thanks for the detail, Maya.',
    isDeleted: false,
    deletionKind: null,
    ...message,
  };
}

function conversation(
  overrides: Partial<Conversation> = {},
  message: Partial<MessagePreview> = {},
): Conversation {
  const latest = preview(message);
  return {
    id: 'conversation-1',
    clientProfileId: 'maya',
    counterpart: { userId: 'hicham', displayName: 'Hicham Haddad', role: 'Coach' },
    unreadCount: 1,
    isAvailable: true,
    accessReason: 'Granted',
    isReadOnly: false,
    lastMessage: latest,
    latestFromCounterpart: latest,
    ...overrides,
  } as Conversation;
}

async function render(
  read: unknown,
  options: {
    today?: string | null;
    timeZone?: string | null;
    access?: ReturnType<typeof fakeClientAccess>;
  } = {},
) {
  const listConversations = vi.fn(() => read);
  const refreshes = signal(0);
  await TestBed.configureTestingModule({
    imports: [TodayCoachMessage],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: ApiClient, useValue: { listConversations } },
      { provide: ClientAccessStore, useValue: options.access ?? fakeClientAccess() },
      { provide: MessagingRealtimeService, useValue: { listRefreshRequests: refreshes } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(TodayCoachMessage);
  fixture.componentRef.setInput(
    'today',
    options.today === undefined ? '2026-09-20' : options.today,
  );
  fixture.componentRef.setInput('timeZone', options.timeZone ?? null);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    listConversations,
    refreshes,
    read: () => (host.textContent ?? '').replace(/\s+/g, ' '),
  };
}

const page = (...items: Conversation[]) =>
  of({ items, hasMore: false, nextBeforeActivityAtUtc: null, nextBeforeConversationId: null });

describe('TodayCoachMessage', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the coach, the time, Unread and the preview, and asks for one conversation', async () => {
    const { host, listConversations, read } = await render(page(conversation()));

    expect(listConversations).toHaveBeenCalledWith(null, null, 1);
    expect(host.querySelector('h2')?.textContent?.trim()).toBe('Latest from your coach');
    expect(read()).toContain('Hicham Haddad');
    expect(host.querySelector('#coach-meta')?.textContent?.replace(/\s+/g, ' ')).toMatch(
      /Your coach · 2:20\sPM/,
    );
    expect(host.querySelector('app-status-label')?.textContent).toContain('Unread');
    expect(host.querySelector('#coach-preview')?.textContent?.trim()).toBe(
      'Thanks for the detail, Maya.',
    );
    const link = host.querySelector('a[href="/messages"]');
    expect(link?.getAttribute('aria-labelledby')).toBe('coach-name coach-meta coach-unread');
    expect(link?.getAttribute('aria-describedby')).toBe('coach-preview');
  });

  it('hands the thread to Messages without marking anything read', async () => {
    const { fixture, host } = await render(page(conversation()));
    const launch = TestBed.inject(ConversationLaunch);

    host.querySelector<HTMLAnchorElement>('a[href="/messages"]')!.click();
    await settle(fixture);

    expect(launch.take('tenant-1')?.id).toBe('conversation-1');
  });

  it('shows the day instead of the time for an older message', async () => {
    const { host } = await render(page(conversation()), { today: '2026-09-21' });
    expect(host.querySelector('#coach-meta')?.textContent).toContain('Sun 20 Sep');
  });

  it('keeps showing the coach’s latest message after the client replied (CLIENT-13)', async () => {
    const reply = preview({
      messageId: 'm2',
      sequence: 3,
      senderUserId: 'maya',
      isFromCaller: true,
      body: 'See you then.',
    });
    const { host, read } = await render(page(conversation({ unreadCount: 0, lastMessage: reply })));
    expect(host.querySelector('#coach-preview')?.textContent?.trim()).toBe(
      'Thanks for the detail, Maya.',
    );
    expect(read()).not.toContain('You:');
    expect(read()).not.toContain('See you then.');
    expect(host.querySelector('app-status-label')).toBeNull();
  });

  it('judges "today" on the workspace’s calendar, not the device’s (WEA-10)', async () => {
    // 22:30 UTC on Sun 20 Sep is already 01:30 on Mon 21 Sep in Beirut.
    const late = { sentAtUtc: '2026-09-20T22:30:00.000Z' };
    const beirut = await render(page(conversation({}, late)), {
      today: '2026-09-21',
      timeZone: 'Asia/Beirut',
    });
    expect(beirut.host.querySelector('#coach-meta')?.textContent).not.toContain('Sep');
    TestBed.resetTestingModule();

    const utc = await render(page(conversation({}, late)), {
      today: '2026-09-21',
      timeZone: 'UTC',
    });
    expect(utc.host.querySelector('#coach-meta')?.textContent).toContain('Sun 20 Sep');
  });

  it('says why a closed conversation is closed', async () => {
    const closed = await render(
      page(conversation({ isAvailable: false, accessReason: 'Expired' })),
      {
        access: fakeClientAccess({ Messaging: 'Expired' }),
      },
    );
    expect(closed.host.querySelector('#coach-preview')?.textContent?.trim()).toBe(
      'Your coaching plan has ended',
    );
  });

  it('shows nothing without a message from the coach, or when messaging is not in the plan', async () => {
    const empty = await render(page());
    expect(empty.host.querySelector('section')).toBeNull();
    TestBed.resetTestingModule();

    const onlyTheClient = await render(
      page(
        conversation({
          lastMessage: preview({ isFromCaller: true, body: 'Hello?' }),
          latestFromCounterpart: null,
        }),
      ),
    );
    expect(onlyTheClient.host.querySelector('section')).toBeNull();
    TestBed.resetTestingModule();

    const outside = await render(page(conversation()), {
      access: fakeClientAccess({ Messaging: 'NoEntitlement' }),
    });
    expect(outside.host.querySelector('section')).toBeNull();
  });

  it('reads again when the live channel says a conversation changed, without a skeleton', async () => {
    const { fixture, host, listConversations, refreshes } = await render(page(conversation()));
    const next = new Subject<unknown>();
    listConversations.mockReturnValue(next);

    refreshes.set(1);
    await settle(fixture);
    expect(listConversations).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.coach-skeleton')).toBeNull();
    expect(host.querySelector('#coach-preview')?.textContent?.trim()).toBe(
      'Thanks for the detail, Maya.',
    );

    next.next({
      items: [conversation({}, { messageId: 'm3', sequence: 4, body: 'Deload next week.' })],
      hasMore: false,
      nextBeforeActivityAtUtc: null,
      nextBeforeConversationId: null,
    });
    next.complete();
    await settle(fixture);
    expect(host.querySelector('#coach-preview')?.textContent?.trim()).toBe('Deload next week.');
  });

  it('keeps the card when a live re-read fails', async () => {
    const { fixture, host, listConversations, refreshes } = await render(page(conversation()));
    listConversations.mockReturnValue(throwError(() => new Error('offline')));

    refreshes.set(1);
    await settle(fixture);
    expect(host.querySelector('#coach-preview')?.textContent?.trim()).toBe(
      'Thanks for the detail, Maya.',
    );
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('reports a failure politely and retries', async () => {
    const { fixture, host, listConversations } = await render(throwError(() => new Error()));
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'Couldn’t load your coach’s latest message.',
    );

    listConversations.mockReturnValue(page(conversation()));
    press(host, 'Retry latest message');
    await settle(fixture);
    expect(host.querySelector('#coach-preview')).not.toBeNull();
  });
});
