import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  AllergenCode,
  AssignNutritionPlanRequest,
  CalculateNutritionTargetsRequest,
  CancelNutritionPlanRequest,
  ClientAllergensView,
  ClientNutritionPlanSummary,
  CreateMacroOverrideRequest,
  NutritionCalculationRecord,
  NutritionCalculationView,
} from '../../core/api/generated';

/**
 * What a coach's Nutrition tab for one client reads and writes (R5.3d): the targets already worked
 * out, the allergens declared, the meal plans assigned, and the writes that change them (A6 added the
 * coach's own macros and stopping a plan). Kept out of `ApiClient` so none of it loads before the tab is
 * opened. The server decides who may do what: a client's plan without Nutrition is refused with 403, and
 * a client who is not in the workspace is 404.
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

  /** Stops a meal plan for good (NUT-011): the reason is kept with it and its dates come free. */
  stop(
    clientId: string,
    planId: string,
    request: CancelNutritionPlanRequest,
  ): Observable<ClientNutritionPlanSummary> {
    return this.http.post<ClientNutritionPlanSummary>(
      `/api/nutrition/clients/${clientId}/plans/${planId}/cancel`,
      request,
    );
  }

  /** The coach's own macros over a calculation, recorded as new targets with why (NUT-008). */
  adjustMacros(
    clientId: string,
    calculationId: string,
    request: CreateMacroOverrideRequest,
  ): Observable<NutritionCalculationRecord> {
    return this.http.post<NutritionCalculationRecord>(
      `/api/nutrition/clients/${clientId}/calculations/${calculationId}/macro-overrides`,
      request,
    );
  }
}
