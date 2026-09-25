import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ConversationLaunch } from '../messaging/conversation-launch';
import type { Conversation, MessagePreview } from '../messaging/messaging.models';
import { press, settle } from '../../../testing/dom';
import { fakeClientAccess } from '../../../testing/today-fixtures';
import { TodayCoachMessage } from './today-coach-message';

// 14:20 on the device's calendar day, whatever zone the test runs in.
const sentAt = new Date(2026, 8, 20, 14, 20).toISOString();

function conversation(
  overrides: Partial<Conversation> = {},
  message: Partial<MessagePreview> = {},
): Conversation {
  return {
    id: 'conversation-1',
    clientProfileId: 'maya',
    counterpart: { userId: 'hicham', displayName: 'Hicham Haddad', role: 'Coach' },
    unreadCount: 1,
    isAvailable: true,
    accessReason: 'Granted',
    isReadOnly: false,
    lastMessage: {
      messageId: 'm1',
      sequence: 2,
      senderUserId: 'hicham',
      isFromCaller: false,
      sentAtUtc: sentAt,
      body: 'Thanks for the detail, Maya.',
      isDeleted: false,
      deletionKind: null,
      ...message,
    },
    ...overrides,
  } as Conversation;
}

async function render(
  read: unknown,
  options: { today?: string | null; access?: ReturnType<typeof fakeClientAccess> } = {},
) {
  const listConversations = vi.fn(() => read);
  await TestBed.configureTestingModule({
    imports: [TodayCoachMessage],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: ApiClient, useValue: { listConversations } },
      { provide: ClientAccessStore, useValue: options.access ?? fakeClientAccess() },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(TodayCoachMessage);
  fixture.componentRef.setInput(
    'today',
    options.today === undefined ? '2026-09-20' : options.today,
  );
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    listConversations,
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

  it('prefixes the client’s own message and drops Unread', async () => {
    const { host } = await render(
      page(conversation({ unreadCount: 0 }, { isFromCaller: true, body: 'See you then.' })),
    );
    expect(host.querySelector('#coach-preview')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'You: See you then.',
    );
    expect(host.querySelector('app-status-label')).toBeNull();
  });

  it('says a removed message was removed and a closed conversation why', async () => {
    const removed = await render(page(conversation({}, { isDeleted: true, body: null })));
    expect(removed.host.querySelector('#coach-preview')?.textContent?.trim()).toBe(
      'Message removed',
    );
    TestBed.resetTestingModule();

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

  it('shows nothing without a message, or when messaging is not in the plan', async () => {
    const empty = await render(page());
    expect(empty.host.querySelector('section')).toBeNull();
    TestBed.resetTestingModule();

    const outside = await render(page(conversation()), {
      access: fakeClientAccess({ Messaging: 'NoEntitlement' }),
    });
    expect(outside.host.querySelector('section')).toBeNull();
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
