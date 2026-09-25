import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decision } from '../../../testing/today-fixtures';
import { ApiClient } from '../api/api-client';
import type { FeatureAccessDecision, TenantMembership } from '../api/api.models';
import { AuthStore } from '../auth/auth.store';
import { TenantStore } from '../tenancy/tenant.store';
import { ClientAccessStore } from './client-access.store';

const CLIENT = { tenantId: 'tenant-1', tenantName: 'Atlas', role: 'Client' } as TenantMembership;
const OTHER = {
  tenantId: 'tenant-2',
  tenantName: 'Beirut Barbell',
  role: 'Client',
} as TenantMembership;
const COACH = { tenantId: 'tenant-3', tenantName: 'Own studio', role: 'Coach' } as TenantMembership;

function setup(read: () => unknown, membership: TenantMembership = CLIENT) {
  const selected = signal<TenantMembership | undefined>(membership);
  const getOwnFeatureAccess = vi.fn(read);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: { getOwnFeatureAccess } },
      { provide: AuthStore, useValue: { user: signal({ id: 'maya' }) } },
      {
        provide: TenantStore,
        useValue: {
          selectedMembership: selected,
          selectedTenantId: computed(() => selected()?.tenantId ?? null),
        },
      },
    ],
  });
  const store = TestBed.inject(ClientAccessStore);
  TestBed.tick();
  return { store, selected, getOwnFeatureAccess };
}

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
};

describe('ClientAccessStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reads the client’s decisions and treats only NoEntitlement as outside the plan', async () => {
    const { store } = setup(() =>
      of([
        decision('Training'),
        decision('Nutrition', 'NoEntitlement'),
        decision('Messaging', 'Paused'),
      ]),
    );
    await flush();

    expect(store.status()).toBe('loaded');
    expect(store.notInPlan('Nutrition')).toBe(true);
    expect(store.notInPlan('Messaging')).toBe(false);
    expect(store.notInPlan('Training')).toBe(false);
    expect(store.decision('Messaging')?.reason).toBe('Paused');
  });

  it('never calls anything outside the plan while the answer is unknown', async () => {
    const { store } = setup(() => throwError(() => new Error()));
    await flush();

    expect(store.status()).toBe('failed');
    expect(store.notInPlan('Nutrition')).toBe(false);
    expect(store.decision('Nutrition')).toBeNull();
  });

  it('asks nothing for a coach membership', async () => {
    const { store, getOwnFeatureAccess } = setup(() => of([]), COACH);
    await flush();

    expect(getOwnFeatureAccess).not.toHaveBeenCalled();
    expect(store.status()).toBe('idle');
  });

  it('clears on a workspace change and drops the previous workspace’s late reply', async () => {
    const late = new Subject<FeatureAccessDecision[]>();
    let calls = 0;
    const { store, selected } = setup(() => (calls++ === 0 ? late : of([decision('Nutrition')])));
    await flush();

    selected.set(OTHER);
    TestBed.tick();
    await flush();
    late.next([decision('Nutrition', 'NoEntitlement')]);
    late.complete();
    await flush();

    expect(store.notInPlan('Nutrition')).toBe(false);
    expect(store.decision('Nutrition')?.reason).toBe('Granted');
  });
});
