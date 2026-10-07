import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import type {
  AddRecipeVersionRequest,
  AiMealDraftAvailabilityView,
  AiMealDraftView,
  CreateRecipeRequest,
  FoodItemPage,
  FoodItemView,
  MediaAccessBatchView,
  MediaAssetView,
  ProviderFoodSearchPage,
  RecipeDetail,
  RecipePage,
  RecipeSummary,
  ReviewAiMealDraftRequest,
} from '../../core/api/generated';

/**
 * The recipe pages' reads and writes (C7, R4.4b): recipes, their photos (MED-014), the food search
 * behind ingredients, and AI suggestions. Kept out of `ApiClient`, like `MealPlanApi`, so they load
 * only with these pages.
 */
@Injectable({ providedIn: 'root' })
export class RecipeApi {
  private readonly http = inject(HttpClient);

  /** Every recipe at its newest version, drafts included, by name. */
  listRecipes(query: string, skip: number, take: number): Observable<RecipePage> {
    return this.http.get<RecipePage>('/api/nutrition/recipes', {
      params: new HttpParams().set('query', query).set('skip', skip).set('take', take),
    });
  }

  getRecipe(recipeId: string): Observable<RecipeDetail> {
    return this.http.get<RecipeDetail>(`/api/nutrition/recipes/${recipeId}`);
  }

  createRecipe(request: CreateRecipeRequest): Observable<RecipeSummary> {
    return this.http.post<RecipeSummary>('/api/nutrition/recipes', request);
  }

  /** A new version of the recipe; refused as `recipe_changed` when it moved on since `baseRevision`. */
  addVersion(recipeId: string, request: AddRecipeVersionRequest): Observable<RecipeSummary> {
    return this.http.post<RecipeSummary>(`/api/nutrition/recipes/${recipeId}/versions`, request);
  }

  publishVersion(versionId: string): Observable<RecipeSummary> {
    return this.http.post<RecipeSummary>(`/api/nutrition/recipe-versions/${versionId}/publish`, {});
  }

  /** Uploads a cover photo; the server re-encodes it with a thumbnail and keeps it for its uploader. */
  uploadPhoto(file: File): Observable<{ id: string }> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http
      .post<MediaAssetView>('/api/media/recipe-photo', form)
      .pipe(map((asset) => ({ id: asset.id })));
  }

  /**
   * Grants the photos on screen in one call (at most 32): each answer carries the photo's own short-
   * lived address and its thumbnail's. A photo the caller may not read is simply left out.
   */
  grantPhotos(assetIds: readonly string[]): Observable<MediaAccessBatchView> {
    return this.http.post<MediaAccessBatchView>('/api/media/access', { assetIds: [...assetIds] });
  }

  searchFoods(query: string): Observable<FoodItemPage> {
    return this.http.get<FoodItemPage>('/api/nutrition/foods', {
      params: new HttpParams().set('query', query).set('skip', 0).set('take', 20),
    });
  }

  /** USDA's basic foods only: an ingredient is rarely a US packaged product (R4.4c). */
  searchUsda(query: string): Observable<ProviderFoodSearchPage> {
    return this.http.get<ProviderFoodSearchPage>('/api/nutrition/providers/usda/search', {
      params: new HttpParams()
        .set('query', query)
        .set('kind', 'Basic')
        .set('skip', 0)
        .set('take', 10),
    });
  }

  /** Copies a USDA food into the workspace's foods, so a recipe line can use it. */
  importUsda(fdcId: string): Observable<FoodItemView> {
    return this.http.post<FoodItemView>('/api/nutrition/providers/usda/import', { fdcId });
  }

  aiAvailability(): Observable<AiMealDraftAvailabilityView> {
    return this.http.get<AiMealDraftAvailabilityView>('/api/nutrition/ai-drafts/availability');
  }

  suggest(prompt: string): Observable<AiMealDraftView> {
    return this.http.post<AiMealDraftView>('/api/nutrition/ai-drafts', {
      prompt,
      promptVersion: 'recipe-editor-v1',
      culture: 'en-LB',
    });
  }

  /** Saves the suggestion as the recipe the coach shaped, or turns it down. */
  review(operationId: string, request: ReviewAiMealDraftRequest): Observable<AiMealDraftView> {
    return this.http.post<AiMealDraftView>(
      `/api/nutrition/ai-drafts/${operationId}/review`,
      request,
    );
  }
}
