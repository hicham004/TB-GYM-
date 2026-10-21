import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { type Observable, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle } from '../../../testing/dom';
import { BillingAccessApi } from './billing-access';
import { BillingBanner } from './billing-banner';
import type { BillingAccess } from './billing-access';

@Component({ template: '' })
class Page {}

async function render(
  access: BillingAccess,
  role: 'Owner' | 'Coach',
  getAccess: () => Observable<BillingAccess> = () => of(access),
) {
  const api = { getAccess: vi.fn(getAccess) };
  await TestBed.configureTestingModule({
    imports: [BillingBanner],
    providers: [
      provideRouter([
        { path: 'clients', component: Page },
        { path: 'training', component: Page },
      ]),
      { provide: BillingAccessApi, useValue: api },
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
  const router = TestBed.inject(Router);
  const go = async (url: string) => {
    await router.navigateByUrl(url);
    await settle(fixture);
  };
  return Object.assign(fixture.nativeElement as HTMLElement, { api, go });
}

const CLEAR: BillingAccess = { isReadOnly: false, hasOverdueInvoice: false, readOnlyFrom: null };

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
    expect(banner?.textContent).toContain('the owner can settle it');
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

  it('says an overdue invoice without a day when the server names none', async () => {
    const host = await render(
      { isReadOnly: false, hasOverdueInvoice: true, readOnlyFrom: null },
      'Owner',
    );

    const banner = host.querySelector('[data-billing-banner="overdue"]');
    expect(banner?.textContent?.replace(/\s+/g, ' ')).toContain(
      'A TB Gym invoice is overdue. Pay it to keep editing.',
    );
    expect(banner?.textContent).not.toContain('before');
  });

  describe('one read per page (audit UIQ-8)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('reads once when it starts, and not again as the pages change while the bill is in order', async () => {
      const host = await render(CLEAR, 'Owner');
      expect(host.api.getAccess).toHaveBeenCalledTimes(1);

      await host.go('/clients');
      await host.go('/training');

      expect(host.api.getAccess).toHaveBeenCalledTimes(1);
    });

    it('asks once while its read is on its way, whatever page arrives meanwhile', async () => {
      const readOnly: BillingAccess = {
        isReadOnly: true,
        hasOverdueInvoice: true,
        readOnlyFrom: '2026-08-15',
      };
      const answer = new Subject<BillingAccess>();
      let calls = 0;
      const host = await render(CLEAR, 'Owner', () => (calls++ === 0 ? answer : of(readOnly)));

      await host.go('/clients');
      expect(host.api.getAccess).toHaveBeenCalledTimes(1);

      answer.next(readOnly);
      answer.complete();
      await host.go('/training');
      expect(host.querySelector('[data-billing-banner="read-only"]')).not.toBeNull();
    });

    it('reads again on each page while it says something, so a recorded payment clears it', async () => {
      let access: BillingAccess = {
        isReadOnly: true,
        hasOverdueInvoice: true,
        readOnlyFrom: '2026-08-15',
      };
      const host = await render(access, 'Owner', () => of(access));
      expect(host.querySelector('[data-billing-banner="read-only"]')).not.toBeNull();

      access = CLEAR;
      await host.go('/clients');

      expect(host.api.getAccess).toHaveBeenCalledTimes(2);
      expect(host.querySelector('[data-billing-banner]')).toBeNull();
      await host.go('/training');
      expect(host.api.getAccess).toHaveBeenCalledTimes(2);
    });

    it('reads again on a page change once its answer is ten minutes old', async () => {
      const start = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
      const host = await render(CLEAR, 'Coach');

      clock.mockReturnValue(start + 9 * 60_000);
      await host.go('/clients');
      expect(host.api.getAccess).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(start + 10 * 60_000);
      await host.go('/training');
      expect(host.api.getAccess).toHaveBeenCalledTimes(2);
    });
  });
});
