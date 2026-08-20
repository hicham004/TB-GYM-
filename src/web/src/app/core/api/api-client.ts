import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
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
