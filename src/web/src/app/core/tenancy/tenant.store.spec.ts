import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { TenantMembership } from '../api/api.models';
import { TenantStore } from './tenant.store';

describe('TenantStore', () => {
  const memberships: TenantMembership[] = [
    {
      tenantId: 'workspace-a',
      tenantName: 'Solo Coach',
      tenantSlug: 'solo-coach',
      role: 'Owner',
    },
    {
      tenantId: 'workspace-b',
      tenantName: 'Shared Business',
      tenantSlug: 'shared-business',
      role: 'Coach',
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        TenantStore,
        {
          provide: ApiClient,
          useValue: { getTenants: vi.fn(() => of(memberships)) },
        },
      ],
    });
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('selects a preferred membership and derives workspace permissions', async () => {
    const store = TestBed.inject(TenantStore);

    await store.load('workspace-b');

    expect(store.selectedTenantId()).toBe('workspace-b');
    expect(store.selectedMembership()?.role).toBe('Coach');
    expect(store.canCoach()).toBe(true);
    expect(store.isOwner()).toBe(false);
    expect(localStorage.getItem('tb-gym.active-tenant')).toBe('workspace-b');
  });

  it('rejects selection of a workspace without membership', async () => {
    const store = TestBed.inject(TenantStore);
    await store.load('workspace-a');

    store.select('workspace-outside-account');

    expect(store.selectedTenantId()).toBe('workspace-a');
  });
});
