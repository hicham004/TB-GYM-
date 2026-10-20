import { PLATFORM_ID } from '@angular/core';
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

  /**
   * An ended session empties the memberships and keeps the choice, so the next sign-in lands in the
   * same workspace (audit WEB-8); signing out forgets it.
   */
  it('offers the remembered workspace again after unloading, and forgets it when cleared', async () => {
    const store = TestBed.inject(TenantStore);
    await store.load('workspace-b');

    store.unload();
    expect(store.memberships()).toEqual([]);
    expect(store.selectedTenantId()).toBeNull();
    expect(localStorage.getItem('tb-gym.active-tenant')).toBe('workspace-b');

    await store.load();
    expect(store.selectedTenantId()).toBe('workspace-b');

    store.clear();
    expect(localStorage.getItem('tb-gym.active-tenant')).toBeNull();
    await store.load();
    expect(store.selectedTenantId()).toBe('workspace-a');
  });

  it('drops a remembered workspace the account that signs in does not belong to', async () => {
    localStorage.setItem('tb-gym.active-tenant', 'workspace-of-someone-else');
    const store = TestBed.inject(TenantStore);
    store.unload();

    await store.load();

    expect(store.selectedTenantId()).toBe('workspace-a');
    expect(localStorage.getItem('tb-gym.active-tenant')).toBe('workspace-a');
  });

  // The homepage is rendered at build time (R6.2a), where there is no browser and no storage.
  it('remembers no workspace during the build-time render and touches no storage', async () => {
    localStorage.setItem('tb-gym.active-tenant', 'workspace-b');
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const store = TestBed.inject(TenantStore);

    expect(store.selectedTenantId()).toBeNull();
    await store.load();
    store.select('workspace-a');
    store.clear();

    expect(localStorage.getItem('tb-gym.active-tenant')).toBe('workspace-b');
  });
});
