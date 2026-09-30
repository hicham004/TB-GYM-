import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantMembership } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionActions } from '../../core/auth/session-actions';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, settle } from '../../../testing/dom';
import { ClientAccount } from './client-account';

// `/api/tenants` orders by workspace name, so the selected workspace is deliberately not the first.
const ALPHA = {
  tenantId: 'tenant-alpha',
  tenantName: 'Alpha Strength',
  role: 'Client',
} as TenantMembership;
const ATLAS = {
  tenantId: 'tenant-atlas',
  tenantName: 'Atlas Performance',
  role: 'Client',
} as TenantMembership;

async function render(memberships: TenantMembership[], roles: string[] = []) {
  const session = { switchWorkspace: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) };
  await TestBed.configureTestingModule({
    imports: [ClientAccount],
    providers: [
      provideRouter([]),
      { provide: SessionActions, useValue: session },
      {
        provide: AuthStore,
        useValue: {
          user: signal({
            id: 'maya',
            displayName: 'Maya Rahman',
            email: 'maya@example.test',
            roles,
          }),
        },
      },
      {
        provide: TenantStore,
        useValue: { memberships: signal(memberships), selectedTenantId: signal('tenant-atlas') },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ClientAccount);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, session };
}

describe('ClientAccount', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('names the account and links its settings', async () => {
    const { host } = await render([ATLAS]);

    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Me');
    expect(host.textContent).toContain('Maya Rahman');
    expect(host.querySelector('app-avatar')?.textContent?.trim()).toBe('MR');
    const links = [...host.querySelectorAll('nav a')].map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      '/profile',
      '/account/security',
      '/account/appearance',
      '/notifications/settings',
      '/progress',
    ]);
    expect(host.textContent).not.toContain('account menu above');
  });

  it('offers no workspace list to a client with one workspace', async () => {
    const { host } = await render([ATLAS]);
    expect(host.textContent).not.toContain('Workspaces');
  });

  it('marks the open workspace and switches to another through the shared path', async () => {
    const { fixture, host, session } = await render([ALPHA, ATLAS]);

    const current = host.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain('Atlas Performance');
    expect(current?.tagName).toBe('P');
    press(host, 'Switch to Alpha Strength, Client');
    await settle(fixture);

    expect(session.switchWorkspace).toHaveBeenCalledWith('tenant-alpha');
  });

  it('signs out through the shared sequence', async () => {
    const { fixture, host, session } = await render([ATLAS]);

    press(host, 'Sign out');
    await settle(fixture);

    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it('links platform billing only for a platform admin', async () => {
    const admin = await render([ATLAS], ['PlatformAdmin']);
    expect(admin.host.querySelector('a[href="/admin/billing"]')).not.toBeNull();
    TestBed.resetTestingModule();

    const client = await render([ATLAS]);
    expect(client.host.querySelector('a[href="/admin/billing"]')).toBeNull();
  });
});
