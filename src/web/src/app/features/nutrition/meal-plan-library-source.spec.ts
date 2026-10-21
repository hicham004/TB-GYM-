import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { RecipePage } from '../../core/api/generated';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { recipe, RECIPES, searchRecipes } from '../../../testing/meal-plan-fixtures';
import { MealPlanApi } from './meal-plan-api';
import { RecipeLibrarySource } from './meal-plan-library-source';

/** Fifty salads sort before the fixtures' three recipes, so the first page of 48 holds none of those. */
const BIG = [
  ...Array.from({ length: 50 }, (_, index) =>
    recipe({
      id: `recipe-salad-${index + 1}`,
      versionId: `salad-${index + 1}-v1`,
      name: `A salad ${String(index + 1).padStart(2, '0')}`,
    }),
  ),
  ...RECIPES,
];

@Component({ template: '' })
class SourceHarness {
  readonly tenants = inject(TenantStore);
  readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  readonly source = new RecipeLibrarySource(inject(MealPlanApi), this.scope);
}

describe('the recipe library source (WEA-14)', () => {
  let api: {
    listPublishedRecipes: ReturnType<
      typeof vi.fn<(query: string, skip: number, take: number) => unknown>
    >;
  };

  beforeEach(async () => {
    localStorage.clear();
    const search = searchRecipes(BIG);
    api = {
      listPublishedRecipes: vi.fn((query: string, skip: number, take: number) =>
        search(query, skip, take),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: MealPlanApi, useValue: api },
        {
          provide: ApiClient,
          useValue: {
            getTenants: () => of(['A', 'B'].map((tenantId) => ({ tenantId, role: 'Owner' }))),
          },
        },
      ],
    });
    await TestBed.inject(TenantStore).load('A');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  function setup() {
    const fixture = TestBed.createComponent(SourceHarness);
    fixture.detectChanges();
    return { harness: fixture.componentInstance, tenants: TestBed.inject(TenantStore) };
  }

  it('reads one page of published recipes, and keeps every recipe a search brings', async () => {
    const { harness } = setup();
    await harness.source.load();

    expect(api.listPublishedRecipes.mock.calls).toEqual([['', 0, 48]]);
    expect([harness.source.first()?.items.length, harness.source.first()?.total]).toEqual([48, 53]);
    const page = await harness.source.search('panel', 'oats', 0);
    expect(page?.items.map((item) => item.name)).toEqual(['Overnight oats']);
    // The plan's totals can name a recipe from any page read.
    expect(harness.source.known().has('oats-v1')).toBe(true);
    expect(harness.source.known().size).toBe(49);
  });

  it('forgets every recipe on a workspace switch and drops an answer meant for the one before', async () => {
    const { harness, tenants } = setup();
    await harness.source.load();
    const before = harness.source.generation();
    const late = new Subject<RecipePage>();
    api.listPublishedRecipes.mockImplementationOnce(() => late);
    const answer = harness.source.search('panel', 'chicken', 0);

    tenants.select('B');
    expect([harness.source.first(), harness.source.known().size, harness.source.state()]).toEqual([
      null,
      0,
      'loading',
    ]);
    expect(harness.source.generation()).toBeGreaterThan(before);

    late.next({
      total: 1,
      skip: 0,
      take: 48,
      items: [recipe({ versionId: 'theirs-v1', name: 'Their stew' })],
    });
    late.complete();
    expect(await answer).toBeNull();
    expect(harness.source.known().has('theirs-v1')).toBe(false);
  });
});
