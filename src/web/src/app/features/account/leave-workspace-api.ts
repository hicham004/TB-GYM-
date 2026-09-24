import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

/**
 * Leaving a workspace yourself (ADR 0027). Kept out of `ApiClient` so it loads only with the account
 * page, like `TeamApi` and `FormerClientsApi`.
 */
@Injectable({ providedIn: 'root' })
export class LeaveWorkspaceApi {
  private readonly http = inject(HttpClient);

  /** A coach leaves the team; their clients move to the owner and are told. */
  resignFromTeam(): Observable<void> {
    return this.http.post('/api/team/me/resign', {}).pipe(map(() => undefined));
  }

  /** A client leaves; the version is their own profile, so a stale page conflicts. */
  leaveAsClient(reason: string | null, version: number): Observable<void> {
    return this.http
      .post('/api/client-profile/me/leave', { reason, version })
      .pipe(map(() => undefined));
  }
}
