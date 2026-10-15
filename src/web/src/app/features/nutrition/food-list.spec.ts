import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FoodItemPage, FoodItemView, ProviderFoodSearchPage } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, fill, settle, tick } from '../../../testing/dom';
import {
  CHICKEN_FOOD,
  CHICKEN_SKIN_FOOD,
  CHOBANI_RESULT,
  nutritionSettings,
  OATS_FOOD,
  usdaPage,
  usdaResult,
  YOGURT_FOOD,
} from '../../../testing/food-fixtures';
import { FoodApi } from './food-api';
import { FoodList } from './food-list';

const page = (
  items: FoodItemView[] = [OATS_FOOD, YOGURT_FOOD],
  total = items.length,
): FoodItemPage => ({
  total,
  skip: 0,
  take: 50,
  items,
});

interface Responses {
  listFoods?: (
    query: string,
    skip: number,
    take: number,
    archived?: boolean,
  ) => Observable<FoodItemPage>;
  searchUsda?: (query: string, kind: string) => Observable<ProviderFoodSearchPage>;
}

async function render(responses: Responses = {}) {
  const api = {
    listFoods: vi.fn(responses.listFoods ?? (() => of(page()))),
    searchUsda: vi.fn(
      responses.searchUsda ??
        ((_query: string, kind: string) =>
          of(usdaPage(kind === 'Packaged' ? [CHOBANI_RESULT] : [usdaResult()]))),
    ),
    importUsda: vi.fn(() => of(CHICKEN_FOOD)),
    createFood: vi.fn((request: { name: string }) =>
      of({ ...OATS_FOOD, id: 'food-new', name: request.name }),
    ),
    addVersion: vi.fn(() => of(OATS_FOOD)),
    setArchived: vi.fn((foodId: string, isArchived: boolean) =>
      of({
        ...(foodId === OATS_FOOD.id ? OATS_FOOD : YOGURT_FOOD),
        archivedAtUtc: isArchived ? '2026-10-07T09:00:00Z' : null,
      }),
    ),
    getSettings: vi.fn(() => of(nutritionSettings())),
  };
  TestBed.configureTestingModule({
    imports: [FoodList],
    providers: [
      provideRouter([]),
      { provide: FoodApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(FoodList);
  await settle(fixture);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const ownRows = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('section[aria-labelledby="own-heading"] .row'));
const usdaRows = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('section[aria-labelledby="usda-heading"] .row'));
/** The sheet opened last; one being closed may still be on its way out. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

async function search(fixture: { detectChanges(): void }, host: HTMLElement, text: string) {
  const box = host.querySelector<HTMLInputElement>('.search input')!;
  box.value = text;
  box.dispatchEvent(new Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await settle(fixture as never);
}

describe('the Foods page', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('lists the coach’s foods with their measure, calories and macros', async () => {
    const { host, api } = await render();

    expect(textOf(host.querySelector('.lede'))).toBe('2 foods, for your recipes');
    const [oats] = ownRows(host);
    expect(textOf(oats.querySelector('.name'))).toBe('Rolled oats');
    expect(textOf(oats.querySelector('.meta'))).toBe('Your food · as sold · per 100 g');
    expect(textOf(oats.querySelector('.kcal'))).toBe('380 kcal');
    expect(textOf(oats.querySelector('.macros'))).toBe('P 13 g · C 68 g · F 7 g');
    expect(textOf(oats.querySelector('.allergens'))).toBe('Contains gluten');
    expect(api.listFoods).toHaveBeenCalledWith('', 0, 50, false);
    // USDA waits for a search.
    expect(api.searchUsda).not.toHaveBeenCalled();
    expect(host.querySelector('#usda-heading')).toBeNull();
  });

  it('searches the coach’s foods and USDA’s basic foods, and packaged products when asked', async () => {
    const { fixture, host, api } = await render({
      listFoods: (query) => of(query ? page([]) : page()),
    });
    await search(fixture, host, 'chicken');

    expect(api.listFoods).toHaveBeenLastCalledWith('chicken', 0, 50, false);
    expect(api.searchUsda).toHaveBeenLastCalledWith('chicken', 'Basic');
    expect(
      textOf(host.querySelector('section[aria-labelledby="own-heading"] [role="status"]')),
    ).toBe('None of your foods match “chicken”.');
    const [chicken] = usdaRows(host);
    expect(textOf(chicken.querySelector('.name'))).toBe('Chicken, breast, boneless, skinless, raw');
    expect(textOf(chicken.querySelector('.kcal'))).toBe('106 kcal per 100 g');
    // Database codes wait behind the switch (plan C7).
    expect(chicken.querySelector('.database')).toBeNull();
    tick(host, 'Database details');
    await settle(fixture);
    expect(textOf(usdaRows(host)[0].querySelector('.database'))).toBe(
      'FoodData Central 2646170 · Foundation',
    );

    const packaged = host.querySelector<HTMLInputElement>('input[type="radio"][value="Packaged"]')!;
    packaged.click();
    await settle(fixture);
    expect(api.searchUsda).toHaveBeenLastCalledWith('chicken', 'Packaged');
    expect(textOf(usdaRows(host)[0].querySelector('.meta'))).toBe('Chobani');
  });

  it('copies a USDA food into the foods, and says so on its match', async () => {
    const { fixture, host, api } = await render();
    await search(fixture, host, 'chicken');

    const add = usdaRows(host)[0].querySelector<HTMLButtonElement>('button')!;
    expect(textOf(add)).toBe('Add Chicken, breast, boneless, skinless, raw');
    add.click();
    await settle(fixture);

    expect(api.importUsda).toHaveBeenCalledWith('2646170');
    expect(textOf(usdaRows(host)[0].querySelector('.added'))).toBe('In your foods');
    // The list is read again, so the copy shows when it matches.
    expect(api.listFoods).toHaveBeenLastCalledWith('chicken', 0, 50, false);
  });

  it('says a refused copy beside its match, in its own words', async () => {
    const { fixture, host, api } = await render();
    api.importUsda.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 503 })) as never,
    );
    await search(fixture, host, 'chicken');
    usdaRows(host)[0].querySelector<HTMLButtonElement>('button')!.click();
    await settle(fixture);

    expect(textOf(usdaRows(host)[0].querySelector('[role="alert"]'))).toBe(
      'This food couldn’t be added. Try another match.',
    );
  });

  it('never shows the server’s own sentence when USDA is not set up', async () => {
    const { fixture, host } = await render({
      searchUsda: () =>
        of(
          usdaPage([], {
            failureCode: 'usda_api_key_missing',
            message: 'USDA FoodData Central is not configured. Add the data.gov API key…',
          }),
        ),
    });
    await search(fixture, host, 'rice');

    const usda = host.querySelector('section[aria-labelledby="usda-heading"]');
    expect(textOf(usda?.querySelector('[role="status"]'))).toBe(
      'USDA search isn’t available right now, so only your own foods are listed.',
    );
    expect(textOf(usda)).not.toContain('data.gov');
  });

  it('opens a food in a sheet: the coach’s own is edited, a USDA one as a copy', async () => {
    const { fixture, host } = await render({
      listFoods: () => of(page([OATS_FOOD, CHICKEN_FOOD])),
    });

    ownRows(host)[0].querySelector<HTMLButtonElement>('button.stretched')!.click();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('.kcal'))).toBe('380 kcal');
    expect(textOf(dialog()?.querySelector('.actions button'))).toBe('Edit food');
    button(dialog()!, 'Edit food').click();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Edit Rolled oats');
    expect((dialog()!.querySelector('input[name="protein"]') as HTMLInputElement).value).toBe('13');

    ownRows(host)[1].querySelector<HTMLButtonElement>('button.stretched')!.click();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('.line.warn'))).toBe(
      'USDA didn’t report fibre, sugar alcohols, alcohol, so it was saved as 0.',
    );
    button(dialog()!, 'Edit a copy').click();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe(
      'Your copy of Chicken, breast, boneless, skinless, raw',
    );
  });

  it('adds a food of the coach’s own from the New food sheet', async () => {
    const { fixture, host, api } = await render();
    button(host, 'New food').click();
    await settle(fixture);
    const sheet = dialog()!;

    fill(sheet, 'Name', 'Labneh');
    fill(sheet, 'Protein', '6');
    fill(sheet, 'Carbs', '4');
    fill(sheet, 'Fat', '10');
    tick(sheet, 'Milk');
    await settle(fixture);
    expect(textOf(sheet.querySelector('.estimate'))).toBe(
      'About 130 kcal in 100 g, counted as on US-style labels.',
    );
    button(sheet, 'Save food').click();
    await settle(fixture);

    expect(api.createFood).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Labneh',
        provenance: 'CoachAuthored',
        version: expect.objectContaining({ proteinGrams: 6, declaredAllergens: ['Milk'] }),
      }),
    );
    expect(dialog()).toBeNull();
    expect(api.listFoods).toHaveBeenCalledTimes(2);
  });

  it('asks before the food sheet closes with something typed, and not when nothing is', async () => {
    const { fixture, host } = await render();
    const escape = () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
      );

    // Nothing typed: Cancel closes at once.
    button(host, 'New food').click();
    await settle(fixture);
    button(dialog()!, 'Cancel').click();
    await settle(fixture);
    expect(dialog()).toBeNull();

    button(host, 'New food').click();
    await settle(fixture);
    fill(dialog()!, 'Protein', '6');
    await settle(fixture);
    escape();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Close without saving?');
    expect(textOf(dialog()?.querySelector('.message'))).toBe(
      'This food isn’t saved. If you close it now, what you typed is lost.',
    );
    button(dialog()!, 'Keep editing').click();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('New food');
    expect((dialog()!.querySelector('input[name="protein"]') as HTMLInputElement).value).toBe('6');

    button(dialog()!, 'Cancel').click();
    await settle(fixture);
    button(dialog()!, 'Close without saving').click();
    await settle(fixture);
    expect(dialog()).toBeNull();
  });

  it('archives a food with Undo, and lists the archived foods to restore', async () => {
    const { fixture, host, api } = await render({
      listFoods: (_query, _skip, _take, archived) =>
        of(
          archived
            ? page([{ ...YOGURT_FOOD, archivedAtUtc: '2026-10-07T09:00:00Z' }])
            : page([OATS_FOOD, YOGURT_FOOD]),
        ),
    });

    ownRows(host)[1].querySelector<HTMLButtonElement>('button.stretched')!.click();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('.actions'))).toContain(
      'It leaves Foods and the ingredient search. Recipes and plans that use it keep it.',
    );
    button(dialog()!, 'Archive food').click();
    await settle(fixture);
    expect(api.setArchived).toHaveBeenCalledWith(YOGURT_FOOD.id, true);
    expect(dialog()).toBeNull();
    // Its row leaves the list, so focus goes to the list's heading.
    expect(document.activeElement?.id).toBe('own-heading');
    expect(textOf(document.querySelector('.tb-toast'))).toContain('Greek yogurt is archived.');

    // Undo restores it at once.
    button(document.querySelector<HTMLElement>('.tb-toast')!, 'Undo').click();
    await settle(fixture);
    expect(api.setArchived).toHaveBeenLastCalledWith(YOGURT_FOOD.id, false);

    // The archived foods are a list of their own, without USDA, each opened to restore.
    const toggle = button(host, 'Archived foods');
    toggle.focus();
    toggle.click();
    await settle(fixture);
    expect(api.listFoods).toHaveBeenLastCalledWith('', 0, 50, true);
    expect(textOf(host.querySelector('#own-heading'))).toBe('Archived foods');
    // The same button, now the way back, keeps the focus.
    expect(document.activeElement).toBe(toggle);
    expect(textOf(toggle)).toBe('Back to your foods');
    await search(fixture, host, 'yogurt');
    expect(api.searchUsda).not.toHaveBeenCalled();
    ownRows(host)[0].querySelector<HTMLButtonElement>('button.stretched')!.click();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('.archived'))).toBe(
      'Archived on 7 Oct 2026. Recipes and plans that use it keep it.',
    );
    expect(dialog()!.querySelector('button')?.textContent).not.toContain('Edit food');
    button(dialog()!, 'Restore food').click();
    await settle(fixture);
    expect(api.setArchived).toHaveBeenLastCalledWith(YOGURT_FOOD.id, false);
    expect(textOf(document.querySelectorAll('.tb-toast')[0])).toContain('Greek yogurt');

    button(host, 'Back to your foods').click();
    await settle(fixture);
    expect(api.listFoods).toHaveBeenLastCalledWith('yogurt', 0, 50, false);
  });

  it('says when USDA’s carbs were just below zero and count as 0 g', async () => {
    const { fixture, host } = await render({ listFoods: () => of(page([CHICKEN_SKIN_FOOD])) });
    ownRows(host)[0].querySelector<HTMLButtonElement>('button.stretched')!.click();
    await settle(fixture);

    expect(textOf(dialog()?.querySelector('.line.note'))).toBe(
      'USDA lists −0.43 g of carbs. It works carbs out from the other nutrients, which can land just below zero in a food with almost none, so it counts as 0 g, as on food labels.',
    );
  });

  it('invites a coach without foods to add one', async () => {
    const { host } = await render({ listFoods: () => of(page([])) });
    expect(textOf(host.querySelector('app-empty-state h2, app-empty-state h3'))).toBe(
      'No foods yet',
    );
    expect(button(host, 'Add your own food')).toBeTruthy();
  });
});
