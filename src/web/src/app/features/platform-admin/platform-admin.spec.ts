import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { fill, press, settle, toggleFold } from '../../../testing/dom';
import {
  foundingTerms,
  gymRequests,
  NOW,
  plan,
  platformSpaces,
  pricePlans,
  SPACE_IDS,
} from '../../../testing/platform-admin-fixtures';
import type { AdminWorkspace, PricePlan } from '../billing/billing.models';
import type { FoundingTerms } from '../billing/founding.models';
import { PlatformAdmin } from './platform-admin';
import { PlatformAdminApi } from './platform-admin-api';
import { isPlatformAdmin } from './platform-admin.guard';
import { PlatformFoundingApi } from './platform-founding-api';

type Api = { [K in keyof PlatformAdminApi]: ReturnType<typeof vi.fn> };
type FoundingApi = { [K in keyof PlatformFoundingApi]: ReturnType<typeof vi.fn> };

const NEXT_TERMS = foundingTerms({
  id: 'terms-2',
  versionNumber: 2,
  clientsWithActivePlan: 8,
  publishedAtUtc: '2026-10-09T12:00:00Z',
});

async function render(
  spaces: () => AdminWorkspace[] = platformSpaces,
  overrides: Partial<Api> = {},
  foundingOverrides: Partial<FoundingApi> = {},
) {
  const api: Api = {
    getWorkspaces: vi.fn(() => of(spaces())),
    getWorkspace: vi.fn(),
    getPricePlans: vi.fn(() => of(pricePlans())),
    getGymRequests: vi.fn(() => of(gymRequests())),
    publishPricePlan: vi.fn(() =>
      of(plan({ id: 'plan-3', versionNumber: 3, seatPrice: 20 }) satisfies PricePlan),
    ),
    issueInvoices: vi.fn(() =>
      of({ periodStart: '2026-09-01', issued: 1, alreadyIssued: 0, inTrial: 2 }),
    ),
    recordPayment: vi.fn(),
    voidInvoice: vi.fn(),
    grantDiscount: vi.fn(),
    revokeDiscount: vi.fn(),
    grantIncludedClients: vi.fn(),
    revokeIncludedClientGrant: vi.fn(),
    getLegalDocuments: vi.fn(),
    publishLegalDocument: vi.fn(),
    withdrawLegalDocument: vi.fn(),
    ...overrides,
  };
  const founding: FoundingApi = {
    markFounding: vi.fn(),
    endFounding: vi.fn(),
    checkFounding: vi.fn(),
    getFoundingTerms: vi.fn(() => of([foundingTerms()])),
    publishFoundingTerms: vi.fn(() => of(NEXT_TERMS)),
    ...foundingOverrides,
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  TestBed.configureTestingModule({
    imports: [PlatformAdmin],
    providers: [
      provideRouter([]),
      { provide: PlatformAdminApi, useValue: api },
      { provide: PlatformFoundingApi, useValue: founding },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(PlatformAdmin);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, founding, csrf };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The sheet or dialog on top, which the CDK draws outside the page. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

/** Every toast on screen, each message whole. */
const toasts = () =>
  Array.from(document.querySelectorAll('.tb-toast__message')).map((message) => textOf(message));

// The price plan sheet's first paragraph (notes plan N8): what a new version means for invoices,
// then for founding spaces, from the guarantee months of the founding terms in force.
const PLAN_INTRO =
  'Version 2 is in force. Invoices issued from now on use the new terms; invoices already issued keep theirs.';
const PLAN_KEPT = 'Founding spaces keep their version until their guarantee ends.';
const PLAN_NOT_HELD =
  'No guarantee months are published yet, so founding spaces are billed at the new version too.';
const planIntro = () => textOf(dialog()?.querySelector('form > .muted'));

/** Change the seat price in the open price plan sheet and publish the next version. */
async function publishVersion3(fixture: Parameters<typeof settle>[0]): Promise<void> {
  fill(dialog()!, 'Price per seat', '20');
  await settle(fixture);
  press(dialog()!, 'Publish version 3');
  await settle(fixture);
}

const rowNames = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.space .name')).map((link) => textOf(link));

describe('Platform billing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('shows what is owed, what is locked and overdue, and which trials end soon', async () => {
    const { host } = await render();

    const tiles = Array.from(host.querySelectorAll('app-stat-tile')).map((tile) =>
      [
        tile.querySelector('.label'),
        tile.querySelector('.value'),
        tile.querySelector('.context'),
      ].map(textOf),
    );
    expect(tiles).toEqual([
      ['Owed to TB Gym', '$155.00', 'By 3 coaching spaces'],
      ['Read-only now', '1', 'Their coaches cannot edit until they pay'],
      ['Overdue', '1', 'Past their due date, not yet read-only'],
      ['Trials ending', '1', 'In the next 7 days'],
    ]);
  });

  it('says so plainly when nothing is owed', async () => {
    const { host } = await render(() => platformSpaces().filter((s) => s.unpaidTotal === 0));

    const tiles = Array.from(host.querySelectorAll('app-stat-tile')).map((tile) =>
      [tile.querySelector('.value'), tile.querySelector('.context')].map(textOf),
    );
    expect(tiles).toEqual([
      ['$0.00', 'Nothing is owed'],
      ['0', 'No coaching space is locked'],
      ['0', 'Nothing is overdue'],
      ['1', 'In the next 7 days'],
    ]);
  });

  it('names what is missing when a filter has nobody in it, and shows everyone again', async () => {
    const { fixture, host } = await render(() =>
      platformSpaces().filter((s) => s.unpaidTotal === 0),
    );

    host.querySelector<HTMLInputElement>('input[name="space-filter"][value="owing"]')!.click();
    await settle(fixture);
    expect(textOf(host.querySelector('app-empty-state h2'))).toBe('Nobody owes anything right now');
    press(host, 'Show all');
    await settle(fixture);
    expect(rowNames(host)).toHaveLength(4);
    expect(host.querySelector('app-empty-state')).toBeNull();
  });

  it('lists the coaching spaces worst first, each with its status, what happens next and what it owes', async () => {
    const { host } = await render();

    expect(rowNames(host)).toEqual([
      'Cedar Barbell Club',
      'Atlas Performance',
      'Beirut Barbell',
      'Strength Lab',
      'Nour Fitness',
      'نادي الأرز',
      'Maya Rahme Coaching',
    ]);
    const row = (id: string) => host.querySelector(`[data-space="${id}"]`)!;
    const cedar = row(SPACE_IDS.cedar);
    expect(textOf(cedar.querySelector('.owner'))).toBe(
      'Olivia Haddad · olivia@cedarbarbell.example',
    );
    expect(textOf(cedar.querySelector('.usage'))).toBe('3 seats · 22 clients');
    expect(textOf(cedar.querySelector('app-status-pill'))).toBe('Read-only until paid');
    expect(textOf(cedar.querySelector('.next'))).toBe('Read-only since Oct 1');
    expect(textOf(cedar.querySelector('.owes'))).toBe('$70.00 owed');
    expect(textOf(row(SPACE_IDS.atlas).querySelector('.next'))).toBe(
      'Was due Oct 5, read-only from Oct 12',
    );
    expect(textOf(row(SPACE_IDS.beirut).querySelector('.next'))).toBe('Due Oct 14');
    expect(textOf(row(SPACE_IDS.strength).querySelector('.next'))).toBe('Trial ends in 3 days');
    const nour = row(SPACE_IDS.nour);
    expect(textOf(nour.querySelector('app-status-pill'))).toBe('Active');
    expect(textOf(nour.querySelector('.next'))).toBe('Paid up');
    expect(textOf(nour.querySelector('.owes'))).toBe('—Nothing owed');
    // The face marks the two spaces in trouble; the pill says it in words.
    expect(cedar.querySelector('app-avatar')!.classList.contains('client-danger')).toBe(true);
    expect(
      row(SPACE_IDS.atlas).querySelector('app-avatar')!.classList.contains('client-warning'),
    ).toBe(true);
  });

  it('opens a space from its name', async () => {
    const { host } = await render();

    const link = host.querySelector<HTMLAnchorElement>(`[data-space="${SPACE_IDS.atlas}"] .name`)!;
    expect(link.getAttribute('href')).toBe(`/admin/billing/${SPACE_IDS.atlas}`);
  });

  it('narrows the list with a filter and a search, and says when nothing matches', async () => {
    const { fixture, host } = await render();
    const chips = () => Array.from(host.querySelectorAll('.chip')).map((chip) => textOf(chip));
    expect(chips()).toEqual(['All 7', 'Needs payment 3', 'On trial 2', 'Paid up 2']);

    host.querySelector<HTMLInputElement>('input[name="space-filter"][value="owing"]')!.click();
    await settle(fixture);
    expect(rowNames(host)).toEqual(['Cedar Barbell Club', 'Atlas Performance', 'Beirut Barbell']);

    fill(host, 'Search coaching spaces', 'atlas');
    await settle(fixture);
    expect(rowNames(host)).toEqual(['Atlas Performance']);
    expect(textOf(host.querySelector('[role="status"]'))).toBe('1 coaching space shown');

    fill(host, 'Search coaching spaces', 'zzz');
    await settle(fixture);
    expect(textOf(host.querySelector('app-empty-state h2'))).toBe(
      'No coaching space matches “zzz”',
    );
    press(host, 'Clear search');
    await settle(fixture);
    expect(rowNames(host)).toHaveLength(3);

    host.querySelector<HTMLInputElement>('input[name="space-filter"][value="all"]')!.click();
    await settle(fixture);
    expect(rowNames(host)).toHaveLength(7);
  });

  it('shows the price plan in force with each of its terms, and the earlier versions', async () => {
    const { fixture, host } = await render();

    const section = host.querySelector('[data-price-plan]')!;
    expect(textOf(section.querySelector('.panel-head .quiet'))).toBe(
      'Version 2 · in force since Sep 20, 2026',
    );
    const terms = Array.from(section.querySelectorAll('[data-current-plan] > div')).map((row) => [
      textOf(row.querySelector('dt')),
      textOf(row.querySelector('dd')),
    ]);
    expect(terms).toEqual([
      ['Price per seat', '$15.00, with 5 clients included'],
      ['Price per extra client', '$2.00'],
      ['Gym fee', '$10.00, from 2 seats'],
      ['Free trial', '30 days'],
      ['To pay an invoice', '7 days after it is issued'],
      ['Read-only', '7 days after it is due'],
    ]);
    expect(textOf(section)).toContain('“Launch prices”');
    const earlier = section.querySelector<HTMLElement>('.versions')!;
    expect(earlier.querySelector('details')?.open).toBe(false);
    expect(textOf(earlier.querySelector('summary'))).toBe('Earlier versions (1)');
    await toggleFold(fixture, section, 'Earlier versions (1)');
    expect(textOf(earlier.querySelector('[data-plan="1"]'))).toBe(
      'v1 Sep 1, 2026 $12.00 a seat · 5 included · $2.00 extra · $10.00 gym fee — Placeholder',
    );
  });

  it('publishes a new version after showing exactly what changes', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Publish a new version');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Publish a price plan version');
    // Notes plan N8: the terms in force publish no guarantee months, so no founding space is held
    // and the sheet says so before the admin publishes.
    expect(planIntro()).toBe(`${PLAN_INTRO} ${PLAN_NOT_HELD}`);
    expect(textOf(sheet)).not.toContain('keep their version');
    expect(textOf(sheet)).toContain('Nothing has changed yet.');
    expect(
      Array.from(sheet.querySelectorAll('button')).find((b) => textOf(b) === 'Publish version 3')!
        .disabled,
    ).toBe(true);

    fill(sheet, 'Price per seat', '20');
    fill(sheet, 'Free trial (days)', '14');
    await settle(fixture);
    expect(
      Array.from(sheet.querySelectorAll('.changes li')).map((row) =>
        ['.what', '.from', '.to'].map((part) => textOf(row.querySelector(part))),
      ),
    ).toEqual([
      ['Price per seat', '$15.00', '$20.00'],
      ['Free trial (days)', '30', '14'],
    ]);

    press(sheet, 'Publish version 3');
    await settle(fixture);

    expect(api.publishPricePlan).toHaveBeenCalledWith(
      expect.objectContaining({ seatPrice: 20, trialDays: 14, expectedCurrentVersion: 2 }),
    );
    expect(dialog()).toBeNull();
    // With no guarantee months the new version reaches founding spaces too, and the toast says so.
    expect(toasts()).toEqual([
      'Price plan version 3 is published. Invoices issued from now on use it, founding spaces’ too: no guarantee months are published.',
    ]);
    expect(api.getPricePlans).toHaveBeenCalledTimes(2);
  });

  // Notes plan N8: a founding space is not moved to the new version while its guarantee runs, and
  // the guarantee is the months of the founding terms in force. The months are this test's own.
  it.each([
    ['5 months', 5],
    // No months after the last discount is still a guarantee, unlike none.
    ['0 months', 0],
  ])(
    'says in the plan sheet and its toast that a founding space keeps its version when the terms in force hold prices for %s',
    async (_, months) => {
      const { fixture, host } = await render(
        platformSpaces,
        {},
        { getFoundingTerms: vi.fn(() => of([foundingTerms({ priceGuaranteeMonths: months })])) },
      );

      press(host, 'Publish a new version');
      await settle(fixture);
      expect(planIntro()).toBe(`${PLAN_INTRO} ${PLAN_KEPT}`);

      await publishVersion3(fixture);
      expect(dialog()).toBeNull();
      expect(toasts()).toEqual([
        'Price plan version 3 is published. Invoices issued from now on use it; a founding space keeps its version until its guarantee ends.',
      ]);
    },
  );

  it('says nothing of founding spaces in the plan sheet or its toast when the founding terms cannot be read', async () => {
    const { fixture, host } = await render(
      platformSpaces,
      {},
      { getFoundingTerms: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))) },
    );

    press(host, 'Publish a new version');
    await settle(fixture);
    expect(planIntro()).toBe(PLAN_INTRO);
    expect(dialog()!.querySelector('[data-plan-founding]')).toBeNull();

    await publishVersion3(fixture);
    expect(dialog()).toBeNull();
    // Neither promise: the page does not know whether a price is held.
    expect(toasts()).toEqual([
      'Price plan version 3 is published. Invoices issued from now on use it.',
    ]);
  });

  it('reads the guarantee’s months from the terms in force, never from an earlier version', async () => {
    const { fixture, host } = await render(
      platformSpaces,
      {},
      {
        getFoundingTerms: vi.fn(() =>
          of([
            foundingTerms({ id: 'terms-2', versionNumber: 2, priceGuaranteeMonths: null }),
            foundingTerms({ isCurrent: false, priceGuaranteeMonths: 7 }),
          ]),
        ),
      },
    );

    press(host, 'Publish a new version');
    await settle(fixture);
    expect(planIntro()).toBe(`${PLAN_INTRO} ${PLAN_NOT_HELD}`);

    await publishVersion3(fixture);
    expect(toasts()).toEqual([
      'Price plan version 3 is published. Invoices issued from now on use it, founding spaces’ too: no guarantee months are published.',
    ]);
  });

  it('says no price is held in the plan sheet and its toast while no founding terms are published at all', async () => {
    const { fixture, host } = await render(
      platformSpaces,
      {},
      { getFoundingTerms: vi.fn(() => of([])) },
    );

    press(host, 'Publish a new version');
    await settle(fixture);
    expect(planIntro()).toBe(`${PLAN_INTRO} ${PLAN_NOT_HELD}`);

    await publishVersion3(fixture);
    expect(toasts()).toEqual([
      'Price plan version 3 is published. Invoices issued from now on use it, founding spaces’ too: no guarantee months are published.',
    ]);
  });

  it('says what founding spaces keep once the terms are read, in a plan sheet opened before them', async () => {
    const late = new Subject<FoundingTerms[]>();
    const read = [foundingTerms({ priceGuaranteeMonths: 7 })];
    const { fixture, host } = await render(
      platformSpaces,
      {},
      { getFoundingTerms: vi.fn(() => of(read)).mockReturnValueOnce(late) },
    );

    // The spaces and the plans are there; the founding terms are still on their way.
    press(host, 'Publish a new version');
    await settle(fixture);
    expect(planIntro()).toBe(PLAN_INTRO);
    fill(dialog()!, 'Price per seat', '20');
    await settle(fixture);

    late.next(read);
    late.complete();
    await settle(fixture);
    expect(planIntro()).toBe(`${PLAN_INTRO} ${PLAN_KEPT}`);
    // What was typed stays, and the toast speaks from the months read by then.
    expect(dialog()!.querySelector<HTMLInputElement>('input[name="seatPrice"]')!.value).toBe('20');
    press(dialog()!, 'Publish version 3');
    await settle(fixture);
    expect(toasts()).toEqual([
      'Price plan version 3 is published. Invoices issued from now on use it; a founding space keeps its version until its guarantee ends.',
    ]);
  });

  it('keeps a refused version on screen with the server’s words', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'price_plan_changed',
        message: 'A newer price plan was published since this page loaded. Refresh and try again.',
      },
    });
    const { fixture, host } = await render(platformSpaces, {
      publishPricePlan: vi.fn(() => throwError(() => conflict)),
    });

    press(host, 'Publish a new version');
    await settle(fixture);
    fill(dialog()!, 'Price per seat', '20');
    await settle(fixture);
    press(dialog()!, 'Publish version 3');
    await settle(fixture);

    expect(textOf(dialog()!.querySelector('[role="alert"]'))).toBe(
      'A newer price plan was published since this page loaded. Refresh and try again.',
    );
  });

  it('checks the terms before sending them and puts focus on the first that is wrong', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Publish a new version');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'Price per seat', '-4');
    fill(sheet, 'Days to pay an invoice', '120');
    await settle(fixture);
    press(sheet, 'Publish version 3');
    await settle(fixture);

    expect(api.publishPricePlan).not.toHaveBeenCalled();
    expect(textOf(sheet)).toContain('Enter an amount from 0 to 100000.');
    expect(textOf(sheet)).toContain('Enter a whole number from 0 to 90.');
    expect(document.activeElement?.id).toBe(
      sheet.querySelector<HTMLInputElement>('input[name="seatPrice"]')!.id,
    );
  });

  it('asks before issuing last month’s invoices, then says what the run did', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Issue last month’s invoices');
    await settle(fixture);
    expect(textOf(dialog()!)).toContain('Issue the invoices for September 2026 now?');
    press(dialog()!, 'Not now');
    await settle(fixture);
    expect(api.issueInvoices).not.toHaveBeenCalled();

    press(host, 'Issue last month’s invoices');
    await settle(fixture);
    press(dialog()!, 'Issue invoices');
    await settle(fixture);

    expect(api.issueInvoices).toHaveBeenCalledTimes(1);
    expect(toast()).toContain(
      'Invoices for September 2026: 1 issued, 0 already issued, 2 in trial.',
    );
    expect(api.getWorkspaces).toHaveBeenCalledTimes(2);
  });

  it('says so when billing cannot be loaded, and tries again', async () => {
    let failing = true;
    const { fixture, host, api } = await render(platformSpaces, {
      getWorkspaces: vi.fn(() =>
        failing ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(platformSpaces()),
      ),
    });

    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'Platform billing couldn’t be loaded.',
    );
    failing = false;
    press(host, 'Try again');
    await settle(fixture);

    expect(api.getWorkspaces).toHaveBeenCalledTimes(2);
    expect(rowNames(host)).toHaveLength(7);
  });

  it('invites nothing when there are no coaching spaces yet', async () => {
    const { host } = await render(() => []);

    expect(textOf(host.querySelector('app-empty-state h2'))).toBe('No coaching spaces yet');
    expect(host.querySelector('.toolbar')).toBeNull();
  });

  it('marks a founding space with a Founding pill after its status, and no other', async () => {
    const { host } = await render();

    const row = (id: string) => host.querySelector(`[data-space="${id}"]`)!;
    const pills = (id: string) =>
      Array.from(row(id).querySelectorAll('app-status-pill')).map((pill) => textOf(pill));
    expect(pills(SPACE_IDS.nour)).toEqual(['Active', 'Founding']);
    expect(row(SPACE_IDS.nour).querySelector('[data-founding]')!.classList).toContain('success');
    expect(pills(SPACE_IDS.atlas)).toEqual(['Overdue']);
    expect(host.querySelectorAll('[data-founding]')).toHaveLength(1);
  });

  it('shows the founding terms in force under the price plan: the badge’s, the founding seat’s and the guarantee’s', async () => {
    const { host, founding } = await render();

    const panel = host.querySelector('[data-founding-terms]')!;
    expect(textOf(panel.querySelector('h2'))).toBe('Founding terms');
    expect(textOf(panel.querySelector('.panel-head .quiet'))).toBe('Version 1 · since Sep 1, 2026');
    expect(textOf(panel.querySelector('[data-terms-sentence]'))).toBe(
      'Earned once 10 of a founding space’s clients have an active plan and the space is 2 months old.',
    );
    // Notes plan N11b: no founding number is published, so the price plan's seat applies.
    expect(textOf(panel.querySelector('[data-terms-seat]'))).toBe(
      'A founding space’s owner seat includes what the price plan’s seat includes: no founding number above it is published yet.',
    );
    // Notes plan N8: no guarantee months are published either, so no price is held.
    expect(textOf(panel.querySelector('[data-terms-guarantee]'))).toBe(
      'A founding space’s prices are not held: no guarantee months are published yet.',
    );
    // One sentence each, in the order of the sheet's numbers.
    expect(
      Array.from(panel.querySelectorAll('p.badge-terms')).map((line) =>
        line.getAttributeNames().find((name) => name.startsWith('data-terms-')),
      ),
    ).toEqual(['data-terms-sentence', 'data-terms-seat', 'data-terms-guarantee']);
    expect(founding.getFoundingTerms).toHaveBeenCalledTimes(1);
    // Its own panel after the price plan's, so the plan's version line stays the only one there.
    const panels = Array.from(host.querySelectorAll('section.panel'));
    expect(panels.indexOf(panel)).toBe(
      panels.indexOf(host.querySelector('[data-price-plan]')!) + 1,
    );
  });

  it('says what a founding owner’s seat includes when the terms in force name a number above the plan’s', async () => {
    const { host } = await render(
      platformSpaces,
      {},
      {
        getFoundingTerms: vi.fn(() => of([foundingTerms({ foundingSeatIncludedClients: 13 })])),
      },
    );

    expect(textOf(host.querySelector('[data-founding-terms] [data-terms-seat]'))).toBe(
      'A founding space’s owner seat includes 13 clients.',
    );
  });

  // Notes plan N8: the months are the terms in force's, read as the server sends them.
  it('says how long a founding space keeps its plan version under the terms in force', async () => {
    const guarantee = async (months: number | null) => {
      const { host } = await render(
        platformSpaces,
        {},
        { getFoundingTerms: vi.fn(() => of([foundingTerms({ priceGuaranteeMonths: months })])) },
      );
      const line = textOf(host.querySelector('[data-founding-terms] [data-terms-guarantee]'));
      TestBed.resetTestingModule();
      return line;
    };

    expect(await guarantee(5)).toBe(
      'A founding space keeps its plan version until 5 months after its last discount ends, or after its founding day when it has none.',
    );
    expect(await guarantee(1)).toBe(
      'A founding space keeps its plan version until 1 month after its last discount ends, or after its founding day when it has none.',
    );
    // No months after the last discount is still a guarantee, unlike none.
    expect(await guarantee(0)).toBe(
      'A founding space keeps its plan version until its last discount ends; with no discount, only for its founding month.',
    );
    expect(await guarantee(null)).toBe(
      'A founding space’s prices are not held: no guarantee months are published yet.',
    );
  });

  it('says no guarantee while the terms cannot be read or none are published', async () => {
    const failed = await render(
      platformSpaces,
      {},
      { getFoundingTerms: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))) },
    );
    expect(failed.host.querySelector('[data-terms-guarantee]')).toBeNull();
    TestBed.resetTestingModule();

    const none = await render(platformSpaces, {}, { getFoundingTerms: vi.fn(() => of([])) });
    expect(textOf(none.host.querySelector('[data-founding-terms]'))).toContain(
      'No badge terms have been published yet.',
    );
    expect(none.host.querySelector('[data-terms-guarantee]')).toBeNull();
  });

  it('publishes the badge’s next terms against the version it saw', async () => {
    const { fixture, host, founding, csrf } = await render();

    press(host, 'Change');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Change the badge’s terms');
    expect(textOf(sheet)).toContain('Version 1 is in force.');
    expect(textOf(sheet)).toContain('Nothing has changed yet.');
    // The founding seat's help names the price plan in force's seat (notes plan N11b).
    expect(textOf(sheet)).toContain(
      'The price plan’s seat includes 5 clients; the larger applies.',
    );
    expect(
      Array.from(sheet.querySelectorAll('button')).find((b) => textOf(b) === 'Publish version 2')!
        .disabled,
    ).toBe(true);

    fill(sheet, 'Clients with an active plan', '8');
    await settle(fixture);
    expect(
      Array.from(sheet.querySelectorAll('.changes li')).map((row) =>
        ['.what', '.from', '.to'].map((part) => textOf(row.querySelector(part))),
      ),
    ).toEqual([['Clients with an active plan', '10', '8']]);

    press(sheet, 'Publish version 2');
    await settle(fixture);

    expect(founding.publishFoundingTerms).toHaveBeenCalledWith({
      clientsWithActivePlan: 8,
      monthsSinceStart: 2,
      note: null,
      expectedCurrentVersion: 1,
      foundingSeatIncludedClients: null,
      priceGuaranteeMonths: null,
    });
    expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      founding.publishFoundingTerms.mock.invocationCallOrder[0],
    );
    expect(dialog()).toBeNull();
    expect(toast()).toContain('Badge terms version 2 is published.');
    expect(founding.getFoundingTerms).toHaveBeenCalledTimes(2);
  });

  // Notes plan N8: the guarantee's months are the terms sheet's fourth number, published from here.
  it('publishes the months a founding space’s prices are held, and says them once read again', async () => {
    const months = 'Months a founding space’s prices are held';
    let versions = [foundingTerms()];
    const { fixture, host, founding } = await render(
      platformSpaces,
      {},
      {
        getFoundingTerms: vi.fn(() => of(versions)),
        publishFoundingTerms: vi.fn(() => {
          const next = foundingTerms({
            id: 'terms-2',
            versionNumber: 2,
            priceGuaranteeMonths: 7,
            publishedAtUtc: NOW,
          });
          versions = [next, foundingTerms({ isCurrent: false })];
          return of(next);
        }),
      },
    );
    const line = () => textOf(host.querySelector('[data-founding-terms] [data-terms-guarantee]'));
    expect(line()).toBe(
      'A founding space’s prices are not held: no guarantee months are published yet.',
    );

    press(host, 'Change');
    await settle(fixture);
    const sheet = dialog()!;
    const box = sheet.querySelector<HTMLInputElement>('input[name="priceGuaranteeMonths"]')!;
    expect(box.value).toBe('');
    expect(textOf(sheet)).toContain(
      'The number in force applies to every founding space, those already founding too.',
    );
    fill(sheet, months, '7');
    await settle(fixture);
    expect(
      Array.from(sheet.querySelectorAll('.changes li')).map((row) =>
        ['.what', '.from', '.to'].map((part) => textOf(row.querySelector(part))),
      ),
    ).toEqual([[months, 'None', '7']]);
    press(sheet, 'Publish version 2');
    await settle(fixture);

    expect(founding.publishFoundingTerms).toHaveBeenCalledWith({
      clientsWithActivePlan: 10,
      monthsSinceStart: 2,
      note: null,
      expectedCurrentVersion: 1,
      foundingSeatIncludedClients: null,
      priceGuaranteeMonths: 7,
    });
    expect(dialog()).toBeNull();
    expect(founding.getFoundingTerms).toHaveBeenCalledTimes(2);
    expect(textOf(host.querySelector('[data-founding-terms] .panel-head .quiet'))).toBe(
      'Version 2 · since Oct 9, 2026',
    );
    expect(line()).toBe(
      'A founding space keeps its plan version until 7 months after its last discount ends, or after its founding day when it has none.',
    );

    // The sheet opened again starts from the months now in force.
    press(host, 'Change');
    await settle(fixture);
    expect(
      dialog()!.querySelector<HTMLInputElement>('input[name="priceGuaranteeMonths"]')!.value,
    ).toBe('7');
  });

  it('keeps refused terms on screen in the server’s words', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'founding_terms_changed',
        message:
          'Newer founding badge terms were published since this page loaded. Refresh and try again.',
      },
    });
    const { fixture, host } = await render(
      platformSpaces,
      {},
      { publishFoundingTerms: vi.fn(() => throwError(() => conflict)) },
    );

    press(host, 'Change');
    await settle(fixture);
    fill(dialog()!, 'Months since the space started', '3');
    await settle(fixture);
    press(dialog()!, 'Publish version 2');
    await settle(fixture);

    expect(textOf(dialog()!.querySelector('[role="alert"]'))).toBe(
      'Newer founding badge terms were published since this page loaded. Refresh and try again.',
    );
  });

  it('still shows billing when the badge’s terms cannot be read, and reads them again', async () => {
    let failing = true;
    const { fixture, host, founding } = await render(
      platformSpaces,
      {},
      {
        getFoundingTerms: vi.fn(() =>
          failing
            ? throwError(() => new HttpErrorResponse({ status: 500 }))
            : of([foundingTerms()]),
        ),
      },
    );

    expect(rowNames(host)).toHaveLength(7);
    const panel = host.querySelector('[data-founding-terms]')!;
    expect(textOf(panel.querySelector('[role="alert"]'))).toBe(
      'The badge’s terms couldn’t be loaded.',
    );
    failing = false;
    press(host, 'Read them again');
    await settle(fixture);

    expect(founding.getFoundingTerms).toHaveBeenCalledTimes(2);
    expect(textOf(panel.querySelector('[data-terms-sentence]'))).toContain('Earned once 10');
  });

  it('keeps what was typed in the terms sheet when the terms are read again meanwhile', async () => {
    const { fixture, host, founding } = await render();

    press(host, 'Change');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'Clients with an active plan', '8');
    fill(sheet, 'Note (optional)', 'After the first talks');
    await settle(fixture);

    // Issued invoices, say, read the page again while the sheet is open.
    await (fixture.componentInstance as unknown as { loadTerms(): Promise<void> }).loadTerms();
    await settle(fixture);

    expect(founding.getFoundingTerms).toHaveBeenCalledTimes(2);
    expect(
      sheet.querySelector<HTMLInputElement>('input[name="clientsWithActivePlan"]')!.value,
    ).toBe('8');
    expect(sheet.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe(
      'After the first talks',
    );
    expect(sheet.querySelectorAll('.changes li')).toHaveLength(1);
  });

  it('asks before closing the terms sheet with a change typed', async () => {
    const { fixture, host, founding } = await render();

    press(host, 'Change');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'Clients with an active plan', '8');
    await settle(fixture);
    sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    await settle(fixture);

    expect(textOf(dialog()!)).toContain('Discard changes?');
    press(dialog()!, 'Keep editing');
    await settle(fixture);
    expect(dialog()).toBe(sheet);
    expect(
      sheet.querySelector<HTMLInputElement>('input[name="clientsWithActivePlan"]')!.value,
    ).toBe('8');
    expect(founding.publishFoundingTerms).not.toHaveBeenCalled();
  });

  it('gives focus to Change once the terms are read again', async () => {
    let failing = true;
    const { fixture, host } = await render(
      platformSpaces,
      {},
      {
        getFoundingTerms: vi.fn(() =>
          failing
            ? throwError(() => new HttpErrorResponse({ status: 500 }))
            : of([foundingTerms()]),
        ),
      },
    );
    failing = false;
    const again = Array.from(host.querySelectorAll('button')).find(
      (candidate) => textOf(candidate) === 'Read them again',
    )!;
    again.focus();
    again.click();
    await settle(fixture);

    expect(document.activeElement).toBe(host.querySelector('[data-change-terms]'));
  });

  it('reaches the legal documents, the coaches and the house from its top actions, House last', async () => {
    const { host } = await render();

    const actions = Array.from(host.querySelectorAll<HTMLAnchorElement>('.top-actions a'));
    expect(actions.map((link) => [textOf(link), link.getAttribute('href')])).toEqual([
      ['Legal documents', '/admin/legal'],
      ['Coaches', '/admin/coaches'],
      ['House', '/admin/house'],
    ]);
    expect(host.querySelector('a[data-coaches]')?.classList).toContain('tb-button--text');
    expect(host.querySelector('a[data-house]')?.classList).toContain('tb-button--text');
  });

  it('knows the platform admin role', () => {
    expect(isPlatformAdmin(['PlatformAdmin'])).toBe(true);
    expect(isPlatformAdmin([])).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});
