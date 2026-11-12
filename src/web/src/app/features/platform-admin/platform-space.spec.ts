import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { UiSheet } from '../../ui/sheet';
import { button, chosenDay, fill, press, settle } from '../../../testing/dom';
import {
  adminFounding,
  amounts,
  atlasDetail,
  clientGrant,
  endedFounding,
  foundingTerms,
  invoice,
  NOW,
  plan,
  SPACE_IDS,
  TODAY,
} from '../../../testing/platform-admin-fixtures';
import type { AdminWorkspaceDetail } from '../billing/billing.models';
import { PlatformAdminApi } from './platform-admin-api';
import { PlatformFoundingApi } from './platform-founding-api';
import { PlatformSpace } from './platform-space';

type Api = { [K in keyof PlatformAdminApi]: ReturnType<typeof vi.fn> };
type FoundingApi = { [K in keyof PlatformFoundingApi]: ReturnType<typeof vi.fn> };

async function render(
  detail: () => AdminWorkspaceDetail = atlasDetail,
  overrides: Partial<Api> = {},
  foundingOverrides: Partial<FoundingApi> = {},
) {
  const api: Api = {
    getWorkspaces: vi.fn(),
    getWorkspace: vi.fn(() => of(detail())),
    getPricePlans: vi.fn(),
    getGymRequests: vi.fn(),
    publishPricePlan: vi.fn(),
    issueInvoices: vi.fn(),
    recordPayment: vi.fn(() => of({})),
    voidInvoice: vi.fn(() => of({})),
    grantDiscount: vi.fn(() => of({})),
    revokeDiscount: vi.fn(() => of({})),
    grantIncludedClients: vi.fn(() => of({})),
    revokeIncludedClientGrant: vi.fn(() => of({})),
    getLegalDocuments: vi.fn(),
    publishLegalDocument: vi.fn(),
    withdrawLegalDocument: vi.fn(),
    ...overrides,
  };
  const founding: FoundingApi = {
    markFounding: vi.fn(() => of(adminFounding())),
    endFounding: vi.fn(() => of(adminFounding())),
    checkFounding: vi.fn(() => of({ checked: 1, earned: 0 })),
    getFoundingTerms: vi.fn(() => of([foundingTerms()])),
    publishFoundingTerms: vi.fn(),
    ...foundingOverrides,
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  TestBed.configureTestingModule({
    imports: [PlatformSpace],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap({ tenantId: SPACE_IDS.atlas })) },
      },
      { provide: PlatformAdminApi, useValue: api },
      { provide: PlatformFoundingApi, useValue: founding },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(PlatformSpace);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, founding, csrf };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

const invoiceRow = (host: HTMLElement, id: string) => host.querySelector(`[data-invoice="${id}"]`)!;

/** Opens the calendar in the field named `label` inside `scope` and chooses a day. */
async function chooseDay(
  fixture: Parameters<typeof settle>[0],
  scope: ParentNode,
  label: string,
  iso: string,
) {
  const field = Array.from(scope.querySelectorAll('app-date-field')).find(
    (candidate) => textOf(candidate.querySelector('label')) === label,
  )!;
  field.querySelector<HTMLButtonElement>('button.trigger')!.click();
  await settle(fixture);
  // Turn the pages until the day is on show, as a person would.
  for (let turn = 0; turn < 36; turn++) {
    const target = field.querySelector<HTMLButtonElement>(`button.day[data-date="${iso}"]`);
    if (target) {
      target.click();
      await settle(fixture);
      return;
    }
    const first = field.querySelector<HTMLElement>('button.day')!.dataset['date']!;
    field
      .querySelector<HTMLButtonElement>(
        `button[aria-label="${iso < first ? 'Previous month' : 'Next month'}"]`,
      )!
      .click();
    await settle(fixture);
  }
  throw new Error(`The calendar never showed ${iso}.`);
}

describe('Platform billing: one coaching space', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('shows who owns the space, where it stands and what it owes', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('h1'))).toBe('Atlas Performance');
    const mail = host.querySelector<HTMLAnchorElement>('.mail')!;
    expect(mail.getAttribute('href')).toBe('mailto:karim@atlas.example');
    expect(textOf(host.querySelector('.lede'))).toBe('Karim Atlas · karim@atlas.example');
    const hero = host.querySelector('[data-space-status]')!;
    expect(textOf(hero.querySelector('app-status-pill'))).toBe('Overdue');
    expect(textOf(hero.querySelector('.next'))).toBe('Was due Oct 5, read-only from Oct 12');
    expect(textOf(hero.querySelector('[data-unpaid]'))).toBe('Owes $55.00');
    expect(textOf(hero.querySelector('.sentence'))).toBe(
      'An invoice was due Oct 5, 2026. The space goes read-only on Oct 12, 2026 if it is still unpaid.',
    );
    expect(textOf(hero.querySelector('.quiet'))).toBe('3 seats and 14 clients so far this month');
    expect(host.querySelector<HTMLAnchorElement>('[data-back]')!.getAttribute('href')).toBe(
      '/admin/billing',
    );
  });

  it('lists the invoices newest first with what became of each', async () => {
    const { host } = await render();

    expect(
      Array.from(host.querySelectorAll('[data-invoice]')).map((row) =>
        row.getAttribute('data-invoice'),
      ),
    ).toEqual(['invoice-sep', 'invoice-aug', 'invoice-jul-2', 'invoice-jul']);

    const sept = invoiceRow(host, 'invoice-sep');
    expect(textOf(sept.querySelector('.inv-month'))).toBe('September 2026');
    expect(textOf(sept.querySelector('.inv-ref'))).toBe('TBG-202609-KX4P7Q');
    expect(textOf(sept.querySelector('.inv-total'))).toBe('$55.00');
    expect(textOf(sept.querySelector('app-status-pill'))).toBe('Overdue');
    expect(textOf(sept.querySelector('.inv-detail'))).toBe(
      'Was due Oct 8, 2026, read-only from Oct 15, 2026 · Plan version 1 · 3 seats · 14 clients',
    );
    expect(sept.querySelector('[data-record-payment]')).not.toBeNull();

    const aug = invoiceRow(host, 'invoice-aug');
    expect(textOf(aug.querySelector('app-status-pill'))).toBe('Paid');
    expect(textOf(aug.querySelector('.inv-detail'))).toContain('Paid Sep 6, 2026');
    expect(textOf(aug.querySelector('.inv-note'))).toBe(
      'Reference WHISH-88214 — Paid at the Hamra shop',
    );
    expect(aug.querySelector('[data-record-payment]')).toBeNull();
    expect(aug.querySelector('[data-void]')).toBeNull();

    const voided = invoiceRow(host, 'invoice-jul');
    expect(voided.classList.contains('void')).toBe(true);
    expect(textOf(voided.querySelector('app-status-pill'))).toBe('Void');
    expect(Array.from(voided.querySelectorAll('.inv-note')).map(textOf)).toEqual([
      'Voided: The founding discount was applied late',
      'Replaced by TBG-202607-HH6E2N',
    ]);
    expect(voided.querySelector('[data-record-payment]')).toBeNull();
    expect(textOf(invoiceRow(host, 'invoice-jul-2').querySelector('.inv-note:last-child'))).toBe(
      'Replaces TBG-202607-A9C3VW',
    );
  });

  it('shows this month so far line by line, or says the space is still on its trial', async () => {
    const { host } = await render();
    expect(textOf(host.querySelector('#month-heading'))).toBe('October 2026 so far');
    expect(
      Array.from(host.querySelectorAll('[data-current-month] .lines > div')).map((line) => [
        textOf(line.querySelector('dt')),
        textOf(line.querySelector('dd')),
      ]),
    ).toEqual([
      ['3 seats', '$45.00'],
      ['Clients with a plan: 14, 15 included with your seats', '$0.00'],
      ['Gym fee', '$10.00'],
      ['Estimate so far', '$55.00'],
    ]);
    TestBed.resetTestingModule();

    const trial = atlasDetail();
    const { host: trialHost } = await render(() => ({
      ...trial,
      currentMonth: { ...trial.currentMonth, inTrial: true },
    }));
    expect(textOf(trialHost.querySelector('[data-current-month] .sentence'))).toContain(
      'On a free trial: nothing is charged for this month.',
    );
    expect(trialHost.querySelector('[data-current-month] .lines')).toBeNull();
  });

  describe('recording a payment', () => {
    async function openPayment(view: Awaited<ReturnType<typeof render>>) {
      press(view.host, 'Record payment September 2026');
      await settle(view.fixture);
      return dialog()!;
    }

    it('takes a reference and the day the money arrived, for the invoice’s exact total', async () => {
      const view = await render();
      const sheet = await openPayment(view);

      expect(textOf(sheet.querySelector('h2'))).toBe('Record payment');
      expect(textOf(sheet.querySelector('.about'))).toBe(
        'Atlas Performance September 2026 · TBG-202609-KX4P7Q',
      );
      expect(textOf(sheet.querySelector('.amount'))).toBe('Amount received $55.00');
      expect(textOf(sheet)).toContain('A payment is always the full amount');

      fill(sheet, 'Whish or transfer reference', ' WHISH-99 ');
      await settle(view.fixture);
      press(sheet, 'Record payment');
      await settle(view.fixture);

      expect(view.api.recordPayment).toHaveBeenCalledWith(
        'invoice-sep',
        55,
        'WHISH-99',
        null,
        TODAY,
      );
      expect(dialog()).toBeNull();
      expect(toast()).toContain('Payment recorded for TBG-202609-KX4P7Q.');
      expect(view.api.getWorkspace).toHaveBeenCalledTimes(2);
    });

    it('dates the payment the day it arrived, which may be a few days ago', async () => {
      const view = await render();
      const sheet = await openPayment(view);

      fill(sheet, 'Whish or transfer reference', 'WHISH-7');
      fill(sheet, 'Note (optional)', 'At the shop');
      await chooseDay(view.fixture, sheet, 'Received on', '2026-10-07');
      press(sheet, 'Record payment');
      await settle(view.fixture);

      expect(view.api.recordPayment).toHaveBeenCalledWith(
        'invoice-sep',
        55,
        'WHISH-7',
        'At the shop',
        '2026-10-07',
      );
    });

    it('greys out days before the invoice was issued and days to come', async () => {
      const view = await render();
      const sheet = await openPayment(view);

      sheet.querySelector<HTMLButtonElement>('button.trigger')!.click();
      await settle(view.fixture);
      const day = (iso: string) =>
        sheet.querySelector<HTMLButtonElement>(`button.day[data-date="${iso}"]`)!;
      expect(day('2026-09-30').getAttribute('aria-disabled')).toBe('true');
      expect(day('2026-10-01').getAttribute('aria-disabled')).toBeNull();
      expect(day('2026-10-09').getAttribute('aria-disabled')).toBeNull();
      expect(day('2026-10-10').getAttribute('aria-disabled')).toBe('true');
    });

    it('asks for the reference before sending, and puts focus on it', async () => {
      const view = await render();
      const sheet = await openPayment(view);

      press(sheet, 'Record payment');
      await settle(view.fixture);

      expect(view.api.recordPayment).not.toHaveBeenCalled();
      expect(textOf(sheet)).toContain('Enter the Whish or transfer reference.');
      expect(textOf(sheet.querySelector('[role="alert"]'))).toBe('Check the fields marked above.');
      expect(document.activeElement).toBe(
        sheet.querySelector<HTMLInputElement>('input[name="reference"]'),
      );
    });

    it('keeps the entry and shows the server’s words when it refuses', async () => {
      const refused = new HttpErrorResponse({
        status: 409,
        error: {
          code: 'invoice_void',
          message: 'This invoice was voided. Record the payment against its replacement.',
        },
      });
      const view = await render(atlasDetail, {
        recordPayment: vi.fn(() => throwError(() => refused)),
      });
      const sheet = await openPayment(view);

      fill(sheet, 'Whish or transfer reference', 'WHISH-1');
      await settle(view.fixture);
      press(sheet, 'Record payment');
      await settle(view.fixture);

      expect(dialog()).toBe(sheet);
      expect(textOf(sheet.querySelector('[role="alert"]'))).toBe(
        'This invoice was voided. Record the payment against its replacement.',
      );
      expect(sheet.querySelector<HTMLInputElement>('input[name="reference"]')!.value).toBe(
        'WHISH-1',
      );
    });

    it('asks before closing a sheet that holds something typed', async () => {
      const view = await render();
      const sheet = await openPayment(view);
      fill(sheet, 'Whish or transfer reference', 'WHISH-1');
      await settle(view.fixture);

      sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(view.fixture);
      expect(textOf(dialog()!.querySelector('h2'))).toBe('Discard what you typed?');
      press(dialog()!, 'Keep editing');
      await settle(view.fixture);
      expect(textOf(dialog()!.querySelector('h2'))).toBe('Record payment');

      dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(view.fixture);
      press(dialog()!, 'Discard');
      await settle(view.fixture);
      expect(dialog()).toBeNull();
      expect(view.api.recordPayment).not.toHaveBeenCalled();
    });

    it('closes at once when nothing was typed', async () => {
      const view = await render();
      const sheet = await openPayment(view);

      sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(view.fixture);

      expect(dialog()).toBeNull();
    });
  });

  describe('voiding an invoice', () => {
    it('needs a reason, and by default issues a corrected invoice', async () => {
      const view = await render();
      press(view.host, 'Void September 2026');
      await settle(view.fixture);
      const sheet = dialog()!;

      expect(textOf(sheet.querySelector('h2'))).toBe('Void invoice');
      expect(textOf(sheet.querySelector('.notice'))).toContain(
        'A new invoice for September 2026 is issued today at plan version 1’s prices.',
      );
      expect(textOf(sheet.querySelector('.notice'))).toContain('due 7 days from today');

      press(sheet, 'Void and reissue');
      await settle(view.fixture);
      expect(view.api.voidInvoice).not.toHaveBeenCalled();
      expect(textOf(sheet)).toContain('Say why the invoice is voided.');

      fill(sheet, 'Why is it void?', ' Wrong seat count ');
      await settle(view.fixture);
      press(sheet, 'Void and reissue');
      await settle(view.fixture);

      expect(view.api.voidInvoice).toHaveBeenCalledWith('invoice-sep', 'Wrong seat count', true);
      expect(dialog()).toBeNull();
      expect(toast()).toContain('TBG-202609-KX4P7Q was voided.');
    });

    it('can void without a replacement, and says the space then owes nothing for the month', async () => {
      const view = await render();
      press(view.host, 'Void September 2026');
      await settle(view.fixture);
      const sheet = dialog()!;

      const reissue = sheet.querySelector<HTMLInputElement>('input[name="reissue"]')!;
      reissue.checked = false;
      reissue.dispatchEvent(new Event('change'));
      fill(sheet, 'Why is it void?', 'Billed by mistake');
      await settle(view.fixture);

      expect(textOf(sheet.querySelector('.notice'))).toBe(
        'Atlas Performance will owe nothing for September 2026. The voided invoice stays on record, struck through.',
      );
      press(sheet, 'Void invoice');
      await settle(view.fixture);
      expect(view.api.voidInvoice).toHaveBeenCalledWith('invoice-sep', 'Billed by mistake', false);
    });
  });

  describe('discounts', () => {
    it('lists each discount with its days and whether it is running, and revokes one after asking', async () => {
      const view = await render();

      const rows = Array.from(view.host.querySelectorAll('[data-discount]'));
      expect(rows.map((row) => row.getAttribute('data-discount'))).toEqual([
        'discount-1',
        'discount-0',
      ]);
      expect(textOf(rows[0])).toContain('30%');
      expect(textOf(rows[0])).toContain('Sep 1, 2026 to Nov 30, 2026');
      expect(textOf(rows[0])).toContain('Founding coach');
      expect(textOf(rows[0].querySelector('app-status-pill'))).toBe('Running now');
      expect(textOf(rows[1].querySelector('app-status-pill'))).toBe('Revoked');
      expect(rows[1].querySelector('button')).toBeNull();

      press(view.host, 'Revoke 30% Founding coach');
      await settle(view.fixture);
      expect(textOf(dialog()!)).toContain(
        'Revoke the 30% discount (Sep 1, 2026 to Nov 30, 2026)? Invoices already issued keep it',
      );
      press(dialog()!, 'Keep it');
      await settle(view.fixture);
      expect(view.api.revokeDiscount).not.toHaveBeenCalled();

      press(view.host, 'Revoke 30% Founding coach');
      await settle(view.fixture);
      press(dialog()!, 'Revoke discount');
      await settle(view.fixture);
      expect(view.api.revokeDiscount).toHaveBeenCalledWith('discount-1');
      expect(toast()).toContain('Discount revoked.');
      expect(view.api.getWorkspace).toHaveBeenCalledTimes(2);
    });

    it('grants a discount of a chosen length starting on a chosen day', async () => {
      const view = await render(() => atlasDetail({ discounts: [] }));
      expect(textOf(view.host)).toContain('No discounts.');
      press(view.host, 'Grant a discount');
      await settle(view.fixture);
      const sheet = dialog()!;

      fill(sheet, 'Percent off', '100');
      fill(sheet, 'What it is for', 'Founding coach');
      await chooseDay(view.fixture, sheet, 'First day', '2026-11-01');
      press(sheet, '3 months');
      await settle(view.fixture);
      expect(textOf(sheet)).toContain('Sun, Jan 31, 2027');
      press(sheet, 'Grant discount');
      await settle(view.fixture);

      // The API takes the day after the last day.
      expect(view.api.grantDiscount).toHaveBeenCalledWith(
        SPACE_IDS.atlas,
        100,
        '2026-11-01',
        '2027-02-01',
        'Founding coach',
      );
      expect(toast()).toContain('Discount granted.');
    });

    it('says a discount would overlap one still in force, before asking the server', async () => {
      const view = await render();
      press(view.host, 'Grant a discount');
      await settle(view.fixture);
      const sheet = dialog()!;

      fill(sheet, 'Percent off', '10');
      fill(sheet, 'What it is for', 'Loyalty');
      await chooseDay(view.fixture, sheet, 'Last day', '2026-12-31');
      press(sheet, 'Grant discount');
      await settle(view.fixture);

      expect(view.api.grantDiscount).not.toHaveBeenCalled();
      expect(textOf(sheet)).toContain(
        'That overlaps the 30% discount from Sep 1, 2026 to Nov 30, 2026. Revoke it first.',
      );
    });

    it('shows the server’s refusal when the days clash at the same moment', async () => {
      const clash = new HttpErrorResponse({
        status: 409,
        error: {
          code: 'discount_overlap',
          message: 'This workspace already has a discount on some of those dates. Revoke it first.',
        },
      });
      const view = await render(() => atlasDetail({ discounts: [] }), {
        grantDiscount: vi.fn(() => throwError(() => clash)),
      });
      press(view.host, 'Grant a discount');
      await settle(view.fixture);
      const sheet = dialog()!;
      fill(sheet, 'Percent off', '10');
      fill(sheet, 'What it is for', 'Loyalty');
      press(sheet, '6 months');
      await settle(view.fixture);
      press(sheet, 'Grant discount');
      await settle(view.fixture);

      expect(textOf(sheet.querySelector('[role="alert"]'))).toBe(
        'This workspace already has a discount on some of those dates. Revoke it first.',
      );
    });
  });

  describe('founding status (notes plan N3b)', () => {
    const NEVER = /\b(verified|certified|qualified|licensed|approved)\b/i;
    const panel = (host: HTMLElement) => host.querySelector('[data-founding]')!;

    it('says a space is not founding, right after where it stands, and marks it', async () => {
      let detail = atlasDetail();
      const view = await render(
        () => detail,
        {},
        {
          markFounding: vi.fn(() => {
            detail = atlasDetail({ founding: adminFounding() });
            return of(adminFounding());
          }),
        },
      );
      expect(textOf(panel(view.host).querySelector('h2'))).toBe('Founding space');
      expect(textOf(panel(view.host).querySelector('[data-not-founding]'))).toBe(
        'Not a founding space.',
      );
      const sections = Array.from(view.host.querySelectorAll('section.panel'));
      expect(sections.indexOf(panel(view.host))).toBe(
        sections.indexOf(view.host.querySelector('[data-space-status]')!) + 1,
      );
      expect(textOf(panel(view.host))).not.toMatch(NEVER);

      press(view.host, 'Mark as founding');
      await settle(view.fixture);
      expect(view.founding.getFoundingTerms).toHaveBeenCalledTimes(1);
      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('h2'))).toBe('Mark as founding');
      expect(textOf(sheet.querySelector('[data-founding-terms-sentence]'))).toBe(
        'The badge is earned once 10 of the space’s clients have an active plan and the space is 2 months old (the terms in force). The discount is separate: grant it on this page too.',
      );
      expect(await chosenDay(view.fixture, sheet, 'Founding since')).toBe(TODAY);
      expect(textOf(sheet)).not.toMatch(NEVER);

      // What it is for is asked first, in the server's own words.
      press(sheet, 'Mark as founding');
      await settle(view.fixture);
      expect(view.founding.markFounding).not.toHaveBeenCalled();
      expect(textOf(sheet)).toContain(
        'Say what the founding status is for, in up to 200 characters.',
      );

      fill(sheet, 'What it is for', '  One of the first ten coaches ');
      press(sheet, 'Mark as founding');
      await settle(view.fixture);

      expect(view.founding.markFounding).toHaveBeenCalledWith(
        SPACE_IDS.atlas,
        TODAY,
        'One of the first ten coaches',
      );
      expect(view.csrf.refresh.mock.invocationCallOrder.at(-1)).toBeLessThan(
        view.founding.markFounding.mock.invocationCallOrder[0],
      );
      expect(dialog()).toBeNull();
      expect(toast()).toContain('Marked as founding.');
      expect(textOf(panel(view.host).querySelector('[data-founding-since]'))).toBe(
        'Founding since Sep 15, 2026 · One of the first ten coaches',
      );
    });

    it('still marks a space when the terms in force cannot be read, without their numbers', async () => {
      const view = await render(
        atlasDetail,
        {},
        { getFoundingTerms: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))) },
      );

      press(view.host, 'Mark as founding');
      await settle(view.fixture);

      expect(textOf(dialog()!.querySelector('[data-founding-terms-sentence]'))).toBe(
        'The badge is earned under the terms in force. The discount is separate: grant it on this page too.',
      );
    });

    it('keeps a refused mark on screen in the server’s words', async () => {
      const exists = new HttpErrorResponse({
        status: 409,
        error: {
          code: 'founding_exists',
          message:
            'This coaching space is already founding. End that status first to mark it again.',
        },
      });
      const view = await render(
        atlasDetail,
        {},
        { markFounding: vi.fn(() => throwError(() => exists)) },
      );

      press(view.host, 'Mark as founding');
      await settle(view.fixture);
      const sheet = dialog()!;
      fill(sheet, 'What it is for', 'One of the first ten coaches');
      press(sheet, 'Mark as founding');
      await settle(view.fixture);

      expect(textOf(sheet.querySelector('[role="alert"]'))).toBe(
        'This coaching space is already founding. End that status first to mark it again.',
      );
      expect(dialog()).toBe(sheet);
    });

    it('shows a waiting badge as the server counts it, and checks it now', async () => {
      let detail = atlasDetail({ founding: adminFounding('Waiting') });
      const view = await render(
        () => detail,
        {},
        {
          checkFounding: vi.fn(() => {
            detail = atlasDetail({ founding: adminFounding('Earned') });
            return of({ checked: 3, earned: 1 });
          }),
        },
      );
      const founding = panel(view.host);
      expect(textOf(founding.querySelector('[data-founding-since]'))).toBe(
        'Founding since Sep 15, 2026 · One of the first ten coaches',
      );
      expect(textOf(founding.querySelector('[data-founding-progress]'))).toBe(
        'Badge: 7 of 10 clients with an active plan right now · 1 of 2 months since the space started.',
      );
      expect(textOf(founding)).toContain('TB Gym checks this on its own; Check now looks at once.');
      expect(founding.querySelector('[data-mark-founding]')).toBeNull();
      expect(founding.querySelector('[data-founding-earned]')).toBeNull();
      expect(textOf(founding)).not.toMatch(NEVER);

      press(view.host, 'Check now');
      await settle(view.fixture);

      expect(view.founding.checkFounding).toHaveBeenCalledTimes(1);
      expect(view.csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        view.founding.checkFounding.mock.invocationCallOrder[0],
      );
      expect(view.api.getWorkspace).toHaveBeenCalledTimes(2);
      // The toast reads this space from the page read again, never the platform's counts.
      expect(toast()).toContain('Checked: the Founding coach badge is earned.');
      const earned = panel(view.host).querySelector('[data-founding-earned]')!;
      expect(textOf(earned.querySelector('app-status-pill'))).toBe('Founding coach');
      expect(textOf(earned.querySelector('.next'))).toBe('Badge earned Oct 3, 2026');
    });

    it('says when a check finds the badge not earned yet, or cannot run', async () => {
      const view = await render(() => atlasDetail({ founding: adminFounding('Waiting') }));
      press(view.host, 'Check now');
      await settle(view.fixture);
      expect(toast()).toContain('Checked: not earned yet.');

      view.founding.checkFounding.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );
      press(view.host, 'Check now');
      await settle(view.fixture);
      expect(toast()).toContain('The badge could not be checked. Try again.');
    });

    it('shows an earned badge with its day, and when the coach hides it', async () => {
      const view = await render(() => atlasDetail({ founding: adminFounding('Earned', true) }));

      const earned = view.host.querySelector('[data-founding-earned]')!;
      const pill = earned.querySelector('app-status-pill')!;
      expect(textOf(pill)).toBe('Founding coach');
      expect(pill.classList).toContain('success');
      expect(textOf(earned.querySelector('.next'))).toBe(
        'Badge earned Oct 3, 2026 · Hidden by the coach',
      );
      expect(view.host.querySelector('[data-check-founding]')).toBeNull();
      expect(view.host.querySelector('[data-end-founding]')).not.toBeNull();
      // Where it stands keeps its one pill: the badge's lives in its own panel.
      expect(view.host.querySelectorAll('[data-space-status] app-status-pill')).toHaveLength(1);
      expect(textOf(panel(view.host))).not.toMatch(NEVER);
    });

    it('ends a founding status for cause, a common cause filling the reason, and keeps it', async () => {
      let detail = atlasDetail({ founding: adminFounding('Earned') });
      const view = await render(
        () => detail,
        {},
        {
          endFounding: vi.fn(() => {
            detail = atlasDetail({
              foundingHistory: [
                endedFounding({
                  id: 'founding-1',
                  foundingSince: '2026-09-15',
                  note: 'One of the first ten coaches',
                  endedAtUtc: NOW,
                  endReason: 'Harm to clients',
                }),
              ],
            });
            return of(adminFounding());
          }),
        },
      );

      press(view.host, 'End founding status');
      await settle(view.fixture);
      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('h2'))).toBe('End founding status');
      expect(textOf(sheet)).toContain('Founding since Sep 15, 2026');
      expect(textOf(sheet)).toContain(
        'The badge leaves the coach’s account and their clients’ Me page at once. The discount is not changed: revoke it separately if it should end.',
      );
      expect(textOf(sheet)).toContain(
        'From next month’s invoice, the owner’s seat includes what the price plan’s seat includes, and extra clients already granted stay until you revoke them. To take only the badge away, the coach can hide it.',
      );
      expect(textOf(sheet)).not.toMatch(NEVER);
      press(sheet, 'Harm to clients');
      await settle(view.fixture);
      press(sheet, 'End founding status');
      await settle(view.fixture);

      expect(view.founding.endFounding).toHaveBeenCalledWith('founding-1', 'Harm to clients');
      expect(toast()).toContain('Founding status ended.');
      const founding = panel(view.host);
      expect(textOf(founding.querySelector('[data-not-founding]'))).toBe('Not a founding space.');
      expect(founding.querySelector('[data-mark-founding]')).not.toBeNull();
      const history = founding.querySelectorAll('[data-founding-history] li');
      expect(history).toHaveLength(1);
      expect(textOf(history[0].querySelector('.history-end'))).toBe(
        'Ended Oct 9, 2026: Harm to clients',
      );
      expect(textOf(history[0].querySelector('.quiet'))).toBe(
        'Founding since Sep 15, 2026 · One of the first ten coaches',
      );
    });

    it('says nothing about the badge when the page cannot read the space again after a check', async () => {
      let reads = 0;
      const view = await render(atlasDetail, {
        getWorkspace: vi.fn(() =>
          ++reads === 1
            ? of(atlasDetail({ founding: adminFounding('Waiting') }))
            : throwError(() => new HttpErrorResponse({ status: 500 })),
        ),
      });

      press(view.host, 'Check now');
      await settle(view.fixture);

      expect(toast()).not.toContain('not earned yet');
      expect(toast()).toContain(
        'The check ran, but this space couldn’t be read again. Read it again to see its badge.',
      );
      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'This coaching space couldn’t be loaded.',
      );
    });

    it('words the check from this space as read again, never from the platform’s counts', async () => {
      // Another space earned its badge in the same check; this one still waits.
      const waiting = await render(
        () => atlasDetail({ founding: adminFounding('Waiting') }),
        {},
        {
          checkFounding: vi.fn(() => of({ checked: 2, earned: 1 })),
        },
      );
      press(waiting.host, 'Check now');
      await settle(waiting.fixture);
      expect(toast()).toContain('Checked: not earned yet.');
      expect(toast()).not.toContain('is earned');
      TestBed.resetTestingModule();
      document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());

      // The billing sweep earned it just before the press, so this check found nothing new.
      let detail = atlasDetail({ founding: adminFounding('Waiting') });
      const earned = await render(
        () => detail,
        {},
        {
          checkFounding: vi.fn(() => {
            detail = atlasDetail({ founding: adminFounding('Earned') });
            return of({ checked: 1, earned: 0 });
          }),
        },
      );
      press(earned.host, 'Check now');
      await settle(earned.fixture);
      expect(toast()).toContain('Checked: the Founding coach badge is earned.');
    });

    it('shows a waiting badge under terms other than the first, every number the server’s', async () => {
      // A waiting badge read against version 2's terms: 12 clients and 3 months.
      const waiting = adminFounding('Waiting');
      const view = await render(() =>
        atlasDetail({
          founding: {
            ...waiting,
            badge: {
              ...waiting.badge,
              clientsWithActivePlan: 5,
              clientsNeeded: 12,
              monthsSinceStart: 1,
              monthsNeeded: 3,
              termsVersion: 2,
            },
          },
        }),
      );

      expect(textOf(view.host.querySelector('[data-founding-progress]'))).toBe(
        'Badge: 5 of 12 clients with an active plan right now · 1 of 3 months since the space started.',
      );
    });

    it('opens no mark sheet over another sheet opened while the terms were read', async () => {
      const terms = new Subject<ReturnType<typeof foundingTerms>[]>();
      const view = await render(atlasDetail, {}, { getFoundingTerms: vi.fn(() => terms) });

      press(view.host, 'Mark as founding');
      await settle(view.fixture);
      press(view.host, 'Grant a discount');
      await settle(view.fixture);
      const discount = dialog()!;
      fill(discount, 'What it is for', 'Loyalty');
      terms.next([foundingTerms()]);
      terms.complete();
      await settle(view.fixture);

      expect(dialog()).toBe(discount);
      expect(textOf(dialog()!.querySelector('h2'))).toBe('Grant a discount');
      expect(discount.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe('Loyalty');
    });

    it('opens no mark sheet once the admin has left the page', async () => {
      const terms = new Subject<ReturnType<typeof foundingTerms>[]>();
      const view = await render(atlasDetail, {}, { getFoundingTerms: vi.fn(() => terms) });

      press(view.host, 'Mark as founding');
      await settle(view.fixture);
      // A sheet's role attribute waits for a render; the sheet's own call and its surface do not.
      const opened = vi.spyOn(TestBed.inject(UiSheet), 'open');
      view.fixture.destroy();
      terms.next([foundingTerms()]);
      terms.complete();
      await Promise.resolve();
      await Promise.resolve();

      expect(opened).not.toHaveBeenCalled();
      expect(document.querySelector('app-modal-surface')).toBeNull();
    });

    it('gives focus to the panel’s heading when the pressed button goes with the reading', async () => {
      let detail = atlasDetail();
      const view = await render(
        () => detail,
        {},
        {
          markFounding: vi.fn(() => {
            detail = atlasDetail({ founding: adminFounding('Waiting') });
            return of(adminFounding());
          }),
          checkFounding: vi.fn(() => {
            detail = atlasDetail({ founding: adminFounding('Earned') });
            return of({ checked: 1, earned: 1 });
          }),
          endFounding: vi.fn(() => {
            detail = atlasDetail({ foundingHistory: [endedFounding()] });
            return of(adminFounding());
          }),
        },
      );
      const heading = () => view.host.querySelector('#founding-heading');

      // Each button has focus as a keyboard leaves it, and goes with the reading it served.
      view.host.querySelector<HTMLButtonElement>('[data-mark-founding]')!.focus();
      press(view.host, 'Mark as founding');
      await settle(view.fixture);
      const mark = dialog()!;
      fill(mark, 'What it is for', 'One of the first ten coaches');
      press(mark, 'Mark as founding');
      await settle(view.fixture);
      expect(view.host.querySelector('[data-mark-founding]')).toBeNull();
      expect(document.activeElement).toBe(heading());

      view.host.querySelector<HTMLButtonElement>('[data-check-founding]')!.focus();
      press(view.host, 'Check now');
      await settle(view.fixture);
      expect(document.activeElement).toBe(heading());

      view.host.querySelector<HTMLButtonElement>('[data-end-founding]')!.focus();
      press(view.host, 'End founding status');
      await settle(view.fixture);
      const end = dialog()!;
      press(end, 'Harm to clients');
      press(end, 'End founding status');
      await settle(view.fixture);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(heading());
    });

    it('asks before closing the end sheet with a reason typed', async () => {
      const view = await render(() => atlasDetail({ founding: adminFounding('Earned') }));

      press(view.host, 'End founding status');
      await settle(view.fixture);
      const sheet = dialog()!;
      fill(sheet, 'Why?', 'Harm to clients, reported by two of them');
      await settle(view.fixture);
      sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(view.fixture);

      expect(textOf(dialog()!)).toContain('Discard what you typed?');
      press(dialog()!, 'Keep editing');
      await settle(view.fixture);
      expect(dialog()).toBe(sheet);
      expect(sheet.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
        'Harm to clients, reported by two of them',
      );
      expect(view.founding.endFounding).not.toHaveBeenCalled();
    });

    it('lists the ended statuses beside a space marked again', async () => {
      const view = await render(() =>
        atlasDetail({ founding: adminFounding('Waiting'), foundingHistory: [endedFounding()] }),
      );

      const founding = panel(view.host);
      expect(founding.querySelector('[data-founding-progress]')).not.toBeNull();
      expect(textOf(founding.querySelector('[data-founding-history] .history-end'))).toBe(
        'Ended Aug 20, 2026: The coach asked to leave the founding group',
      );
    });
  });

  describe('extra included clients and the founding seat (notes plan N11b)', () => {
    const grants = (host: HTMLElement) => host.querySelector('[data-client-grants]');
    const seat = (host: HTMLElement) =>
      textOf(host.querySelector('[data-founding] [data-founding-seat]'));

    it('adds nothing to a space never founding and never granted, so it looks as it did', async () => {
      const { host } = await render();

      expect(grants(host)).toBeNull();
      expect(host.querySelector('[data-founding-seat]')).toBeNull();
      expect(host.querySelector('[data-invoice-included]')).toBeNull();
      expect(textOf(host)).not.toContain('Extra included clients');
    });

    it('shows a founding space an empty panel after Discounts, and what its owner’s seat includes', async () => {
      const { host } = await render(() =>
        atlasDetail({ founding: adminFounding('Waiting', false, 13) }),
      );

      const panel = grants(host)!;
      expect(textOf(panel.querySelector('h2'))).toBe('Extra included clients');
      expect(textOf(panel.querySelector('[data-no-client-grants]'))).toBe(
        'No extra clients. A grant adds its clients to the invoice of each month it covers.',
      );
      expect(panel.querySelector('[data-grant-clients]')).not.toBeNull();
      const sections = Array.from(host.querySelectorAll('section.panel'));
      const discounts = host.querySelector('#discounts-heading')!.closest('section')!;
      expect(sections.indexOf(panel as HTMLElement)).toBe(sections.indexOf(discounts) + 1);
      expect(seat(host)).toBe('Its owner’s seat includes 13 clients while it stays founding.');
    });

    it('says the price plan’s seat applies while no founding number above it is published', async () => {
      const { host } = await render(() => atlasDetail({ founding: adminFounding('Earned') }));

      expect(seat(host)).toBe(
        'Its owner’s seat includes what the price plan’s seat includes: no founding number above it is published yet.',
      );
    });

    it('lists each grant with its clients, days, note and state, and revokes one after asking', async () => {
      const view = await render(() =>
        atlasDetail({
          founding: adminFounding(),
          includedClientGrants: [
            clientGrant(),
            clientGrant({
              id: 'grant-0',
              clients: 1,
              note: 'Brought Lea Khoury',
              revokedAtUtc: '2026-09-03T09:00:00Z',
            }),
          ],
        }),
      );

      const rows = Array.from(view.host.querySelectorAll('[data-client-grant]'));
      expect(rows.map((row) => row.getAttribute('data-client-grant'))).toEqual([
        'grant-1',
        'grant-0',
      ]);
      expect(textOf(rows[0].querySelector('.percent'))).toBe('7 clients');
      expect(textOf(rows[0])).toContain('Sep 1, 2026 to Nov 30, 2026');
      expect(textOf(rows[0])).toContain('Brought Karim Haddad');
      expect(textOf(rows[0].querySelector('app-status-pill'))).toBe('Running now');
      expect(textOf(rows[1].querySelector('.percent'))).toBe('1 client');
      expect(textOf(rows[1].querySelector('app-status-pill'))).toBe('Revoked');
      expect(rows[1].querySelector('button')).toBeNull();
      // A grant row is not a discount row: the discounts' list stays as it was.
      expect(view.host.querySelectorAll('[data-discount]')).toHaveLength(2);

      press(view.host, 'Revoke 7 clients Brought Karim Haddad');
      await settle(view.fixture);
      expect(textOf(dialog()!.querySelector('h2'))).toBe('Revoke these extra clients?');
      expect(textOf(dialog()!)).not.toMatch(
        /\b(verified|certified|qualified|licensed|approved)\b/i,
      );
      expect(textOf(dialog()!)).toContain(
        'Revoke these 7 extra clients (Sep 1, 2026 to Nov 30, 2026)? Invoices already issued keep them; invoices from now on will not have them.',
      );
      press(dialog()!, 'Keep them');
      await settle(view.fixture);
      expect(view.api.revokeIncludedClientGrant).not.toHaveBeenCalled();

      press(view.host, 'Revoke 7 clients Brought Karim Haddad');
      await settle(view.fixture);
      press(dialog()!, 'Revoke clients');
      await settle(view.fixture);
      expect(view.api.revokeIncludedClientGrant).toHaveBeenCalledWith('grant-1');
      expect(view.csrf.refresh.mock.invocationCallOrder.at(-1)).toBeLessThan(
        view.api.revokeIncludedClientGrant.mock.invocationCallOrder[0],
      );
      expect(toast()).toContain('Extra clients revoked.');
      expect(view.api.getWorkspace).toHaveBeenCalledTimes(2);
    });

    it('gives the panel’s heading the focus once the revoked row’s Revoke is gone', async () => {
      let detail = atlasDetail({
        founding: adminFounding(),
        includedClientGrants: [clientGrant()],
      });
      const view = await render(() => detail, {
        revokeIncludedClientGrant: vi.fn(() => {
          detail = atlasDetail({
            founding: adminFounding(),
            includedClientGrants: [clientGrant({ revokedAtUtc: NOW })],
          });
          return of({});
        }),
      });

      const revoke = button(view.host, 'Revoke 7 clients Brought Karim Haddad');
      revoke.focus();
      revoke.click();
      await settle(view.fixture);
      press(dialog()!, 'Revoke clients');
      await settle(view.fixture);

      expect(view.host.querySelector('[data-client-grant] button')).toBeNull();
      expect(document.activeElement).toBe(view.host.querySelector('#grants-heading'));
    });

    it('leaves the focus where the admin moved it while the space was read again', async () => {
      const revoked = atlasDetail({
        founding: adminFounding(),
        includedClientGrants: [clientGrant({ revokedAtUtc: NOW })],
      });
      const reread = new Subject<AdminWorkspaceDetail>();
      let reads = 0;
      const view = await render(atlasDetail, {
        getWorkspace: vi.fn(() =>
          ++reads === 1
            ? of(atlasDetail({ founding: adminFounding(), includedClientGrants: [clientGrant()] }))
            : reread,
        ),
      });

      const revoke = button(view.host, 'Revoke 7 clients Brought Karim Haddad');
      revoke.focus();
      revoke.click();
      await settle(view.fixture);
      press(dialog()!, 'Revoke clients');
      await settle(view.fixture);
      // The read is still out: the admin opens Grant extra clients and starts typing.
      press(view.host, 'Grant extra clients');
      await settle(view.fixture);
      const clients = dialog()!.querySelector<HTMLInputElement>('input[name="clients"]')!;
      clients.focus();

      reread.next(revoked);
      reread.complete();
      await settle(view.fixture);
      expect(view.host.querySelector('[data-client-grant] button')).toBeNull();
      expect(document.activeElement).toBe(clients);
    });

    it('says a refused revoke in the server’s words and reads the space again', async () => {
      const view = await render(
        () =>
          atlasDetail({
            founding: adminFounding(),
            includedClientGrants: [clientGrant({ clients: 1 })],
          }),
        {
          revokeIncludedClientGrant: vi.fn(() =>
            throwError(
              () =>
                new HttpErrorResponse({
                  status: 409,
                  error: {
                    code: 'grant_revoked',
                    message: 'These extra clients were already revoked.',
                  },
                }),
            ),
          ),
        },
      );

      press(view.host, 'Revoke 1 client Brought Karim Haddad');
      await settle(view.fixture);
      // One client reads in the singular throughout: the title, the question and both answers.
      expect(textOf(dialog()!.querySelector('h2'))).toBe('Revoke this extra client?');
      expect(textOf(dialog()!)).toContain(
        'Revoke this extra client (Sep 1, 2026 to Nov 30, 2026)? Invoices already issued keep it; invoices from now on will not have it.',
      );
      expect(button(dialog()!, 'Keep it')).toBeTruthy();
      press(dialog()!, 'Revoke client');
      await settle(view.fixture);
      expect(toast()).toContain('These extra clients were already revoked.');
      expect(view.api.getWorkspace).toHaveBeenCalledTimes(2);
    });

    it('keeps the grants of a space whose founding status ended, with Revoke and without Grant', async () => {
      const { host } = await render(() =>
        atlasDetail({
          founding: null,
          foundingHistory: [endedFounding()],
          includedClientGrants: [
            clientGrant({ startsOn: '2026-11-01', endsOnExclusive: '2027-02-01' }),
          ],
        }),
      );

      const panel = grants(host)!;
      expect(panel).not.toBeNull();
      expect(panel.querySelector('[data-grant-clients]')).toBeNull();
      expect(textOf(panel.querySelector('app-status-pill'))).toBe('Starts later');
      expect(textOf(panel.querySelector('button'))).toBe('Revoke 7 clients Brought Karim Haddad');
      expect(host.querySelector('[data-founding-seat]')).toBeNull();
    });

    it('grants extra clients for next month alone by default, then reads the space again', async () => {
      const view = await render(() => atlasDetail({ founding: adminFounding() }));

      press(view.host, 'Grant extra clients');
      await settle(view.fixture);
      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('h2'))).toBe('Grant extra clients');
      expect(await chosenDay(view.fixture, sheet, 'First day')).toBe('2026-11-01');
      expect(await chosenDay(view.fixture, sheet, 'Last day')).toBe('2026-11-30');
      fill(sheet, 'Clients', '7');
      fill(sheet, 'What it is for', 'Brought Karim Haddad');
      press(sheet, 'Grant clients');
      await settle(view.fixture);

      expect(view.api.grantIncludedClients).toHaveBeenCalledWith(
        SPACE_IDS.atlas,
        7,
        '2026-11-01',
        '2026-12-01',
        'Brought Karim Haddad',
      );
      expect(dialog()).toBeNull();
      expect(toast()).toContain('Extra clients granted.');
      expect(view.api.getWorkspace).toHaveBeenCalledTimes(2);
    });

    it('asks before discarding a grant typed but not sent', async () => {
      const view = await render(() => atlasDetail({ founding: adminFounding() }));

      press(view.host, 'Grant extra clients');
      await settle(view.fixture);
      fill(dialog()!, 'Clients', '7');
      await settle(view.fixture);
      dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(view.fixture);
      expect(textOf(dialog()!.querySelector('h2'))).toBe('Discard what you typed?');
      press(dialog()!, 'Keep editing');
      await settle(view.fixture);
      expect(textOf(dialog()!.querySelector('h2'))).toBe('Grant extra clients');
      expect(view.api.grantIncludedClients).not.toHaveBeenCalled();
    });

    it('names the founding terms an invoice used and where its included clients came from', async () => {
      const counted = invoice({
        foundingSeatIncludedClients: 13,
        foundingTermsVersion: 2,
        grantedIncludedClients: 7,
        amounts: amounts({
          includedClients: 30,
          seatIncludedClients: 15,
          foundingIncludedClients: 8,
          grantedIncludedClients: 7,
        }),
      });
      const base = atlasDetail();
      const { host } = await render(() =>
        atlasDetail({
          founding: adminFounding('Waiting', false, 13),
          invoices: [counted, ...base.invoices.slice(1)],
          currentMonth: {
            ...base.currentMonth,
            amounts: amounts({
              includedClients: 22,
              seatIncludedClients: 15,
              grantedIncludedClients: 7,
            }),
          },
        }),
      );

      const sept = invoiceRow(host, 'invoice-sep');
      expect(textOf(sept.querySelector('.inv-detail'))).toBe(
        'Was due Oct 8, 2026, read-only from Oct 15, 2026 · Plan version 1 · founding terms v2 · 3 seats · 14 clients',
      );
      expect(textOf(sept.querySelector('[data-invoice-included]'))).toBe(
        'Clients with a plan: 14, 30 included: 15 with your seats, 8 more as a founding space, 7 more granted',
      );
      // A plain invoice of the same space shows as before.
      expect(invoiceRow(host, 'invoice-aug').querySelector('[data-invoice-included]')).toBeNull();
      expect(
        Array.from(host.querySelectorAll('[data-current-month] .lines > div')).map((line) =>
          textOf(line.querySelector('dt')),
        )[1],
      ).toBe('Clients with a plan: 14, 22 included: 15 with your seats, 7 more granted');
    });

    it('says in the mark sheet what the owner’s seat includes under the terms in force, beside the plan’s', async () => {
      const sentence = () => textOf(dialog()!.querySelector('[data-founding-seat-sentence]'));
      const mark = async (seatClients: number | null, planSeat: number | null) => {
        const view = await render(
          atlasDetail,
          {
            getPricePlans: vi.fn(() =>
              planSeat === null
                ? throwError(() => new HttpErrorResponse({ status: 500 }))
                : of([plan({ includedClientsPerSeat: planSeat })]),
            ),
          },
          {
            getFoundingTerms: vi.fn(() =>
              of([foundingTerms({ foundingSeatIncludedClients: seatClients })]),
            ),
          },
        );
        press(view.host, 'Mark as founding');
        await settle(view.fixture);
        return view;
      };

      const raised = await mark(13, 5);
      expect(raised.api.getPricePlans).toHaveBeenCalledTimes(1);
      expect(textOf(dialog()!.querySelector('.about'))).toContain(
        'The space’s owner holds the badge once it is earned. Marking changes no access.',
      );
      expect(sentence()).toBe(
        'Marking changes no access. While the space stays founding, its owner’s seat includes 13 clients (the terms in force).',
      );
      document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
      TestBed.resetTestingModule();

      await mark(13, 20);
      expect(sentence()).toBe(
        'Marking changes no access. While the space stays founding, its owner’s seat includes what the price plan’s seat includes: no founding number above it is published yet.',
      );
      document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
      TestBed.resetTestingModule();

      // The plan could not be read: the number in force is named as published.
      await mark(13, null);
      expect(sentence()).toBe(
        'Marking changes no access. While the space stays founding, its owner’s seat includes 13 clients (the terms in force).',
      );
      document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
      TestBed.resetTestingModule();

      await mark(null, 5);
      expect(sentence()).toBe(
        'Marking changes no access. While the space stays founding, its owner’s seat includes what the price plan’s seat includes: no founding number above it is published yet.',
      );
    });

    it('marks a space even when neither the terms nor the plan can be read', async () => {
      const view = await render(
        atlasDetail,
        { getPricePlans: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))) },
        { getFoundingTerms: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))) },
      );

      press(view.host, 'Mark as founding');
      await settle(view.fixture);
      expect(textOf(dialog()!.querySelector('[data-founding-seat-sentence]'))).toBe(
        'Marking changes no access. While the space stays founding, its owner’s seat includes what the terms in force give a founding seat.',
      );
      expect(textOf(dialog()!.querySelector('h2'))).toBe('Mark as founding');
    });
  });

  it('says when the coaching space does not exist', async () => {
    const view = await render(atlasDetail, {
      getWorkspace: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
    });

    expect(textOf(view.host.querySelector('app-empty-state h2'))).toBe(
      'That coaching space isn’t here',
    );
  });

  it('says when it cannot be loaded, and tries again', async () => {
    let failing = true;
    const view = await render(atlasDetail, {
      getWorkspace: vi.fn(() =>
        failing ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(atlasDetail()),
      ),
    });
    expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
      'This coaching space couldn’t be loaded.',
    );

    failing = false;
    press(view.host, 'Try again');
    await settle(view.fixture);

    expect(textOf(view.host.querySelector('h1'))).toBe('Atlas Performance');
  });
});
