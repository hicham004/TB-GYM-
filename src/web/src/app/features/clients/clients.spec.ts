import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormerClient } from '../../core/api/api.models';
import type { ClientOverviewView } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { COACH_NOW, LEA_ID, OWNER_ID } from '../../../testing/coach-today-fixtures';
import { clientListView, KARL, overviewRow, TALA } from '../../../testing/client-list-fixtures';
import { click, fill, menuChoices, press, query, settle, tick } from '../../../testing/dom';
import { fakeMotion, provideFakeMotion, type FakeMotion } from '../../../testing/motion-fake';
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
    timeZone?: string;
    calendar?: unknown;
    motion?: FakeMotion;
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
      {
        provide: WorkspaceCalendar,
        useValue: options.calendar ?? {
          timeZone: signal(options.timeZone ?? 'Asia/Beirut'),
          resolveToday: () => Promise.resolve('2026-10-01'),
        },
      },
      ...(options.motion ? [provideFakeMotion(options.motion)] : []),
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

/** Each piece of text on its own, a space between them: Angular drops the spaces between elements. */
function said(host: Node): string {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const pieces: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const piece = squash(node.textContent);
    if (piece) pieces.push(piece);
  }
  return pieces.join(' ');
}

describe('Clients', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('lists everyone with a face, age, goal, status, plan, last check-in and last activity', async () => {
    const { host } = await render();

    expect(names(host)).toHaveLength(12);
    const maya = row(host, 'Maya Fakhoury');
    expect(squash(maya.querySelector('app-avatar')?.textContent)).toBe('MF');
    expect(squash(maya.querySelector('.goal')?.textContent)).toBe(
      'Age 29 · Lose 6 kg and feel strong for my wedding in December.',
    );
    // The reason and the plan's own status, then the last 7 days with its words for screen readers.
    expect(squash(maya.querySelector('.reason-tag')?.textContent)).toBe(
      'Maya Fakhoury: 1 check-in to review',
    );
    expect(squash(maya.querySelector('app-status-pill')?.textContent)).toBe('On track');
    expect(maya.querySelectorAll('.strip app-day-mark')).toHaveLength(7);
    expect(squash(maya.querySelector('.week')?.textContent)).toContain(
      '3 of 4 workouts done in the last 7 days',
    );
    expect(squash(maya.querySelector('.plan')?.textContent)).toBe(
      'Plan Online coaching Training, Nutrition, Check-ins, Messaging 12 weeks · USD 330 Ends Sun 20 Dec +1 more plan',
    );
    expect(squash(maya.querySelector('.checkin')?.textContent)).toBe(
      'Last check-in Sent 18 hours ago',
    );
    expect(squash(maya.querySelector('.activity')?.textContent)).toBe(
      'Last activity Trained Lower A · 2 hours ago',
    );
    // The name's link covers the row; each reason is its own link above it; a chevron ends the row.
    expect(Array.from(maya.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(
      ['/clients/c-maya', '/clients/c-maya/checkins/a-maya'],
    );
    expect(maya.querySelector('app-icon.chevron')).not.toBeNull();
    expect(squash(query(host, '.lede').textContent)).toBe(
      '12 clients · 6 need attention · 2 plans end soon',
    );
  });

  it('heads the columns and draws the strip’s legend, which a phone shows above the list', async () => {
    const { host } = await render();

    const head = query(host, '.list-head');
    expect(head.getAttribute('aria-hidden')).toBe('true');
    expect(said(head)).toBe(
      'Client Status · last 7 days done · missed · still due Plan Last check-in Last activity',
    );
    expect(said(query(host, '.legend-line'))).toBe('Last 7 days done · missed · still due');
    expect(
      Array.from(query(host, '.legend-line').querySelectorAll('app-day-mark')).map((mark) =>
        mark.getAttribute('data-mark'),
      ),
    ).toEqual(['done', 'missed', 'due']);
  });

  it('links each reason to where it is handled, the plan’s end having its own pill', async () => {
    const { host } = await render();

    const tags = (name: string) =>
      Array.from(row(host, name).querySelectorAll<HTMLAnchorElement>('.reason-tag a')).map(
        (tag) => [squash(tag.textContent), tag.getAttribute('href')],
      );
    expect(tags('Jad Karam')).toEqual([
      ['Jad Karam: 3 missed workouts', '/clients/c-jad/training'],
      ['Jad Karam: 2 check-ins overdue', '/clients/c-jad/checkins'],
    ]);
    expect(tags('Sara Mansour')).toEqual([
      ['Sara Mansour: 2 unread messages', '/messages?conversation=conv-sara'],
    ]);
    expect(tags('Rita Daher')).toEqual([]);
    expect(squash(row(host, 'Rita Daher').querySelector('app-status-pill')?.textContent)).toBe(
      'Plan ends soon',
    );
    expect(row(host, 'Rita Daher').querySelector('.plan-end')?.classList).toContain('soon');
  });

  it('leads the plan with its name as it was booked, in its own writing direction (critique B4c)', async () => {
    const view = clientListView();
    const { host } = await render({
      getOverview: () =>
        of({
          ...view,
          clients: view.clients.map((client) =>
            client.client.firstName === 'Rita' && client.plan
              ? { ...client, plan: { ...client.plan, name: 'إعادة تأهيل بعد الولادة' } }
              : client.client.firstName === 'Lynn'
                ? { ...client, planState: 'None' as const, plan: null, planEndsOn: null }
                : client,
          ),
        }),
    });

    const lines = (name: string) =>
      Array.from(row(host, name).querySelectorAll('.plan-line')).map((line) =>
        squash(line.textContent),
      );
    expect(lines('Maya Fakhoury')).toEqual([
      'Online coaching',
      'Training, Nutrition, Check-ins, Messaging',
      '12 weeks · USD 330',
      'Ends Sun 20 Dec',
      '+1 more plan',
    ]);
    // Isolated in a <bdi>, so a name in another script keeps its order and the line its alignment.
    expect(lines('Rita Daher')[0]).toBe('إعادة تأهيل بعد الولادة');
    expect(row(host, 'Rita Daher').querySelector('.plan-name > bdi')?.textContent).toBe(
      'إعادة تأهيل بعد الولادة',
    );
    // A client with no plan has no name to show, only where they stand.
    expect(lines('Lynn Bou Khalil')).toEqual(['No plan yet']);
  });

  it('shows what is left on a pack beside the plan’s pill, warm as it runs out (critique B10c)', async () => {
    const view = clientListView({
      clients: [
        overviewRow(KARL, { sessionsLeft: 2, attention: ['SessionsRunningOut'] }),
        overviewRow(TALA, { sessionsLeft: 7 }),
      ],
    });
    const { host } = await render({ getOverview: () => of(view) });

    const pills = (name: string) => Array.from(row(host, name).querySelectorAll('app-status-pill'));
    expect(pills('Karl Saade').map((pill) => squash(pill.textContent))).toEqual([
      'On track',
      '2 sessions left',
    ]);
    expect(pills('Karl Saade')[1].classList.contains('warm')).toBe(true);
    expect(pills('Tala Rizk').map((pill) => squash(pill.textContent))).toEqual([
      'On track',
      '7 sessions left',
    ]);
    expect(pills('Tala Rizk')[1].classList.contains('warm')).toBe(false);
    expect(row(host, 'Karl Saade').querySelector('app-tag')).toBeNull();
  });

  it('shows no sessions on a client with no pack running', async () => {
    const { host } = await render();

    expect(host.querySelector('li.client-row')?.textContent).not.toContain('sessions left');
  });

  it('says why check-ins show nothing: none sent yet, or not in the plan', async () => {
    const { host } = await render();

    expect(squash(row(host, 'Lynn Bou Khalil').querySelector('.checkin')?.textContent)).toBe(
      'Last check-in None sent yet',
    );
    expect(squash(row(host, 'Rami Tabet').querySelector('.checkin')?.textContent)).toBe(
      'Last check-in Not in plan',
    );
    expect(squash(row(host, 'Karl Saade').querySelector('.plan-end')?.textContent)).toBe(
      'Paused since Sun 20 Sep · ends Sun 20 Dec',
    );
  });

  it('explains how the statuses work beside the chips (critique B4a)', async () => {
    const { host, harness } = await render();

    press(host, 'How these statuses work');
    await settle(harness.fixture);

    const sheet = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(squash(sheet?.querySelector('h2')?.textContent)).toBe('How these statuses work');
    expect(squash(sheet?.textContent)).toContain('13 days away is soon, 14 is not');
  });

  it('shows none of the old columns: phone, onboarding or an "Open profile" link', async () => {
    const { host } = await render();

    expect(host.textContent).not.toContain('Open profile');
    expect(host.textContent).not.toContain('Onboarding');
    expect(host.textContent).not.toContain('Phone');
  });

  it('says Not set up yet beside the status of a client who never finished their profile', async () => {
    const view = clientListView();
    const [first, ...rest] = view.clients;
    const { host } = await render({
      getOverview: () =>
        of({ ...view, clients: [{ ...first, onboardingStatus: 'NotStarted' }, ...rest] }),
    });

    const chips = Array.from(host.querySelectorAll('[data-not-set-up]'));
    expect(chips).toHaveLength(1);
    expect(squash(chips[0].textContent)).toBe('Not set up yet');
    // In the row's status, beside the pill (LOST-12), and not a column of its own.
    expect(chips[0].closest('.state')).not.toBeNull();
    expect(host.textContent).not.toContain('Onboarding');
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

  it('narrows the owner’s list to one coach’s clients, kept in the address (critique B3a)', async () => {
    const { host, harness } = await render({ isOwner: true });
    const trigger = query<HTMLButtonElement>(host, 'app-menu.coach-filter button');
    expect(squash(trigger.textContent)).toBe('Coach');

    trigger.click();
    await settle(harness.fixture);
    const choices = menuChoices(trigger);
    expect(
      choices.map((choice) => squash(choice.querySelector('.item-title')?.textContent)),
    ).toEqual(['Every coach', 'You', 'Lea Khoury']);
    choices[2].click();
    await settle(harness.fixture);

    expect(names(host)).toEqual(['Maya Fakhoury']);
    expect(TestBed.inject(Router).url).toBe(`/clients?coach=${LEA_ID}`);
    expect(squash(query(host, 'app-menu.coach-filter button').textContent)).toBe(
      'Coach: Lea Khoury',
    );
    expect(squash(query(host, '[role="status"]').textContent)).toBe('Showing 1 of 12 clients');
    // Each chip counts the chosen coach's clients, not the whole list's, and so does the lede.
    expect(squash(query(host, '.chips .chip').textContent)).toBe('All 1');
    expect(squash(query(host, '.lede').textContent)).toBe('1 client · 1 needs attention');
  });

  it('speaks for the chosen coach’s clients when none of theirs matches, and keeps the coach (review of B3a)', async () => {
    const { host, harness } = await render({
      isOwner: true,
      url: `/clients?coach=${LEA_ID}&show=paused`,
    });

    // Lea's only client, Maya, is not paused; the rest of the list may well hold one.
    expect(names(host)).toEqual([]);
    expect(squash(host.querySelector('app-empty-state h2')?.textContent)).toBe(
      'None of Lea Khoury’s clients has a paused plan',
    );
    press(host, 'Show all of Lea Khoury’s clients');
    await settle(harness.fixture);

    expect(names(host)).toEqual(['Maya Fakhoury']);
    expect(TestBed.inject(Router).url).toBe(`/clients?coach=${LEA_ID}`);
  });

  it('says “your clients” when the owner chose their own', async () => {
    const { host, harness } = await render({
      isOwner: true,
      url: `/clients?coach=${OWNER_ID}`,
    });

    fill(host, 'Search clients', 'zzz');
    await settle(harness.fixture);
    expect(squash(host.querySelector('app-empty-state h2')?.textContent)).toBe(
      'None of your clients matches “zzz”',
    );
  });

  it('opens on the coach named in the address, and narrows nothing for a coach it does not hold', async () => {
    const named = await render({ isOwner: true, url: `/clients?coach=${LEA_ID}` });
    expect(names(named.host)).toEqual(['Maya Fakhoury']);
    TestBed.resetTestingModule();

    const unknown = await render({ isOwner: true, url: '/clients?coach=someone-else' });
    expect(names(unknown.host)).toHaveLength(12);
    expect(squash(query(unknown.host, 'app-menu.coach-filter button').textContent)).toBe('Coach');
  });

  it('offers Maxes to review only while a client has maxes to review', async () => {
    const view = clientListView();
    const stronger = view.clients.find((item) => item.client.firstName === 'Hiba');
    if (!stronger) throw new Error('No Hiba in the fixture.');
    const withMaxes: ClientOverviewView = {
      ...view,
      clients: view.clients.map((item) =>
        item === stronger ? { ...item, attention: ['MaxesToReview'] } : item,
      ),
    };
    const { host, harness } = await render({ getOverview: () => of(withMaxes) });

    const chips = Array.from(host.querySelectorAll('.chip')).map((chip) =>
      squash(chip.textContent),
    );
    expect(chips).toEqual([
      'All 12',
      'Needs attention 6',
      'Ending soon 2',
      'Paused 1',
      'New 2',
      'Maxes to review 1',
    ]);

    tick(host, 'Maxes to review');
    await settle(harness.fixture);
    expect(names(host)).toEqual(['Hiba Nasser']);
    expect(TestBed.inject(Router).url).toBe('/clients?show=maxes');
  });

  it('keeps Maxes to review when the address asks for it, and says nobody has any', async () => {
    const { host } = await render({ url: '/clients?show=maxes' });

    expect(query<HTMLInputElement>(host, 'input[value="maxes"]').checked).toBe(true);
    expect(names(host)).toEqual([]);
    expect(host.textContent).toContain('No logged sets suggest a new max right now');
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

    // A server fault reads the screen's own sentence, never its title (audit UIQ-2).
    expect(squash(query(host, '[role="alert"]').textContent)).toBe(
      'Clients could not be loaded. Try again.',
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

  it('says the day coaching ended on the workspace’s calendar, not the device’s (audit WEB-17)', async () => {
    const { host } = await render({
      url: '/clients/former',
      isOwner: true,
      timeZone: 'America/Los_Angeles',
      // 03:00 UTC on Monday is still Sunday evening in the workspace.
      getFormerClients: () => of([{ ...OMAR, releasedAtUtc: '2026-09-21T03:00:00Z' }]),
    });

    expect(squash(row(host, 'Omar Nasr').querySelector('.goal')?.textContent)).toBe(
      'Left by client · Sun 20 Sep 2026',
    );
  });

  it('reads Former clients once while the workspace’s calendar is first read (review of A15a)', async () => {
    // The real calendar reads its signals before it waits, and sets them once the workspace answers.
    const resolved = signal<string | null>(null);
    const calendar = {
      timeZone: computed(() => resolved()),
      resolveToday: () => {
        resolved();
        return Promise.resolve().then(() => {
          resolved.set('Asia/Beirut');
          return '2026-10-01';
        });
      },
    };
    const { host, formerApi } = await render({ url: '/clients/former', isOwner: true, calendar });

    expect(formerApi.getFormerClients).toHaveBeenCalledTimes(1);
    expect(squash(row(host, 'Omar Nasr').querySelector('.goal')?.textContent)).toBe(
      'Left by client · Sun 20 Sep 2026',
    );
  });

  it('tells a coach who opens Former clients whose list it is, with a way back', async () => {
    const { host } = await render({
      url: '/clients/former',
      getFormerClients: () => throwError(() => new HttpErrorResponse({ status: 403, error: null })),
    });

    // It was "Clients could not be loaded. Check your connection and try again." (audit UIQ-2).
    expect(squash(query(host, '[role="alert"]').textContent)).toBe(
      'Only the owner sees former clients.',
    );
    expect(query<HTMLAnchorElement>(host, '.load-failed a').getAttribute('href')).toBe('/clients');
    expect(query(host, '.load-failed a').textContent?.trim()).toBe('See your clients');
    expect(host.querySelector('.load-failed button')).toBeNull();
  });

  describe('W14: the chips crossfade the rows', () => {
    interface Transition {
      finished: Promise<void>;
    }
    /** A browser with view transitions: the update runs at once and `finished` follows it. */
    function viewTransitions() {
      let scoped: boolean | null = null;
      const start = vi.fn((update: () => Promise<void>): Transition => {
        scoped = document.documentElement.classList.contains('tb-rows-swap');
        const done = update();
        return { finished: done };
      });
      Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        writable: true,
        value: start,
      });
      return { start, scoped: () => scoped };
    }

    afterEach(() => {
      delete (document as { startViewTransition?: unknown }).startViewTransition;
      document.documentElement.classList.remove('tb-rows-swap');
    });

    it('runs a chip inside a view transition scoped by a class on <html>, where motion is allowed', async () => {
      const browser = viewTransitions();
      const { host, harness } = await render({ motion: fakeMotion({ allowed: true }) });
      expect(host.querySelector('.panel.tb-client-rows')).not.toBeNull();

      tick(host, 'Ending soon');
      await settle(harness.fixture);

      expect(browser.start).toHaveBeenCalledTimes(1);
      expect(browser.scoped()).toBe(true);
      expect(names(host)).toEqual(['Rita Daher', 'Sara Mansour']);
      await vi.waitFor(() =>
        expect(document.documentElement.classList.contains('tb-rows-swap')).toBe(false),
      );
      // The owner's coach chip (B3a) crossfades the rows the same way.
    });

    it('swaps the rows at once where motion is not allowed, or the browser has no transitions', async () => {
      const browser = viewTransitions();
      const still = await render({ motion: fakeMotion({ allowed: false }) });
      tick(still.host, 'Ending soon');
      await settle(still.harness.fixture);
      expect(browser.start).not.toHaveBeenCalled();
      expect(names(still.host)).toEqual(['Rita Daher', 'Sara Mansour']);
      expect(document.documentElement.classList.contains('tb-rows-swap')).toBe(false);

      delete (document as { startViewTransition?: unknown }).startViewTransition;
      TestBed.resetTestingModule();
      const older = await render({ motion: fakeMotion({ allowed: true }) });
      tick(older.host, 'Paused');
      await settle(older.harness.fixture);
      expect(names(older.host)).toHaveLength(1);
    });
  });
});
