import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ConversationDetail } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ConversationLaunch } from './conversation-launch';
import { ConversationStarter } from './conversation-starter';

@Component({ selector: 'app-messages-stub', template: 'messages' })
class MessagesStub {}

/** The chat as the server answers it, started or found (it answers the existing one when there is one). */
function detail(clientProfileId: string): ConversationDetail {
  return {
    conversation: {
      id: `conversation-${clientProfileId}`,
      clientProfileId,
      counterpart: { userId: `user-${clientProfileId}`, displayName: 'Jad Karam', role: 'Client' },
      callerRole: 'Coach',
      canModerate: true,
      startedAtUtc: '2026-10-01T08:00:00Z',
      lastActivityAtUtc: '2026-10-01T08:00:00Z',
      lastSequence: '0',
      unreadCount: '0',
      lastReadSequence: '0',
      lastReadAtUtc: null,
      isAvailable: true,
      accessReason: 'Granted',
      lastMessage: null,
    },
    readState: {
      conversationId: `conversation-${clientProfileId}`,
      userId: 'coach-1',
      role: 'Coach',
      lastReadSequence: '0',
      lastReadAtUtc: null,
      unreadCount: '0',
      latestSequence: '0',
    },
  };
}

function setup(createDirectConversation: ReturnType<typeof vi.fn>) {
  const tenant = signal<string | null>('tenant-1');
  const refresh = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'messages', component: MessagesStub }]),
      { provide: ApiClient, useValue: { createDirectConversation } },
      { provide: CsrfService, useValue: { refresh } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  });
  return { starter: TestBed.inject(ConversationStarter), tenant, refresh };
}

describe('ConversationStarter', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts the chat with a fresh token, hands it to Messages and opens it', async () => {
    const create = vi.fn(() => of(detail('c-jad')));
    const { starter, refresh } = setup(create);

    expect(await starter.open('c-jad')).toBe(true);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('c-jad', expect.any(String));
    expect(TestBed.inject(Router).url).toBe('/messages');
    expect(TestBed.inject(ConversationLaunch).take('tenant-1')).toMatchObject({
      id: 'conversation-c-jad',
      clientProfileId: 'c-jad',
    });
  });

  it('retries a failed start as the same command, and gives each client a command of their own', async () => {
    const create = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValue(of(detail('c-jad')));
    const { starter } = setup(create);

    await expect(starter.open('c-jad')).rejects.toThrow('offline');
    await starter.open('c-jad');
    await starter.open('c-sara');

    const [first, retry, other] = create.mock.calls;
    expect(retry).toEqual(first);
    expect(other[0]).toBe('c-sara');
    // A key is bound to its command: another client's start never reuses it.
    expect(other[1]).not.toBe(first[1]);
  });

  it('opens nothing for a workspace the coach has left meanwhile', async () => {
    const create = vi.fn(() => of(detail('c-jad')));
    const { starter, tenant, refresh } = setup(create);
    refresh.mockImplementation(async () => tenant.set('tenant-2'));

    expect(await starter.open('c-jad')).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(TestBed.inject(ConversationLaunch).take('tenant-1')).toBeNull();
  });
});
