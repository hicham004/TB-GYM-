import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AuthStore } from './core/auth/auth.store';
import { TenantStore } from './core/tenancy/tenant.store';
import { settle } from '../testing/dom';

const OWNER = {
  id: 'user-1',
  email: 'coach@example.test',
  displayName: 'Tarek Bou',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

const MEMBERSHIP = {
  tenantId: 'tenant-1',
  tenantName: 'TB Gym',
  tenantSlug: 'tb-gym',
  role: 'Owner' as const,
};

async function render(options: { signedIn?: boolean; owner?: boolean } = {}) {
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([]),
      {
        provide: AuthStore,
        useValue: {
          user: signal(options.signedIn ? OWNER : null),
          loading: signal(false),
          initialize: vi.fn().mockResolvedValue(undefined),
          logout: vi.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: TenantStore,
        useValue: {
          memberships: signal(options.signedIn ? [MEMBERSHIP] : []),
          selectedTenantId: signal(options.signedIn ? 'tenant-1' : null),
          selectedMembership: signal(options.signedIn ? MEMBERSHIP : undefined),
          canCoach: signal(Boolean(options.owner)),
          isOwner: signal(Boolean(options.owner)),
          isClient: signal(false),
          select: vi.fn(),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(App);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('App', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('creates the application shell', async () => {
    const { fixture, host } = await render();

    expect(fixture.componentInstance).toBeTruthy();
    expect(host.querySelector('.brand')?.textContent).toContain('TB Gym');
  });

  /**
   * The owner navigation carries a "Workspace" link to the settings page, and the session controls
   * carry a workspace picker. Both captions read "Workspace", so an owner saw the word twice side
   * by side in the topbar with no way to tell which was which.
   */
  it('names the workspace picker apart from the workspace nav link', async () => {
    const { host } = await render({ signedIn: true, owner: true });

    expect(host.querySelector('nav a[href="/workspace"]')?.textContent?.trim()).toBe('Workspace');
    expect(host.querySelector('.workspace-picker span')?.textContent?.trim()).toBe(
      'Active workspace',
    );

    // No two captions in the topbar say the same thing.
    const captions = Array.from(
      host.querySelectorAll('.authenticated-nav nav a, .authenticated-nav .workspace-picker span'),
    ).map((element) => element.textContent?.trim());
    expect(new Set(captions).size).toBe(captions.length);
  });

  it('offers the picker every workspace the user belongs to', async () => {
    const { host } = await render({ signedIn: true, owner: true });

    const options = Array.from(
      host.querySelectorAll<HTMLOptionElement>('.workspace-picker option'),
    );
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('TB Gym');
  });
});
