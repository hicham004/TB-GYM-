import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  AddFoodVersionRequest,
  CreateFoodItemRequest,
  FoodItemPage,
  FoodItemView,
  NutritionWorkspaceSettingsView,
  ProviderFoodSearchPage,
  UpdateNutritionSettingsRequest,
} from '../../core/api/generated';
import type { UsdaKind } from './food.models';

/**
 * The Foods page's reads and writes (C7, R4.4c) and the nutrition Settings page's: the workspace's
 * foods, USDA's matches and the calculation defaults. Kept out of `ApiClient`, like `RecipeApi`, so
 * they load only with these pages.
 */
@Injectable({ providedIn: 'root' })
export class FoodApi {
  private readonly http = inject(HttpClient);

  /**
   * The workspace's foods by name, every one or those whose name holds `query`; with `archived`, only
   * the archived ones.
   */
  listFoods(query: string, skip: number, take: number, archived = false): Observable<FoodItemPage> {
    let params = new HttpParams().set('query', query).set('skip', skip).set('take', take);
    if (archived) params = params.set('archived', true);
    return this.http.get<FoodItemPage>('/api/nutrition/foods', { params });
  }

  /** Archives a food, which recipes keep, or restores it; either twice changes nothing. */
  setArchived(foodId: string, isArchived: boolean): Observable<FoodItemView> {
    return this.http.put<FoodItemView>(`/api/nutrition/foods/${foodId}/archive`, { isArchived });
  }

  createFood(request: CreateFoodItemRequest): Observable<FoodItemView> {
    return this.http.post<FoodItemView>('/api/nutrition/foods', request);
  }

  /** The food's next version; refused as `food_changed` when it moved on since `baseRevision`. */
  addVersion(foodId: string, request: AddFoodVersionRequest): Observable<FoodItemView> {
    return this.http.post<FoodItemView>(`/api/nutrition/foods/${foodId}/versions`, request);
  }

  searchUsda(query: string, kind: UsdaKind, take = 20): Observable<ProviderFoodSearchPage> {
    return this.http.get<ProviderFoodSearchPage>('/api/nutrition/providers/usda/search', {
      params: new HttpParams()
        .set('query', query)
        .set('kind', kind)
        .set('skip', 0)
        .set('take', take),
    });
  }

  /** Copies a USDA food into the workspace's foods; a food copied before comes back as it is. */
  importUsda(fdcId: string): Observable<FoodItemView> {
    return this.http.post<FoodItemView>('/api/nutrition/providers/usda/import', { fdcId });
  }

  getSettings(): Observable<NutritionWorkspaceSettingsView> {
    return this.http.get<NutritionWorkspaceSettingsView>('/api/nutrition/settings');
  }

  /** The owner's alone (R4.4c); a save since `version` was read is refused as a conflict. */
  updateSettings(
    request: UpdateNutritionSettingsRequest,
  ): Observable<NutritionWorkspaceSettingsView> {
    return this.http.put<NutritionWorkspaceSettingsView>('/api/nutrition/settings', request);
  }
}
