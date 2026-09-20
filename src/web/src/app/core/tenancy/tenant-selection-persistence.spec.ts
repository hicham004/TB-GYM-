import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { CurrentUser, TenantMembership } from '../api/api.models';
import { AuthStore } from '../auth/auth.store';
import { TenantStore } from './tenant.store';

const storageKey = 'tb-gym.active-tenant';

const coach: CurrentUser = {
  id: 'user-coach',
  email: 'coach@example.test',
  displayName: 'Coach',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

const otherCoach: CurrentUser = { ...coach, id: 'user-other', email: 'other@example.test' };

// `/api/tenants` returns "Shared Business" first, so falling back to memberships[0] is visible:
// it lands on a workspace the coach did not choose.
const memberships: TenantMembership[] = [
  {
    tenantId: 'workspace-b',
    tenantName: 'Shared Business',
    tenantSlug: 'shared-business',
    role: 'Coach',
  },
  { tenantId: 'workspace-a', tenantName: 'Solo Coach', tenantSlug: 'solo-coach', role: 'Owner' },
];

function configure(user: CurrentUser | 'unauthenticated'): {
  getTenants: ReturnType<typeof vi.fn>;
} {
  const getTenants = vi.fn(() => of(memberships));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getCsrfToken: vi.fn(() => of({ token: 'csrf' })),
          getCurrentUser: vi.fn(() =>
            user === 'unauthenticated' ? throwError(() => new Error('unauthenticated')) : of(user),
          ),
          getTenants,
        },
      },
    ],
  });
  return { getTenants };
}

describe('active workspace persistence across a cold load', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps the stored workspace when the session loads for the first time', async () => {
    // A cold load has no previously loaded user. That is not "somebody else signed in", so the
    // coach's own choice has to survive the refresh.
    localStorage.setItem(storageKey, 'workspace-a');
    configure(coach);

    const auth = TestBed.inject(AuthStore);
    await auth.initialize();

    const tenants = TestBed.inject(TenantStore);
    expect(tenants.selectedTenantId()).toBe('workspace-a');
    expect(localStorage.getItem(storageKey)).toBe('workspace-a');
  });

  it('falls back to the first membership when the stored workspace is no longer one', async () => {
    localStorage.setItem(storageKey, 'workspace-lost-access');
    configure(coach);

    const auth = TestBed.inject(AuthStore);
    await auth.initialize();

    const tenants = TestBed.inject(TenantStore);
    expect(tenants.selectedTenantId()).toBe('workspace-b');
    expect(localStorage.getItem(storageKey)).toBe('workspace-b');
  });

  it('clears the stored workspace when a different user loads a session', async () => {
    localStorage.setItem(storageKey, 'workspace-a');
    configure(coach);

    const auth = TestBed.inject(AuthStore);
    await auth.initialize();
    expect(TestBed.inject(TenantStore).selectedTenantId()).toBe('workspace-a');

    const api = TestBed.inject(ApiClient) as unknown as {
      getCurrentUser: ReturnType<typeof vi.fn>;
    };
    api.getCurrentUser.mockReturnValue(of(otherCoach));
    await auth.initialize(true);

    // The previous user's selection must not be inherited: the fallback runs instead.
    expect(TestBed.inject(TenantStore).selectedTenantId()).toBe('workspace-b');
    expect(localStorage.getItem(storageKey)).toBe('workspace-b');
  });

  it('clears the stored workspace when the session fails to load', async () => {
    localStorage.setItem(storageKey, 'workspace-a');
    configure('unauthenticated');

    await TestBed.inject(AuthStore).initialize();

    expect(TestBed.inject(TenantStore).selectedTenantId()).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
