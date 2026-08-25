import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CoachingProduct, ProductCatalog, ProductOffer } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, fill, press, query, settle, tick, type } from '../../../testing/dom';
import { Products } from './products';

function offer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
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
    ...overrides,
  };
}

function product(overrides: Partial<CoachingProduct> = {}): CoachingProduct {
  return {
    id: 'product-1',
    name: 'Online coaching',
    description: null,
    isActive: true,
    offers: [offer()],
    version: 2,
    ...overrides,
  };
}

function catalog(products: CoachingProduct[] = []): ProductCatalog {
  return { workspaceCurrencyCode: 'USD', products };
}

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [Products],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getProductCatalog: vi.fn(() => of(catalog())),
          createCoachingProduct: vi.fn(() => of(product())),
          addProductOffer: vi.fn(() => of(offer({ id: 'offer-2' }))),
          updateCoachingProduct: vi.fn(() => of(product({ isActive: false }))),
          setOfferAvailability: vi.fn(() => of(offer({ isActive: false }))),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Products);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

/** The Price label wraps both the amount and the currency, so the code is reached by its own box. */
const CURRENCY_BOX = 'input[maxlength="3"]';

describe('Products', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * A product and its first immutable offer are created together, and the offer is what every
   * later enrollment snapshots its price, duration and included access from. A checkbox that never
   * reaches the model would sell access the coach did not intend to include.
   */
  it('creates a product with the offer and the access boxes that were ticked', async () => {
    const { fixture, host, api } = await render();

    // With no products yet the form is already open, because there is nothing else to do here.
    expect(host.textContent).toContain('Create a coaching product');

    fill(host, 'Product name', 'Online coaching');
    fill(host, 'Offer label', '12 weeks');
    fill(host, 'Description', 'Remote programming and weekly review.');
    fill(host, 'Duration', '12');
    fill(host, 'Price', '450');
    type(host, CURRENCY_BOX, 'USD');
    tick(host, 'Nutrition');
    tick(host, 'Check-ins', false);
    await settle(fixture);

    expect(button(host, 'Create product').disabled).toBe(false);
    press(host, 'Create product');
    await settle(fixture);

    expect(api.createCoachingProduct).toHaveBeenCalledWith({
      name: 'Online coaching',
      description: 'Remote programming and weekly review.',
      initialOffer: {
        label: '12 weeks',
        durationCount: 12,
        durationUnit: 'Week',
        priceAmount: 450,
        priceCurrency: 'USD',
        // Training stays on, Nutrition was ticked, Check-ins was unticked. Nothing else is sold.
        features: [
          { feature: 'Training', allowsConcurrentCoverage: false },
          { feature: 'Nutrition', allowsConcurrentCoverage: false },
        ],
      },
    });
    expect(host.textContent).toContain('Coaching product created.');
  });

  /**
   * Regression: the currency validator was `/^[A-Z]{3}$/` while `toOfferRequest` uppercased the
   * value before sending it, so a lowercase code left the form invalid with nothing disabled and
   * nothing said — Create product simply did nothing.
   */
  it('accepts a lowercase currency code rather than dead-ending the form', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Product name', 'Online coaching');
    fill(host, 'Offer label', '12 weeks');
    fill(host, 'Duration', '12');
    fill(host, 'Price', '450');
    type(host, CURRENCY_BOX, 'usd');
    await settle(fixture);
    press(host, 'Create product');
    await settle(fixture);

    expect(api.createCoachingProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        initialOffer: expect.objectContaining({ priceCurrency: 'USD' }),
      }),
    );
  });

  it('refuses to create a product that includes no access at all', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Product name', 'Online coaching');
    fill(host, 'Offer label', '12 weeks');
    fill(host, 'Duration', '12');
    fill(host, 'Price', '450');
    type(host, CURRENCY_BOX, 'USD');
    tick(host, 'Training', false);
    tick(host, 'Check-ins', false);
    await settle(fixture);
    press(host, 'Create product');
    await settle(fixture);

    expect(api.createCoachingProduct).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Select at least one coaching feature.',
    );
  });

  it('does not create a product with no name', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Offer label', '12 weeks');
    fill(host, 'Price', '450');
    type(host, CURRENCY_BOX, 'USD');
    await settle(fixture);
    press(host, 'Create product');
    await settle(fixture);

    expect(api.createCoachingProduct).not.toHaveBeenCalled();
  });

  /** A new price or duration is a new offer, never an edit of the one clients already bought. */
  it('adds a second offer to an existing product', async () => {
    const { fixture, host, api } = await render({
      getProductCatalog: vi.fn(() => of(catalog([product()]))),
    });

    press(host, 'Add offer');
    await settle(fixture);

    fill(host, 'Label', '24 weeks');
    fill(host, 'Duration', '24');
    fill(host, 'Price', '800');
    type(host, CURRENCY_BOX, 'USD');
    await settle(fixture);
    press(host, 'Save offer');
    await settle(fixture);

    expect(api.addProductOffer).toHaveBeenCalledWith('product-1', {
      label: '24 weeks',
      durationCount: 24,
      durationUnit: 'Week',
      priceAmount: 800,
      priceCurrency: 'USD',
      features: [
        { feature: 'Training', allowsConcurrentCoverage: false },
        { feature: 'CheckIns', allowsConcurrentCoverage: false },
      ],
    });
    expect(host.textContent).toContain(
      'New offer added. Existing enrollments were left unchanged.',
    );
  });

  it('archives a product with the version it was shown at', async () => {
    const { fixture, host, api } = await render({
      getProductCatalog: vi.fn(() => of(catalog([product()]))),
    });

    press(host, 'Archive');
    await settle(fixture);

    expect(api.updateCoachingProduct).toHaveBeenCalledWith('product-1', {
      name: 'Online coaching',
      description: null,
      isActive: false,
      version: 2,
    });
    expect(host.textContent).toContain('Product archived.');
  });

  it('retires an offer without deleting it from the catalogue', async () => {
    const { fixture, host, api } = await render({
      getProductCatalog: vi.fn(() => of(catalog([product()]))),
    });

    press(host, 'Retire');
    await settle(fixture);

    expect(api.setOfferAvailability).toHaveBeenCalledWith('offer-1', false, 1);
    expect(host.textContent).toContain('Offer retired.');
    // The offer is still listed, because past enrollments reference it.
    expect(host.textContent).toContain('12 weeks');
  });

  it('reports a refused creation instead of listing a product that does not exist', async () => {
    const refused = new HttpErrorResponse({
      status: 409,
      error: { title: 'A product with that name already exists.' },
    });
    const { fixture, host } = await render({
      createCoachingProduct: vi.fn(() => throwError(() => refused)),
    });

    fill(host, 'Product name', 'Online coaching');
    fill(host, 'Offer label', '12 weeks');
    fill(host, 'Duration', '12');
    fill(host, 'Price', '450');
    type(host, CURRENCY_BOX, 'USD');
    await settle(fixture);
    press(host, 'Create product');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'A product with that name already exists.',
    );
    expect(host.textContent).toContain('No products yet');
  });

  it('reports a failed load instead of claiming the catalogue is empty', async () => {
    const { host } = await render({
      getProductCatalog: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain(
      'Coaching products could not be loaded.',
    );
    expect(host.textContent).not.toContain('No products yet');
  });
});
