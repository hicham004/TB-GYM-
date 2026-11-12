import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
import { press, settle, text } from '../../../testing/dom';
import { Billing } from './billing';
import { BillingApi } from './billing-api';
import type { BillingAmounts, BillingInvoice, WorkspaceBilling } from './billing.models';

function amounts(overrides: Partial<BillingAmounts> = {}): BillingAmounts {
  return {
    seats: 2,
    billableClients: 12,
    includedClients: 10,
    extraClients: 2,
    seatAmount: 30,
    extraClientAmount: 4,
    gymFeeAmount: 10,
    subtotal: 44,
    discountPercent: 0,
    discountAmount: 0,
    total: 44,
    currencyCode: 'USD',
    seatIncludedClients: 10,
    foundingIncludedClients: 0,
    grantedIncludedClients: 0,
    ...overrides,
  };
}

function invoice(overrides: Partial<BillingInvoice> = {}): BillingInvoice {
  return {
    id: 'invoice-1',
    referenceCode: 'TBG-202607-ABC234',
    periodStart: '2026-07-01',
    periodEndExclusive: '2026-08-01',
    usageFromUtc: '2026-07-01T00:00:00Z',
    issuedAtUtc: '2026-08-01T00:10:00Z',
    dueOn: '2026-08-08',
    readOnlyFrom: '2026-08-15',
    pricePlanVersion: 1,
    planSeatPrice: 15,
    planIncludedClientsPerSeat: 5,
    planExtraClientPrice: 2,
    planGymFee: 10,
    planGymFeeMinimumSeats: 2,
    foundingSeatIncludedClients: null,
    foundingTermsVersion: null,
    grantedIncludedClients: 0,
    amounts: amounts(),
    status: 'Open',
    locksWorkspace: false,
    payment: null,
    voidedAtUtc: null,
    voidReason: null,
    replacesInvoiceId: null,
    replacedByInvoiceId: null,
    ...overrides,
  };
}

function billing(overrides: Partial<WorkspaceBilling> = {}): WorkspaceBilling {
  return {
    status: 'Active',
    trialEndsAtUtc: '2026-07-01T09:00:00Z',
    currentMonth: {
      periodStart: '2026-08-01',
      usageFromUtc: '2026-08-01T00:00:00Z',
      usageToUtc: '2026-08-05T00:00:00Z',
      inTrial: false,
      pricePlanVersion: 1,
      amounts: amounts({ extraClients: 0, extraClientAmount: 0, total: 40, subtotal: 40 }),
    },
    invoices: [invoice()],
    unpaidTotal: 44,
    currencyCode: 'USD',
    readOnlyFrom: '2026-08-15',
    whishNumber: '+961 70 123 456',
    supportEmail: null,
    whatsAppNumber: null,
    discounts: [],
    foundingSeatIncludedClients: null,
    includedClientGrants: [],
    ...overrides,
  };
}

async function render(getWorkspaceBilling: () => unknown) {
  const toast = { show: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [Billing],
    providers: [
      provideRouter([]),
      { provide: BillingApi, useValue: { getWorkspaceBilling: vi.fn(getWorkspaceBilling) } },
      { provide: UiToast, useValue: toast },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantId: 'tenant-1', role: 'Owner' }),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Billing);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, toast };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** A bill line as read: its term, then its amount. */
const line = (row: Element) =>
  `${textOf(row.querySelector('dt'))} ${textOf(row.querySelector('dd'))}`;

/** The sheet on top, which the CDK draws outside the page. */
const sheet = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

const PAYMENT = {
  id: 'payment-1',
  amount: 30.8,
  currencyCode: 'USD',
  reference: 'WHISH-1',
  note: null,
  receivedOn: '2026-08-03',
  recordedAtUtc: '2026-08-03T10:00:00Z',
};

describe('Settings › Billing', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('leads with what is owed, then how to pay each unpaid invoice by its reference', async () => {
    const { host } = await render(() => of(billing()));

    expect(textOf(host.querySelector('[data-unpaid]'))).toBe('To pay $44.00');
    expect(textOf(host.querySelector('[data-billing-status] app-status-pill'))).toBe('Active');
    const pay = host.querySelector('[data-how-to-pay]')!;
    expect(textOf(pay.querySelector('.copyable .code'))).toBe('+961 70 123 456');
    const owing = Array.from(pay.querySelectorAll('[data-owing]'));
    expect(owing).toHaveLength(1);
    expect(
      ['.owing-month', '.owing-total', '.code', '.owing-due'].map((part) =>
        textOf(owing[0].querySelector(part)),
      ),
    ).toEqual(['July 2026', '$44.00', 'TBG-202607-ABC234', 'Due Aug 8, 2026']);
  });

  it('without a Whish number, names TB Gym’s support inbox and WhatsApp to ask for the details', async () => {
    const { host } = await render(() =>
      of(
        billing({
          whishNumber: null,
          supportEmail: 'support@tbgym.example',
          whatsAppNumber: '+961 70 123 456',
        }),
      ),
    );

    // Audit BILL-2: no promise that TB Gym will be in touch, but a way to reach it.
    const pay = host.querySelector('[data-how-to-pay]')!;
    expect(textOf(pay)).toContain(
      'TB Gym hasn’t set up its Whish number here yet. Ask us for the payment details:',
    );
    expect(textOf(pay)).not.toContain('will confirm the payment details');
    const links = Array.from(pay.querySelectorAll<HTMLAnchorElement>('[data-pay-contacts] a'));
    expect(links.map((link) => [textOf(link), link.getAttribute('href')])).toEqual([
      ['support@tbgym.example', 'mailto:support@tbgym.example'],
      ['WhatsApp +961 70 123 456 (opens in a new tab)', 'https://wa.me/96170123456'],
    ]);
    expect(links[1].getAttribute('rel')).toBe('noopener noreferrer');
    // The references are still there to write in the transfer note.
    expect(textOf(pay.querySelector('[data-owing] .code'))).toBe('TBG-202607-ABC234');
  });

  it('says plainly when neither a Whish number nor a contact is set on this server', async () => {
    const { host } = await render(() => of(billing({ whishNumber: null })));

    expect(textOf(host.querySelector('[data-how-to-pay] [data-pay-contacts]'))).toBe(
      'TB Gym hasn’t set up a payment number or a way to reach it on this server yet.',
    );
  });

  it('copies the Whish number and a reference, and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { fixture, host, toast } = await render(() => of(billing()));

    (host.querySelector('[data-copy-whish]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith('+961 70 123 456');
    expect(toast.show).toHaveBeenCalledWith('Whish number copied.', { tone: 'success' });

    press(host, 'Copy the reference for July 2026');
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith('TBG-202607-ABC234');
    expect(toast.show).toHaveBeenCalledWith('Reference copied.', { tone: 'success' });
  });

  it('breaks this month so far down the way the invoice will be', async () => {
    const { host } = await render(() => of(billing()));

    const lines = Array.from(host.querySelectorAll('[data-current-month] .lines > div')).map(line);
    expect(lines).toEqual([
      '2 seats $30.00',
      'Clients with a plan: 12, 10 included with your seats $0.00',
      'Gym fee $10.00',
      'Estimate so far $40.00',
    ]);
  });

  it('lists each invoice on one line and opens its lines, discount and payment in a sheet', async () => {
    const paid = invoice({
      status: 'Paid',
      amounts: amounts({ discountPercent: 30, discountAmount: 13.2, total: 30.8 }),
      payment: PAYMENT,
    });
    const { fixture, host } = await render(() =>
      of(billing({ invoices: [paid], unpaidTotal: 0, readOnlyFrom: null })),
    );

    expect(host.querySelector('[data-how-to-pay]')).toBeNull();
    expect(textOf(host.querySelector('[data-billing-status] .sentence'))).toBe(
      'You’re all paid up. An invoice comes on the 1st of each month for the month before.',
    );
    const row = host.querySelector<HTMLButtonElement>('[data-invoice="invoice-1"] button')!;
    expect(textOf(row)).toBe('July 2026 TBG-202607-ABC234 · paid Aug 3, 2026 $30.80 Paid');

    row.click();
    await settle(fixture);
    expect(textOf(sheet()?.querySelector('h2'))).toBe('July 2026 invoice');
    const lines = Array.from(sheet()!.querySelectorAll('.lines > div')).map(line);
    expect(lines).toEqual([
      'Seats: 2 × $15.00 $30.00',
      'Clients with a plan: 12, 10 included with your seats, 2 more × $2.00 $4.00',
      'Gym fee, from 2 seats $10.00',
      'Discount (30%) −$13.20',
      'Total $30.80',
    ]);
    expect(textOf(sheet())).toContain('Aug 3, 2026, transfer WHISH-1');
    expect(sheet()?.querySelector('[data-read-only-from]')).toBeNull();
  });

  it('tells the owner the read-only day of an invoice still merely waiting, and that days are UTC', async () => {
    const { fixture, host } = await render(() => of(billing()));

    // BILL-3: the day is said before the invoice is overdue, on the page and in the invoice's sheet.
    expect(textOf(host.querySelector('[data-billing-status] .sentence'))).toBe(
      'A new invoice is waiting. Pay it by its due date below. If it is still unpaid on Aug 15, 2026, your coaching space becomes read-only for you and your coaches until it is paid. Your clients keep full use.',
    );
    // BILL-6: every billing day is a UTC day, and the page says so.
    expect(textOf(host.querySelector('[data-utc-note]'))).toBe(
      'Dates here are UTC days, the one clock TB Gym bills every coaching space by, so a day here can start a few hours before or after your own midnight.',
    );
    expect(host.querySelector('[data-discount]'), 'No discount, no discount line.').toBeNull();
    expect(
      host.querySelector('[data-included-clients]'),
      'Not founding and no grant: nothing about included clients.',
    ).toBeNull();

    host.querySelector<HTMLButtonElement>('[data-invoice="invoice-1"] button')!.click();
    await settle(fixture);
    expect(line(sheet()!.querySelector('[data-read-only-from]')!)).toBe(
      'Read-only from Aug 15, 2026',
    );
  });

  it('links a voided invoice to the one that replaced it', async () => {
    const voided = invoice({
      status: 'Void',
      voidReason: 'Counted a coach twice.',
      replacedByInvoiceId: 'invoice-2',
    });
    const reissued = invoice({
      id: 'invoice-2',
      referenceCode: 'TBG-202607-XYZ789',
      replacesInvoiceId: 'invoice-1',
    });
    const { fixture, host } = await render(() => of(billing({ invoices: [reissued, voided] })));

    expect(textOf(host.querySelector('[data-invoice="invoice-1"] .invoice-detail'))).toBe(
      'TBG-202607-ABC234 · replaced, nothing to pay',
    );
    host.querySelector<HTMLButtonElement>('[data-invoice="invoice-1"] button')!.click();
    await settle(fixture);
    expect(textOf(sheet())).toContain('Voided by TB Gym: Counted a coach twice.');

    press(sheet()!, 'Open the invoice that replaced it');
    await settle(fixture);
    expect(textOf(sheet()?.querySelector('.facts .code'))).toBe('TBG-202607-XYZ789');
  });

  it('explains the trial, and that nothing is charged for it', async () => {
    const { fixture } = await render(() =>
      of(
        billing({
          status: 'Trial',
          trialEndsAtUtc: '2026-09-30T09:00:00Z',
          invoices: [],
          unpaidTotal: 0,
          readOnlyFrom: null,
          currentMonth: { ...billing().currentMonth, inTrial: true },
        }),
      ),
    );

    expect(text(fixture)).toContain('Free trial');
    expect(text(fixture)).toContain('Nothing is charged for it');
    expect(text(fixture)).toContain('nothing to pay this month so far');
    expect(text(fixture)).toContain('No invoices yet.');
  });

  it('names each discount and its last day under the bill’s state, a gap starting a new sentence', async () => {
    const { host } = await render(() =>
      of(
        billing({
          invoices: [],
          unpaidTotal: 0,
          readOnlyFrom: null,
          discounts: [
            {
              name: 'Early coach offer',
              percent: 100,
              startsOn: '2026-08-01',
              lastDay: '2026-08-20',
              endsOnExclusive: '2026-08-21',
              startsLater: false,
            },
            {
              name: 'Early coach offer',
              percent: 40,
              startsOn: '2026-08-21',
              lastDay: '2026-11-30',
              endsOnExclusive: '2026-12-01',
              startsLater: true,
            },
            {
              name: 'Spring return',
              percent: 10,
              startsOn: '2027-03-01',
              lastDay: '2027-03-31',
              endsOnExclusive: '2027-04-01',
              startsLater: true,
            },
          ],
        }),
      ),
    );

    expect(Array.from(host.querySelectorAll('[data-billing-status] p')).map(textOf)).toEqual([
      'You’re all paid up. An invoice comes on the 1st of each month for the month before.',
      'Early coach offer: free until Aug 20, 2026, then 40% off until Nov 30, 2026, then the normal price.',
      'Spring return: 10% off from Mar 1, 2027 until Mar 31, 2027, then the normal price.',
    ]);
    // The name is TB Gym's admin's words, isolated so one typed in Arabic keeps the line's order.
    expect(host.querySelector('[data-discount] [dir="auto"]')?.textContent).toBe(
      'Early coach offer',
    );
  });

  it('says during the trial what follows it: the trial sentence, then the discount line', async () => {
    const { host } = await render(() =>
      of(
        billing({
          status: 'Trial',
          trialEndsAtUtc: '2026-08-15T09:00:00Z',
          invoices: [],
          unpaidTotal: 0,
          readOnlyFrom: null,
          currentMonth: { ...billing().currentMonth, inTrial: true },
          discounts: [
            {
              name: 'Early coach offer',
              percent: 35,
              startsOn: '2026-08-15',
              lastDay: '2026-12-14',
              endsOnExclusive: '2026-12-15',
              startsLater: true,
            },
          ],
        }),
      ),
    );

    expect(Array.from(host.querySelectorAll('[data-billing-status] p')).map(textOf)).toEqual([
      'Your free trial runs until Aug 15, 2026. Nothing is charged for it, and your first invoice comes the month after.',
      'Early coach offer: 35% off from Aug 15, 2026 until Dec 14, 2026, then the normal price.',
    ]);
  });

  it('says what a founding seat includes and each grant until when, after the discount line, and where an invoice’s included clients came from', async () => {
    const counted = invoice({
      status: 'Paid',
      payment: PAYMENT,
      foundingSeatIncludedClients: 13,
      foundingTermsVersion: 2,
      grantedIncludedClients: 6,
      amounts: amounts({
        billableClients: 30,
        includedClients: 24,
        extraClients: 6,
        extraClientAmount: 12,
        subtotal: 52,
        total: 52,
        seatIncludedClients: 10,
        foundingIncludedClients: 8,
        grantedIncludedClients: 6,
      }),
    });
    const { fixture, host } = await render(() =>
      of(
        billing({
          invoices: [counted],
          unpaidTotal: 0,
          readOnlyFrom: null,
          discounts: [
            {
              name: 'Early coach offer',
              percent: 35,
              startsOn: '2026-08-01',
              lastDay: '2026-10-31',
              endsOnExclusive: '2026-11-01',
              startsLater: false,
            },
          ],
          foundingSeatIncludedClients: 13,
          includedClientGrants: [
            {
              clients: 4,
              startsOn: '2026-08-01',
              lastDay: '2026-10-31',
              endsOnExclusive: '2026-11-01',
              startsLater: false,
            },
            {
              clients: 1,
              startsOn: '2026-12-01',
              lastDay: '2027-02-28',
              endsOnExclusive: '2027-03-01',
              startsLater: true,
            },
          ],
        }),
      ),
    );

    expect(Array.from(host.querySelectorAll('[data-billing-status] p')).map(textOf)).toEqual([
      'You’re all paid up. An invoice comes on the 1st of each month for the month before.',
      'Early coach offer: 35% off until Oct 31, 2026, then the normal price.',
      'As a founding coaching space, your own seat includes 13 clients.',
      '4 more clients included until Oct 31, 2026.',
      '1 more client included from Dec 1, 2026 until Feb 28, 2027.',
    ]);

    host.querySelector<HTMLButtonElement>('[data-invoice="invoice-1"] button')!.click();
    await settle(fixture);
    expect(Array.from(sheet()!.querySelectorAll('.lines > div')).map(line)).toEqual([
      'Seats: 2 × $15.00 $30.00',
      'Clients with a plan: 30, 24 included: 10 with your seats, 8 more as a founding space, 6 more granted, 6 more × $2.00 $12.00',
      'Gym fee, from 2 seats $10.00',
      'Total $52.00',
    ]);
  });

  it('says during the trial what the founding seat includes, after the trial sentence', async () => {
    const { host } = await render(() =>
      of(
        billing({
          status: 'Trial',
          trialEndsAtUtc: '2026-08-15T09:00:00Z',
          invoices: [],
          unpaidTotal: 0,
          readOnlyFrom: null,
          currentMonth: { ...billing().currentMonth, inTrial: true },
          foundingSeatIncludedClients: 1,
        }),
      ),
    );

    expect(Array.from(host.querySelectorAll('[data-billing-status] p')).map(textOf)).toEqual([
      'Your free trial runs until Aug 15, 2026. Nothing is charged for it, and your first invoice comes the month after.',
      'As a founding coaching space, your own seat includes 1 client.',
    ]);
  });

  it('says plainly what read-only means for coaches and clients', async () => {
    const { host } = await render(() =>
      of(
        billing({
          status: 'ReadOnly',
          invoices: [invoice({ status: 'Overdue', locksWorkspace: true })],
        }),
      ),
    );

    expect(textOf(host.querySelector('[data-billing-status] app-status-pill'))).toBe(
      'Read-only until paid',
    );
    expect(textOf(host.querySelector('[data-billing-status] .sentence'))).toContain(
      'Your clients keep full use, and nothing is deleted.',
    );
    expect(textOf(host.querySelector('[data-invoice="invoice-1"] .invoice-detail'))).toBe(
      'TBG-202607-ABC234 · was due Aug 8, 2026',
    );
  });

  it('offers another try instead of an empty page when billing cannot be read', async () => {
    let calls = 0;
    const { fixture, host } = await render(() =>
      ++calls === 1
        ? throwError(() => new HttpErrorResponse({ status: 500, error: {} }))
        : of(billing()),
    );

    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Billing couldn’t be loaded.');
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelector('[data-how-to-pay]')).not.toBeNull();
  });
});
