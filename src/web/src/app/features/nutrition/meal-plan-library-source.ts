import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { RecipeSummary } from '../../core/api/generated';
import type { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import type { SearchPage } from '../../ui/paged-search';
import type { MealPlanApi } from './meal-plan-api';
import { planRecipe, type PlanRecipe } from './meal-plan-builder.models';
import { numeric } from '../training/training-builder.models';

/** A page of published recipes, as the Exercises page pages its library. */
export const RECIPE_PAGE_SIZE = 48;

/**
 * What the meal-plan builder reads of the recipe library (audit WEA-14), so a library of hundreds costs
 * what one of 25 does: the first page of published recipes, by name, read once a visit and shared by the
 * library beside the grid and the recipe sheet, and the pages a search asks the server for. Every recipe
 * read stays known, so a meal keeps its calories and macros whatever the coach searches next.
 */
export class RecipeLibrarySource {
  readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  readonly first = signal<SearchPage<PlanRecipe> | null>(null);
  /** Every recipe read on this visit, by version. */
  readonly known = signal<ReadonlyMap<string, PlanRecipe>>(new Map());
  /** Moves with every read of the first page and every workspace switch: each list starts again. */
  readonly generation = signal(0);

  constructor(
    private readonly api: MealPlanApi,
    private readonly scope: TenantAsyncScope,
  ) {
    scope.onReset(() => this.clear());
  }

  /** The first page of published recipes, once a visit, for every list on the page. */
  load(): Promise<void> {
    return this.scope.run('library', async (owner) => {
      this.state.set('loading');
      this.generation.update((value) => value + 1);
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.listPublishedRecipes('', 0, RECIPE_PAGE_SIZE)),
        );
        this.first.set({ items: this.adopt(page.items), total: numeric(page.total) });
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }

  /**
   * One page of what a list's search finds, from `skip`. Each list reads in its own `lane`, where a newer
   * search makes an older one obsolete; an obsolete answer, or one from before a workspace switch, is null.
   */
  search(lane: string, query: string, skip: number): Promise<SearchPage<PlanRecipe> | null> {
    return this.scope.run(
      `library:${lane}`,
      async (owner) => {
        const page = await owner.wait(
          firstValueFrom(this.api.listPublishedRecipes(query, skip, RECIPE_PAGE_SIZE)),
        );
        return { items: this.adopt(page.items), total: numeric(page.total) };
      },
      null,
    );
  }

  private adopt(summaries: readonly RecipeSummary[]): PlanRecipe[] {
    const items = summaries.map(planRecipe);
    // A page of recipes already known changes nothing that reads them, such as the plan's totals.
    if (items.some((item) => !this.known().has(item.versionId))) {
      this.known.update((known) => {
        const next = new Map(known);
        for (const item of items) next.set(item.versionId, item);
        return next;
      });
    }
    return items;
  }

  private clear(): void {
    this.state.set('loading');
    this.first.set(null);
    this.known.set(new Map());
    this.generation.update((value) => value + 1);
  }
}
