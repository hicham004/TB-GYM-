import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  ClientEnrollment,
  CoachClientDetails,
  ProductCatalog,
} from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, fill, press, query, settle } from '../../../testing/dom';
import { ClientCommercial } from './client-commercial';

const CLIENT: CoachClientDetails = {
  id: 'client-1',
  userId: 'user-1',
  firstName: 'Rana',
  lastName: 'Haddad',
  email: 'rana@example.test',
  phoneNumber: null,
  birthDate: null,
  heightCentimeters: null,
  heightEnteredValue: null,
  heightEnteredUnit: null,
  workType: null,
  averageDailySteps: null,
  trainingBackground: null,
  foodPreferences: null,
  foodAversions: null,
  goals: null,
  allergies: null,
  medications: null,
  previousInjuries: null,
  onboardingStatus: 'Completed',
  onboardingCompletedAtUtc: '2026-08-01T09:00:00Z',
  coachNotes: null,
  isCoachBlocked: false,
  version: 3,
};

const CATALOG: ProductCatalog = {
  workspaceCurrencyCode: 'USD',
  products: [
    {
      id: 'product-1',
      name: 'Online coaching',
      description: null,
      isActive: true,
      version: 1,
      offers: [
        {
          id: 'offer-1',
          label: '12 weeks',
          billingModel: 'FixedDuration',
          durationCount: 12,
          durationUnit: 'Week',
          priceAmount: 450,
          priceCurrency: 'USD',
          isActive: true,
          features: [{ feature: 'Training', allowsConcurrentCoverage: false }],
          createdAtUtc: '2026-07-01T09:00:00Z',
          version: 1,
        },
        {
          id: 'offer-2',
          label: '24 weeks',
          billingModel: 'FixedDuration',
          durationCount: 24,
          durationUnit: 'Week',
          priceAmount: 800,
          priceCurrency: 'USD',
          isActive: true,
          features: [{ feature: 'Training', allowsConcurrentCoverage: false }],
          createdAtUtc: '2026-07-01T09:00:00Z',
          version: 1,
        },
      ],
    },
  ],
};

function enrollment(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return {
    id: 'enrollment-1',
    productId: 'product-1',
    offerId: 'offer-1',
    renewedFromEnrollmentId: null,
    productName: 'Online coaching',
    offerLabel: '12 weeks',
    priceAmount: 450,
    priceCurrency: 'USD',
    paidAmount: 0,
    balanceAmount: 450,
    startDate: '2026-09-01',
    endDateExclusive: '2026-12-01',
    lastActiveDate: '2026-11-30',
    storedStatus: 'PendingPayment',
    effectiveStatus: 'PendingPayment',
    statusReason: null,
    features: ['Training'],
    payments: [],
    createdAtUtc: '2026-08-25T09:00:00Z',
    version: 2,
    ...overrides,
  };
}

function overview(overrides: Partial<ClientCommercialOverview> = {}): ClientCommercialOverview {
  return {
    clientProfileId: 'client-1',
    isRelationshipBlocked: false,
    featureAccess: [
      {
        feature: 'Training',
        isAllowed: false,
        reason: 'PaymentRequired',
        enrollmentId: 'enrollment-1',
        accessibleFrom: null,
        accessibleUntilExclusive: null,
      },
    ],
    enrollments: [],
    ...overrides,
  };
}

async function render(options: { client?: CoachClientDetails; api?: Partial<ApiClient> } = {}) {
  await TestBed.configureTestingModule({
    imports: [ClientCommercial],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getProductCatalog: vi.fn(() => of(CATALOG)),
          getClientCommercialOverview: vi.fn(() => of(overview())),
          assignProduct: vi.fn(() => of(enrollment())),
          recordManualPayment: vi.fn(() => of(enrollment({ paidAmount: 450, balanceAmount: 0 }))),
          blockClientRelationship: vi.fn(() => of({ ...CLIENT, isCoachBlocked: true, version: 4 })),
          unblockClientRelationship: vi.fn(() =>
            of({ ...CLIENT, isCoachBlocked: false, version: 4 }),
          ),
          ...options.api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ClientCommercial);
  fixture.componentRef.setInput('client', options.client ?? CLIENT);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

describe('ClientCommercial', () => {
  beforeEach(() => {
    // The commands carry an idempotency key, so the payload is only assertable with a fixed one.
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-3333-4444-555555555555');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  /**
   * Assigning an offer is what starts a client's commercial history and every entitlement that
   * follows from it. The offer select carries the price, currency and duration the enrollment
   * snapshots, so a select that never reaches the model would assign the wrong service silently.
   */
  it('assigns the offer the coach picked, with an idempotency key', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Product and offer', 'offer-2');
    fill(host, 'Start date', '2026-09-01');
    await settle(fixture);

    expect(button(host, 'Assign service').disabled).toBe(false);
    press(host, 'Assign service');
    await settle(fixture);

    expect(api.assignProduct).toHaveBeenCalledWith('client-1', {
      offerId: 'offer-2',
      startDate: '2026-09-01',
      idempotencyKey: '11111111-2222-3333-4444-555555555555',
    });
    expect(host.textContent).toContain('Service assigned.');
  });

  it('offers no assignment form when the workspace has no active offer', async () => {
    const { host } = await render({
      api: {
        getProductCatalog: vi.fn(() =>
          of({ ...CATALOG, products: [{ ...CATALOG.products[0], isActive: false }] }),
        ),
      },
    });

    expect(host.textContent).toContain(
      'Create an active coaching product before assigning service',
    );
    expect(host.querySelector('.assignment-form')).toBeNull();
  });

  /**
   * A manual receipt is money. It must reach the server as the exact amount and currency the coach
   * entered, as a UTC instant, and with the optional text sent as absent rather than as "".
   */
  it('records a manual payment with the amount, currency and instant entered', async () => {
    const { fixture, host, api } = await render({
      api: {
        getClientCommercialOverview: vi.fn(() => of(overview({ enrollments: [enrollment()] }))),
      },
    });

    press(host, 'Record payment');
    await settle(fixture);

    // The outstanding balance and the enrollment's own currency are offered, not a blank form.
    expect(query<HTMLInputElement>(host, 'input[type="number"]').value).toBe('450');

    fill(host, 'Amount', '450');
    fill(host, 'Currency', 'usd');
    fill(host, 'Received', '2026-09-02T14:30');
    fill(host, 'Method', 'BankTransfer');
    fill(host, 'Reference', 'TR-99');
    await settle(fixture);

    press(host, 'Confirm payment');
    await settle(fixture);

    expect(api.recordManualPayment).toHaveBeenCalledWith('enrollment-1', {
      amount: 450,
      // Normalised to the ISO code the enrollment stores, rather than refused.
      currencyCode: 'USD',
      receivedAtUtc: new Date('2026-09-02T14:30').toISOString(),
      method: 'BankTransfer',
      reference: 'TR-99',
      // An untouched note is absent, not an empty string.
      note: null,
      idempotencyKey: '11111111-2222-3333-4444-555555555555',
    });
    expect(host.textContent).toContain('Payment recorded in the immutable payment history.');
  });

  /**
   * Regression: the currency validator was `/^[A-Z]{3}$/` while `recordPayment` uppercased the
   * value before sending it. A coach who retyped the code in lowercase left the form invalid, and
   * because nothing disables Confirm payment the click produced no request and no message at all.
   */
  it('accepts a lowercase currency code rather than dead-ending the form', async () => {
    const { fixture, host, api } = await render({
      api: {
        getClientCommercialOverview: vi.fn(() => of(overview({ enrollments: [enrollment()] }))),
      },
    });

    press(host, 'Record payment');
    await settle(fixture);
    fill(host, 'Amount', '450');
    fill(host, 'Currency', 'usd');
    await settle(fixture);
    press(host, 'Confirm payment');
    await settle(fixture);

    expect(api.recordManualPayment).toHaveBeenCalledWith(
      'enrollment-1',
      expect.objectContaining({ currencyCode: 'USD' }),
    );
  });

  it('does not record a payment of nothing', async () => {
    const { fixture, host, api } = await render({
      api: {
        getClientCommercialOverview: vi.fn(() => of(overview({ enrollments: [enrollment()] }))),
      },
    });

    press(host, 'Record payment');
    await settle(fixture);
    fill(host, 'Amount', '0');
    await settle(fixture);
    press(host, 'Confirm payment');
    await settle(fixture);

    expect(api.recordManualPayment).not.toHaveBeenCalled();
  });

  it('offers no payment control once the enrollment is paid in full', async () => {
    const paid = enrollment({
      paidAmount: 450,
      balanceAmount: 0,
      storedStatus: 'Active',
      effectiveStatus: 'Active',
    });
    const { host } = await render({
      api: { getClientCommercialOverview: vi.fn(() => of(overview({ enrollments: [paid] }))) },
    });

    expect(host.textContent).toContain('Online coaching');
    expect(() => button(host, 'Record payment')).toThrow();
  });

  /**
   * The block control gates every other feature's authorization for this workspace, so it has to
   * carry the reason and the version the coach was looking at, or an optimistic-concurrency
   * conflict is silently overwritten.
   */
  it('blocks the relationship with the reason and the version on screen', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Block access');
    await settle(fixture);

    fill(host, 'Reason', 'Payment overdue for two months.');
    await settle(fixture);
    press(host, 'Confirm block');
    await settle(fixture);

    expect(api.blockClientRelationship).toHaveBeenCalledWith(
      'client-1',
      'Payment overdue for two months.',
      3,
    );
    expect(host.textContent).toContain('Client access blocked in this workspace only.');
  });

  it('unblocks a blocked relationship rather than blocking it again', async () => {
    const { fixture, host, api } = await render({
      client: { ...CLIENT, isCoachBlocked: true },
    });

    expect(host.textContent).toContain('Blocked');
    press(host, 'Unblock');
    await settle(fixture);

    fill(host, 'Reason', 'Balance settled.');
    await settle(fixture);
    press(host, 'Confirm unblock');
    await settle(fixture);

    expect(api.unblockClientRelationship).toHaveBeenCalledWith('client-1', 'Balance settled.', 3);
    expect(api.blockClientRelationship).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Workspace relationship restored.');
  });

  it('does not change the relationship without a reason', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Block access');
    await settle(fixture);
    press(host, 'Confirm block');
    await settle(fixture);

    expect(api.blockClientRelationship).not.toHaveBeenCalled();
  });

  it('reports a rejected payment instead of claiming it was recorded', async () => {
    const wrongCurrency = new HttpErrorResponse({
      status: 400,
      error: { message: 'The receipt currency must match the enrollment currency.' },
    });
    const { fixture, host } = await render({
      api: {
        getClientCommercialOverview: vi.fn(() => of(overview({ enrollments: [enrollment()] }))),
        recordManualPayment: vi.fn(() => throwError(() => wrongCurrency)),
      },
    });

    press(host, 'Record payment');
    await settle(fixture);
    fill(host, 'Amount', '450');
    fill(host, 'Currency', 'EUR');
    await settle(fixture);
    press(host, 'Confirm payment');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'The receipt currency must match the enrollment currency.',
    );
    expect(host.textContent).not.toContain('Payment recorded');
  });

  it('shows each feature’s own access reason rather than one verdict for the client', async () => {
    const { host } = await render({
      api: {
        getClientCommercialOverview: vi.fn(() =>
          of(
            overview({
              featureAccess: [
                {
                  feature: 'Training',
                  isAllowed: true,
                  reason: 'Granted',
                  enrollmentId: 'enrollment-1',
                  accessibleFrom: '2026-09-01',
                  accessibleUntilExclusive: '2026-12-01',
                },
                {
                  feature: 'Nutrition',
                  isAllowed: false,
                  reason: 'NoEntitlement',
                  enrollmentId: null,
                  accessibleFrom: null,
                  accessibleUntilExclusive: null,
                },
              ],
            }),
          ),
        ),
      },
    });

    expect(host.textContent).toContain('Available now');
    expect(host.textContent).toContain('Not included');
  });
});
