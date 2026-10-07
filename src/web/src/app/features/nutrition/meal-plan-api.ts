import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  CreateMealPlanDraftRequest,
  MealPlanDraftSaveView,
  MealPlanDraftSummary,
  MealPlanDraftView,
  MealPlanTemplateDetail,
  MealPlanTemplatePage,
  MealPlanTemplateSummary,
  MealPlanVersionView,
  PublishMealPlanDraftRequest,
  RecipePage,
  SaveMealPlanDraftRequest,
} from '../../core/api/generated';

/**
 * The meal-plan list and builder's reads and writes (C7, R4.4a): plans, versions, published recipes
 * and the coach's own drafts (NUT-013). Kept out of `ApiClient`, like `ProgramBuilderApi`, so they
 * load only with these pages rather than in every page's initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class MealPlanApi {
  private readonly http = inject(HttpClient);

  listPlans(skip: number, take: number): Observable<MealPlanTemplatePage> {
    return this.http.get<MealPlanTemplatePage>('/api/nutrition/meal-plans', {
      params: new HttpParams().set('skip', skip).set('take', take),
    });
  }

  /** One plan with every version, newest first, and the caller's own draft of it, if any. */
  getPlan(planId: string): Observable<MealPlanTemplateDetail> {
    return this.http.get<MealPlanTemplateDetail>(`/api/nutrition/meal-plans/${planId}`);
  }

  getVersion(versionId: string): Observable<MealPlanVersionView> {
    return this.http.get<MealPlanVersionView>(`/api/nutrition/meal-plan-versions/${versionId}`);
  }

  /** Recipes a plan may hold: each at its newest published version, a page at a time. */
  listPublishedRecipes(skip: number): Observable<RecipePage> {
    return this.http.get<RecipePage>('/api/nutrition/recipes', {
      params: new HttpParams().set('published', true).set('skip', skip).set('take', 100),
    });
  }

  /** The caller's own drafts, newest change first: new plans and changes to saved ones. */
  listDrafts(): Observable<MealPlanDraftSummary[]> {
    return this.http.get<MealPlanDraftSummary[]>('/api/nutrition/meal-plan-drafts');
  }

  getDraft(draftId: string): Observable<MealPlanDraftView> {
    return this.http.get<MealPlanDraftView>(`/api/nutrition/meal-plan-drafts/${draftId}`);
  }

  createDraft(request: CreateMealPlanDraftRequest): Observable<MealPlanDraftSaveView> {
    return this.http.post<MealPlanDraftSaveView>('/api/nutrition/meal-plan-drafts', request);
  }

  saveDraft(draftId: string, request: SaveMealPlanDraftRequest): Observable<MealPlanDraftSaveView> {
    return this.http.put<MealPlanDraftSaveView>(
      `/api/nutrition/meal-plan-drafts/${draftId}`,
      request,
    );
  }

  discardDraft(draftId: string, version: number): Observable<void> {
    return this.http.post<void>(`/api/nutrition/meal-plan-drafts/${draftId}/discard`, { version });
  }

  /** The draft becomes the plan's next version, published, and is removed. */
  publishDraft(
    draftId: string,
    request: PublishMealPlanDraftRequest,
  ): Observable<MealPlanTemplateSummary> {
    return this.http.post<MealPlanTemplateSummary>(
      `/api/nutrition/meal-plan-drafts/${draftId}/publish`,
      request,
    );
  }
}
