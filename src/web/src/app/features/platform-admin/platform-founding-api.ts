import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type {
  AdminFoundingView,
  EndFoundingRequest,
  FoundingCheckOutcome,
  FoundingTermsView,
  MarkFoundingRequest,
  PublishFoundingTermsRequest,
} from '../../core/api/generated';
import { toNumber } from '../../core/api/api-client';
import {
  toAdminFounding,
  toFoundingTerms,
  type AdminFounding,
  type FoundingTerms,
} from '../billing/founding.models';

export interface FoundingCheck {
  checked: number;
  earned: number;
}

export interface PublishFoundingTerms {
  clientsWithActivePlan: number;
  monthsSinceStart: number;
  note: string | null;
  expectedCurrentVersion: number;
  /** Always sent, null for none: the server refuses a publish that leaves it out (notes plan N11a). */
  foundingSeatIncludedClients: number | null;
}

/**
 * The platform admin's founding endpoints (notes plan N3a, PBL-009): mark a space as founding, end
 * it for cause, check every waiting badge now, and publish the badge's terms. Like the rest of
 * platform billing they send no workspace header; the API authorizes the global role on every
 * request. Kept apart from `PlatformAdminApi` so the founding screens carry only what they use.
 */
@Injectable({ providedIn: 'root' })
export class PlatformFoundingApi {
  private readonly http = inject(HttpClient);

  /** `foundingSince` is a UTC day no later than today. */
  markFounding(tenantId: string, foundingSince: string, note: string): Observable<AdminFounding> {
    const body: MarkFoundingRequest = { foundingSince, note };
    return this.http
      .post<AdminFoundingView>(`/api/platform-admin/workspaces/${tenantId}/founding`, body)
      .pipe(map(toAdminFounding));
  }

  /** Ends an open founding status for cause; the record and the reason are kept. */
  endFounding(foundingId: string, reason: string): Observable<AdminFounding> {
    const body: EndFoundingRequest = { reason };
    return this.http
      .post<AdminFoundingView>(`/api/platform-admin/founding/${foundingId}/end`, body)
      .pipe(map(toAdminFounding));
  }

  /** Looks at every waiting badge now, as the billing sweep does on its own. Safe to repeat. */
  checkFounding(): Observable<FoundingCheck> {
    return this.http
      .post<FoundingCheckOutcome>('/api/platform-admin/founding/check', null)
      .pipe(map((value) => ({ checked: toNumber(value.checked), earned: toNumber(value.earned) })));
  }

  /** Every published version of the badge's terms. */
  getFoundingTerms(): Observable<FoundingTerms[]> {
    return this.http
      .get<FoundingTermsView[]>('/api/platform-admin/founding-terms')
      .pipe(map((items) => items.map(toFoundingTerms)));
  }

  /** Publishes the next version against the one the admin saw, so a stale one is refused. */
  publishFoundingTerms(request: PublishFoundingTerms): Observable<FoundingTerms> {
    const body: PublishFoundingTermsRequest = request;
    return this.http
      .post<FoundingTermsView>('/api/platform-admin/founding-terms', body)
      .pipe(map(toFoundingTerms));
  }
}
