import { DOCUMENT } from '@angular/common';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import type { TenantMembership } from '../api/api.models';
import { CsrfService } from '../security/csrf.service';
import { TenantStore } from '../tenancy/tenant.store';
import { brandTokens } from './brand-theme';
import { WorkspaceBrandStore } from './workspace-brand.store';

const CEDAR: TenantMembership = {
  tenantId: 'tenant-cedar',
  tenantName: 'Cedar Strength',
  tenantSlug: 'cedar-strength',
  role: 'Client',
  brandColor: '#15233f',
  accentColor: '#ffb48c',
  logoAssetId: 'logo-cedar',
};

const PLAIN: TenantMembership = {
  tenantId: 'tenant-plain',
  tenantName: 'Plain Coaching',
  tenantSlug: 'plain-coaching',
  role: 'Coach',
};

interface Harness {
  store: WorkspaceBrandStore;
  membership: WritableSignal<TenantMembership | undefined>;
  access: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  root: HTMLElement;
}

function harness(start: TenantMembership | undefined = CEDAR): Harness {
  const membership = signal<TenantMembership | undefined>(start);
  const refresh = vi.fn(async () => undefined);
  const access = vi.fn((assetId: string) => of({ url: `/api/media/${assetId}/content` }));
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: { createMediaAccess: access } },
      { provide: CsrfService, useValue: { refresh } },
      { provide: TenantStore, useValue: { selectedMembership: membership } },
    ],
  });
  const store = TestBed.inject(WorkspaceBrandStore);
  return { store, membership, access, refresh, root: TestBed.inject(DOCUMENT).documentElement };
}

/** The effects, then the brand code's own import and the grant, have to run. */
async function settle(): Promise<void> {
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
  await new Promise((resolve) => setTimeout(resolve));
}

const inline = (root: HTMLElement, name: string) => root.style.getPropertyValue(name);

describe('WorkspaceBrandStore', () => {
  afterEach(() => {
    const root = TestBed.inject(DOCUMENT).documentElement;
    root.removeAttribute('style');
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('paints the workspace’s colours on the page, derived as the brand theme derives them', async () => {
    const { root } = harness();
    await settle();

    const tokens = brandTokens({ brand: '#15233f', accent: '#ffb48c' });
    expect(inline(root, '--tb-brand')).toBe(tokens['--tb-brand']);
    expect(inline(root, '--tb-accent')).toBe(tokens['--tb-accent']);
    expect(inline(root, '--tb-night')).toBe(tokens['--tb-night']);
  });

  it('leaves the stylesheet’s TB Gym colours alone for a workspace without a brand', async () => {
    const { root } = harness(PLAIN);
    await settle();

    expect(inline(root, '--tb-brand')).toBe('');
  });

  it('returns to TB Gym’s colours on a TB Gym screen, after switching workspace and signing out', async () => {
    const { store, membership, root } = harness();
    await settle();
    expect(inline(root, '--tb-brand')).not.toBe('');

    store.useHouseBrand(true);
    await settle();
    expect(inline(root, '--tb-brand')).toBe('');

    store.useHouseBrand(false);
    await settle();
    expect(inline(root, '--tb-brand')).not.toBe('');

    membership.set(PLAIN);
    await settle();
    expect(inline(root, '--tb-brand')).toBe('');

    membership.set(CEDAR);
    await settle();
    membership.set(undefined);
    await settle();
    expect(inline(root, '--tb-brand')).toBe('');
  });

  it('names the space and grants its logo with a fresh security token first', async () => {
    const { store, access, refresh } = harness();
    await settle();

    expect(store.name()).toBe('Cedar Strength');
    expect(refresh).toHaveBeenCalled();
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(access.mock.invocationCallOrder[0]);
    expect(access).toHaveBeenCalledWith('logo-cedar');
    expect(store.logoUrl()).toBe('/api/media/logo-cedar/content');
  });

  it('shows no logo without one, and never another workspace’s', async () => {
    const { store, membership, access } = harness(PLAIN);
    await settle();
    expect(store.logoUrl()).toBeNull();
    expect(access).not.toHaveBeenCalled();

    membership.set(CEDAR);
    await settle();
    expect(store.logoUrl()).toBe('/api/media/logo-cedar/content');

    membership.set({ ...PLAIN, logoAssetId: 'logo-plain' });
    // Until the new grant arrives, the old workspace's logo is not shown.
    TestBed.tick();
    expect(store.logoUrl()).toBeNull();
    await settle();
    expect(store.logoUrl()).toBe('/api/media/logo-plain/content');
  });

  it('asks for a fresh grant once when the image breaks, then gives up on it', async () => {
    const { store, access } = harness();
    await settle();
    expect(access).toHaveBeenCalledTimes(1);

    store.logoFailed();
    await settle();
    expect(access).toHaveBeenCalledTimes(2);
    expect(store.logoUrl()).toBe('/api/media/logo-cedar/content');

    store.logoFailed();
    await settle();
    expect(access).toHaveBeenCalledTimes(2);
    expect(store.logoUrl()).toBeNull();
  });

  it('falls back to the initials when the logo cannot be granted', async () => {
    const { store, access } = harness();
    access.mockReturnValue(throwError(() => new Error('offline')));
    await settle();

    expect(store.logoUrl()).toBeNull();
  });
});
