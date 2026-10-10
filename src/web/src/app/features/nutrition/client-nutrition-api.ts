import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  AllergenCode,
  AssignNutritionPlanRequest,
  CalculateNutritionTargetsRequest,
  ClientAllergensView,
  ClientNutritionPlanSummary,
  NutritionCalculationRecord,
  NutritionCalculationView,
} from '../../core/api/generated';

/**
 * What a coach's Nutrition tab for one client reads and writes (R5.3d): the targets already worked
 * out, the allergens declared, the meal plans assigned, and the three writes. Kept out of `ApiClient`
 * so none of it loads before the tab is opened. The server decides who may do what, and every answer
 * is refused with 403 when the client's plan does not include Nutrition.
 */
@Injectable({ providedIn: 'root' })
export class ClientNutritionApi {
  private readonly http = inject(HttpClient);

  allergens(clientId: string): Observable<ClientAllergensView> {
    return this.http.get<ClientAllergensView>(`/api/nutrition/clients/${clientId}/allergens`);
  }

  /** Replaces the whole declared list; the server keeps what was dropped as history. */
  replaceAllergens(clientId: string, codes: readonly AllergenCode[]): Observable<void> {
    return this.http.put<void>(`/api/nutrition/clients/${clientId}/allergens`, { codes });
  }

  /** Newest first, each with the numbers it was worked out from. */
  calculations(clientId: string, take = 5): Observable<NutritionCalculationRecord[]> {
    return this.http.get<NutritionCalculationRecord[]>(
      `/api/nutrition/clients/${clientId}/calculations`,
      { params: new HttpParams().set('take', take) },
    );
  }

  /** Each press records a calculation; the server never overwrites an earlier one. */
  calculate(
    clientId: string,
    request: CalculateNutritionTargetsRequest,
  ): Observable<NutritionCalculationView> {
    return this.http.post<NutritionCalculationView>(
      `/api/nutrition/clients/${clientId}/calculations`,
      request,
    );
  }

  plans(clientId: string): Observable<ClientNutritionPlanSummary[]> {
    return this.http.get<ClientNutritionPlanSummary[]>(`/api/nutrition/clients/${clientId}/plans`);
  }

  assign(
    clientId: string,
    request: AssignNutritionPlanRequest,
  ): Observable<ClientNutritionPlanSummary> {
    return this.http.post<ClientNutritionPlanSummary>(
      `/api/nutrition/clients/${clientId}/plans`,
      request,
    );
  }
}
