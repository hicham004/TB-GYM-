import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FoundingBadgeState } from '../../core/api/generated';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle } from '../../../testing/dom';
import { BillingAccessApi, type BillingAccess } from '../billing/billing-access';
import { SettingsFoundingMemo, SettingsFrame } from './settings-frame';

@Component({
  imports: [SettingsFrame],
  template: `<app-settings-frame
    ><h1 settingsHead>A Settings page</h1>
    <p>Its body</p></app-settings-frame
  >`,
})
class Page {}

const access = (foundingCoach: FoundingBadgeState | null): BillingAccess => ({
  isReadOnly: false,
  hasOverdueInvoice: false,
  readOnlyFrom: null,
  foundingCoach,
});

function configure(role: 'Owner' | 'Coach' | 'Client', getAccess: () => Observable<BillingAccess>) {
  const api = { getAccess: vi.fn(getAccess) };
  TestBed.configureTestingModule({
    imports: [Page],
    providers: [
      provideRouter([]),
      { provide: BillingAccessApi, useValue: api },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantId: 'tenant-1', role }),
        },
      },
    ],
  });
  return api;
}

async function open() {
  const fixture = TestBed.createComponent(Page);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const accountLinks = (host: HTMLElement) =>
  Array.from(
    host.querySelectorAll('[aria-labelledby="settings-group-account"] a'),
    (link) => [link.textContent?.trim(), link.getAttribute('href')] as const,
  );

describe('The Settings frame and the Founding coach page (notes plan N3b)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists the owner’s Founding coach page last when the server says their space is founding', async () => {
    const api = configure('Owner', () => of(access('Earned')));
    const { host } = await open();

    expect(api.getAccess).toHaveBeenCalledTimes(1);
    expect(accountLinks(host)).toEqual([
      ['Notifications', '/notifications/settings'],
      ['Appearance', '/account/appearance'],
      ['Password and security', '/account/security'],
      ['Founding coach', '/account/founding'],
    ]);
  });

  it('lists it while the badge waits too, and never once the status ended or for none', async () => {
    configure('Owner', () => of(access('Waiting')));
    expect(accountLinks((await open()).host).at(-1)).toEqual([
      'Founding coach',
      '/account/founding',
    ]);
    TestBed.resetTestingModule();

    for (const state of ['Ended', 'NotFounding', null] as const) {
      configure('Owner', () => of(access(state)));
      expect(accountLinks((await open()).host).map(([label]) => label)).not.toContain(
        'Founding coach',
      );
      TestBed.resetTestingModule();
    }
  });

  it('never asks for a coach or a client', async () => {
    const coach = configure('Coach', () => of(access('Earned')));
    const { host } = await open();
    expect(coach.getAccess).not.toHaveBeenCalled();
    expect(accountLinks(host).map(([label]) => label)).not.toContain('Founding coach');
    TestBed.resetTestingModule();

    const client = configure('Client', () => of(access('Earned')));
    await open();
    expect(client.getAccess).not.toHaveBeenCalled();
  });

  it('leaves the row out when the server cannot be read', async () => {
    configure('Owner', () => throwError(() => new HttpErrorResponse({ status: 500 })));
    const { host } = await open();

    expect(accountLinks(host).map(([label]) => label)).toEqual([
      'Notifications',
      'Appearance',
      'Password and security',
    ]);
  });

  it('takes the row away at once when the founding page learns the status ended', async () => {
    configure('Owner', () => of(access('Earned')));
    const { fixture, host } = await open();
    expect(accountLinks(host).at(-1)?.[0]).toBe('Founding coach');

    TestBed.inject(SettingsFoundingMemo).write(
      'tenant-1',
      TestBed.inject(TenantContext).epoch(),
      'Ended',
    );
    await settle(fixture);

    expect(accountLinks(host).map(([label]) => label)).not.toContain('Founding coach');
  });

  it('draws the row at once on the next Settings page while it asks again', async () => {
    const later = new Subject<BillingAccess>();
    let reads = 0;
    configure('Owner', () => (++reads === 1 ? of(access('Earned')) : later));
    const first = await open();
    first.fixture.destroy();

    const second = await open();
    expect(reads).toBe(2);
    expect(accountLinks(second.host).at(-1)?.[0]).toBe('Founding coach');

    // The server's newer word wins: the status ended meanwhile.
    later.next(access(null));
    later.complete();
    await settle(second.fixture);
    expect(accountLinks(second.host).map(([label]) => label)).not.toContain('Founding coach');
  });
});
