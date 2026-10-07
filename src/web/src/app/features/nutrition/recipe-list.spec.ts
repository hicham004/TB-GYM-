import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecipePage } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle } from '../../../testing/dom';
import { recipeSummary } from '../../../testing/recipe-fixtures';
import { RecipeApi } from './recipe-api';
import { RecipeList } from './recipe-list';

const page = (items = [recipeSummary()], total = items.length): RecipePage => ({
  total,
  skip: 0,
  take: 48,
  items,
});

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

    expect(api.listRecipes).toHaveBeenLastCalledWith('tahini', 0, 48);
    expect(textOf(host.querySelector('[role="status"]'))).toBe('No recipes match “tahini”.');
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
