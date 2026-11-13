import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type { CloseOwnAccountRequest } from '../../core/api/generated';

/**
 * Closing your own TB Gym account (CLI-027, notes plan N9e). Kept out of `ApiClient` so it loads only with
 * Me, like `LeaveWorkspaceApi`.
 */
@Injectable({ providedIn: 'root' })
export class CloseAccountApi {
  private readonly http = inject(HttpClient);

  /**
   * Closes the signed-in account for good, after its password: every coaching space is left and the
   * person is erased. The server ends every session, this one included.
   */
  close(password: string): Observable<void> {
    const body: CloseOwnAccountRequest = { password };
    return this.http.post('/api/auth/account/close', body).pipe(map(() => undefined));
  }
}
