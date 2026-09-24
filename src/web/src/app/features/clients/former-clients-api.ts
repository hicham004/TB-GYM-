import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { toCoachClient } from '../../core/api/api-client';
import { CoachClientDetails, FormerClient } from '../../core/api/api.models';
import type {
  CoachClientDetails as ContractCoachClientDetails,
  FormerClientSummary,
} from '../../core/api/generated';

/**
 * The owner's release endpoints (ADR 0027). Kept out of `ApiClient`, like `TeamApi`, so they load
 * only with the client screens that use them rather than in every page's initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class FormerClientsApi {
  private readonly http = inject(HttpClient);

  /** The owner's released clients, most recently released first. */
  getFormerClients(): Observable<FormerClient[]> {
    return this.http.get<FormerClientSummary[]>('/api/clients/former').pipe(
      map((items) =>
        items.map((item) => ({
          id: item.id,
          firstName: item.firstName,
          lastName: item.lastName,
          email: item.email,
          releasedAtUtc: item.releasedAtUtc,
          reason: item.reason,
          departureKind: item.departureKind,
        })),
      ),
    );
  }

  /**
   * Releases a client: their access ends at once and their record becomes read-only. The version
   * is the profile the owner saw, so a stale screen conflicts instead of releasing.
   */
  releaseClient(clientId: string, reason: string, version: number): Observable<CoachClientDetails> {
    return this.http
      .post<ContractCoachClientDetails>(`/api/clients/${clientId}/release`, { reason, version })
      .pipe(map(toCoachClient));
  }
}
