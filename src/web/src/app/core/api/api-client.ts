import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type * as Phase3Contracts from './generated';
import {
  mapAiDraft,
  mapCalculation,
  mapClientPlan,
  mapFoodPage,
  mapMealPlanPage,
  mapNutritionDay,
  mapNutritionSettings,
  mapProviderSearch,
  mapRecipePage,
} from '../../features/nutrition/nutrition.models';
import {
  mapDateCorrection,
  mapHistory,
  mapMeasurement,
  mapMeasurementHistory,
  mapMeasurements,
  mapObservation,
  mapProgress,
  mapProgressPhoto,
  mapProgressPhotos,
} from '../../features/progress/progress.models';
import type { ProgressPhotoPose } from '../../features/progress/progress.models';
import { mapProgressDashboard } from '../../features/progress/progress-dashboard.models';
import type {
  ClientCommercialOverview as ContractClientCommercialOverview,
  ClientEnrollmentView as ContractClientEnrollmentView,
  ClientSelfProfile as ContractClientSelfProfile,
  ClientSummary as ContractClientSummary,
  CoachingProductView as ContractCoachingProductView,
  CoachClientDetails as ContractCoachClientDetails,
  FeatureAccessDecision as ContractFeatureAccessDecision,
  InvitationSummary,
  PaymentRecordView as ContractPaymentRecordView,
  ProductCatalog as ContractProductCatalog,
  ProductOfferView as ContractProductOfferView,
  UpdateWorkspaceRequest,
  WorkspaceDetails as ContractWorkspaceDetails,
} from './generated';
import {
  ClientInvitation,
  ClientCommercialOverview,
  ClientEnrollment,
  ClientSelfProfile,
  ClientSummary,
  CoachClientDetails,
  CoachingProduct,
  CompleteClientOnboardingRequest,
  CreateClientInvitationRequest,
  CreateCoachingProductRequest,
  CreateProductOfferRequest,
  CurrentUser,
  EmailActionResponse,
  InvitationAcceptance,
  LoginRequest,
  PaymentRecord,
  ProductCatalog,
  PublicInvitation,
  RegisterCoachRequest,
  RecordManualPaymentRequest,
  RegistrationResponse,
  TenantMembership,
  UpdateCoachingProductRequest,
  UpdateClientIntakeRequest,
  WorkspaceDetails,
  AssignProductRequest,
  RenewEnrollmentRequest,
  ChangeEnrollmentStatusRequest,
} from './api.models';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  getCsrfToken(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>('/api/auth/csrf');
  }

  registerCoach(request: RegisterCoachRequest): Observable<RegistrationResponse> {
    return this.http.post<RegistrationResponse>('/api/auth/register/coach', request);
  }

  login(request: LoginRequest): Observable<CurrentUser> {
    return this.http.post<CurrentUser>('/api/auth/login', request);
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {});
  }

  getCurrentUser(): Observable<CurrentUser> {
    return this.http.get<CurrentUser>('/api/auth/me');
  }

  confirmEmail(userId: string, code: string): Observable<void> {
    return this.http.post<void>('/api/auth/confirm-email', { userId, code });
  }

  forgotPassword(email: string): Observable<EmailActionResponse> {
    return this.http.post<EmailActionResponse>('/api/auth/forgot-password', { email });
  }

  resetPassword(userId: string, code: string, newPassword: string): Observable<void> {
    return this.http.post<void>('/api/auth/reset-password', { userId, code, newPassword });
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>('/api/auth/change-password', { currentPassword, newPassword });
  }

  revokeAllSessions(): Observable<void> {
    return this.http.post<void>('/api/auth/sessions/revoke-all', {});
  }

  getTenants(): Observable<TenantMembership[]> {
    return this.http.get<TenantMembership[]>('/api/tenants');
  }

  getWorkspace(): Observable<WorkspaceDetails> {
    return this.http.get<ContractWorkspaceDetails>('/api/workspace').pipe(map(toWorkspace));
  }

  updateWorkspace(request: UpdateWorkspaceRequest): Observable<WorkspaceDetails> {
    return this.http
      .put<ContractWorkspaceDetails>('/api/workspace', request)
      .pipe(map(toWorkspace));
  }

  getInvitations(): Observable<ClientInvitation[]> {
    return this.http
      .get<InvitationSummary[]>('/api/invitations')
      .pipe(map((items) => items.map(toInvitation)));
  }

  createInvitation(request: CreateClientInvitationRequest): Observable<ClientInvitation> {
    return this.http.post<InvitationSummary>('/api/invitations', request).pipe(map(toInvitation));
  }

  resendInvitation(invitationId: string): Observable<ClientInvitation> {
    return this.http
      .post<InvitationSummary>(`/api/invitations/${invitationId}/resend`, {})
      .pipe(map(toInvitation));
  }

  revokeInvitation(invitationId: string): Observable<ClientInvitation> {
    return this.http
      .post<InvitationSummary>(`/api/invitations/${invitationId}/revoke`, {})
      .pipe(map(toInvitation));
  }

  getPublicInvitation(token: string): Observable<PublicInvitation> {
    return this.http.get<PublicInvitation>(`/api/invitations/public/${encodeURIComponent(token)}`);
  }

  acceptInvitation(
    token: string,
    displayName: string | null,
    password: string | null,
  ): Observable<InvitationAcceptance> {
    return this.http.post<InvitationAcceptance>('/api/invitations/accept', {
      token,
      displayName,
      password,
    });
  }

  getClients(): Observable<ClientSummary[]> {
    return this.http
      .get<ContractClientSummary[]>('/api/clients')
      .pipe(map((items) => items.map(toClientSummary)));
  }

  getClient(clientId: string): Observable<CoachClientDetails> {
    return this.http
      .get<ContractCoachClientDetails>(`/api/clients/${clientId}`)
      .pipe(map(toCoachClient));
  }

  updateClientIntake(
    clientId: string,
    request: UpdateClientIntakeRequest,
  ): Observable<CoachClientDetails> {
    return this.http
      .put<ContractCoachClientDetails>(`/api/clients/${clientId}/intake`, request)
      .pipe(map(toCoachClient));
  }

  completeClientOnboarding(
    clientId: string,
    request: CompleteClientOnboardingRequest,
  ): Observable<CoachClientDetails> {
    return this.http
      .post<ContractCoachClientDetails>(`/api/clients/${clientId}/complete-onboarding`, request)
      .pipe(map(toCoachClient));
  }

  updateCoachNotes(
    clientId: string,
    notes: string | null,
    version: number,
  ): Observable<CoachClientDetails> {
    return this.http
      .put<ContractCoachClientDetails>(`/api/clients/${clientId}/coach-notes`, {
        notes,
        version,
      })
      .pipe(map(toCoachClient));
  }

  blockClientRelationship(
    clientId: string,
    reason: string,
    version: number,
  ): Observable<CoachClientDetails> {
    return this.http
      .post<ContractCoachClientDetails>(`/api/clients/${clientId}/relationship/block`, {
        reason,
        version,
      })
      .pipe(map(toCoachClient));
  }

  unblockClientRelationship(
    clientId: string,
    reason: string,
    version: number,
  ): Observable<CoachClientDetails> {
    return this.http
      .post<ContractCoachClientDetails>(`/api/clients/${clientId}/relationship/unblock`, {
        reason,
        version,
      })
      .pipe(map(toCoachClient));
  }

  getProductCatalog(): Observable<ProductCatalog> {
    return this.http
      .get<ContractProductCatalog>('/api/commercial/products')
      .pipe(map(toProductCatalog));
  }

  createCoachingProduct(request: CreateCoachingProductRequest): Observable<CoachingProduct> {
    return this.http
      .post<ContractCoachingProductView>('/api/commercial/products', request)
      .pipe(map(toCoachingProduct));
  }

  updateCoachingProduct(
    productId: string,
    request: UpdateCoachingProductRequest,
  ): Observable<CoachingProduct> {
    return this.http
      .put<ContractCoachingProductView>(`/api/commercial/products/${productId}`, request)
      .pipe(map(toCoachingProduct));
  }

  addProductOffer(
    productId: string,
    request: CreateProductOfferRequest,
  ): Observable<CoachingProduct> {
    return this.http
      .post<ContractCoachingProductView>(`/api/commercial/products/${productId}/offers`, request)
      .pipe(map(toCoachingProduct));
  }

  setOfferAvailability(
    offerId: string,
    isActive: boolean,
    version: number,
  ): Observable<CoachingProduct> {
    return this.http
      .put<ContractCoachingProductView>(`/api/commercial/offers/${offerId}/availability`, {
        isActive,
        version,
      })
      .pipe(map(toCoachingProduct));
  }

  getClientCommercialOverview(clientId: string): Observable<ClientCommercialOverview> {
    return this.http
      .get<ContractClientCommercialOverview>(`/api/commercial/clients/${clientId}`)
      .pipe(map(toClientCommercialOverview));
  }

  assignProduct(clientId: string, request: AssignProductRequest): Observable<ClientEnrollment> {
    return this.http
      .post<ContractClientEnrollmentView>(
        `/api/commercial/clients/${clientId}/enrollments`,
        request,
      )
      .pipe(map(toClientEnrollment));
  }

  recordManualPayment(
    enrollmentId: string,
    request: RecordManualPaymentRequest,
  ): Observable<ClientEnrollment> {
    return this.http
      .post<ContractClientEnrollmentView>(
        `/api/commercial/enrollments/${enrollmentId}/payments`,
        request,
      )
      .pipe(map(toClientEnrollment));
  }

  renewEnrollment(
    enrollmentId: string,
    request: RenewEnrollmentRequest,
  ): Observable<ClientEnrollment> {
    return this.http
      .post<ContractClientEnrollmentView>(
        `/api/commercial/enrollments/${enrollmentId}/renew`,
        request,
      )
      .pipe(map(toClientEnrollment));
  }

  pauseEnrollment(
    enrollmentId: string,
    request: ChangeEnrollmentStatusRequest,
  ): Observable<ClientEnrollment> {
    return this.http
      .post<ContractClientEnrollmentView>(
        `/api/commercial/enrollments/${enrollmentId}/pause`,
        request,
      )
      .pipe(map(toClientEnrollment));
  }

  resumeEnrollment(enrollmentId: string, version: number): Observable<ClientEnrollment> {
    return this.http
      .post<ContractClientEnrollmentView>(`/api/commercial/enrollments/${enrollmentId}/resume`, {
        version,
      })
      .pipe(map(toClientEnrollment));
  }

  cancelEnrollment(
    enrollmentId: string,
    request: ChangeEnrollmentStatusRequest,
  ): Observable<ClientEnrollment> {
    return this.http
      .post<ContractClientEnrollmentView>(
        `/api/commercial/enrollments/${enrollmentId}/cancel`,
        request,
      )
      .pipe(map(toClientEnrollment));
  }

  getSelfProfile(): Observable<ClientSelfProfile> {
    return this.http
      .get<ContractClientSelfProfile>('/api/client-profile/me')
      .pipe(map(toSelfProfile));
  }

  updateSelfIntake(request: UpdateClientIntakeRequest): Observable<ClientSelfProfile> {
    return this.http
      .put<ContractClientSelfProfile>('/api/client-profile/me/intake', request)
      .pipe(map(toSelfProfile));
  }

  completeSelfOnboarding(request: CompleteClientOnboardingRequest): Observable<ClientSelfProfile> {
    return this.http
      .post<ContractClientSelfProfile>('/api/client-profile/me/complete-onboarding', request)
      .pipe(map(toSelfProfile));
  }

  searchExercises(query: {
    query?: string;
    equipment?: Phase3Contracts.ExerciseEquipment;
    movementPattern?: Phase3Contracts.MovementPattern;
    classification?: Phase3Contracts.ExerciseClassification;
    tag?: string;
    includeArchived?: boolean;
  }): Observable<Phase3Contracts.ExerciseSearchResult> {
    const parameters = Object.fromEntries(
      Object.entries({ ...query, skip: 0, take: 200 }).filter(
        ([, value]) => value !== undefined && value !== '',
      ),
    );
    return this.http.get<Phase3Contracts.ExerciseSearchResult>('/api/exercises', {
      params: parameters,
    });
  }

  createExercise(
    request: Phase3Contracts.CreateExerciseRequest,
  ): Observable<Phase3Contracts.ExerciseView> {
    return this.http.post<Phase3Contracts.ExerciseView>('/api/exercises', request);
  }

  updateExercise(
    exerciseId: string,
    request: Phase3Contracts.UpdateExerciseRequest,
  ): Observable<Phase3Contracts.ExerciseView> {
    return this.http.put<Phase3Contracts.ExerciseView>(`/api/exercises/${exerciseId}`, request);
  }

  setExerciseArchived(
    exerciseId: string,
    request: Phase3Contracts.SetExerciseArchivedRequest,
  ): Observable<Phase3Contracts.ExerciseView> {
    return this.http.put<Phase3Contracts.ExerciseView>(
      `/api/exercises/${exerciseId}/archive`,
      request,
    );
  }

  listMedia(skip = 0, take = 100): Observable<Phase3Contracts.MediaAssetPage> {
    return this.http.get<Phase3Contracts.MediaAssetPage>('/api/media', {
      params: { skip, take },
    });
  }

  uploadMedia(title: string, file: File): Observable<Phase3Contracts.MediaAssetView> {
    const body = new FormData();
    body.append('title', title);
    body.append('file', file, file.name);
    return this.http.post<Phase3Contracts.MediaAssetView>('/api/media/uploads', body);
  }

  registerExternalMedia(
    request: Phase3Contracts.RegisterExternalMediaRequest,
  ): Observable<Phase3Contracts.MediaAssetView> {
    return this.http.post<Phase3Contracts.MediaAssetView>('/api/media/external', request);
  }

  createMediaAccess(assetId: string): Observable<Phase3Contracts.MediaAccessView> {
    return this.http.post<Phase3Contracts.MediaAccessView>(`/api/media/${assetId}/access`, {});
  }

  deleteMedia(
    assetId: string,
    request: Phase3Contracts.DeleteMediaRequest,
  ): Observable<Phase3Contracts.MediaAssetView> {
    return this.http.delete<Phase3Contracts.MediaAssetView>(`/api/media/${assetId}`, {
      body: request,
    });
  }

  listProgramTemplates(skip = 0, take = 100): Observable<Phase3Contracts.ProgramTemplatePage> {
    return this.http.get<Phase3Contracts.ProgramTemplatePage>('/api/training/templates', {
      params: { skip, take },
    });
  }

  getProgramTemplateVersion(
    versionId: string,
  ): Observable<Phase3Contracts.ProgramTemplateVersionView> {
    return this.http.get<Phase3Contracts.ProgramTemplateVersionView>(
      `/api/training/template-versions/${versionId}`,
    );
  }

  createProgramTemplate(
    request: Phase3Contracts.SaveProgramTemplateRequest,
  ): Observable<Phase3Contracts.ProgramTemplateVersionView> {
    return this.http.post<Phase3Contracts.ProgramTemplateVersionView>(
      '/api/training/templates',
      request,
    );
  }

  addProgramTemplateVersion(
    templateId: string,
    request: Phase3Contracts.SaveProgramTemplateRequest,
  ): Observable<Phase3Contracts.ProgramTemplateVersionView> {
    return this.http.post<Phase3Contracts.ProgramTemplateVersionView>(
      `/api/training/templates/${templateId}/versions`,
      request,
    );
  }

  listSavedSessions(): Observable<Phase3Contracts.SavedSessionView[]> {
    return this.http.get<Phase3Contracts.SavedSessionView[]>('/api/training/saved-sessions');
  }

  saveTrainingSession(
    request: Phase3Contracts.SaveSessionTemplateRequest,
  ): Observable<Phase3Contracts.SavedSessionView> {
    return this.http.post<Phase3Contracts.SavedSessionView>(
      '/api/training/saved-sessions',
      request,
    );
  }

  listClientMesocycles(clientId: string): Observable<Phase3Contracts.MesocycleSummary[]> {
    return this.http.get<Phase3Contracts.MesocycleSummary[]>(
      `/api/training/clients/${clientId}/mesocycles`,
    );
  }

  assignClientMesocycle(
    clientId: string,
    request: Phase3Contracts.AssignMesocycleRequest,
  ): Observable<Phase3Contracts.TrainingMesocycleView> {
    return this.http.post<Phase3Contracts.TrainingMesocycleView>(
      `/api/training/clients/${clientId}/mesocycles`,
      request,
    );
  }

  getTrainingMesocycle(id: string): Observable<Phase3Contracts.TrainingMesocycleView> {
    return this.http.get<Phase3Contracts.TrainingMesocycleView>(`/api/training/mesocycles/${id}`);
  }

  updateMesocycleVisibility(
    id: string,
    request: Phase3Contracts.UpdateMesocycleVisibilityRequest,
  ): Observable<Phase3Contracts.TrainingMesocycleView> {
    return this.http.put<Phase3Contracts.TrainingMesocycleView>(
      `/api/training/mesocycles/${id}/visibility`,
      request,
    );
  }

  setMesocycleWeekPublished(
    mesocycleId: string,
    weekId: string,
    request: Phase3Contracts.SetWeekPublishedRequest,
  ): Observable<Phase3Contracts.TrainingMesocycleView> {
    return this.http.put<Phase3Contracts.TrainingMesocycleView>(
      `/api/training/mesocycles/${mesocycleId}/weeks/${weekId}/publish`,
      request,
    );
  }

  rescheduleMesocycle(
    mesocycleId: string,
    request: Phase3Contracts.RescheduleMesocycleRequest,
  ): Observable<Phase3Contracts.TrainingMesocycleView> {
    return this.http.put<Phase3Contracts.TrainingMesocycleView>(
      `/api/training/mesocycles/${mesocycleId}/schedule`,
      request,
    );
  }

  cancelTrainingMesocycle(
    mesocycleId: string,
    request: Phase3Contracts.CancelMesocycleRequest,
  ): Observable<Phase3Contracts.TrainingMesocycleView> {
    return this.http.post<Phase3Contracts.TrainingMesocycleView>(
      `/api/training/mesocycles/${mesocycleId}/cancel`,
      request,
    );
  }

  completeTrainingMesocycle(
    mesocycleId: string,
    request: Phase3Contracts.CompleteMesocycleRequest,
  ): Observable<Phase3Contracts.TrainingMesocycleView> {
    return this.http.post<Phase3Contracts.TrainingMesocycleView>(
      `/api/training/mesocycles/${mesocycleId}/complete`,
      request,
    );
  }

  replaceFutureTrainingSession(
    mesocycleId: string,
    sessionId: string,
    request: Phase3Contracts.ReplaceTrainingSessionRequest,
  ): Observable<Phase3Contracts.TrainingMesocycleView> {
    return this.http.put<Phase3Contracts.TrainingMesocycleView>(
      `/api/training/mesocycles/${mesocycleId}/sessions/${sessionId}`,
      request,
    );
  }

  previewTrainingProgression(
    mesocycleId: string,
    request: Phase3Contracts.ProgressionPreviewRequest,
  ): Observable<Phase3Contracts.ProgressionPreviewView> {
    return this.http.post<Phase3Contracts.ProgressionPreviewView>(
      `/api/training/mesocycles/${mesocycleId}/progression/preview`,
      request,
    );
  }

  applyTrainingProgression(
    mesocycleId: string,
    request: Phase3Contracts.ApplyProgressionRequest,
  ): Observable<Phase3Contracts.TrainingMesocycleView> {
    return this.http.post<Phase3Contracts.TrainingMesocycleView>(
      `/api/training/mesocycles/${mesocycleId}/progression/apply`,
      request,
    );
  }

  getExerciseHistory(
    clientId: string,
    exerciseId: string,
    skip = 0,
    take = 50,
  ): Observable<Phase3Contracts.ExerciseHistoryPage> {
    return this.http.get<Phase3Contracts.ExerciseHistoryPage>(
      `/api/training/clients/${clientId}/exercises/${exerciseId}/history`,
      { params: { skip, take } },
    );
  }

  listStrengthMaxes(
    clientId: string,
    exerciseId?: string,
    skip = 0,
    take = 100,
  ): Observable<Phase3Contracts.StrengthMaxPage> {
    return this.http.get<Phase3Contracts.StrengthMaxPage>(
      `/api/strength/clients/${clientId}/maxes`,
      {
        params: {
          ...(exerciseId ? { exerciseId } : {}),
          skip,
          take,
        },
      },
    );
  }

  recordStrengthMax(
    clientId: string,
    request: Phase3Contracts.RecordStrengthMaxRequest,
  ): Observable<Phase3Contracts.StrengthMaxView> {
    return this.http.post<Phase3Contracts.StrengthMaxView>(
      `/api/strength/clients/${clientId}/maxes`,
      request,
    );
  }

  getMyTrainingToday(): Observable<Phase3Contracts.ClientTrainingDayResult> {
    return this.http.get<Phase3Contracts.ClientTrainingDayResult>('/api/training/me/today');
  }

  startMyWorkout(sessionId: string): Observable<Phase3Contracts.WorkoutExecutionView> {
    return this.http.post<Phase3Contracts.WorkoutExecutionView>(
      `/api/training/me/sessions/${sessionId}/start`,
      {},
    );
  }

  recordMyTrainingSet(
    workoutId: string,
    setId: string,
    request: Phase3Contracts.RecordSetActualRequest,
  ): Observable<Phase3Contracts.WorkoutSetSaveView> {
    return this.http.put<Phase3Contracts.WorkoutSetSaveView>(
      `/api/training/me/workouts/${workoutId}/sets/${setId}`,
      request,
    );
  }

  substituteMyTrainingExercise(
    workoutId: string,
    exercisePerformanceId: string,
    request: Phase3Contracts.SubstituteExerciseRequest,
  ): Observable<Phase3Contracts.WorkoutExecutionView> {
    return this.http.put<Phase3Contracts.WorkoutExecutionView>(
      `/api/training/me/workouts/${workoutId}/exercises/${exercisePerformanceId}/substitution`,
      request,
    );
  }

  completeMyWorkout(
    workoutId: string,
    request: Phase3Contracts.CompleteWorkoutRequest,
  ): Observable<Phase3Contracts.WorkoutExecutionView> {
    return this.http.post<Phase3Contracts.WorkoutExecutionView>(
      `/api/training/me/workouts/${workoutId}/complete`,
      request,
    );
  }

  addWorkoutNote(
    workoutId: string,
    request: Phase3Contracts.AddWorkoutNoteRequest,
  ): Observable<Phase3Contracts.WorkoutExecutionView> {
    return this.http.post<Phase3Contracts.WorkoutExecutionView>(
      `/api/training/workouts/${workoutId}/notes`,
      request,
    );
  }

  getNutritionSettings() {
    return this.http
      .get<Phase3Contracts.NutritionWorkspaceSettingsView>('/api/nutrition/settings')
      .pipe(map(mapNutritionSettings));
  }

  updateNutritionSettings(request: Phase3Contracts.UpdateNutritionSettingsRequest) {
    return this.http
      .put<Phase3Contracts.NutritionWorkspaceSettingsView>('/api/nutrition/settings', request)
      .pipe(map(mapNutritionSettings));
  }

  listFoods(query = '', skip = 0, take = 100) {
    return this.http
      .get<Phase3Contracts.FoodItemPage>('/api/nutrition/foods', { params: { query, skip, take } })
      .pipe(map(mapFoodPage));
  }

  createFood(request: Phase3Contracts.CreateFoodItemRequest) {
    return this.http.post<Phase3Contracts.FoodItemView>('/api/nutrition/foods', request);
  }

  searchUsdaFoods(query: string, skip = 0, take = 25) {
    return this.http
      .get<Phase3Contracts.ProviderFoodSearchPage>('/api/nutrition/providers/usda/search', {
        params: { query, skip, take },
      })
      .pipe(map(mapProviderSearch));
  }

  importUsdaFood(fdcId: string) {
    return this.http.post<Phase3Contracts.FoodItemView>('/api/nutrition/providers/usda/import', {
      fdcId,
    });
  }

  listRecipes(query = '', skip = 0, take = 100) {
    return this.http
      .get<Phase3Contracts.RecipePage>('/api/nutrition/recipes', { params: { query, skip, take } })
      .pipe(map(mapRecipePage));
  }

  createRecipe(request: Phase3Contracts.CreateRecipeRequest) {
    return this.http.post<Phase3Contracts.RecipeSummary>('/api/nutrition/recipes', request);
  }

  publishRecipe(versionId: string) {
    return this.http.post<Phase3Contracts.RecipeSummary>(
      `/api/nutrition/recipe-versions/${versionId}/publish`,
      {},
    );
  }

  listMealPlans(skip = 0, take = 100) {
    return this.http
      .get<Phase3Contracts.MealPlanTemplatePage>('/api/nutrition/meal-plans', {
        params: { skip, take },
      })
      .pipe(map(mapMealPlanPage));
  }

  createMealPlan(request: Phase3Contracts.CreateMealPlanRequest) {
    return this.http.post<Phase3Contracts.MealPlanTemplateSummary>(
      '/api/nutrition/meal-plans',
      request,
    );
  }

  publishMealPlan(versionId: string) {
    return this.http.post<Phase3Contracts.MealPlanTemplateSummary>(
      `/api/nutrition/meal-plan-versions/${versionId}/publish`,
      {},
    );
  }

  calculateNutritionTargets(
    clientId: string,
    request: Phase3Contracts.CalculateNutritionTargetsRequest,
  ) {
    return this.http
      .post<Phase3Contracts.NutritionCalculationView>(
        `/api/nutrition/clients/${clientId}/calculations`,
        request,
      )
      .pipe(map(mapCalculation));
  }

  replaceClientAllergens(clientId: string, codes: Phase3Contracts.AllergenCode[]) {
    return this.http.put<void>(`/api/nutrition/clients/${clientId}/allergens`, { codes });
  }

  listClientNutritionPlans(clientId: string) {
    return this.http
      .get<Phase3Contracts.ClientNutritionPlanSummary[]>(`/api/nutrition/clients/${clientId}/plans`)
      .pipe(map((items) => items.map(mapClientPlan)));
  }

  assignNutritionPlan(clientId: string, request: Phase3Contracts.AssignNutritionPlanRequest) {
    return this.http
      .post<Phase3Contracts.ClientNutritionPlanSummary>(
        `/api/nutrition/clients/${clientId}/plans`,
        request,
      )
      .pipe(map(mapClientPlan));
  }

  getMyNutritionDay(localDate?: string) {
    return this.http
      .get<Phase3Contracts.ClientNutritionDayView>('/api/nutrition/me/day', {
        params: localDate ? { localDate } : {},
      })
      .pipe(map(mapNutritionDay));
  }

  recordMyNutritionChoice(request: Phase3Contracts.RecordNutritionChoiceRequest) {
    return this.http
      .put<Phase3Contracts.ClientNutritionDayView>('/api/nutrition/me/choices', request)
      .pipe(map(mapNutritionDay));
  }

  completeMyNutritionLog(logId: string, request: Phase3Contracts.CompleteNutritionLogRequest) {
    return this.http
      .post<Phase3Contracts.ClientNutritionDayView>(
        `/api/nutrition/me/logs/${logId}/complete`,
        request,
      )
      .pipe(map(mapNutritionDay));
  }

  generateAiMealDraft(request: Phase3Contracts.GenerateAiMealDraftRequest) {
    return this.http
      .post<Phase3Contracts.AiMealDraftView>('/api/nutrition/ai-drafts', request)
      .pipe(map(mapAiDraft));
  }

  reviewAiMealDraft(operationId: string, request: Phase3Contracts.ReviewAiMealDraftRequest) {
    return this.http
      .post<Phase3Contracts.AiMealDraftView>(
        `/api/nutrition/ai-drafts/${operationId}/review`,
        request,
      )
      .pipe(map(mapAiDraft));
  }

  getMyProgress(displayUnit: Phase3Contracts.RecordedMassUnit) {
    return this.http
      .get<Phase3Contracts.ProgressView>('/api/progress/me', { params: { displayUnit } })
      .pipe(map(mapProgress));
  }

  getClientProgress(clientId: string, displayUnit: Phase3Contracts.RecordedMassUnit) {
    return this.http
      .get<Phase3Contracts.ProgressView>(`/api/progress/clients/${clientId}`, {
        params: { displayUnit },
      })
      .pipe(map(mapProgress));
  }

  recordMyBodyweight(request: Phase3Contracts.RecordBodyweightRequest) {
    return this.http
      .post<Phase3Contracts.BodyweightObservationView>('/api/progress/me/bodyweight', request)
      .pipe(map(mapObservation));
  }

  recordClientBodyweight(clientId: string, request: Phase3Contracts.RecordBodyweightRequest) {
    return this.http
      .post<Phase3Contracts.BodyweightObservationView>(
        `/api/progress/clients/${clientId}/bodyweight`,
        request,
      )
      .pipe(map(mapObservation));
  }

  correctMyBodyweight(observationId: string, request: Phase3Contracts.CorrectBodyweightRequest) {
    return this.http
      .put<Phase3Contracts.BodyweightHistoryView>(
        `/api/progress/me/bodyweight/${observationId}`,
        request,
      )
      .pipe(map(mapHistory));
  }

  correctClientBodyweight(
    clientId: string,
    observationId: string,
    request: Phase3Contracts.CorrectBodyweightRequest,
  ) {
    return this.http
      .put<Phase3Contracts.BodyweightHistoryView>(
        `/api/progress/clients/${clientId}/bodyweight/${observationId}`,
        request,
      )
      .pipe(map(mapHistory));
  }

  replaceMyBodyweightDate(
    observationId: string,
    request: Phase3Contracts.ReplaceBodyweightDateRequest,
  ) {
    return this.http
      .post<Phase3Contracts.BodyweightDateCorrectionView>(
        `/api/progress/me/bodyweight/${observationId}/replace-date`,
        request,
      )
      .pipe(map(mapDateCorrection));
  }

  replaceClientBodyweightDate(
    clientId: string,
    observationId: string,
    request: Phase3Contracts.ReplaceBodyweightDateRequest,
  ) {
    return this.http
      .post<Phase3Contracts.BodyweightDateCorrectionView>(
        `/api/progress/clients/${clientId}/bodyweight/${observationId}/replace-date`,
        request,
      )
      .pipe(map(mapDateCorrection));
  }

  getMyBodyweightHistory(observationId: string) {
    return this.http
      .get<Phase3Contracts.BodyweightHistoryView>(
        `/api/progress/me/bodyweight/${observationId}/history`,
      )
      .pipe(map(mapHistory));
  }

  getClientBodyweightHistory(clientId: string, observationId: string) {
    return this.http
      .get<Phase3Contracts.BodyweightHistoryView>(
        `/api/progress/clients/${clientId}/bodyweight/${observationId}/history`,
      )
      .pipe(map(mapHistory));
  }

  getMyProgressDashboard(from: string | null = null, to: string | null = null) {
    return this.http
      .get<Phase3Contracts.ProgressDashboardView>('/api/progress/me/dashboard', {
        params: progressWindowParams(from, to),
      })
      .pipe(map(mapProgressDashboard));
  }

  getClientProgressDashboard(
    clientId: string,
    from: string | null = null,
    to: string | null = null,
  ) {
    return this.http
      .get<Phase3Contracts.ProgressDashboardView>(`/api/progress/clients/${clientId}/dashboard`, {
        params: progressWindowParams(from, to),
      })
      .pipe(map(mapProgressDashboard));
  }

  getMyProgressPhotos() {
    return this.http
      .get<Phase3Contracts.ProgressPhotosView>('/api/progress/me/photos')
      .pipe(map(mapProgressPhotos));
  }

  getClientProgressPhotos(clientId: string) {
    return this.http
      .get<Phase3Contracts.ProgressPhotosView>(`/api/progress/clients/${clientId}/photos`)
      .pipe(map(mapProgressPhotos));
  }

  recordMyProgressPhoto(pose: ProgressPhotoPose, photoDate: string | null, file: File) {
    return this.http
      .post<Phase3Contracts.ProgressPhotoView>('/api/progress/me/photos', progressPhotoBody(file), {
        params: progressPhotoParams(pose, photoDate),
      })
      .pipe(map(mapProgressPhoto));
  }

  recordClientProgressPhoto(
    clientId: string,
    pose: ProgressPhotoPose,
    photoDate: string | null,
    file: File,
  ) {
    return this.http
      .post<Phase3Contracts.ProgressPhotoView>(
        `/api/progress/clients/${clientId}/photos`,
        progressPhotoBody(file),
        { params: progressPhotoParams(pose, photoDate) },
      )
      .pipe(map(mapProgressPhoto));
  }

  removeMyProgressPhoto(photoId: string, request: Phase3Contracts.RemoveProgressPhotoRequest) {
    return this.http
      .post<Phase3Contracts.ProgressPhotoView>(`/api/progress/me/photos/${photoId}/remove`, request)
      .pipe(map(mapProgressPhoto));
  }

  removeClientProgressPhoto(
    clientId: string,
    photoId: string,
    request: Phase3Contracts.RemoveProgressPhotoRequest,
  ) {
    return this.http
      .post<Phase3Contracts.ProgressPhotoView>(
        `/api/progress/clients/${clientId}/photos/${photoId}/remove`,
        request,
      )
      .pipe(map(mapProgressPhoto));
  }

  getMyBodyMeasurements(displayUnit: Phase3Contracts.MeasurementUnit) {
    return this.http
      .get<Phase3Contracts.BodyMeasurementsView>('/api/progress/me/measurements', {
        params: { displayUnit },
      })
      .pipe(map(mapMeasurements));
  }

  getClientBodyMeasurements(clientId: string, displayUnit: Phase3Contracts.MeasurementUnit) {
    return this.http
      .get<Phase3Contracts.BodyMeasurementsView>(`/api/progress/clients/${clientId}/measurements`, {
        params: { displayUnit },
      })
      .pipe(map(mapMeasurements));
  }

  recordMyBodyMeasurement(request: Phase3Contracts.RecordBodyMeasurementRequest) {
    return this.http
      .post<Phase3Contracts.BodyMeasurementView>('/api/progress/me/measurements', request)
      .pipe(map(mapMeasurement));
  }

  recordClientBodyMeasurement(
    clientId: string,
    request: Phase3Contracts.RecordBodyMeasurementRequest,
  ) {
    return this.http
      .post<Phase3Contracts.BodyMeasurementView>(
        `/api/progress/clients/${clientId}/measurements`,
        request,
      )
      .pipe(map(mapMeasurement));
  }

  correctMyBodyMeasurement(
    measurementId: string,
    request: Phase3Contracts.CorrectBodyMeasurementRequest,
  ) {
    return this.http
      .put<Phase3Contracts.BodyMeasurementHistoryView>(
        `/api/progress/me/measurements/${measurementId}`,
        request,
      )
      .pipe(map(mapMeasurementHistory));
  }

  correctClientBodyMeasurement(
    clientId: string,
    measurementId: string,
    request: Phase3Contracts.CorrectBodyMeasurementRequest,
  ) {
    return this.http
      .put<Phase3Contracts.BodyMeasurementHistoryView>(
        `/api/progress/clients/${clientId}/measurements/${measurementId}`,
        request,
      )
      .pipe(map(mapMeasurementHistory));
  }

  getMyBodyMeasurementHistory(measurementId: string) {
    return this.http
      .get<Phase3Contracts.BodyMeasurementHistoryView>(
        `/api/progress/me/measurements/${measurementId}/history`,
      )
      .pipe(map(mapMeasurementHistory));
  }

  getClientBodyMeasurementHistory(clientId: string, measurementId: string) {
    return this.http
      .get<Phase3Contracts.BodyMeasurementHistoryView>(
        `/api/progress/clients/${clientId}/measurements/${measurementId}/history`,
      )
      .pipe(map(mapMeasurementHistory));
  }
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : toNumber(value);
}

function toWorkspace(value: ContractWorkspaceDetails): WorkspaceDetails {
  return { ...value, version: toNumber(value.version) };
}

function toInvitation(value: InvitationSummary): ClientInvitation {
  return {
    ...value,
    sendCount: toNumber(value.sendCount),
    developmentActionUrl: value.developmentActionUrl ?? null,
  };
}

function toClientSummary(value: ContractClientSummary): ClientSummary {
  return {
    ...value,
    version: toNumber(value.version),
  };
}

function toSelfProfile(value: ContractClientSelfProfile): ClientSelfProfile {
  return {
    ...value,
    heightCentimeters: toNullableNumber(value.heightCentimeters),
    heightEnteredValue: toNullableNumber(value.heightEnteredValue),
    averageDailySteps: toNullableNumber(value.averageDailySteps),
    version: toNumber(value.version),
  };
}

function toCoachClient(value: ContractCoachClientDetails): CoachClientDetails {
  return {
    ...value,
    heightCentimeters: toNullableNumber(value.heightCentimeters),
    heightEnteredValue: toNullableNumber(value.heightEnteredValue),
    averageDailySteps: toNullableNumber(value.averageDailySteps),
    version: toNumber(value.version),
  };
}

function toProductCatalog(value: ContractProductCatalog): ProductCatalog {
  return {
    workspaceCurrencyCode: value.workspaceCurrencyCode,
    products: value.products.map(toCoachingProduct),
  };
}

function toCoachingProduct(value: ContractCoachingProductView): CoachingProduct {
  return {
    ...value,
    version: toNumber(value.version),
    offers: value.offers.map(toProductOffer),
  };
}

function toProductOffer(value: ContractProductOfferView) {
  return {
    ...value,
    durationCount: toNumber(value.durationCount),
    priceAmount: toNumber(value.priceAmount),
    version: toNumber(value.version),
  };
}

function toClientCommercialOverview(
  value: ContractClientCommercialOverview,
): ClientCommercialOverview {
  return {
    ...value,
    featureAccess: value.featureAccess.map(toFeatureAccess),
    enrollments: value.enrollments.map(toClientEnrollment),
  };
}

function toFeatureAccess(value: ContractFeatureAccessDecision) {
  return {
    ...value,
    enrollmentId: value.enrollmentId ?? null,
    accessibleFrom: value.accessibleFrom ?? null,
    accessibleUntilExclusive: value.accessibleUntilExclusive ?? null,
  };
}

function toClientEnrollment(value: ContractClientEnrollmentView): ClientEnrollment {
  return {
    ...value,
    priceAmount: toNumber(value.priceAmount),
    paidAmount: toNumber(value.paidAmount),
    balanceAmount: toNumber(value.balanceAmount),
    version: toNumber(value.version),
    payments: value.payments.map(toPaymentRecord),
  };
}

function toPaymentRecord(value: ContractPaymentRecordView): PaymentRecord {
  return {
    ...value,
    amount: toNumber(value.amount),
  };
}

function progressPhotoBody(file: File): FormData {
  const body = new FormData();
  body.append('file', file, file.name);
  return body;
}

function progressPhotoParams(
  pose: ProgressPhotoPose,
  photoDate: string | null,
): Record<string, string> {
  return photoDate === null ? { pose } : { pose, photoDate };
}

// Omitted bounds let the server apply the shared progress window defaults rather than the client
// guessing at them.
function progressWindowParams(from: string | null, to: string | null): Record<string, string> {
  const params: Record<string, string> = {};
  if (from !== null) {
    params['from'] = from;
  }

  if (to !== null) {
    params['to'] = to;
  }

  return params;
}
