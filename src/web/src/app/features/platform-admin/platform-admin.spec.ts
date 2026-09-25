import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { button, fill, press, settle, text } from '../../../testing/dom';
import type {
  AdminWorkspace,
  AdminWorkspaceDetail,
  BillingAmounts,
  BillingInvoice,
  PricePlan,
} from '../billing/billing.models';
import { PlatformAdmin, shiftDate } from './platform-admin';
import { PlatformAdminApi } from './platform-admin-api';
import { isPlatformAdmin } from './platform-admin.guard';

const amounts: BillingAmounts = {
  seats: 1,
  billableClients: 3,
  includedClients: 5,
  extraClients: 0,
  seatAmount: 15,
  extraClientAmount: 0,
  gymFeeAmount: 0,
  subtotal: 15,
  discountPercent: 0,
  discountAmount: 0,
  total: 15,
  currencyCode: 'USD',
};

const workspace: AdminWorkspace = {
  tenantId: 'tenant-1',
  name: 'Cedar Gym',
  ownerName: 'Olivia Owner',
  ownerEmail: 'owner@example.test',
  createdAtUtc: '2026-06-01T09:00:00Z',
  status: 'Overdue',
  trialEndsAtUtc: '2026-07-01T09:00:00Z',
  seatsThisMonth: 1,
  billableClientsThisMonth: 3,
  unpaidTotal: 15,
  currencyCode: 'USD',
  currentDiscountPercent: 0,
};

const invoice: BillingInvoice = {
  id: 'invoice-1',
  referenceCode: 'TBG-202607-ABC234',
  periodStart: '2026-07-01',
  periodEndExclusive: '2026-08-01',
  usageFromUtc: '2026-07-01T09:00:00Z',
  issuedAtUtc: '2026-08-01T00:10:00Z',
  dueOn: '2026-08-08',
  readOnlyFrom: '2026-08-15',
  pricePlanVersion: 1,
  planSeatPrice: 15,
  planIncludedClientsPerSeat: 5,
  planExtraClientPrice: 2,
  planGymFee: 10,
  planGymFeeMinimumSeats: 2,
  amounts,
  status: 'Overdue',
  locksWorkspace: false,
  payment: null,
  voidedAtUtc: null,
  voidReason: null,
  replacesInvoiceId: null,
  replacedByInvoiceId: null,
};

const detail: AdminWorkspaceDetail = {
  summary: workspace,
  currentMonth: {
    periodStart: '2026-08-01',
    usageFromUtc: '2026-08-01T00:00:00Z',
    usageToUtc: '2026-08-10T00:00:00Z',
    inTrial: false,
    pricePlanVersion: 1,
    amounts,
  },
  invoices: [invoice],
  discounts: [],
};

const plan: PricePlan = {
  id: 'plan-1',
  versionNumber: 1,
  currencyCode: 'USD',
  seatPrice: 15,
  includedClientsPerSeat: 5,
  extraClientPrice: 2,
  gymFee: 10,
  gymFeeMinimumSeats: 2,
  trialDays: 30,
  paymentTermDays: 7,
  graceDays: 7,
  note: 'Placeholder',
  publishedAtUtc: '2026-09-24T00:00:00Z',
  isCurrent: true,
};

async function render() {
  const api = {
    getWorkspaces: vi.fn(() => of([workspace])),
    getWorkspace: vi.fn(() => of(detail)),
    getPricePlans: vi.fn(() => of([plan])),
    publishPricePlan: vi.fn(() => of({ ...plan, id: 'plan-2', versionNumber: 2, seatPrice: 20 })),
    issueInvoices: vi.fn(() =>
      of({ periodStart: '2026-08-01', issued: 1, alreadyIssued: 0, inTrial: 2 }),
    ),
    recordPayment: vi.fn(() => of({})),
    voidInvoice: vi.fn(() => of({})),
    grantDiscount: vi.fn(() => of({})),
    revokeDiscount: vi.fn(() => of({})),
  };
  await TestBed.configureTestingModule({
    imports: [PlatformAdmin],
    providers: [
      provideRouter([]),
      { provide: PlatformAdminApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(PlatformAdmin);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api };
}

async function openWorkspace(
  host: HTMLElement,
  fixture: Awaited<ReturnType<typeof render>>['fixture'],
) {
  press(host, 'Open Cedar Gym');
  await settle(fixture);
}

describe('PlatformAdmin', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('lists every workspace with its status, usage this month and unpaid total', async () => {
    const { host } = await render();

    const row = host.querySelector('[data-workspace="tenant-1"]')?.textContent ?? '';
    expect(row).toContain('Cedar Gym');
    expect(row).toContain('owner@example.test');
    expect(row).toContain('Overdue');
    expect(row).toContain('$15.00');
    expect(host.querySelector('[data-current-plan]')?.textContent).toContain('Version 1');
  });

  it('records a payment for the exact total with its Whish reference', async () => {
    const { fixture, host, api } = await render();
    await openWorkspace(host, fixture);

    press(host, 'Record payment');
    await settle(fixture);
    fill(host, 'Whish or transfer reference', ' WHISH-99 ');
    await settle(fixture);
    const submit = Array.from(host.querySelectorAll('form button[type="submit"]')).find((item) =>
      item.textContent?.includes('Record payment'),
    ) as HTMLButtonElement;
    submit.click();
    await settle(fixture);

    expect(api.recordPayment).toHaveBeenCalledWith('invoice-1', 15, 'WHISH-99', null);
    expect(text(fixture)).toContain('Payment recorded for TBG-202607-ABC234.');
  });

  it('voids and reissues an invoice with a reason', async () => {
    const { fixture, host, api } = await render();
    await openWorkspace(host, fixture);

    press(host, 'Void');
    await settle(fixture);
    fill(host, 'Why is it void?', 'Wrong seat count');
    await settle(fixture);
    press(host, 'Void invoice');
    await settle(fixture);

    expect(api.voidInvoice).toHaveBeenCalledWith('invoice-1', 'Wrong seat count', true);
  });

  it('grants a discount through its last day, sent as a half-open end', async () => {
    const { fixture, host, api } = await render();
    await openWorkspace(host, fixture);

    fill(host, 'Percent off', '100');
    fill(host, 'First day', '2026-09-01');
    fill(host, 'Last day', '2026-11-30');
    await settle(fixture);
    press(host, 'Grant discount');
    await settle(fixture);

    expect(api.grantDiscount).toHaveBeenCalledWith(
      'tenant-1',
      100,
      '2026-09-01',
      '2026-12-01',
      'Founding coach',
    );
  });

  it('publishes a new plan version against the version it was shown', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Seat price', '20');
    await settle(fixture);
    press(host, 'Publish new version');
    await settle(fixture);

    expect(api.publishPricePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        seatPrice: 20,
        includedClientsPerSeat: 5,
        expectedCurrentVersion: 1,
      }),
    );
    expect(text(fixture)).toContain('Price plan version 2 is published.');
  });

  it('issues last month’s invoices on demand and says what happened', async () => {
    const { fixture, host, api } = await render();

    expect(button(host, "Issue last month's invoices")).toBeTruthy();
    press(host, "Issue last month's invoices");
    await settle(fixture);

    expect(api.issueInvoices).toHaveBeenCalled();
    expect(text(fixture)).toContain('1 issued, 0 already issued, 2 in trial.');
  });

  it('shifts calendar dates without a time zone moving them', () => {
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(isPlatformAdmin(['PlatformAdmin'])).toBe(true);
    expect(isPlatformAdmin([])).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});
