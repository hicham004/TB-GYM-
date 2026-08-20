import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type {
  ClientSelfProfile as ContractClientSelfProfile,
  ClientSummary as ContractClientSummary,
  CoachClientDetails as ContractCoachClientDetails,
  InvitationSummary,
  UpdateWorkspaceRequest,
  WorkspaceDetails as ContractWorkspaceDetails,
} from './generated';
import {
  ClientInvitation,
  ClientSelfProfile,
  ClientSummary,
  CoachClientDetails,
  CompleteClientOnboardingRequest,
  CreateClientInvitationRequest,
  CurrentUser,
  EmailActionResponse,
  InvitationAcceptance,
  LoginRequest,
  PublicInvitation,
  RegisterCoachRequest,
  RegistrationResponse,
  TenantMembership,
  UpdateClientIntakeRequest,
  WorkspaceDetails,
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
