import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle, text } from '../../../testing/dom';
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
    ...overrides,
  };
}

async function render(getWorkspaceBilling: () => unknown) {
  await TestBed.configureTestingModule({
    imports: [Billing],
    providers: [
      provideRouter([]),
      { provide: BillingApi, useValue: { getWorkspaceBilling: vi.fn(getWorkspaceBilling) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Billing);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('Billing', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows how to pay each unpaid invoice with its Whish number and reference code', async () => {
    const { fixture, host } = await render(() => of(billing()));

    const pay = host.querySelector('[data-how-to-pay]');
    expect(pay?.textContent).toContain('+961 70 123 456');
    expect(pay?.textContent).toContain('TBG-202607-ABC234');
    expect(pay?.textContent).toContain('$44.00');
    expect(host.querySelector('[data-unpaid]')?.textContent).toContain('$44.00');
    expect(text(fixture)).toContain('Awaiting payment');
  });

  it('breaks this month so far down the way the invoice will be', async () => {
    const { host } = await render(() => of(billing()));

    const month = host.querySelector('[data-current-month]')?.textContent ?? '';
    expect(month).toContain('Seats (2)');
    expect(month).toContain('Gym fee');
    expect(month).toContain('$40.00');
    expect(month).not.toContain('Discount');
  });

  it('shows the invoice lines, the discount and the payment once paid', async () => {
    const paid = invoice({
      status: 'Paid',
      amounts: amounts({ discountPercent: 30, discountAmount: 13.2, total: 30.8 }),
      payment: {
        id: 'payment-1',
        amount: 30.8,
        currencyCode: 'USD',
        reference: 'WHISH-1',
        note: null,
        receivedOn: '2026-08-03',
        recordedAtUtc: '2026-08-03T10:00:00Z',
      },
    });
    const { fixture, host } = await render(() =>
      of(billing({ invoices: [paid], unpaidTotal: 0, readOnlyFrom: null })),
    );

    expect(host.querySelector('[data-how-to-pay]')).toBeNull();
    const row = host.querySelector('[data-invoice="invoice-1"]')?.textContent ?? '';
    expect(row).toContain('Discount (30%)');
    expect(row).toContain('−$13.20');
    expect(row).toContain('WHISH-1');
    expect(text(fixture)).toContain('Paid');
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
    expect(text(fixture)).toContain('Nothing is charged for it.');
    expect(text(fixture)).toContain('nothing to pay for this month so far');
    expect(text(fixture)).toContain('No invoices yet.');
  });

  it('says plainly what read-only means for coaches and clients', async () => {
    const { fixture } = await render(() =>
      of(
        billing({
          status: 'ReadOnly',
          invoices: [invoice({ status: 'Overdue', locksWorkspace: true })],
        }),
      ),
    );

    expect(text(fixture)).toContain('Read-only until paid');
    expect(text(fixture)).toContain('Your clients keep full access, and nothing is deleted.');
  });

  it('reports a failed load instead of an empty page', async () => {
    const { fixture } = await render(() =>
      throwError(() => new HttpErrorResponse({ status: 500, error: {} })),
    );

    expect(text(fixture)).toContain('Billing could not be loaded.');
  });
});
