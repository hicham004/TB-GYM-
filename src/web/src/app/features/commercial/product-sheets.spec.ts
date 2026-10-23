import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachingProductView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { announced, button, field, fill, press, query, settle, tick } from '../../../testing/dom';
import { features, offer, product } from '../../../testing/product-fixtures';
import { ProductSheet, type ProductSheetMode } from './product-sheets';
import { ProductsApi } from './products-api';

interface Options {
  readonly currency?: string;
  readonly refresh?: () => Promise<void>;
}

async function render(mode: ProductSheetMode, options: Options = {}) {
  const saved = product({ id: 'p-saved', name: 'Saved plan' });
  const api = {
    createProduct: vi.fn<ProductsApi['createProduct']>(() => of(saved)),
    addOffer: vi.fn<ProductsApi['addOffer']>(() => of(saved)),
    updateProduct: vi.fn<ProductsApi['updateProduct']>(() => of(saved)),
    changePrice: vi.fn<ProductsApi['changePrice']>(() => of(saved)),
  };
  const refresh = vi.fn(options.refresh ?? (() => Promise.resolve()));
  const tenant = signal('tenant-1');
  TestBed.configureTestingModule({
    imports: [ProductSheet],
    providers: [
      { provide: ProductsApi, useValue: api },
      { provide: CsrfService, useValue: { refresh } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  });
  const fixture = TestBed.createComponent(ProductSheet);
  fixture.componentRef.setInput('mode', mode);
  fixture.componentRef.setInput('currency', options.currency ?? 'USD');
  const closed: (CoachingProductView | null)[] = [];
  const dirty: boolean[] = [];
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, saved, tenant, closed, dirty };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The words under a box, help or reason, read where the box points a screen reader. */
function describedText(control: Element): string {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => textOf(document.getElementById(id)))
    .filter((words) => words.length > 0)
    .join(' ');
}

/** The reason under a box marked wrong, or '' while it is not marked. */
function reasonFor(control: Element): string {
  return control.getAttribute('aria-invalid') === 'true' ? describedText(control) : '';
}

/** What's included, in order: each box's name and whether it is ticked. */
function included(host: HTMLElement): [string, boolean][] {
  return Array.from(host.querySelectorAll('fieldset.features app-checkbox')).map((item) => [
    textOf(item.querySelector('label')),
    item.querySelector<HTMLInputElement>('input')!.checked,
  ]);
}

const sellLine = (host: HTMLElement) => textOf(host.querySelector('p[aria-live="polite"]'));

const ONLINE = product();

describe('ProductSheet', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('what each sheet asks', () => {
    it('asks a new plan for its name, what clients get and a first price option in the workspace’s currency', async () => {
      const { host } = await render({ kind: 'new' }, { currency: 'LBP' });

      expect(field(host, 'Plan name').value).toBe('');
      const description = field<HTMLTextAreaElement>(host, 'What clients get (optional)');
      expect(describedText(description)).toBe(
        'One or two sentences, as you would say it to a new client.',
      );
      expect(textOf(host.querySelector('h3'))).toBe('First price option');
      expect(field(host, 'Length in weeks').value).toBe('12');
      expect(field(host, 'Price').value).toBe('');
      expect(field(host, 'Currency').value).toBe('LBP');
      expect(textOf(host.querySelector('fieldset.features legend'))).toBe('What’s included');
      expect(included(host)).toEqual([
        ['Training', true],
        ['Nutrition', false],
        ['Check-ins', true],
        ['Messaging', true],
        ['Resources', false],
      ]);
      expect(button(host, 'Create plan').type).toBe('submit');
      expect(host.textContent).not.toContain('New price');
    });

    it('adds a price option to the plan it names, asking nothing about the plan itself', async () => {
      const { host } = await render({ kind: 'option', product: ONLINE });

      expect(textOf(host.querySelector('.plan-line .caption'))).toBe('Plan');
      expect(textOf(host.querySelector('.plan-line [dir="auto"]'))).toBe('Online Coaching');
      expect(() => field(host, 'Plan name')).toThrow();
      expect(host.querySelector('h3')).toBeNull();
      expect(field(host, 'Length in weeks').value).toBe('12');
      expect(included(host)).toHaveLength(5);
      expect(button(host, 'Add price option').type).toBe('submit');
    });

    it('changes one option’s price, naming the option and what happens to its clients', async () => {
      const { host } = await render({ kind: 'price', product: ONLINE, offer: offer() });

      expect(textOf(host.querySelector('.plan-line .caption'))).toBe('Price option');
      expect(textOf(host.querySelector('.plan-line [dir="auto"]'))).toBe(
        'Online Coaching · 12 weeks, now USD 330',
      );
      expect(field(host, 'New price').value).toBe('330');
      expect(textOf(host.querySelector('.unit'))).toBe('USD');
      expect(host.textContent?.replace(/\s+/g, ' ')).toContain(
        'New plans use the new price. Clients already on this option keep their price, dates and payments.',
      );
      expect(() => field(host, 'Length in weeks')).toThrow();
      expect(host.querySelector('fieldset.features')).toBeNull();
      expect(button(host, 'Change price').type).toBe('submit');
    });

    it('edits a plan’s name and description from what it says now', async () => {
      const { host } = await render({ kind: 'details', product: ONLINE });

      expect(field(host, 'Plan name').value).toBe('Online Coaching');
      expect(field<HTMLTextAreaElement>(host, 'What clients get (optional)').value).toBe(
        'Your own program, a weekly check-in and direct chat with your coach.',
      );
      expect(() => field(host, 'Price')).toThrow();
      expect(host.querySelector('fieldset.features')).toBeNull();
      expect(button(host, 'Save').type).toBe('submit');
    });
  });

  describe('the price option', () => {
    it('says in one line what a client would be sold, paid or free', async () => {
      const { fixture, host } = await render({ kind: 'new' });
      // No price yet: nothing to sell, so nothing is said, though the region is there to say it.
      expect(host.querySelector('p[aria-live="polite"]')).not.toBeNull();
      expect(sellLine(host)).toBe('');

      fill(host, 'Length in weeks', '4');
      fill(host, 'Price', '120');
      await settle(fixture);
      expect(sellLine(host)).toBe(
        'Clients pay USD 120 for 4 weeks. You record each payment on their profile.',
      );

      fill(host, 'Price', '120.5');
      await settle(fixture);
      expect(sellLine(host)).toBe(
        'Clients pay USD 120.50 for 4 weeks. You record each payment on their profile.',
      );

      fill(host, 'Length in weeks', '1');
      fill(host, 'Price', '0');
      await settle(fixture);
      expect(sellLine(host)).toBe(
        'Clients get 1 week for free, from the day you start their plan.',
      );
    });

    it('sells a plan by the day, its length, checks and words in days (INV-7)', async () => {
      const { fixture, host, api, dirty } = await render({ kind: 'new' });
      // Weeks first, as before; the number stays as typed when the unit changes.
      expect(field(host, 'Weeks').checked).toBe(true);
      expect(field(host, 'Length in weeks').value).toBe('12');
      tick(host, 'Days');
      await settle(fixture);
      expect(dirty).toContain(true);
      expect(() => field(host, 'Length in weeks')).toThrow();
      expect(field(host, 'Length in days').value).toBe('12');

      fill(host, 'Plan name', 'Monthly coaching');
      fill(host, 'Length in days', '30');
      fill(host, 'Price', '90');
      await settle(fixture);
      expect(sellLine(host)).toBe(
        'Clients pay USD 90 for 30 days. You record each payment on their profile.',
      );
      expect(describedText(field(host, 'Option name (optional)'))).toBe(
        'Left empty, clients see “30 days”.',
      );

      // A length the server would refuse is refused here, in days.
      fill(host, 'Length in days', '0');
      await settle(fixture);
      press(host, 'Create plan');
      await settle(fixture);
      expect(reasonFor(field(host, 'Length in days'))).toBe(
        'Enter a whole number of days, 1 or more.',
      );
      expect(document.activeElement).toBe(field(host, 'Length in days'));
      expect(api.createProduct).not.toHaveBeenCalled();

      fill(host, 'Length in days', '30');
      await settle(fixture);
      press(host, 'Create plan');
      await settle(fixture);
      expect(api.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Monthly coaching',
          initialOffer: expect.objectContaining({
            label: '30 days',
            durationCount: 30,
            durationUnit: 'Day',
            priceAmount: 90,
          }),
        }),
      );

      // Back to weeks, the same number is weeks again.
      tick(host, 'Weeks');
      await settle(fixture);
      expect(field(host, 'Length in weeks').value).toBe('30');
    });

    it('says what an option left unnamed is called, and sends it by that name', async () => {
      const { fixture, host, api } = await render({ kind: 'option', product: ONLINE });
      const name = field(host, 'Option name (optional)');
      expect(describedText(name)).toBe('Left empty, clients see “12 weeks”.');

      fill(host, 'Length in weeks', '4');
      await settle(fixture);
      expect(describedText(name)).toBe('Left empty, clients see “4 weeks”.');
      fill(host, 'Length in weeks', '');
      await settle(fixture);
      expect(describedText(name)).toBe('Left empty, clients see its length.');

      fill(host, 'Length in weeks', '4');
      fill(host, 'Price', '100');
      await settle(fixture);
      press(host, 'Add price option');
      await settle(fixture);
      expect(api.addOffer.mock.calls[0][1].label).toBe('4 weeks');
    });

    it('sends the currency in capitals and what is included in the page’s order', async () => {
      const { fixture, host, api } = await render({ kind: 'option', product: ONLINE });
      fill(host, 'Length in weeks', '8');
      fill(host, 'Price', '99.99');
      fill(host, 'Currency', 'gbp');
      fill(host, 'Option name (optional)', '  Summer offer ');
      tick(host, 'Training', false);
      tick(host, 'Resources');
      tick(host, 'Nutrition');
      await settle(fixture);

      press(host, 'Add price option');
      await settle(fixture);

      expect(api.addOffer).toHaveBeenCalledWith('p-online', {
        label: 'Summer offer',
        durationCount: 8,
        durationUnit: 'Week',
        priceAmount: 99.99,
        priceCurrency: 'GBP',
        features: features('Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'),
      });
    });
  });

  describe('a refused entry', () => {
    it('refuses a new plan with nothing filled in, marks each box and focuses the first', async () => {
      const { fixture, host, api, closed } = await render({ kind: 'new' });
      fill(host, 'Length in weeks', '');
      for (const feature of ['Training', 'Check-ins', 'Messaging']) tick(host, feature, false);
      await settle(fixture);

      press(host, 'Create plan');
      await settle(fixture);

      expect(api.createProduct).not.toHaveBeenCalled();
      expect(closed).toEqual([]);
      expect(announced(host)).toBe('Check the fields marked above.');
      expect(reasonFor(field(host, 'Plan name'))).toBe(
        'Give the plan a name clients will recognise.',
      );
      expect(reasonFor(field(host, 'Length in weeks'))).toBe(
        'Enter a whole number of weeks, 1 or more.',
      );
      expect(reasonFor(field(host, 'Price'))).toBe('Enter a price of zero or more.');
      const fieldset = query(host, 'fieldset.features');
      expect(fieldset.getAttribute('aria-describedby')).toBe('plan-features-error');
      expect(textOf(query(host, '#plan-features-error'))).toBe(
        'Choose at least one thing the plan includes.',
      );
      expect(document.activeElement).toBe(field(host, 'Plan name'));
    });

    it('focuses the first box of What’s included when only that is missing', async () => {
      const { fixture, host, api } = await render({ kind: 'option', product: ONLINE });
      fill(host, 'Length in weeks', '4');
      fill(host, 'Price', '100');
      for (const feature of ['Training', 'Check-ins', 'Messaging']) tick(host, feature, false);
      await settle(fixture);

      press(host, 'Add price option');
      await settle(fixture);

      expect(api.addOffer).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(field(host, 'Training'));
    });

    it('marks a wrong currency on its own box, says why there and focuses it', async () => {
      const { fixture, host, api } = await render({ kind: 'option', product: ONLINE });
      fill(host, 'Length in weeks', '4');
      fill(host, 'Price', '100');
      fill(host, 'Currency', 'US');
      await settle(fixture);

      press(host, 'Add price option');
      await settle(fixture);

      expect(api.addOffer).not.toHaveBeenCalled();
      expect(announced(host)).toBe('Check the fields marked above.');
      const currency = field(host, 'Currency');
      expect(reasonFor(currency)).toBe('Use a three-letter currency code, like USD.');
      // The price is right, so its box is not marked for the currency's mistake.
      expect(field(host, 'Price').getAttribute('aria-invalid')).toBeNull();
      expect(document.activeElement).toBe(currency);
    });

    it('marks a wrong price on the price box alone, never the currency beside it', async () => {
      const { fixture, host } = await render({ kind: 'option', product: ONLINE });
      fill(host, 'Length in weeks', '4');
      fill(host, 'Price', '-5');
      await settle(fixture);

      press(host, 'Add price option');
      await settle(fixture);

      expect(reasonFor(field(host, 'Price'))).toBe('Enter a price of zero or more.');
      const currency = field(host, 'Currency');
      expect(currency.hasAttribute('aria-invalid')).toBe(false);
      expect(currency.hasAttribute('aria-describedby')).toBe(false);
      expect(document.activeElement).toBe(field(host, 'Price'));
    });

    it('keeps a refusal on screen in coach words, with the entry, and stays open', async () => {
      const { fixture, host, api, closed } = await render({ kind: 'new' });
      api.createProduct.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 409, error: { code: 'product_name_taken' } }),
        ),
      );
      fill(host, 'Plan name', 'Online Coaching');
      fill(host, 'Price', '330');
      await settle(fixture);

      press(host, 'Create plan');
      await settle(fixture);

      expect(announced(host)).toBe(
        'You already sell a plan with this name. Choose another name, or rename that plan first.',
      );
      expect(closed).toEqual([]);
      expect(field(host, 'Plan name').value).toBe('Online Coaching');
      expect(button(host, 'Create plan').hasAttribute('aria-disabled')).toBe(false);
    });

    it('brings a server refusal into view above the sticky actions and gives it focus', async () => {
      const { fixture, host, api } = await render({ kind: 'new' });
      api.createProduct.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 409, error: { code: 'product_name_taken' } }),
        ),
      );
      // On HTMLElement, nearer than Element, and taken away after: jsdom has no scrollIntoView.
      const scrolled = vi.fn();
      const original = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = scrolled;
      try {
        fill(host, 'Plan name', 'Online Coaching');
        fill(host, 'Price', '330');
        await settle(fixture);

        press(host, 'Create plan');
        await settle(fixture);

        const summary = query<HTMLElement>(host, 'app-form-summary');
        expect(textOf(summary)).toBe(
          'You already sell a plan with this name. Choose another name, or rename that plan first.',
        );
        expect(document.activeElement).toBe(summary);
        expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
        expect(scrolled.mock.contexts).toContain(summary);
      } finally {
        if (original) HTMLElement.prototype.scrollIntoView = original;
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    });

    it('points at the marked boxes after a refusal, never at the server’s earlier words', async () => {
      const { fixture, host, api } = await render({ kind: 'new' });
      api.createProduct.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 409, error: { code: 'product_name_taken' } }),
        ),
      );
      fill(host, 'Plan name', 'Online Coaching');
      fill(host, 'Price', '330');
      await settle(fixture);
      press(host, 'Create plan');
      await settle(fixture);

      fill(host, 'Price', '');
      await settle(fixture);
      press(host, 'Create plan');
      await settle(fixture);

      expect(announced(host)).toBe('Check the fields marked above.');
      expect(document.activeElement).toBe(field(host, 'Price'));
      expect(api.createProduct).toHaveBeenCalledTimes(1);
    });

    it('says in its own words that a server fault stopped the change', async () => {
      const { fixture, host, api, closed } = await render({ kind: 'details', product: ONLINE });
      api.updateProduct.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      press(host, 'Save');
      await settle(fixture);

      expect(announced(host)).toBe('The change could not be saved. Try again.');
      expect(closed).toEqual([]);
    });
  });

  describe('the writes', () => {
    it('creates a plan with its first price option, trimmed, and closes with the plan saved', async () => {
      const { fixture, host, api, saved, closed } = await render({ kind: 'new' });
      fill(host, 'Plan name', '  Hybrid Coaching ');
      fill(host, 'What clients get (optional)', '   ');
      fill(host, 'Length in weeks', '6');
      fill(host, 'Price', '150');
      await settle(fixture);

      press(host, 'Create plan');
      await settle(fixture);

      expect(api.createProduct).toHaveBeenCalledWith({
        name: 'Hybrid Coaching',
        description: null,
        initialOffer: {
          label: '6 weeks',
          durationCount: 6,
          durationUnit: 'Week',
          priceAmount: 150,
          priceCurrency: 'USD',
          features: features('Training', 'CheckIns', 'Messaging'),
        },
      });
      expect(closed).toEqual([saved]);
    });

    it('saves a plan’s words with the version it read, keeping whether it is sold', async () => {
      const summer = product({ id: 'p-summer', name: 'Summer Shred', isActive: false, version: 3 });
      const { fixture, host, api, saved, closed } = await render({
        kind: 'details',
        product: summer,
      });
      fill(host, 'Plan name', 'Summer Shred 2027');
      fill(host, 'What clients get (optional)', '');
      await settle(fixture);

      press(host, 'Save');
      await settle(fixture);

      expect(api.updateProduct).toHaveBeenCalledWith('p-summer', {
        name: 'Summer Shred 2027',
        description: null,
        isActive: false,
        version: 3,
      });
      expect(closed).toEqual([saved]);
    });

    it('changes a price with the option’s version, retrying under the same key and never reusing one that went through', async () => {
      const { fixture, host, api, closed } = await render({
        kind: 'price',
        product: ONLINE,
        offer: offer({ id: 'o-12', version: 4 }),
      });
      let calls = 0;
      api.changePrice.mockImplementation(() =>
        ++calls === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(ONLINE),
      );
      fill(host, 'New price', '360');
      await settle(fixture);

      press(host, 'Change price');
      await settle(fixture);
      expect(announced(host)).toBe(
        'The app couldn’t connect. Check your connection and try again.',
      );
      press(host, 'Change price');
      await settle(fixture);
      expect(closed).toEqual([ONLINE]);
      press(host, 'Change price');
      await settle(fixture);
      fill(host, 'New price', '370');
      await settle(fixture);
      press(host, 'Change price');
      await settle(fixture);

      const sent = api.changePrice.mock.calls;
      expect(sent.map(([offerId]) => offerId)).toEqual(['o-12', 'o-12', 'o-12', 'o-12']);
      expect(sent[0][1]).toEqual({
        priceAmount: 360,
        version: 4,
        idempotencyKey: expect.any(String),
      });
      const keys = sent.map(([, request]) => request.idempotencyKey);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).not.toBe(keys[1]);
      expect(keys[3]).not.toBe(keys[2]);
      expect(sent[3][1].priceAmount).toBe(370);
    });

    it('closes with nothing on Not now, saving nothing', async () => {
      const { fixture, host, api, closed } = await render({ kind: 'new' });
      fill(host, 'Plan name', 'Hybrid');
      await settle(fixture);

      press(host, 'Not now');
      await settle(fixture);

      expect(closed).toEqual([null]);
      expect(api.createProduct).not.toHaveBeenCalled();
    });

    it('drops the write when the workspace changes while it waits for its token', async () => {
      let release!: () => void;
      const token = new Promise<void>((resolve) => (release = resolve));
      const { fixture, host, api, tenant, closed } = await render(
        { kind: 'details', product: ONLINE },
        { refresh: () => token },
      );
      press(host, 'Save');
      await settle(fixture);

      tenant.set('tenant-2');
      release();
      await token;
      await settle(fixture);

      expect(api.updateProduct).not.toHaveBeenCalled();
      expect(closed).toEqual([]);
      expect(announced(host)).toBe('');
    });

    it('says it is saving while it saves, and a second press saves nothing more', async () => {
      const answer = new Subject<CoachingProductView>();
      const { fixture, host, api, closed } = await render({ kind: 'details', product: ONLINE });
      api.updateProduct.mockReturnValue(answer);

      press(host, 'Save');
      await settle(fixture);
      expect(button(host, 'Saving…').getAttribute('aria-disabled')).toBe('true');
      press(host, 'Saving…');
      await settle(fixture);
      expect(api.updateProduct).toHaveBeenCalledTimes(1);

      answer.next(ONLINE);
      answer.complete();
      await settle(fixture);
      expect(closed).toEqual([ONLINE]);
    });
  });

  it.each<[string, ProductSheetMode, (host: HTMLElement) => void]>([
    ['a new plan’s name', { kind: 'new' }, (host) => fill(host, 'Plan name', 'H')],
    [
      'an option’s features',
      { kind: 'option', product: ONLINE },
      (host) => tick(host, 'Nutrition'),
    ],
    [
      'a new price',
      { kind: 'price', product: ONLINE, offer: offer() },
      (host) => fill(host, 'New price', '340'),
    ],
    [
      'a plan’s description alone',
      { kind: 'details', product: ONLINE },
      (host) => fill(host, 'What clients get (optional)', 'Now with a monthly video call.'),
    ],
  ])('tells the page once %s is typed, so closing asks first', async (_, mode, change) => {
    const { fixture, host, dirty } = await render(mode);
    expect(dirty).toEqual([]);

    change(host);
    await settle(fixture);

    expect(dirty.at(-1)).toBe(true);
  });
});
