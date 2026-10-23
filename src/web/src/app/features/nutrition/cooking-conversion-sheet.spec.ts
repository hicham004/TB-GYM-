import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CookingConversionPage,
  CookingConversionView,
  CreateCookingConversionRequest,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { LIBRARY_SEARCH_PAUSE } from '../../ui/paged-search';
import { UiToast } from '../../ui/toast';
import {
  CHICKEN_GRILLED,
  conversionView,
  RAW_RICE,
  RICE_BOILED,
} from '../../../testing/cooking-fixtures';
import { field, fill, formSummary, press, settle, tick } from '../../../testing/dom';
import { CookingConversionSheet } from './cooking-conversion-sheet';
import type { Conversion } from './cooking-conversion.models';
import { RecipeApi } from './recipe-api';

const RICE_VIEW = conversionView();
const CHICKEN_VIEW = conversionView({
  id: 'chicken',
  sourceKey: 'Chicken breast, grilled',
  sourceVersion: 'Weighed in my kitchen',
  yieldFactor: 0.75,
  retentionFactor: 0.95,
});
const TAKEN =
  'A conversion for “White rice, boiled” from “Weighed in my kitchen” already has other numbers. Give the new one another name or source.';

function page(items: CookingConversionView[], total = items.length): CookingConversionPage {
  return { total, skip: 0, take: 20, items };
}

interface Options {
  readonly list?: (query: string, skip: number) => Observable<CookingConversionPage>;
  readonly create?: (request: CreateCookingConversionRequest) => Observable<CookingConversionView>;
  readonly current?: Conversion | null;
}

async function render(options: Options = {}) {
  const api = {
    listConversions: vi.fn<RecipeApi['listConversions']>(
      options.list ?? (() => of(page([RICE_VIEW, CHICKEN_VIEW]))),
    ),
    createConversion: vi.fn<RecipeApi['createConversion']>(
      options.create ??
        ((request) =>
          of(
            conversionView({
              id: 'new',
              sourceKey: request.sourceKey,
              sourceVersion: request.sourceVersion,
              yieldFactor: request.yieldFactor,
              retentionFactor: request.retentionFactor,
            }),
          )),
    ),
  };
  const refresh = vi.fn(() => Promise.resolve());
  const toast = { show: vi.fn(() => ({ dismiss: vi.fn() })) };
  TestBed.configureTestingModule({
    imports: [CookingConversionSheet],
    providers: [
      { provide: RecipeApi, useValue: api },
      { provide: CsrfService, useValue: { refresh } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: LIBRARY_SEARCH_PAUSE, useValue: 0 },
      { provide: UiToast, useValue: toast },
    ],
  });
  const fixture = TestBed.createComponent(CookingConversionSheet);
  fixture.componentRef.setInput('food', RAW_RICE);
  fixture.componentRef.setInput('current', options.current ?? null);
  fixture.componentRef.setInput('locale', 'en-US');
  const closed: (Conversion | null)[] = [];
  const dirty: boolean[] = [];
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api,
    refresh,
    toast,
    closed,
    dirty,
  };
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

/** The conversions listed, each as its name and the line under it. */
function listed(host: HTMLElement): string[][] {
  return Array.from(host.querySelectorAll('.choice')).map((choice) => [
    textOf(choice.querySelector('.choice-name')),
    textOf(choice.querySelector('.choice-hint')),
  ]);
}

/** The radio of the conversion listed as `name`. */
function conversion(host: HTMLElement, name: string): HTMLInputElement {
  const found = Array.from(host.querySelectorAll('.choice')).filter(
    (choice) => textOf(choice.querySelector('.choice-name')) === name,
  );
  if (found.length !== 1) throw new Error(`${found.length} conversions are listed as "${name}".`);
  return found[0].querySelector<HTMLInputElement>('input[type="radio"]')!;
}

function pick(host: HTMLElement, name: string): void {
  const radio = conversion(host, name);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
}

/** Fills the add form as a coach who weighed their own rice. */
function fillRice(host: HTMLElement): void {
  fill(host, 'What it is', 'White rice, boiled');
  fill(host, 'Cooked weight of 100 g raw', '290');
  fill(host, 'Where the numbers come from', 'Weighed in my kitchen');
}

describe('Weigh a raw food cooked (INV-6)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists the workspace’s conversions with their numbers and source, and uses the one chosen', async () => {
    const { fixture, host, api, closed } = await render();

    expect(api.listConversions).toHaveBeenCalledWith('', 0, 20);
    expect(textOf(host.querySelector('.about'))).toBe('White rice, raw 353 kcal per 100 g raw');
    expect(field(host, 'Choose one').checked).toBe(true);
    expect(listed(host)).toEqual([
      ['White rice, boiled', '100 g raw makes 290 g cooked · USDA cooking yields, 2014'],
      [
        'Chicken breast, grilled',
        '100 g raw makes 75 g cooked, keeping 95% of its protein, carbs and fat · Weighed in my kitchen',
      ],
    ]);

    // Nothing chosen yet: Use it says so, and nothing goes back.
    press(host, 'Use it');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe('Choose a conversion, or add one.');
    expect(document.activeElement).toBe(formSummary(host));
    expect(closed).toEqual([]);

    pick(host, 'Chicken breast, grilled');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe('');
    expect(conversion(host, 'Chicken breast, grilled').closest('.choice')?.classList).toContain(
      'chosen',
    );
    press(host, 'Use it');
    await settle(fixture);
    expect(closed).toEqual([CHICKEN_GRILLED]);
    expect(api.createConversion).not.toHaveBeenCalled();
  });

  it('keeps the line’s own conversion chosen, on the list until something is searched', async () => {
    const { fixture, host, api, closed } = await render({
      current: CHICKEN_GRILLED,
      list: (query) =>
        of(
          query === 'kitchen'
            ? page([CHICKEN_VIEW])
            : query === 'lentils'
              ? page([])
              : page([RICE_VIEW], 2),
        ),
    });

    // The first page holds rice only; the chicken the line is weighed through comes first, chosen.
    expect(listed(host).map(([name]) => name)).toEqual([
      'Chicken breast, grilled',
      'White rice, boiled',
    ]);
    expect(conversion(host, 'Chicken breast, grilled').checked).toBe(true);

    // Found on the server by what it is or where its numbers come from.
    fill(host, 'Find a conversion', 'kitchen');
    await settle(fixture);
    expect(api.listConversions).toHaveBeenLastCalledWith('kitchen', 0, 20);
    expect(listed(host).map(([name]) => name)).toEqual(['Chicken breast, grilled']);
    fill(host, 'Find a conversion', 'lentils');
    await settle(fixture);
    expect(listed(host)).toEqual([]);
    expect(describedText(field(host, 'Find a conversion'))).toBe(
      'No conversion is called that. Add one instead.',
    );

    press(host, 'Use it');
    await settle(fixture);
    expect(closed).toEqual([CHICKEN_GRILLED]);
  });

  it('opens on adding the first conversion when there is none, and saves it in the coach’s words', async () => {
    const { fixture, host, api, refresh, closed, dirty } = await render({
      list: () => of(page([])),
    });

    // With nothing to choose there is no choice to make.
    expect(host.querySelector('app-segmented-control')).toBeNull();
    expect(field(host, 'Protein, carbs and fat kept').value).toBe('100');
    expect(dirty.at(-1)).toBe(false);

    fillRice(host);
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);
    expect(textOf(host.querySelector('.preview'))).toBe('So 100 g cooked counts as 34.5 g raw.');
    fill(host, 'Protein, carbs and fat kept', '95');
    await settle(fixture);
    expect(textOf(host.querySelector('.preview'))).toBe(
      'So 100 g cooked counts as 34.5 g raw, keeping 95% of its protein, carbs and fat.',
    );

    press(host, 'Save and use it');
    await settle(fixture);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(api.createConversion).toHaveBeenCalledWith({
      sourceKey: 'White rice, boiled',
      sourceVersion: 'Weighed in my kitchen',
      yieldFactor: 2.9,
      retentionFactor: 0.95,
    });
    expect(closed).toEqual([
      {
        ...RICE_BOILED,
        yieldId: 'y-new',
        retentionId: 'r-new',
        retention: 0.95,
        source: 'Weighed in my kitchen',
      },
    ]);
  });

  it('refuses a conversion it cannot save, each box saying why, the first one focused', async () => {
    const { fixture, host, api } = await render({ list: () => of(page([])) });

    fill(host, 'Protein, carbs and fat kept', '');
    await settle(fixture);
    press(host, 'Save and use it');
    await settle(fixture);

    expect(reasonFor(field(host, 'What it is'))).toBe('Say what it is, like White rice, boiled.');
    expect(reasonFor(field(host, 'Cooked weight of 100 g raw'))).toBe(
      'Enter what 100 g raw weighs cooked, above 0 and up to 500 g.',
    );
    expect(reasonFor(field(host, 'Protein, carbs and fat kept'))).toBe(
      'Enter how much is kept, above 0% and up to 100%.',
    );
    expect(reasonFor(field(host, 'Where the numbers come from'))).toBe(
      'Say where these numbers come from, like USDA cooking yields or Weighed in my kitchen.',
    );
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(field(host, 'What it is'));
    expect(api.createConversion).not.toHaveBeenCalled();
  });

  it('puts the server’s refusal on the box it names, or its words in the summary, keeping what was typed', async () => {
    const answers = [
      new HttpErrorResponse({
        status: 400,
        error: {
          errors: {
            yieldFactor: [
              'The cooked weight must be above 0 and at most 5 times the raw weight, to six decimals.',
            ],
          },
        },
      }),
      new HttpErrorResponse({
        status: 409,
        error: { code: 'cooking_conversion_taken', message: TAKEN },
      }),
    ];
    const { fixture, host, closed } = await render({
      list: () => of(page([])),
      create: () => throwError(() => answers.shift()),
    });
    fillRice(host);
    await settle(fixture);

    press(host, 'Save and use it');
    await settle(fixture);
    const cooked = () => field(host, 'Cooked weight of 100 g raw');
    expect(reasonFor(cooked())).toBe(
      'The cooked weight must be above 0 and at most 5 times the raw weight, to six decimals.',
    );
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(formSummary(host));

    // Changing the box takes the server's reason away.
    fill(host, 'Cooked weight of 100 g raw', '300');
    await settle(fixture);
    expect(reasonFor(cooked())).toBe('');

    press(host, 'Save and use it');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe(TAKEN);
    expect(document.activeElement).toBe(formSummary(host));
    expect(field(host, 'What it is').value).toBe('White rice, boiled');
    expect(closed).toEqual([]);
  });

  it('says when the conversions could not be loaded or searched, and tries again on request', async () => {
    let failing = true;
    const { fixture, host, api } = await render({
      list: (query) =>
        failing
          ? throwError(() => new HttpErrorResponse({ status: 0 }))
          : of(query ? page([CHICKEN_VIEW]) : page([RICE_VIEW])),
    });

    expect(textOf(host.querySelector('.load-failed [role="alert"]'))).toBe(
      'Your conversions couldn’t be loaded.',
    );
    // Adding one is still offered.
    expect(field(host, 'Add one').checked).toBe(false);
    failing = false;
    press(host, 'Try again');
    await settle(fixture);
    expect(listed(host).map(([name]) => name)).toEqual(['White rice, boiled']);

    failing = true;
    fill(host, 'Find a conversion', 'kitchen');
    await settle(fixture);
    expect(textOf(host.querySelector('.load-failed [role="alert"]'))).toBe(
      'Your conversions couldn’t be searched.',
    );
    expect(listed(host)).toEqual([]);
    failing = false;
    press(host, 'Try again');
    await settle(fixture);
    expect(api.listConversions).toHaveBeenLastCalledWith('kitchen', 0, 20);
    expect(listed(host).map(([name]) => name)).toEqual(['Chicken breast, grilled']);
  });

  it('adds the next page of the list with Show more, and says when it could not', async () => {
    let failing = false;
    const { fixture, host, api, toast } = await render({
      list: (_query, skip) =>
        failing
          ? throwError(() => new HttpErrorResponse({ status: 0 }))
          : of(skip === 0 ? page([RICE_VIEW], 2) : page([CHICKEN_VIEW], 2)),
    });

    // A page that could not be read is said in a toast, as the builders' libraries say it; the sheet's
    // summary stays for the server's word on the sheet itself (ARCHITECTURE §8).
    failing = true;
    press(host, 'Show more');
    await settle(fixture);
    expect(toast.show).toHaveBeenCalledWith('More conversions couldn’t be loaded. Try again.', {
      tone: 'error',
    });
    expect(textOf(formSummary(host))).toBe('');

    failing = false;
    press(host, 'Show more');
    await settle(fixture);
    expect(api.listConversions).toHaveBeenLastCalledWith('', 1, 20);
    expect(listed(host).map(([name]) => name)).toEqual([
      'White rice, boiled',
      'Chicken breast, grilled',
    ]);
    expect(textOf(formSummary(host))).toBe('');
    expect(host.textContent).not.toContain('Show more');
    // Its button gone, focus moves to the first conversion it brought, never out of the sheet.
    expect(document.activeElement).toBe(conversion(host, 'Chicken breast, grilled'));
  });

  it('searches at once on Enter, never sending the sheet', async () => {
    const { fixture, host, api, closed } = await render({
      current: CHICKEN_GRILLED,
      list: (query) => of(query ? page([CHICKEN_VIEW]) : page([RICE_VIEW], 2)),
    });

    const box = field(host, 'Find a conversion');
    box.value = 'kitchen';
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    box.dispatchEvent(enter);
    await settle(fixture);
    expect(enter.defaultPrevented).toBe(true);
    expect(api.listConversions).toHaveBeenLastCalledWith('kitchen', 0, 20);
    expect(listed(host).map(([name]) => name)).toEqual(['Chicken breast, grilled']);
    expect(closed).toEqual([]);
    // The source is the coach's own words, isolated so an Arabic one keeps the line's order.
    expect(textOf(host.querySelector('.choice-hint bdi'))).toBe('Weighed in my kitchen');

    // The server reads words: more spaces between them are the same search, not sent again.
    const sent = api.listConversions.mock.calls.length;
    fill(host, 'Find a conversion', 'my   kitchen');
    await settle(fixture);
    fill(host, 'Find a conversion', 'my kitchen');
    await settle(fixture);
    expect(api.listConversions.mock.calls.length).toBe(sent + 1);
  });

  it('switches between choosing one and adding one, keeping what was typed', async () => {
    const { fixture, host, dirty } = await render();

    tick(host, 'Add one');
    await settle(fixture);
    fill(host, 'What it is', 'Lentils, boiled');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);
    tick(host, 'Choose one');
    await settle(fixture);
    expect(listed(host)).toHaveLength(2);
    tick(host, 'Add one');
    await settle(fixture);
    expect(field(host, 'What it is').value).toBe('Lentils, boiled');
  });
});
