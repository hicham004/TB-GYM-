import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageUnreadStore } from '../messaging/message-unread.store';
import { NotificationStore } from '../notifications/notification.store';
import { TenantStore } from '../tenancy/tenant.store';
import { AuthStore } from './auth.store';
import { SessionActions } from './session-actions';

function setup() {
  const order: string[] = [];
  const logout = vi.fn(async () => void order.push('logout'));
  const select = vi.fn((tenantId: string | null) => void order.push(`select ${tenantId}`));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: AuthStore, useValue: { user: signal(null), logout } },
      { provide: TenantStore, useValue: { select } },
      {
        provide: NotificationStore,
        useValue: { clear: vi.fn(() => order.push('clear notifications')) },
      },
      {
        provide: MessageUnreadStore,
        useValue: { clear: vi.fn(() => order.push('clear messages')) },
      },
    ],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigateByUrl').mockImplementation(async (url) => {
    order.push(`navigate ${String(url)}`);
    return true;
  });
  return { actions: TestBed.inject(SessionActions), order, navigate };
}

describe('SessionActions', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('selects the workspace before landing on its home page', () => {
    const { actions, order } = setup();

    actions.switchWorkspace('tenant-2');

    expect(order).toEqual(['select tenant-2', 'navigate /']);
  });

  it('clears both unread counts before signing out, then goes to sign-in', async () => {
    const { actions, order } = setup();

    await actions.signOut();

    expect(order).toEqual([
      'clear notifications',
      'clear messages',
      'logout',
      'navigate /auth/sign-in',
    ]);
  });
});
