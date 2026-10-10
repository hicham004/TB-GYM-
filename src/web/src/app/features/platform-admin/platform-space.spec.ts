import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { fill, press, settle } from '../../../testing/dom';
import { atlasDetail, NOW, SPACE_IDS, TODAY } from '../../../testing/platform-admin-fixtures';
import type { AdminWorkspaceDetail } from '../billing/billing.models';
import { PlatformAdminApi } from './platform-admin-api';
import { PlatformSpace } from './platform-space';

type Api = { [K in keyof PlatformAdminApi]: ReturnType<typeof vi.fn> };

async function render(
  detail: () => AdminWorkspaceDetail = atlasDetail,
  overrides: Partial<Api> = {},
) {
  const api: Api = {
    getWorkspaces: vi.fn(),
    getWorkspace: vi.fn(() => of(detail())),
    getPricePlans: vi.fn(),
    publishPricePlan: vi.fn(),
    issueInvoices: vi.fn(),
    recordPayment: vi.fn(() => of({})),
    voidInvoice: vi.fn(() => of({})),
    grantDiscount: vi.fn(() => of({})),
    revokeDiscount: vi.fn(() => of({})),
    ...overrides,
  };
  TestBed.configureTestingModule({
    imports: [PlatformSpace],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap({ tenantId: SPACE_IDS.atlas })) },
      },
      { provide: PlatformAdminApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  });
  const fixture = TestBed.createComponent(PlatformSpace);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api };
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
      press(dialog()!, 'Close');
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
