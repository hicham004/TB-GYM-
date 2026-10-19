import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { fill, press, settle } from '../../../testing/dom';
import {
  gymRequests,
  NOW,
  plan,
  platformSpaces,
  pricePlans,
  SPACE_IDS,
} from '../../../testing/platform-admin-fixtures';
import type { AdminWorkspace, PricePlan } from '../billing/billing.models';
import { PlatformAdmin } from './platform-admin';
import { PlatformAdminApi } from './platform-admin-api';
import { isPlatformAdmin } from './platform-admin.guard';

type Api = { [K in keyof PlatformAdminApi]: ReturnType<typeof vi.fn> };

async function render(
  spaces: () => AdminWorkspace[] = platformSpaces,
  overrides: Partial<Api> = {},
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
    ...overrides,
  };
  TestBed.configureTestingModule({
    imports: [PlatformAdmin],
    providers: [
      provideRouter([]),
      { provide: PlatformAdminApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  });
  const fixture = TestBed.createComponent(PlatformAdmin);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The sheet or dialog on top, which the CDK draws outside the page. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

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
    const { host } = await render();

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
    const earlier = section.querySelector<HTMLDetailsElement>('details.versions')!;
    expect(earlier.open).toBe(false);
    expect(textOf(earlier.querySelector('summary'))).toBe('Earlier versions (1)');
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
    expect(textOf(sheet)).toContain('Version 2 is in force.');
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
    expect(toast()).toContain('Price plan version 3 is published.');
    expect(api.getPricePlans).toHaveBeenCalledTimes(2);
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

  it('knows the platform admin role', () => {
    expect(isPlatformAdmin(['PlatformAdmin'])).toBe(true);
    expect(isPlatformAdmin([])).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});
