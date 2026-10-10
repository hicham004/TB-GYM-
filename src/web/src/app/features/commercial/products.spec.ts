import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachingProductView, ProductCatalog } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, fill, press, settle, tick } from '../../../testing/dom';
import { atlasCatalog, offer, product } from '../../../testing/product-fixtures';
import { Products } from './products';
import { ProductsApi } from './products-api';

type Api = { [K in keyof ProductsApi]: ReturnType<typeof vi.fn> };

async function render(
  catalog: () => Observable<ProductCatalog> = () => of(atlasCatalog()),
  overrides: Partial<Api> = {},
) {
  const api: Api = {
    getCatalog: vi.fn(catalog),
    createProduct: vi.fn(() => of(product({ id: 'p-new', name: 'Hybrid Coaching' }))),
    updateProduct: vi.fn((_id: string, request: { isActive: boolean }) =>
      of(product({ isActive: request.isActive, version: 2 })),
    ),
    addOffer: vi.fn(() => of(product())),
    setOfferAvailability: vi.fn((id: string, isActive: boolean) =>
      of(product({ offers: [offer({ id, isActive, version: 5 })] })),
    ),
    changePrice: vi.fn(() => of(product())),
    ...overrides,
  };
  TestBed.configureTestingModule({
    imports: [Products],
    providers: [
      { provide: ProductsApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(Products);
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

/** Chooses `item` from the menu named `label`. */
async function choose(
  fixture: { detectChanges(): void },
  host: HTMLElement,
  label: string,
  item: string,
) {
  const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`No menu is named "${label}".`);
  trigger.click();
  await settle(fixture as never);
  // Matched by its title: an item with a hint reads both.
  const choice = Array.from(host.querySelectorAll<HTMLButtonElement>('.panel .item')).find(
    (candidate) => textOf(candidate.querySelector('.item-title')) === item,
  );
  if (!choice) throw new Error(`The menu "${label}" has no "${item}".`);
  choice.click();
  await settle(fixture as never);
}

const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

describe('Plans you sell', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('shows each plan with its clients, price options shortest first and what each includes', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('h1'))).toBe('Plans you sell');
    expect(textOf(host.querySelector('.lede'))).toBe('2 plans for sale · 8 clients on them now');
    const selling = Array.from(host.querySelectorAll('.plans > .cards > .card'));
    expect(selling.map((card) => textOf(card.querySelector('.card-name')))).toEqual([
      'Online Coaching',
      'Strength Program',
    ]);
    const [online, strength] = selling;
    expect(textOf(online.querySelector('.clients'))).toBe('6 clients · 1 starting');
    const options = Array.from(online.querySelectorAll(':scope > .options > .option'));
    expect(
      options.map((row) =>
        ['.price', '.length', '.option-clients'].map((part) => textOf(row.querySelector(part))),
      ),
    ).toEqual([
      ['USD 130', '4 weeks', '2 clients'],
      ['USD 330', '12 weeks', '4 clients · 1 starting'],
    ]);
    // Both options include the same, so the plan says it once and the rows do not repeat it.
    expect(Array.from(online.querySelectorAll(':scope > .includes .chip')).map(textOf)).toEqual([
      'Training',
      'Nutrition',
      'Check-ins',
      'Messaging',
    ]);
    expect(options[0].querySelector('.includes')).toBeNull();
    // An option named for more than its length keeps its name; cents show only when there are some.
    expect(textOf(strength.querySelector('.option .price'))).toBe('USD 180.50');
    expect(textOf(strength.querySelector('.option .length'))).toBe('8 weeks · Meet prep');

    // Old prices and plans no longer sold wait behind a closed disclosure.
    const retired = online.querySelector<HTMLDetailsElement>('details.retired')!;
    expect(retired.open).toBe(false);
    expect(textOf(retired.querySelector('summary'))).toBe('Old price options (1)');
    const stopped = host.querySelector<HTMLDetailsElement>('details.stopped')!;
    expect(stopped.open).toBe(false);
    expect(textOf(stopped.querySelector('summary'))).toBe('No longer sold (1)');
    expect(textOf(stopped.querySelector('.card-name'))).toBe('Summer Shred');
    expect(stopped.querySelector('.card-foot')).toBeNull();
  });

  it('invites a coach with nothing to sell to create the first plan', async () => {
    const { fixture, host } = await render(() =>
      of({ workspaceCurrencyCode: 'LBP', products: [] }),
    );

    expect(textOf(host.querySelector('app-empty-state h2'))).toBe('Nothing to sell yet');
    press(host, 'Create your first plan');
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('New plan');
    // The first price option starts in the workspace's currency.
    expect(dialog()!.querySelector<HTMLInputElement>('input[name="currency"]')!.value).toBe('LBP');
  });

  it('says so when the plans cannot be loaded, and tries again', async () => {
    let fail = true;
    const { fixture, host, api } = await render(() =>
      fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(atlasCatalog()),
    );
    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Your plans could not be loaded.');
    fail = false;
    press(host, 'Try again');
    await settle(fixture);
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('.card')).toHaveLength(3);
  });

  it('creates a plan with its first price option, named by its length unless the coach names it', async () => {
    const { fixture, host, api } = await render();
    press(host, 'New plan');
    await settle(fixture);
    const sheet = dialog()!;

    fill(sheet, 'Plan name', '  Hybrid Coaching ');
    fill(sheet, 'Length in weeks', '8');
    fill(sheet, 'Price', '250');
    fill(sheet, 'Currency', 'eur');
    tick(sheet, 'Nutrition');
    tick(sheet, 'Messaging', false);
    await settle(fixture);
    expect(textOf(sheet.querySelector('[aria-live="polite"]'))).toBe(
      'Clients pay EUR 250 for 8 weeks. You record each payment on their profile.',
    );
    press(sheet, 'Create plan');
    await settle(fixture);

    expect(api.createProduct).toHaveBeenCalledWith({
      name: 'Hybrid Coaching',
      description: null,
      initialOffer: {
        label: '8 weeks',
        durationCount: 8,
        durationUnit: 'Week',
        priceAmount: 250,
        priceCurrency: 'EUR',
        features: [
          { feature: 'Training', allowsConcurrentCoverage: false },
          { feature: 'Nutrition', allowsConcurrentCoverage: false },
          { feature: 'CheckIns', allowsConcurrentCoverage: false },
        ],
      },
    });
    expect(dialog()).toBeNull();
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
    expect(toast()).toContain('Hybrid Coaching is ready to sell.');
  });

  it('sends nothing for a plan with no name, no price or nothing included', async () => {
    const { fixture, host, api } = await render();
    press(host, 'New plan');
    await settle(fixture);
    const sheet = dialog()!;
    for (const feature of ['Training', 'Check-ins', 'Messaging']) tick(sheet, feature, false);
    await settle(fixture);
    press(sheet, 'Create plan');
    await settle(fixture);

    expect(api.createProduct).not.toHaveBeenCalled();
    expect(textOf(sheet.querySelector('[role="alert"]'))).toBe('Check the fields marked above.');
    expect(sheet.textContent).toContain('Give the plan a name clients will recognise.');
    expect(sheet.textContent).toContain('Enter a price of zero or more.');
    expect(sheet.textContent).toContain('Choose at least one thing the plan includes.');
  });

  it('asks before closing a sheet with something typed in it', async () => {
    const { fixture, host } = await render();
    press(host, 'New plan');
    await settle(fixture);
    fill(dialog()!, 'Plan name', 'Hybrid');
    await settle(fixture);
    press(dialog()!, 'Not now');
    await settle(fixture);

    expect(textOf(dialog()?.querySelector('h2'))).toBe('Close without saving?');
    press(dialog()!, 'Keep editing');
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('New plan');
  });

  it('adds a price option and explains a duplicate length beside the form, keeping the entry', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: { code: 'active_offer_slot_conflict', message: 'Duplicate active option.' },
    });
    const { fixture, host, api } = await render(undefined, {
      addOffer: vi.fn(() => throwError(() => conflict)),
    });
    const online = host.querySelector('.card')!;
    press(online as HTMLElement, 'Add price option');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('New price option');
    fill(sheet, 'Length in weeks', '12');
    fill(sheet, 'Price', '360');
    await settle(fixture);
    press(sheet, 'Add price option');
    await settle(fixture);

    expect(api.addOffer).toHaveBeenCalledWith(
      'p-online',
      expect.objectContaining({ durationCount: 12, priceAmount: 360 }),
    );
    expect(textOf(sheet.querySelector('[role="alert"]'))).toBe(
      'This plan already sells an option of that length in that currency. Change its price instead, or stop selling it first.',
    );
    expect(sheet.querySelector<HTMLInputElement>('input[name="price"]')!.value).toBe('360');
  });

  it('changes a price with the option’s version, retrying an uncertain change under the same key', async () => {
    let calls = 0;
    const { fixture, host, api } = await render(undefined, {
      changePrice: vi.fn(() =>
        ++calls === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(product()),
      ),
    });
    await choose(fixture, host, 'More for 12 weeks at USD 330', 'Change price');
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('.plan-line'))).toContain(
      'Online Coaching · 12 weeks, now USD 330',
    );

    fill(sheet, 'New price', '330');
    await settle(fixture);
    press(sheet, 'Change price');
    await settle(fixture);
    expect(api.changePrice).not.toHaveBeenCalled();
    expect(sheet.textContent).toContain('Choose a different price for this option.');

    fill(sheet, 'New price', '360.505');
    await settle(fixture);
    press(sheet, 'Change price');
    await settle(fixture);
    expect(sheet.textContent).toContain('Use at most two decimals.');

    fill(sheet, 'New price', '360');
    await settle(fixture);
    press(sheet, 'Change price');
    await settle(fixture);
    press(sheet, 'Change price');
    await settle(fixture);

    const [first, second] = api.changePrice.mock.calls as [string, { idempotencyKey: string }][];
    expect(first[0]).toBe('o-12');
    expect(first[1]).toEqual({ priceAmount: 360, version: 1, idempotencyKey: expect.any(String) });
    expect(second[1].idempotencyKey).toBe(first[1].idempotencyKey);
    expect(toast()).toContain('Clients already on this option keep their price and payments.');
  });

  it('stops selling a plan with its version, and Undo sells it again from the new version', async () => {
    const { fixture, host, api } = await render();
    await choose(fixture, host, 'More for Online Coaching', 'Stop selling this plan');

    expect(api.updateProduct).toHaveBeenCalledWith('p-online', {
      name: 'Online Coaching',
      description: 'Your own program, a weekly check-in and direct chat with your coach.',
      isActive: false,
      version: 1,
    });
    expect(toast()).toContain(
      'You no longer sell Online Coaching. Clients already on it keep their plan.',
    );
    button(document.body, 'Undo').click();
    await settle(fixture);
    expect(api.updateProduct).toHaveBeenLastCalledWith(
      'p-online',
      expect.objectContaining({ isActive: true, version: 2 }),
    );
  });

  it('stops selling one price option, keeping it under Old price options, with Undo', async () => {
    const { fixture, host, api } = await render();
    await choose(fixture, host, 'More for 4 weeks at USD 130', 'Stop selling');

    expect(api.setOfferAvailability).toHaveBeenCalledWith('o-4', false, 1);
    expect(toast()).toContain('You no longer sell Online Coaching for 4 weeks.');
    button(document.body, 'Undo').click();
    await settle(fixture);
    expect(api.setOfferAvailability).toHaveBeenLastCalledWith('o-4', true, 5);
  });

  it('reports a refused write in coach words and reloads the plans', async () => {
    const { fixture, host, api } = await render(undefined, {
      updateProduct: vi.fn(() =>
        throwError(
          () => new HttpErrorResponse({ status: 409, error: { code: 'concurrency_conflict' } }),
        ),
      ),
    });
    await choose(fixture, host, 'More for Online Coaching', 'Stop selling this plan');

    expect(toast()).toContain(
      'This plan changed since you opened it. It has been reloaded; try again.',
    );
    expect(api.getCatalog).toHaveBeenCalledTimes(2);
  });

  it('edits a plan’s name and description, keeping whether it is sold', async () => {
    const saved: CoachingProductView = product({ name: 'Online Coaching Pro' });
    const { fixture, host, api } = await render(undefined, {
      updateProduct: vi.fn(() => of(saved)),
    });
    await choose(fixture, host, 'More for Strength Program', 'Edit name and description');
    const sheet = dialog()!;
    expect(sheet.querySelector<HTMLInputElement>('input[name="plan-name"]')!.value).toBe(
      'Strength Program',
    );
    fill(sheet, 'Plan name', 'Strength Program Pro');
    await settle(fixture);
    press(sheet, 'Save');
    await settle(fixture);

    expect(api.updateProduct).toHaveBeenCalledWith('p-strength', {
      name: 'Strength Program Pro',
      description: 'Powerlifting-style programming with technique feedback on your lifts.',
      isActive: true,
      version: 1,
    });
  });
});
