import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type * as Phase3Contracts from './generated';
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
  CurrentUser,
  EmailActionResponse,
  FeatureAccessDecision,
  InvitationAcceptance,
  LoginRequest,
  PaymentRecord,
  ProductCatalog,
  PublicInvitation,
  RegisterCoachRequest,
  RecordManualPaymentRequest,
  RegistrationResponse,
  TenantMembership,
  UpdateClientIntakeRequest,
  WorkspaceDetails,
  AssignProductRequest,
  RenewEnrollmentRequest,
  ChangeEnrollmentStatusRequest,
} from './api.models';

/** The conversation list's filter and search, in the server's words (the Messages page has its own). */
export interface ConversationListQuery {
  readonly filter: Phase3Contracts.ConversationListFilter;
  readonly search: string;
}

/**
 * The calls the shell and the core stores make, and reads several features share. What this file
 * imports is in every page's first download, so it imports nothing from a feature (audit WEB-5): a
 * read whose answer only a feature shows returns the server's own type, and the feature maps it with
 * its own models. A new call only one screen makes belongs in that feature's own API service.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  getCsrfToken(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>('/api/auth/csrf');
  }

  /** The public website's settings (R6.2g): a WhatsApp number and the analytics script, or neither. */
  getWebsiteSettings(): Observable<Phase3Contracts.WebsiteSettingsView> {
    return this.http.get<Phase3Contracts.WebsiteSettingsView>('/api/website/settings');
  }

  /** The stamp the Talk-to-us form carries back, behind the minimum-time rule. */
  getContactForm(): Observable<Phase3Contracts.ContactFormStampView> {
    return this.http.get<Phase3Contracts.ContactFormStampView>('/api/website/contact-form');
  }

  /** Talk to us about your gym: no account, no workspace; 202 and nothing back. */
  submitContactRequest(request: Phase3Contracts.ContactRequestSubmission): Observable<void> {
    return this.http.post<void>('/api/website/contact-requests', request);
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

  /** The signed-in account, or null when nobody is signed in in this browser (audit AUTH-12). */
  getCurrentUser(): Observable<CurrentUser | null> {
    return this.http.get<CurrentUser | null>('/api/auth/me');
  }

  updateOwnThemeMode(mode: CurrentUser['preferredThemeMode']): Observable<CurrentUser> {
    return this.http.put<CurrentUser>('/api/auth/me/theme', { mode });
  }

  updateOwnWeightUnit(unit: CurrentUser['preferredWeightUnit']): Observable<CurrentUser> {
    return this.http.put<CurrentUser>('/api/auth/me/weight-unit', { unit });
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

  /**
   * Deliberately resends an invitation, which kills every earlier link for it.
   *
   * Both arguments are required by the API and both are security-relevant. The idempotency key
   * makes two concurrent presses converge on one new logical-send generation instead of racing to
   * create two; the version makes a press issued against a stale list conflict rather than silently
   * revoking a link the person pressing did not know existed.
   */
  resendInvitation(
    invitationId: string,
    idempotencyKey: string,
    version: number,
  ): Observable<ClientInvitation> {
    return this.http
      .post<InvitationSummary>(`/api/invitations/${invitationId}/resend`, {
        idempotencyKey,
        version,
      })
      .pipe(map(toInvitation));
  }

  revokeInvitation(invitationId: string, version: number): Observable<ClientInvitation> {
    return this.http
      .post<InvitationSummary>(`/api/invitations/${invitationId}/revoke`, { version })
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

  /** The signed-in client's own access to each coaching feature in the selected workspace. */
  getOwnFeatureAccess(): Observable<FeatureAccessDecision[]> {
    return this.http
      .get<ContractFeatureAccessDecision[]>('/api/client-access/me')
      .pipe(map((decisions) => decisions.map(toFeatureAccess)));
  }

  /** Whether the signed-in client's whole plan has run out, and when they last asked to renew. */
  getOwnRenewalStatus(): Observable<Phase3Contracts.RenewalStatusView> {
    return this.http.get<Phase3Contracts.RenewalStatusView>('/api/client-renewal/me');
  }

  /** Asks the client's coach to renew; asking again inside 7 days returns the first request. */
  requestRenewal(): Observable<Phase3Contracts.RenewalStatusView> {
    return this.http.post<Phase3Contracts.RenewalStatusView>(
      '/api/client-renewal/me/requests',
      null,
    );
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

  getOwnCoach(): Observable<Phase3Contracts.OwnCoachView> {
    return this.http.get<Phase3Contracts.OwnCoachView>('/api/client-profile/me/coach');
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
    /** Any of these patterns (a builder's chip); sent as `movementPattern` once each. */
    movementPatterns?: readonly Phase3Contracts.MovementPattern[];
    classification?: Phase3Contracts.ExerciseClassification;
    tag?: string;
    includeArchived?: boolean;
    /** Only these exercises, at most 100: a program's own lifts. */
    ids?: readonly string[];
    /** Adds the library's count per movement pattern, which a builder's chips are drawn from. */
    patterns?: boolean;
    skip?: number;
    take?: number;
  }): Observable<Phase3Contracts.ExerciseSearchResult> {
    // 100 is the most the server returns (it clamps `take` to 1-100); asking for more only made the
    // request claim a page size it never received. Callers compare `items.length` with `total`.
    const { movementPatterns, ids, take, ...rest } = query;
    const parameters: Record<string, string | number | boolean | readonly string[]> = {
      skip: 0,
      take: take ?? 100,
    };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined && value !== '') parameters[key] = value;
    }
    if (movementPatterns?.length) parameters['movementPattern'] = movementPatterns;
    if (ids?.length) parameters['ids'] = ids;
    return this.http.get<Phase3Contracts.ExerciseSearchResult>('/api/exercises', {
      params: parameters,
    });
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

  createMediaAccess(assetId: string): Observable<Phase3Contracts.MediaAccessView> {
    return this.http.post<Phase3Contracts.MediaAccessView>(`/api/media/${assetId}/access`, {});
  }

  /**
   * Grants several protected assets in one call. The server sets one path-scoped grant cookie per
   * asset, so a screen full of thumbnails becomes one request instead of one per tile. Bounded by
   * the server at 32 ids; callers pass a set they have already bounded.
   */
  createMediaAccessBatch(
    assetIds: readonly string[],
  ): Observable<Phase3Contracts.MediaAccessBatchView> {
    return this.http.post<Phase3Contracts.MediaAccessBatchView>('/api/media/access', {
      assetIds: [...assetIds],
    });
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

  getMyTrainingPersonalRecords(): Observable<Phase3Contracts.ClientPersonalRecordsResult> {
    return this.http.get<Phase3Contracts.ClientPersonalRecordsResult>(
      '/api/training/me/personal-records',
    );
  }

  /** A coach's read of a client's personal records (R3.3b): the same list and rule as their own. */
  getClientTrainingPersonalRecords(
    clientId: string,
  ): Observable<Phase3Contracts.ClientPersonalRecordsResult> {
    return this.http.get<Phase3Contracts.ClientPersonalRecordsResult>(
      `/api/training/clients/${clientId}/personal-records`,
    );
  }

  /** One client's status, what needs the coach and this week, as Today and Clients work them out. */
  getClientOverview(clientId: string): Observable<Phase3Contracts.ClientProfileOverviewView> {
    return this.http.get<Phase3Contracts.ClientProfileOverviewView>(
      `/api/clients/${clientId}/overview`,
    );
  }

  // The Training page maps these itself, so their mapping stays out of the initial bundle.
  /** Coach Today (R3.1). Phrased in the lazy dashboard chunk, so none of it is in the initial bundle. */
  getCoachToday(): Observable<Phase3Contracts.CoachTodayView> {
    return this.http.get<Phase3Contracts.CoachTodayView>('/api/coach-today');
  }

  getMyTrainingProgram(): Observable<Phase3Contracts.ClientTrainingProgramView> {
    return this.http.get<Phase3Contracts.ClientTrainingProgramView>('/api/training/me/program');
  }

  getMyWorkoutHistory(skip = 0): Observable<Phase3Contracts.ClientWorkoutHistoryPage> {
    return this.http.get<Phase3Contracts.ClientWorkoutHistoryPage>('/api/training/me/history', {
      params: { skip },
    });
  }

  /** A finished program's facts for the client's share card (R6.1a, TRN-030); 404 for any other. */
  getMyProgramSummary(programId: string): Observable<Phase3Contracts.ClientProgramSummaryResult> {
    return this.http.get<Phase3Contracts.ClientProgramSummaryResult>(
      `/api/training/me/programs/${programId}/summary`,
    );
  }

  /**
   * The client's recorded maxes; with `includeProgramMaxes` also every training max of their programs
   * (STR-015), whose ids are never recorded maxes, so Assign program leaves it off.
   */
  listStrengthMaxes(
    clientId: string,
    exerciseId?: string,
    skip = 0,
    take = 100,
    includeProgramMaxes = false,
  ): Observable<Phase3Contracts.StrengthMaxPage> {
    return this.http.get<Phase3Contracts.StrengthMaxPage>(
      `/api/strength/clients/${clientId}/maxes`,
      {
        params: {
          ...(exerciseId ? { exerciseId } : {}),
          ...(includeProgramMaxes ? { includeProgramMaxes } : {}),
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

  getMyTrainingWeek(): Observable<Phase3Contracts.ClientTrainingWeekView> {
    return this.http.get<Phase3Contracts.ClientTrainingWeekView>('/api/training/me/week');
  }

  getMyUpcomingTraining(skip = 0) {
    return this.http.get<Phase3Contracts.ClientTrainingUpcomingView>('/api/training/me/upcoming', {
      params: { skip },
    });
  }

  getCoachWorkoutDetail(clientId: string, workoutId: string, notesSkip = 0) {
    return this.http.get<Phase3Contracts.CoachWorkoutDetailResult>(
      `/api/training/clients/${clientId}/workouts/${workoutId}`,
      { params: { notesSkip } },
    );
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

  /** The client's own day, or null when there is nothing for that date (audit AUTH-12). */
  getMyNutritionDay(localDate?: string) {
    return this.http.get<Phase3Contracts.ClientNutritionDayView | null>('/api/nutrition/me/day', {
      params: localDate ? { localDate } : {},
    });
  }

  /** A recipe in the caller's own plan, as the plan copied it (R4.4d). */
  getMyPlanRecipe(recipeId: string) {
    return this.http.get<Phase3Contracts.ClientPlanRecipeView>(
      `/api/nutrition/me/recipes/${recipeId}`,
    );
  }

  recordMyNutritionChoice(request: Phase3Contracts.RecordNutritionChoiceRequest) {
    return this.http.put<Phase3Contracts.ClientNutritionDayView>(
      '/api/nutrition/me/choices',
      request,
    );
  }

  addMyNutritionCustomFood(request: Phase3Contracts.AddNutritionCustomFoodRequest) {
    return this.http.post<Phase3Contracts.ClientNutritionDayView>(
      '/api/nutrition/me/custom-foods',
      request,
    );
  }

  reverseMyNutritionCustomFood(
    foodId: string,
    request: Phase3Contracts.ReverseNutritionCustomFoodRequest,
  ) {
    return this.http.post<Phase3Contracts.ClientNutritionDayView>(
      `/api/nutrition/me/custom-foods/${foodId}/reverse`,
      request,
    );
  }

  completeMyNutritionLog(logId: string, request: Phase3Contracts.CompleteNutritionLogRequest) {
    return this.http.post<Phase3Contracts.ClientNutritionDayView>(
      `/api/nutrition/me/logs/${logId}/complete`,
      request,
    );
  }

  getMyProgress(
    displayUnit: Phase3Contracts.RecordedMassUnit,
    from: string | null = null,
    to: string | null = null,
  ) {
    return this.http.get<Phase3Contracts.ProgressView>('/api/progress/me', {
      params: { displayUnit, ...progressWindowParams(from, to) },
    });
  }

  getMyBodyweightSpan() {
    return this.http.get<Phase3Contracts.BodyweightHistorySpanView>('/api/progress/me/span');
  }

  getClientBodyweightSpan(clientId: string) {
    return this.http.get<Phase3Contracts.BodyweightHistorySpanView>(
      `/api/progress/clients/${clientId}/span`,
    );
  }

  getClientProgress(
    clientId: string,
    displayUnit: Phase3Contracts.RecordedMassUnit,
    from: string | null = null,
    to: string | null = null,
  ) {
    return this.http.get<Phase3Contracts.ProgressView>(`/api/progress/clients/${clientId}`, {
      params: { displayUnit, ...progressWindowParams(from, to) },
    });
  }

  recordMyBodyweight(request: Phase3Contracts.RecordBodyweightRequest) {
    return this.http.post<Phase3Contracts.BodyweightObservationView>(
      '/api/progress/me/bodyweight',
      request,
    );
  }

  recordClientBodyweight(clientId: string, request: Phase3Contracts.RecordBodyweightRequest) {
    return this.http.post<Phase3Contracts.BodyweightObservationView>(
      `/api/progress/clients/${clientId}/bodyweight`,
      request,
    );
  }

  correctMyBodyweight(observationId: string, request: Phase3Contracts.CorrectBodyweightRequest) {
    return this.http.put<Phase3Contracts.BodyweightHistoryView>(
      `/api/progress/me/bodyweight/${observationId}`,
      request,
    );
  }

  correctClientBodyweight(
    clientId: string,
    observationId: string,
    request: Phase3Contracts.CorrectBodyweightRequest,
  ) {
    return this.http.put<Phase3Contracts.BodyweightHistoryView>(
      `/api/progress/clients/${clientId}/bodyweight/${observationId}`,
      request,
    );
  }

  replaceMyBodyweightDate(
    observationId: string,
    request: Phase3Contracts.ReplaceBodyweightDateRequest,
  ) {
    return this.http.post<Phase3Contracts.BodyweightDateCorrectionView>(
      `/api/progress/me/bodyweight/${observationId}/replace-date`,
      request,
    );
  }

  replaceClientBodyweightDate(
    clientId: string,
    observationId: string,
    request: Phase3Contracts.ReplaceBodyweightDateRequest,
  ) {
    return this.http.post<Phase3Contracts.BodyweightDateCorrectionView>(
      `/api/progress/clients/${clientId}/bodyweight/${observationId}/replace-date`,
      request,
    );
  }

  getMyBodyweightHistory(observationId: string) {
    return this.http.get<Phase3Contracts.BodyweightHistoryView>(
      `/api/progress/me/bodyweight/${observationId}/history`,
    );
  }

  getClientBodyweightHistory(clientId: string, observationId: string) {
    return this.http.get<Phase3Contracts.BodyweightHistoryView>(
      `/api/progress/clients/${clientId}/bodyweight/${observationId}/history`,
    );
  }

  /** The unit is the client's saved one; left out, the server answers in kilograms. */
  getMyProgressDashboard(
    from: string | null = null,
    to: string | null = null,
    displayUnit: Phase3Contracts.RecordedMassUnit | null = null,
  ) {
    return this.http.get<Phase3Contracts.ProgressDashboardView>('/api/progress/me/dashboard', {
      params: {
        ...progressWindowParams(from, to),
        ...(displayUnit === null ? {} : { displayUnit }),
      },
    });
  }

  getClientProgressDashboard(
    clientId: string,
    from: string | null = null,
    to: string | null = null,
  ) {
    return this.http.get<Phase3Contracts.ProgressDashboardView>(
      `/api/progress/clients/${clientId}/dashboard`,
      {
        params: progressWindowParams(from, to),
      },
    );
  }

  getMyProgressPhotos(from: string | null = null, to: string | null = null) {
    return this.http.get<Phase3Contracts.ProgressPhotosView>('/api/progress/me/photos', {
      params: progressWindowParams(from, to),
    });
  }

  getClientProgressPhotos(clientId: string, from: string | null = null, to: string | null = null) {
    return this.http.get<Phase3Contracts.ProgressPhotosView>(
      `/api/progress/clients/${clientId}/photos`,
      {
        params: progressWindowParams(from, to),
      },
    );
  }

  recordMyProgressPhoto(
    pose: Phase3Contracts.ProgressPhotoPose,
    photoDate: string | null,
    file: File,
  ) {
    return this.http.post<Phase3Contracts.ProgressPhotoView>(
      '/api/progress/me/photos',
      progressPhotoBody(file),
      {
        params: progressPhotoParams(pose, photoDate),
      },
    );
  }

  recordClientProgressPhoto(
    clientId: string,
    pose: Phase3Contracts.ProgressPhotoPose,
    photoDate: string | null,
    file: File,
  ) {
    return this.http.post<Phase3Contracts.ProgressPhotoView>(
      `/api/progress/clients/${clientId}/photos`,
      progressPhotoBody(file),
      { params: progressPhotoParams(pose, photoDate) },
    );
  }

  removeMyProgressPhoto(photoId: string, request: Phase3Contracts.RemoveProgressPhotoRequest) {
    return this.http.post<Phase3Contracts.ProgressPhotoView>(
      `/api/progress/me/photos/${photoId}/remove`,
      request,
    );
  }

  /**
   * Records a before-and-after the client confirmed (R6.1b, PRG-013), before its picture is made on the
   * device: who, when and which two photos. 404 for a photo that is not theirs, 409 for a removed one.
   */
  exportMyProgressPhotos(
    request: Phase3Contracts.ExportProgressPhotosRequest,
  ): Observable<Phase3Contracts.ProgressPhotoExportView> {
    return this.http.post<Phase3Contracts.ProgressPhotoExportView>(
      '/api/progress/me/photo-exports',
      request,
    );
  }

  removeClientProgressPhoto(
    clientId: string,
    photoId: string,
    request: Phase3Contracts.RemoveProgressPhotoRequest,
  ) {
    return this.http.post<Phase3Contracts.ProgressPhotoView>(
      `/api/progress/clients/${clientId}/photos/${photoId}/remove`,
      request,
    );
  }

  getMyBodyMeasurements(
    displayUnit: Phase3Contracts.MeasurementUnit,
    from: string | null = null,
    to: string | null = null,
  ) {
    return this.http.get<Phase3Contracts.BodyMeasurementsView>('/api/progress/me/measurements', {
      params: { displayUnit, ...progressWindowParams(from, to) },
    });
  }

  getClientBodyMeasurements(
    clientId: string,
    displayUnit: Phase3Contracts.MeasurementUnit,
    from: string | null = null,
    to: string | null = null,
  ) {
    return this.http.get<Phase3Contracts.BodyMeasurementsView>(
      `/api/progress/clients/${clientId}/measurements`,
      {
        params: { displayUnit, ...progressWindowParams(from, to) },
      },
    );
  }

  recordMyBodyMeasurement(request: Phase3Contracts.RecordBodyMeasurementRequest) {
    return this.http.post<Phase3Contracts.BodyMeasurementView>(
      '/api/progress/me/measurements',
      request,
    );
  }

  recordClientBodyMeasurement(
    clientId: string,
    request: Phase3Contracts.RecordBodyMeasurementRequest,
  ) {
    return this.http.post<Phase3Contracts.BodyMeasurementView>(
      `/api/progress/clients/${clientId}/measurements`,
      request,
    );
  }

  correctMyBodyMeasurement(
    measurementId: string,
    request: Phase3Contracts.CorrectBodyMeasurementRequest,
  ) {
    return this.http.put<Phase3Contracts.BodyMeasurementHistoryView>(
      `/api/progress/me/measurements/${measurementId}`,
      request,
    );
  }

  correctClientBodyMeasurement(
    clientId: string,
    measurementId: string,
    request: Phase3Contracts.CorrectBodyMeasurementRequest,
  ) {
    return this.http.put<Phase3Contracts.BodyMeasurementHistoryView>(
      `/api/progress/clients/${clientId}/measurements/${measurementId}`,
      request,
    );
  }

  getMyBodyMeasurementHistory(measurementId: string) {
    return this.http.get<Phase3Contracts.BodyMeasurementHistoryView>(
      `/api/progress/me/measurements/${measurementId}/history`,
    );
  }

  getClientBodyMeasurementHistory(clientId: string, measurementId: string) {
    return this.http.get<Phase3Contracts.BodyMeasurementHistoryView>(
      `/api/progress/clients/${clientId}/measurements/${measurementId}/history`,
    );
  }

  /** A page of the reader's own inbox, newest first; `unreadOnly` leaves out what was read. */
  listNotifications(
    skip = 0,
    take = 25,
    unreadOnly = false,
    beforeId?: string,
  ): Observable<Phase3Contracts.NotificationPage> {
    const params: Record<string, string | number | boolean> = unreadOnly
      ? { skip, take, unread: true }
      : { skip, take };
    if (beforeId) params['beforeId'] = beforeId;
    return this.http.get<Phase3Contracts.NotificationPage>('/api/notifications', { params });
  }

  /** Marks every unread notice of the reader's read, in this workspace; answers the unread left. */
  markAllNotificationsRead(): Observable<number> {
    return this.http
      .post<Phase3Contracts.NotificationReadAllResult>('/api/notifications/read-all', null)
      .pipe(map((result) => Number(result.unread)));
  }

  getUnreadNotificationCount(): Observable<number> {
    return this.http
      .get<Phase3Contracts.NotificationUnreadCount>('/api/notifications/unread-count')
      .pipe(map((result) => Number(result.unread)));
  }

  markNotificationRead(notificationId: string): Observable<Phase3Contracts.NotificationView> {
    return this.http.post<Phase3Contracts.NotificationView>(
      `/api/notifications/${notificationId}/read`,
      null,
    );
  }

  getNotificationPreferences(): Observable<Phase3Contracts.NotificationPreferenceView> {
    return this.http.get<Phase3Contracts.NotificationPreferenceView>(
      '/api/notifications/preferences',
    );
  }

  /**
   * There is no subject in the request. The API derives it from the authentication cookie, so a
   * coach or an owner has no shape in which to opt somebody else into email.
   */
  updateNotificationPreferences(
    request: Phase3Contracts.UpdateNotificationPreferenceRequest,
  ): Observable<Phase3Contracts.NotificationPreferenceView> {
    return this.http.put<Phase3Contracts.NotificationPreferenceView>(
      '/api/notifications/preferences',
      request,
    );
  }

  listConversations(
    beforeActivityAtUtc?: string | null,
    beforeConversationId?: string | null,
    take = 25,
    query?: ConversationListQuery,
  ): Observable<Phase3Contracts.ConversationPage> {
    // Both halves of the keyset cursor or neither: the API refuses one without the other, because a
    // half cursor cannot identify a position.
    const params: Record<string, string | number> =
      beforeActivityAtUtc && beforeConversationId
        ? { beforeActivityAtUtc, beforeConversationId, take }
        : { take };
    // The plain list sends neither, so it pages straight from the index.
    if (query && query.filter !== 'All') params['filter'] = query.filter;
    const search = query?.search.trim() ?? '';
    if (search !== '') params['search'] = search;
    return this.http.get<Phase3Contracts.ConversationPage>('/api/messaging/conversations', {
      params,
    });
  }

  createDirectConversation(
    clientProfileId: string,
    idempotencyKey: string,
  ): Observable<Phase3Contracts.ConversationDetail> {
    return this.http.post<Phase3Contracts.ConversationDetail>('/api/messaging/conversations', {
      clientProfileId,
      idempotencyKey,
    });
  }

  listConversationMessages(
    conversationId: string,
    beforeSequence?: number | null,
    take = 50,
  ): Observable<Phase3Contracts.MessagePage> {
    const params: Record<string, string | number> =
      beforeSequence === null || beforeSequence === undefined ? { take } : { beforeSequence, take };
    return this.http.get<Phase3Contracts.MessagePage>(
      `/api/messaging/conversations/${conversationId}/messages`,
      {
        params,
      },
    );
  }

  sendConversationMessage(
    conversationId: string,
    body: string,
    idempotencyKey: string,
  ): Observable<Phase3Contracts.MessageView> {
    return this.http.post<Phase3Contracts.MessageView>(
      `/api/messaging/conversations/${conversationId}/messages`,
      { body, idempotencyKey },
    );
  }

  editConversationMessage(
    conversationId: string,
    messageId: string,
    body: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Observable<Phase3Contracts.MessageView> {
    return this.http.post<Phase3Contracts.MessageView>(
      `/api/messaging/conversations/${conversationId}/messages/${messageId}/edit`,
      { body, expectedVersion, idempotencyKey },
    );
  }

  deleteConversationMessage(
    conversationId: string,
    messageId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Observable<Phase3Contracts.MessageView> {
    return this.http.post<Phase3Contracts.MessageView>(
      `/api/messaging/conversations/${conversationId}/messages/${messageId}/delete`,
      { expectedVersion, idempotencyKey },
    );
  }

  moderateConversationMessage(
    conversationId: string,
    messageId: string,
    reason: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Observable<Phase3Contracts.MessageView> {
    return this.http.post<Phase3Contracts.MessageView>(
      `/api/messaging/conversations/${conversationId}/messages/${messageId}/moderate`,
      { reason, expectedVersion, idempotencyKey },
    );
  }

  advanceConversationReadCursor(
    conversationId: string,
    throughSequence: number,
  ): Observable<Phase3Contracts.ConversationReadState> {
    return this.http.post<Phase3Contracts.ConversationReadState>(
      `/api/messaging/conversations/${conversationId}/read`,
      { throughSequence },
    );
  }

  getMessagingUnreadCount(): Observable<number> {
    return this.http
      .get<Phase3Contracts.MessagingUnreadCount>('/api/messaging/unread-count')
      .pipe(map((result) => Number(result.unread)));
  }

  /**
   * One bounded page of realtime events, ascending from a cursor.
   *
   * The cursor is the conversation's event position, never a message sequence: an edit or a removal
   * of an old message is a new event about an old position, and asking by message sequence would
   * never return it.
   */
  listConversationRealtimeEvents(
    conversationId: string,
    afterEventSequence: number,
    take = 100,
  ): Observable<Phase3Contracts.RealtimeEventPage> {
    return this.http.get<Phase3Contracts.RealtimeEventPage>(
      `/api/messaging/conversations/${conversationId}/realtime-events`,
      { params: { afterEventSequence, take } },
    );
  }

  /**
   * Records that this application accepted the named events.
   *
   * No user identifier is sent: the server derives the acknowledging participant from the session.
   * This is called only after an event has been validated and merged, because accepting a transport
   * frame is not the same as having it.
   */
  acknowledgeConversationRealtimeEvents(
    conversationId: string,
    eventSequences: readonly number[],
  ): Observable<Phase3Contracts.RealtimeAcknowledgementResult> {
    return this.http.post<Phase3Contracts.RealtimeAcknowledgementResult>(
      `/api/messaging/conversations/${conversationId}/realtime-acknowledgements`,
      { eventSequences },
    );
  }

  listCheckInForms(skip = 0, take = 100): Observable<Phase3Contracts.CheckInFormPage> {
    return this.http.get<Phase3Contracts.CheckInFormPage>('/api/checkins/forms', {
      params: { skip, take },
    });
  }

  getCheckInForm(formId: string): Observable<Phase3Contracts.CheckInFormDetails> {
    return this.http.get<Phase3Contracts.CheckInFormDetails>(`/api/checkins/forms/${formId}`);
  }

  getCheckInFormVersion(
    formId: string,
    versionId: string,
  ): Observable<Phase3Contracts.CheckInFormVersionView> {
    return this.http.get<Phase3Contracts.CheckInFormVersionView>(
      `/api/checkins/forms/${formId}/versions/${versionId}`,
    );
  }

  createCheckInForm(
    request: Phase3Contracts.CreateCheckInFormRequest,
  ): Observable<Phase3Contracts.CheckInFormDetails> {
    return this.http.post<Phase3Contracts.CheckInFormDetails>('/api/checkins/forms', request);
  }

  renameCheckInForm(
    formId: string,
    request: Phase3Contracts.RenameCheckInFormRequest,
  ): Observable<Phase3Contracts.CheckInFormDetails> {
    return this.http.put<Phase3Contracts.CheckInFormDetails>(
      `/api/checkins/forms/${formId}`,
      request,
    );
  }

  archiveCheckInForm(
    formId: string,
    version: number,
  ): Observable<Phase3Contracts.CheckInFormDetails> {
    return this.http.post<Phase3Contracts.CheckInFormDetails>(
      `/api/checkins/forms/${formId}/archive`,
      { version },
    );
  }

  restoreCheckInForm(
    formId: string,
    version: number,
  ): Observable<Phase3Contracts.CheckInFormDetails> {
    return this.http.post<Phase3Contracts.CheckInFormDetails>(
      `/api/checkins/forms/${formId}/restore`,
      { version },
    );
  }

  deriveCheckInDraft(
    formId: string,
    request: Phase3Contracts.DeriveCheckInDraftRequest,
  ): Observable<Phase3Contracts.CheckInFormVersionView> {
    return this.http.post<Phase3Contracts.CheckInFormVersionView>(
      `/api/checkins/forms/${formId}/versions`,
      request,
    );
  }

  saveCheckInDraft(
    formId: string,
    versionId: string,
    request: Phase3Contracts.SaveCheckInDraftRequest,
  ): Observable<Phase3Contracts.CheckInFormVersionView> {
    return this.http.put<Phase3Contracts.CheckInFormVersionView>(
      `/api/checkins/forms/${formId}/versions/${versionId}`,
      request,
    );
  }

  publishCheckInVersion(
    formId: string,
    versionId: string,
    version: number,
  ): Observable<Phase3Contracts.CheckInFormVersionView> {
    return this.http.post<Phase3Contracts.CheckInFormVersionView>(
      `/api/checkins/forms/${formId}/versions/${versionId}/publish`,
      { version },
    );
  }

  listClientCheckInAssignments(
    clientId: string,
    skip = 0,
    take = 50,
  ): Observable<Phase3Contracts.CheckInAssignmentListView> {
    return this.http.get<Phase3Contracts.CheckInAssignmentListView>(
      `/api/checkins/clients/${clientId}/assignments`,
      { params: { skip, take } },
    );
  }

  assignCheckIn(
    clientId: string,
    request: Phase3Contracts.AssignCheckInRequest,
  ): Observable<Phase3Contracts.CheckInAssignmentDetail> {
    return this.http.post<Phase3Contracts.CheckInAssignmentDetail>(
      `/api/checkins/clients/${clientId}/assignments`,
      request,
    );
  }

  listOwnCheckInAssignments(
    skip = 0,
    take = 50,
  ): Observable<Phase3Contracts.CheckInAssignmentListView> {
    return this.http.get<Phase3Contracts.CheckInAssignmentListView>(
      '/api/checkins/me/assignments',
      {
        params: { skip, take },
      },
    );
  }

  getOwnCheckInResponse(assignmentId: string): Observable<Phase3Contracts.CheckInResponseDetail> {
    return this.http.get<Phase3Contracts.CheckInResponseDetail>(
      `/api/checkins/me/assignments/${assignmentId}/response`,
    );
  }

  saveOwnCheckInDraftResponse(
    assignmentId: string,
    request: Phase3Contracts.SaveCheckInResponseRequest,
  ): Observable<Phase3Contracts.CheckInResponseDetail> {
    return this.http.put<Phase3Contracts.CheckInResponseDetail>(
      `/api/checkins/me/assignments/${assignmentId}/response`,
      request,
    );
  }

  submitOwnCheckInResponse(
    assignmentId: string,
    version: number,
  ): Observable<Phase3Contracts.CheckInResponseDetail> {
    return this.http.post<Phase3Contracts.CheckInResponseDetail>(
      `/api/checkins/me/assignments/${assignmentId}/response/submit`,
      { version },
    );
  }

  getClientCheckInResponse(
    clientId: string,
    assignmentId: string,
  ): Observable<Phase3Contracts.CheckInResponseDetail> {
    return this.http.get<Phase3Contracts.CheckInResponseDetail>(
      `/api/checkins/clients/${clientId}/assignments/${assignmentId}/response`,
    );
  }

  reviewCheckInResponse(
    clientId: string,
    assignmentId: string,
    version: number,
  ): Observable<Phase3Contracts.CheckInResponseDetail> {
    return this.http.post<Phase3Contracts.CheckInResponseDetail>(
      `/api/checkins/clients/${clientId}/assignments/${assignmentId}/response/review`,
      { version },
    );
  }

  compareCheckInResponses(
    clientId: string,
    firstResponseId: string,
    secondResponseId: string,
  ): Observable<Phase3Contracts.CheckInComparisonView> {
    return this.http.get<Phase3Contracts.CheckInComparisonView>(
      `/api/checkins/clients/${clientId}/checkin-comparison`,
      { params: { firstResponseId, secondResponseId } },
    );
  }
}

export function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : toNumber(value);
}

export function toWorkspace(value: ContractWorkspaceDetails): WorkspaceDetails {
  return {
    ...value,
    version: toNumber(value.version),
    brandColor: value.brandColor ?? null,
    accentColor: value.accentColor ?? null,
    logoAssetId: value.logoAssetId ?? null,
  };
}

export function toInvitation(value: InvitationSummary): ClientInvitation {
  return {
    ...value,
    sendCount: toNumber(value.sendCount),
    logicalSendGeneration: toNumber(value.logicalSendGeneration),
    version: toNumber(value.version),
    developmentActionUrl: value.developmentActionUrl ?? null,
    kind: value.kind ?? 'Client',
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

export function toCoachClient(value: ContractCoachClientDetails): CoachClientDetails {
  return {
    ...value,
    heightCentimeters: toNullableNumber(value.heightCentimeters),
    heightEnteredValue: toNullableNumber(value.heightEnteredValue),
    averageDailySteps: toNullableNumber(value.averageDailySteps),
    version: toNumber(value.version),
    release: value.release ?? null,
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
  pose: Phase3Contracts.ProgressPhotoPose,
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
