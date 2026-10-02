import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormerClient } from '../../core/api/api.models';
import type { ClientOverviewView } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { COACH_NOW, OWNER_ID } from '../../../testing/coach-today-fixtures';
import { clientListView } from '../../../testing/client-list-fixtures';
import { click, fill, press, query, settle, tick } from '../../../testing/dom';
import { ClientListApi } from './client-list-api';
import { Clients } from './clients';
import { FormerClientsApi } from './former-clients-api';

const OMAR: FormerClient = {
  id: 'client-9',
  firstName: 'Omar',
  lastName: 'Nasr',
  email: 'omar@example.test',
  releasedAtUtc: '2026-09-20T10:00:00Z',
  reason: 'Followed his coach to another gym',
  departureKind: 'LeftByClient',
};

async function render(
  options: {
    url?: string;
    tenantId?: string | null;
    isOwner?: boolean;
    getOverview?: () => unknown;
    getFormerClients?: () => unknown;
  } = {},
) {
  vi.useFakeTimers({ now: new Date(COACH_NOW), toFake: ['Date'] });
  const tenantId = signal(options.tenantId === undefined ? 'tenant-1' : options.tenantId);
  const listApi = { getOverview: vi.fn(options.getOverview ?? (() => of(clientListView()))) };
  const formerApi = { getFormerClients: vi.fn(options.getFormerClients ?? (() => of([OMAR]))) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'clients', component: Clients },
        { path: 'clients/former', component: Clients, data: { view: 'former' } },
      ]),
      { provide: ClientListApi, useValue: listApi },
      { provide: FormerClientsApi, useValue: formerApi },
      { provide: AuthStore, useValue: { user: signal({ id: OWNER_ID }) } },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: tenantId, isOwner: signal(options.isOwner ?? false) },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(options.url ?? '/clients');
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    listApi,
    formerApi,
    tenantId,
  };
}

function names(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('li.client-row .name')).map(
    (link) => link.textContent?.trim() ?? '',
  );
}

function row(host: HTMLElement, name: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('li.client-row')).find(
    (item) => item.querySelector('.name')?.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No row for ${name}.`);
  return found;
}

function squash(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

describe('Clients', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('lists everyone with a face, goal, status and the whole row as a link', async () => {
    const { host } = await render();

    expect(names(host)).toHaveLength(12);
    const maya = row(host, 'Maya Fakhoury');
    expect(squash(maya.querySelector('app-avatar')?.textContent)).toBe('MF');
    expect(maya.querySelector('.goal')?.textContent).toContain('wedding in December');
    expect(squash(maya.querySelector('app-status-pill')?.textContent)).toBe('Needs attention');
    expect(squash(maya.querySelector('.reasons')?.textContent)).toBe('Check-in to review');
    expect(squash(maya.querySelector('.activity')?.textContent)).toBe('Trained 2 hours ago');
    expect(squash(maya.querySelector('.week')?.textContent)).toContain(
      '3 of 4 sessions done in the last 7 days',
    );
    expect(squash(maya.querySelector('.plan')?.textContent)).toBe('Plan ends Sun 20 Dec');
    // One link per row, on the name; its overlay makes the whole row clickable.
    expect(maya.querySelectorAll('a')).toHaveLength(1);
    expect(query<HTMLAnchorElement>(maya, 'a.name').getAttribute('href')).toBe('/clients/c-maya');
    expect(squash(query(host, '.lede').textContent)).toBe('12 clients · 6 need attention');
  });

  it('shows none of the old columns: phone, onboarding or an "Open profile" link', async () => {
    const { host } = await render();

    expect(host.textContent).not.toContain('Open profile');
    expect(host.textContent).not.toContain('Onboarding');
    expect(host.textContent).not.toContain('Phone');
  });

  it("names the coach on a team member's client only", async () => {
    const { host } = await render({ isOwner: true });

    expect(squash(row(host, 'Maya Fakhoury').querySelector('.coach')?.textContent)).toBe(
      'Coached by Lea Khoury',
    );
    expect(row(host, 'Rami Tabet').querySelector('.coach')).toBeNull();
  });

  it('says when training is not in the plan instead of drawing an empty week', async () => {
    const { host } = await render();

    const elie = row(host, 'Elie Azar');
    expect(elie.querySelector('.strip')).toBeNull();
    expect(squash(elie.querySelector('.week')?.textContent)).toBe('Training not in plan');
  });

  it('narrows the list with a chip, keeps it in the address and says how many show', async () => {
    const { host, harness } = await render();

    const chips = Array.from(host.querySelectorAll('.chip')).map((chip) =>
      squash(chip.textContent),
    );
    expect(chips).toEqual(['All 12', 'Needs attention 6', 'Ending soon 2', 'Paused 1', 'New 2']);

    tick(host, 'Ending soon');
    await settle(harness.fixture);

    expect(names(host)).toEqual(['Rita Daher', 'Sara Mansour']);
    expect(TestBed.inject(Router).url).toBe('/clients?show=ending');
    expect(squash(query(host, '[role="status"]').textContent)).toBe('Showing 2 of 12 clients');
  });

  it('opens on the chip named in the address, so Back returns to the same list', async () => {
    const { host } = await render({ url: '/clients?show=paused' });

    expect(names(host)).toEqual(['Karl Saade']);
    expect(query<HTMLInputElement>(host, 'input[value="paused"]').checked).toBe(true);
  });

  it('searches names and goals within the chosen chip', async () => {
    const { host, harness } = await render({ url: '/clients?show=attention' });

    fill(host, 'Search clients', 'pull-up');
    await settle(harness.fixture);
    expect(names(host)).toEqual(['Nour Hamdan']);

    click(host, 'button[aria-label="Clear search"]');
    await settle(harness.fixture);
    expect(names(host)).toHaveLength(6);
  });

  it('offers the one action that brings rows back when nothing matches', async () => {
    const { host, harness } = await render();

    fill(host, 'Search clients', 'zzz');
    await settle(harness.fixture);
    expect(names(host)).toEqual([]);
    expect(host.querySelector('app-empty-state h2')?.textContent).toContain(
      'No client matches “zzz”',
    );
    press(host, 'Clear search');
    await settle(harness.fixture);
    expect(names(host)).toHaveLength(12);

    const view = clientListView();
    view.clients = view.clients.filter((client) => client.planState !== 'Paused');
    TestBed.resetTestingModule();
    const unpaused = await render({ url: '/clients?show=paused', getOverview: () => of(view) });
    expect(unpaused.host.querySelector('app-empty-state h2')?.textContent).toContain(
      'No plan is paused',
    );
    press(unpaused.host, 'Show all clients');
    await settle(unpaused.harness.fixture);
    expect(names(unpaused.host)).toHaveLength(11);
  });

  it('invites the first client when the coach has none', async () => {
    const { host } = await render({ getOverview: () => of(clientListView({ clients: [] })) });

    expect(host.textContent).toContain('No clients yet');
    expect(query<HTMLAnchorElement>(host, '[empty-state-action]').getAttribute('href')).toBe(
      '/invitations',
    );
    expect(host.querySelector('.chips')).toBeNull();
  });

  /** A failed load is not an empty workspace, and saying so would misreport the coach's roster. */
  it('reports a failed load and tries again on request', async () => {
    let fail = true;
    const { host, harness, listApi } = await render({
      getOverview: () =>
        fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(clientListView()),
    });

    expect(squash(query(host, '[role="alert"]').textContent)).toBe(
      'Clients could not be loaded. Check your connection and try again.',
    );
    expect(host.textContent).not.toContain('No clients yet');

    fail = false;
    press(host, 'Try again');
    await settle(harness.fixture);
    expect(listApi.getOverview).toHaveBeenCalledTimes(2);
    expect(names(host)).toHaveLength(12);
  });

  it('asks for nothing until a workspace is selected', async () => {
    const { listApi } = await render({ tenantId: null });

    expect(listApi.getOverview).not.toHaveBeenCalled();
  });

  /** A reply for the workspace the coach just left must never list that workspace's clients. */
  it('drops a late reply from the previous workspace and reloads for the new one', async () => {
    const late = new Subject<ClientOverviewView>();
    let calls = 0;
    const { host, harness, tenantId } = await render({
      getOverview: () => (++calls === 1 ? late : of(clientListView({ clients: [] }))),
    });

    tenantId.set('tenant-2');
    await settle(harness.fixture);
    late.next(clientListView());
    late.complete();
    await settle(harness.fixture);

    expect(names(host)).toEqual([]);
    expect(host.textContent).toContain('No clients yet');
  });

  /** ADR 0027: the owner switches between current and former clients; a coach has one list. */
  it('offers the former-clients list to the owner only', async () => {
    const { host } = await render({ isOwner: true });
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

  it('lists former clients with when, how and why coaching ended', async () => {
    const { host, listApi, formerApi } = await render({ url: '/clients/former', isOwner: true });

    expect(formerApi.getFormerClients).toHaveBeenCalledTimes(1);
    expect(listApi.getOverview).not.toHaveBeenCalled();
    expect(host.querySelector('h1')?.textContent).toContain('Former clients');
    const omar = row(host, 'Omar Nasr');
    expect(squash(omar.querySelector('.goal')?.textContent)).toBe(
      'Left by client · Sun 20 Sep 2026',
    );
    expect(omar.querySelector('.reason')?.textContent).toContain(
      'Followed his coach to another gym',
    );
    expect(query<HTMLAnchorElement>(omar, 'a.name').getAttribute('href')).toBe('/clients/client-9');
    expect(host.querySelector('.chips')).toBeNull();
  });

  it("shows the server's reason when the former list is refused", async () => {
    const { host } = await render({
      url: '/clients/former',
      getFormerClients: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              error: { message: 'Only the owner can see former clients.' },
            }),
        ),
    });

    expect(squash(query(host, '[role="alert"]').textContent)).toBe(
      'Only the owner can see former clients.',
    );
  });
});
