import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle } from '../../../testing/dom';
import { BillingAccessApi } from './billing-access';
import { BillingBanner } from './billing-banner';
import type { BillingAccess } from './billing-access';

async function render(access: BillingAccess, role: 'Owner' | 'Coach') {
  await TestBed.configureTestingModule({
    imports: [BillingBanner],
    providers: [
      provideRouter([]),
      { provide: BillingAccessApi, useValue: { getAccess: vi.fn(() => of(access)) } },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          canCoach: computed(() => true),
          isOwner: computed(() => role === 'Owner'),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BillingBanner);
  await settle(fixture);
  return fixture.nativeElement as HTMLElement;
}

describe('BillingBanner', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('tells the owner the workspace is read-only and where to pay', async () => {
    const host = await render(
      { isReadOnly: true, hasOverdueInvoice: true, readOnlyFrom: '2026-08-15' },
      'Owner',
    );

    const banner = host.querySelector('[data-billing-banner="read-only"]');
    expect(banner?.textContent).toContain('read-only until the overdue TB Gym invoice is paid');
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe('/billing');
  });

  it('tells a coach only that it is read-only, without the bill', async () => {
    const host = await render(
      { isReadOnly: true, hasOverdueInvoice: false, readOnlyFrom: null },
      'Coach',
    );

    const banner = host.querySelector('[data-billing-banner="read-only"]');
    expect(banner?.textContent).toContain('the workspace owner can settle it');
    expect(banner?.querySelector('a')).toBeNull();
  });

  it('warns the owner before an overdue invoice locks anything', async () => {
    const host = await render(
      { isReadOnly: false, hasOverdueInvoice: true, readOnlyFrom: '2026-08-15' },
      'Owner',
    );

    expect(host.querySelector('[data-billing-banner="overdue"]')?.textContent).toContain(
      'Aug 15, 2026',
    );
  });

  it('says nothing while the bill is in order', async () => {
    const host = await render(
      { isReadOnly: false, hasOverdueInvoice: false, readOnlyFrom: null },
      'Owner',
    );

    expect(host.querySelector('[data-billing-banner]')).toBeNull();
  });
});
