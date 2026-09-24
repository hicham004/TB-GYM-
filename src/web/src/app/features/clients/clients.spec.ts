import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ClientSummary } from '../../core/api/api.models';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { query, settle } from '../../../testing/dom';
import { Clients } from './clients';
import { FormerClientsApi } from './former-clients-api';

function client(overrides: Partial<ClientSummary> = {}): ClientSummary {
  return {
    id: 'client-1',
    firstName: 'Rana',
    lastName: 'Haddad',
    email: 'rana@example.test',
    phoneNumber: '+96170123456',
    onboardingStatus: 'Completed',
    isCoachBlocked: false,
    version: 1,
    assignedCoachUserId: 'owner-1',
    assignedCoachName: 'Olivia Owner',
    ...overrides,
  };
}

async function render(
  api: Partial<ApiClient> = {},
  tenantId: string | null = 'tenant-1',
  options: { isOwner?: boolean; view?: 'former'; former?: Partial<FormerClientsApi> } = {},
) {
  await TestBed.configureTestingModule({
    imports: [Clients],
    providers: [
      provideRouter([]),
      ...(options.view
        ? [{ provide: ActivatedRoute, useValue: { snapshot: { data: { view: options.view } } } }]
        : []),
      { provide: ApiClient, useValue: { getClients: vi.fn(() => of([client()])), ...api } },
      {
        provide: FormerClientsApi,
        useValue: { getFormerClients: vi.fn(() => of([])), ...options.former },
      },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: signal(tenantId), isOwner: signal(options.isOwner ?? false) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Clients);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

describe('Clients', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** ADR 0027: the owner switches between current and former clients; a coach has one list. */
  it('offers the former-clients list to the owner only', async () => {
    const { host } = await render({}, 'tenant-1', { isOwner: true });
    const links = Array.from(host.querySelectorAll('app-section-nav a')).map((link) => ({
      text: link.textContent?.trim(),
      href: link.getAttribute('href'),
    }));
    expect(links).toEqual([
      { text: 'Current clients', href: '/clients' },
      { text: 'Former clients', href: '/clients/former' },
    ]);

    TestBed.resetTestingModule();
    const coach = await render();
    expect(coach.host.querySelector('app-section-nav')).toBeNull();
  });

  it('lists former clients with when and why they were released', async () => {
    const getFormerClients = vi.fn(() =>
      of([
        {
          id: 'client-9',
          firstName: 'Omar',
          lastName: 'Nasr',
          email: 'omar@example.test',
          releasedAtUtc: '2026-09-20T10:00:00Z',
          reason: 'Followed his coach to another gym',
        },
      ]),
    );
    const getClients = vi.fn(() => of([client()]));
    const { host } = await render({ getClients }, 'tenant-1', {
      isOwner: true,
      view: 'former',
      former: { getFormerClients },
    });

    expect(getFormerClients).toHaveBeenCalledTimes(1);
    expect(getClients).not.toHaveBeenCalled();
    expect(host.querySelector('h1')?.textContent).toContain('Former clients');
    expect(host.textContent).toContain('Omar Nasr');
    expect(host.textContent).toContain('Followed his coach to another gym');
    expect(host.textContent).toContain('Sep 20, 2026');
    expect(query<HTMLAnchorElement>(host, 'tbody a').getAttribute('href')).toBe(
      '/clients/client-9',
    );
  });

  it('lists each client with a link into their profile', async () => {
    const { host } = await render();

    expect(host.textContent).toContain('Rana Haddad');
    expect(host.textContent).toContain('rana@example.test');
    expect(host.textContent).toContain('+96170123456');
    expect(query<HTMLAnchorElement>(host, 'tbody a').getAttribute('href')).toContain('client-1');
  });

  /** The block gates every other feature, so the list has to say which state each client is in. */
  it('distinguishes a blocked client from an active one', async () => {
    const { host } = await render({
      getClients: vi.fn(() =>
        of([
          client(),
          client({ id: 'client-2', firstName: 'Omar', lastName: 'Nasr', isCoachBlocked: true }),
        ]),
      ),
    });

    const access = Array.from(host.querySelectorAll('tbody tr')).map((row) =>
      row.querySelectorAll('td')[3].textContent?.trim(),
    );
    expect(access).toEqual(['Active', 'Blocked']);
  });

  it('shows an unfinished onboarding as unfinished rather than as complete', async () => {
    const { host } = await render({
      getClients: vi.fn(() => of([client({ onboardingStatus: 'InProgress' })])),
    });

    expect(host.textContent).toContain('In progress');
    expect(host.textContent).not.toContain('Completed');
  });

  it('says a client has no phone number instead of leaving the cell blank', async () => {
    const { host } = await render({
      getClients: vi.fn(() => of([client({ phoneNumber: null })])),
    });

    expect(host.querySelectorAll('tbody td')[1].textContent?.trim()).toBe('-');
  });

  it('invites the first client when the workspace has none', async () => {
    const { host } = await render({ getClients: vi.fn(() => of([])) });

    expect(host.textContent).toContain('No accepted clients yet');
    expect(host.querySelector('tbody')).toBeNull();
  });

  /** A failed load is not an empty workspace, and saying so would misreport the coach's roster. */
  it('reports a failed load instead of claiming there are no clients', async () => {
    const { host } = await render({
      getClients: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain('Clients could not be loaded.');
  });

  it('asks for nothing until a workspace is selected', async () => {
    const { api } = await render({}, null);

    expect(api.getClients).not.toHaveBeenCalled();
  });
});
