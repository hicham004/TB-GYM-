import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { TenantMembership } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle, text } from '../../../testing/dom';
import { Dashboard } from './dashboard';

async function render(memberships: TenantMembership[], selectedTenantId: string | null) {
  const selected = signal(selectedTenantId);
  const all = signal(memberships);
  const selectedMembership = computed(() =>
    all().find((membership) => membership.tenantId === selected()),
  );
  await TestBed.configureTestingModule({
    imports: [Dashboard],
    providers: [
      provideRouter([]),
      {
        provide: ApiClient,
        useValue: { getClients: vi.fn(() => of([])), getInvitations: vi.fn(() => of([])) },
      },
      { provide: AuthStore, useValue: { user: signal({ displayName: 'Dana' }) } },
      {
        provide: TenantStore,
        useValue: {
          memberships: all,
          selectedTenantId: selected,
          selectedMembership,
          canCoach: computed(() => false),
          isOwner: computed(() => false),
          isClient: computed(() => false),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Dashboard);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('Dashboard', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('explains plainly when the account has no workspace left', async () => {
    const { fixture, host } = await render([], null);

    expect(host.querySelector('[data-no-workspace]')).not.toBeNull();
    expect(text(fixture)).toContain('You are not part of a coaching space right now');
    expect(text(fixture)).toContain('ask your coach to send you a new invitation');
    expect(text(fixture)).not.toContain('No role here yet');
  });

  it('still asks to pick a workspace when the account has some but none is selected', async () => {
    const membership = {
      tenantId: 'tenant-1',
      tenantName: 'Studio',
      role: 'Client',
    } as TenantMembership;
    const { fixture, host } = await render([membership], null);

    expect(host.querySelector('[data-no-workspace]')).toBeNull();
    expect(text(fixture)).toContain('Choose another coaching space to continue.');
  });
});
