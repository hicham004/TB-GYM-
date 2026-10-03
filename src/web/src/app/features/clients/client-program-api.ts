import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { CoachClientProgramView } from '../../core/api/generated';

/**
 * The coach's read of a client's programs (C3, R3.4a). Kept out of `ApiClient`, like
 * `ClientListApi`, so it loads only with the Training section rather than in every page's initial
 * bundle.
 */
@Injectable({ providedIn: 'root' })
export class ClientProgramApi {
  private readonly http = inject(HttpClient);

  /** Every program block of the client, newest first, with the state of each session (TRN-022). */
  getProgram(clientId: string): Observable<CoachClientProgramView> {
    return this.http.get<CoachClientProgramView>(`/api/training/clients/${clientId}/program`);
  }
}
