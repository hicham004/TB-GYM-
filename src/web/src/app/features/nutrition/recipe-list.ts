import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { RecipeSummary } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { SectionNav } from '../../ui/section-nav';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { numeric } from '../training/training-builder.models';
import { NUTRITION_SECTIONS } from './nutrition-sections';
import { RecipeApi } from './recipe-api';
import { recipeCard } from './recipe.models';

const PAGE_SIZE = 48;
/** The media grant route takes at most this many photos per call. */
const GRANT_BATCH = 32;
const SEARCH_DELAY_MS = 250;

/**
 * Recipes (C7, R4.4b): the workspace's recipes as cards, a photo and a serving's calories and macros
 * on each, opening in the editor. New recipe comes first (plan §2 rule 1); an empty library is
 * invited to write its first one.
 */
@Component({
  selector: 'app-recipe-list',
  imports: [Button, ButtonLink, EmptyState, Icon, RouterLink, SectionNav, Skeleton, StatusPill],
  templateUrl: './recipe-list.html',
  styleUrl: './recipe-list.scss',
})
export class RecipeList {
  private readonly api = inject(RecipeApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenantId: string | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly sections = NUTRITION_SECTIONS;
  protected readonly loadingLabel = $localize`Loading your recipes…`;

  private readonly recipes = signal<RecipeSummary[]>([]);
  private readonly total = signal(0);
  /** Thumbnail addresses by photo, once granted; a card without one shows its initials. */
  private readonly thumbnails = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly search = signal('');
  /** The search the list on screen answers, so "no match" names what was looked for. */
  protected readonly searched = signal('');
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);

  protected readonly cards = computed(() => {
    const thumbnails = this.thumbnails();
    return this.recipes().map((recipe) => {
      const card = recipeCard(recipe, this.locale);
      return { ...card, thumbnail: card.photoId ? (thumbnails.get(card.photoId) ?? null) : null };
    });
  });
  protected readonly hasMore = computed(() => this.recipes().length < this.total());
  /** No recipe at all, as opposed to none matching a search. */
  protected readonly recipesEmpty = computed(() => this.total() === 0 && !this.searched());
  protected readonly summary = computed(() => {
    const count = this.total();
    if (count === 0 || this.searched()) return '';
    const recipes = count === 1 ? $localize`1 recipe` : $localize`${count}:count: recipes`;
    if (this.hasMore()) return recipes;
    const drafts = this.recipes().filter((recipe) => !recipe.publishedVersionId).length;
    return drafts === 0
      ? $localize`${recipes}:recipes:, all ready for meal plans`
      : drafts === 1
        ? $localize`${recipes}:recipes:, 1 still a draft`
        : $localize`${recipes}:recipes:, ${drafts}:drafts: still drafts`;
  });

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.recipes.set([]);
      this.total.set(0);
      this.thumbnails.set(new Map());
      this.state.set('loading');
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
    // The heading takes focus on arrival, so a screen reader starts at the top of the page.
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  /** Each pause in typing asks the server, which searches every recipe, not just those on screen. */
  protected typed(text: string): void {
    this.search.set(text);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      void this.load();
    }, SEARCH_DELAY_MS);
  }

  protected clearSearch(): void {
    this.search.set('');
    void this.load();
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const query = this.search().trim();
      if (this.state() !== 'ready') this.state.set('loading');
      try {
        const page = await owner.wait(firstValueFrom(this.api.listRecipes(query, 0, PAGE_SIZE)));
        this.recipes.set([...page.items]);
        this.total.set(numeric(page.total));
        this.searched.set(query);
        this.state.set('ready');
        await owner.wait(this.grant(page.items));
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }

  protected async loadMore(): Promise<void> {
    return this.scope.run('more', async (owner) => {
      this.loadingMore.set(true);
      this.moreFailed.set(false);
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.listRecipes(this.searched(), this.recipes().length, PAGE_SIZE)),
        );
        this.recipes.update((items) => [...items, ...page.items]);
        this.total.set(numeric(page.total));
        await owner.wait(this.grant(page.items));
      } catch {
        if (owner.current) this.moreFailed.set(true);
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  /**
   * Asks for the photos' grants, in calls of at most 32. A photo is not a public address: its
   * content route needs a short-lived grant cookie (MED-004). A failure leaves those cards with their
   * initials rather than failing the page.
   */
  private async grant(recipes: readonly RecipeSummary[]): Promise<void> {
    const known = this.thumbnails();
    const ids = [
      ...new Set(
        recipes.flatMap((recipe) => (recipe.photoMediaAssetId ? [recipe.photoMediaAssetId] : [])),
      ),
    ].filter((id) => !known.has(id));
    if (ids.length === 0) return;
    return this.scope.run('grant', async (owner) => {
      try {
        await owner.wait(this.csrf.refresh());
        for (let start = 0; start < ids.length; start += GRANT_BATCH) {
          const batch = await owner.wait(
            firstValueFrom(this.api.grantPhotos(ids.slice(start, start + GRANT_BATCH))),
          );
          this.thumbnails.update((current) => {
            const next = new Map(current);
            for (const item of batch.items) next.set(item.assetId, item.thumbnailUrl ?? item.url);
            return next;
          });
        }
      } catch {
        // The cards keep their initials.
      }
    });
  }
}
