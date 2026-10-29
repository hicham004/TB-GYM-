import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecipeListStatus, RecipePage } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { segment, settle } from '../../../testing/dom';
import { recipeSummary } from '../../../testing/recipe-fixtures';
import { RecipeApi } from './recipe-api';
import { RecipeList } from './recipe-list';

const page = (items = [recipeSummary()], total = items.length): RecipePage => {
  const drafts = items.filter((item) => !item.publishedVersionId).length;
  return {
    total,
    skip: 0,
    take: 48,
    items,
    counts: { all: total, published: total - drafts, drafts },
  };
};

async function render(listRecipes: (query: string) => Observable<RecipePage> = () => of(page())) {
  const api = {
    listRecipes: vi.fn(listRecipes),
    grantPhotos: vi.fn((ids: readonly string[]) =>
      of({
        items: ids.map((id) => ({
          assetId: id,
          url: `/api/media/${id}/content`,
          thumbnailUrl: `/api/media/${id}/content/thumbnail`,
        })),
      }),
    ),
  };
  TestBed.configureTestingModule({
    imports: [RecipeList],
    providers: [
      provideRouter([]),
      { provide: RecipeApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(RecipeList);
  await settle(fixture);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api };
}

/** The page at an address, so its filter is read from it and written back (critique B5c2). */
async function renderAt(
  url: string,
  listRecipes: (query: string, status: RecipeListStatus) => Observable<RecipePage>,
) {
  const api = {
    listRecipes: vi.fn(
      (query: string, _skip: number, _take: number, status: RecipeListStatus = 'All') =>
        listRecipes(query, status),
    ),
    grantPhotos: vi.fn(() => of({ items: [] })),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'nutrition/recipes', component: RecipeList }]),
      { provide: RecipeApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, RecipeList);
  await settle(harness.fixture);
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    api,
    router: TestBed.inject(Router),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cards = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.card'));

describe('the recipes page', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows each recipe as a card with its photo and one serving', async () => {
    const draft = recipeSummary({
      id: 'recipe-pancakes',
      name: 'Banana oat pancakes',
      status: 'Draft',
      publishedVersionId: null,
      photoMediaAssetId: null,
      servings: 1,
      calories: 380,
      proteinGrams: 18,
      carbohydrateGrams: 60,
      fatGrams: 9,
      declaredAllergens: ['Eggs'],
    });
    const { host, api } = await render(() => of(page([recipeSummary(), draft])));

    expect(textOf(host.querySelector('.lede'))).toBe('2 recipes, 1 still a draft');
    const [oats, pancakes] = cards(host);
    expect(textOf(oats.querySelector('.card-name'))).toBe('Overnight oats');
    expect(textOf(oats.querySelector('.kcal'))).toBe('222 kcal a serving');
    expect(textOf(oats.querySelector('.macros'))).toBe('P 15.2 g · C 31.2 g · F 4.8 g');
    expect(textOf(oats.querySelector('.meta'))).toBe('2 servings Contains gluten, milk');
    expect(oats.querySelector('app-status-pill')).toBeNull();
    expect(oats.querySelector('a')?.getAttribute('href')).toBe('/nutrition/recipes/recipe-oats');
    // Photos come through one grant call; a recipe without one shows its initials.
    expect(api.grantPhotos).toHaveBeenCalledWith(['photo-1']);
    expect(oats.querySelector('img')?.getAttribute('src')).toBe(
      '/api/media/photo-1/content/thumbnail',
    );
    expect(textOf(pancakes.querySelector('.initials'))).toBe('BO');
    expect(textOf(pancakes.querySelector('app-status-pill'))).toBe('Draft');
    expect(host.querySelector('a[href="/nutrition/recipes/new"]')).not.toBeNull();
  });

  it('invites an empty library to write its first recipe', async () => {
    const { host } = await render(() => of(page([])));
    expect(textOf(host.querySelector('app-empty-state'))).toContain('No recipes yet');
    expect(host.querySelector('.search')).toBeNull();
  });

  it('searches every recipe on the server after a pause in typing', async () => {
    const { fixture, host, api } = await render((query) => of(query ? page([]) : page()));
    const box = host.querySelector<HTMLInputElement>('.search input')!;
    box.value = 'tahini';
    box.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle(fixture);

    expect(api.listRecipes).toHaveBeenLastCalledWith('tahini', 0, 48, 'All');
    expect(textOf(host.querySelector('[role="status"]'))).toBe('No recipes match “tahini”.');
  });

  it('counts the drafts of the whole library from the server, more pages or not', async () => {
    const { host } = await render(() =>
      of({ ...page([recipeSummary()], 60), counts: { all: 60, published: 57, drafts: 3 } }),
    );

    expect(textOf(host.querySelector('.lede'))).toBe('60 recipes, 3 still drafts');
    expect(textOf(segment(host, 'Recipes to show', 'Drafts (3)').closest('label'))).toBe(
      'Drafts (3)',
    );
  });

  it('filters published recipes and drafts on the server, the choice kept in the address (critique B5c2)', async () => {
    const oats = recipeSummary();
    const pancakes = recipeSummary({
      id: 'recipe-pancakes',
      name: 'Banana oat pancakes',
      status: 'Draft',
      publishedVersionId: null,
      photoMediaAssetId: null,
    });
    const shown = { All: [oats, pancakes], Published: [oats], Drafts: [pancakes] };
    const { harness, host, api, router } = await renderAt('/nutrition/recipes', (_, status) =>
      of({ ...page(shown[status]), counts: { all: 2, published: 1, drafts: 1 } }),
    );
    const names = () => cards(host).map((card) => textOf(card.querySelector('.card-name')));

    expect(
      ['All', 'Published', 'Drafts (1)'].map(
        (label) => segment(host, 'Recipes to show', label).checked,
      ),
    ).toEqual([true, false, false]);
    expect(names()).toEqual(['Overnight oats', 'Banana oat pancakes']);

    segment(host, 'Recipes to show', 'Drafts (1)').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(router.url).toBe('/nutrition/recipes?status=drafts');
    expect(api.listRecipes).toHaveBeenLastCalledWith('', 0, 48, 'Drafts');
    expect(names()).toEqual(['Banana oat pancakes']);
    // The lede still speaks of the whole library.
    expect(textOf(host.querySelector('.lede'))).toBe('2 recipes, 1 still a draft');

    segment(host, 'Recipes to show', 'Published').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(router.url).toBe('/nutrition/recipes?status=published');
    expect(names()).toEqual(['Overnight oats']);

    segment(host, 'Recipes to show', 'All').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(router.url).toBe('/nutrition/recipes');
    expect(api.listRecipes).toHaveBeenLastCalledWith('', 0, 48, 'All');
    expect(names()).toEqual(['Overnight oats', 'Banana oat pancakes']);
  });

  it('opens on the filter its address names, and says when it holds nothing', async () => {
    const { harness, host, api, router } = await renderAt(
      '/nutrition/recipes?status=drafts',
      (_, status) =>
        of({
          ...page(status === 'Drafts' ? [] : [recipeSummary()], status === 'Drafts' ? 0 : 1),
          counts: { all: 1, published: 1, drafts: 0 },
        }),
    );

    expect(api.listRecipes).toHaveBeenCalledWith('', 0, 48, 'Drafts');
    expect(segment(host, 'Recipes to show', 'Drafts (0)').checked).toBe(true);
    expect(textOf(host.querySelector('[role="status"]'))).toBe(
      'No drafts: every recipe is published.',
    );

    (host.querySelector('.load-failed button') as HTMLButtonElement).click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(router.url).toBe('/nutrition/recipes');
    expect(api.listRecipes).toHaveBeenLastCalledWith('', 0, 48, 'All');
    expect(cards(host)).toHaveLength(1);
  });

  it('says the recipes could not be loaded, and tries again', async () => {
    let fail = true;
    const { fixture, host, api } = await render(() =>
      fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(page()),
    );
    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Your recipes could not be loaded.');
    fail = false;
    (host.querySelector('.load-failed button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(cards(host)).toHaveLength(1);
    expect(api.listRecipes).toHaveBeenCalledTimes(2);
  });
});
