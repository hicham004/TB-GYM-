import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { toCoachClient, toInvitation, toNumber } from '../../core/api/api-client';
import {
  ClientInvitation,
  CoachClientDetails,
  CoachRemoval,
  CreateCoachInvitationRequest,
  TeamMember,
} from '../../core/api/api.models';
import type {
  CoachClientDetails as ContractCoachClientDetails,
  CoachRemovalResponse,
  InvitationSummary,
  TeamMemberSummary,
} from '../../core/api/generated';

/**
 * The owner's team endpoints (ADR 0026). Kept out of `ApiClient` so they load only with the
 * screens that use them — the Team page and the client page's reassign action.
 */
@Injectable({ providedIn: 'root' })
export class TeamApi {
  private readonly http = inject(HttpClient);

  getTeamMembers(): Observable<TeamMember[]> {
    return this.http.get<TeamMemberSummary[]>('/api/team/members').pipe(
      map((items) =>
        items.map((item) => ({
          ...item,
          assignedClientCount: toNumber(item.assignedClientCount),
          version: toNumber(item.version),
        })),
      ),
    );
  }

  /** Removes a coach; their clients and pending client invitations move to the owner. */
  removeTeamCoach(coachUserId: string, version: number): Observable<CoachRemoval> {
    return this.http
      .post<CoachRemovalResponse>(`/api/team/members/${coachUserId}/remove`, { version })
      .pipe(
        map((value) => ({
          reassignedClientCount: toNumber(value.reassignedClientCount),
          reassignedInvitationCount: toNumber(value.reassignedInvitationCount),
        })),
      );
  }

  getCoachInvitations(): Observable<ClientInvitation[]> {
    return this.http
      .get<InvitationSummary[]>('/api/team/invitations')
      .pipe(map((items) => items.map(toInvitation)));
  }

  createCoachInvitation(request: CreateCoachInvitationRequest): Observable<ClientInvitation> {
    return this.http
      .post<InvitationSummary>('/api/team/invitations', request)
      .pipe(map(toInvitation));
  }

  /** A deliberate resend: it kills every earlier link, exactly like a client invitation's. */
  resendCoachInvitation(
    invitationId: string,
    idempotencyKey: string,
    version: number,
  ): Observable<ClientInvitation> {
    return this.http
      .post<InvitationSummary>(`/api/team/invitations/${invitationId}/resend`, {
        idempotencyKey,
        version,
      })
      .pipe(map(toInvitation));
  }

  revokeCoachInvitation(invitationId: string, version: number): Observable<ClientInvitation> {
    return this.http
      .post<InvitationSummary>(`/api/team/invitations/${invitationId}/revoke`, { version })
      .pipe(map(toInvitation));
  }

  /** The owner moves a client to another coach. The version is the client profile the owner saw. */
  reassignClientCoach(
    clientId: string,
    coachUserId: string,
    note: string | null,
    version: number,
  ): Observable<CoachClientDetails> {
    return this.http
      .post<ContractCoachClientDetails>(`/api/clients/${clientId}/coach`, {
        coachUserId,
        note,
        version,
      })
      .pipe(map(toCoachClient));
  }
}
