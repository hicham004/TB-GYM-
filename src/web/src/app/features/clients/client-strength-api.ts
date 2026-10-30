import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  EstimateOneRepMaxRequest,
  MaxFromSetView,
  OneRepMaxEstimateView,
  RecordMaxFromSetRequest,
} from '../../core/api/generated';

/**
 * A max from a set they did (critique B7b, STR-017): the server's estimate and the training max at 90% of it
 * before anything is saved, and the save that records them. Kept out of `ApiClient`, like `ClientProgramApi`,
 * so it loads only with the Record a max sheet rather than in every page's initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class ClientStrengthApi {
  private readonly http = inject(HttpClient);

  /** What a set implies, by Epley v1, and the training max 90% of it would be; records nothing (INV-9). */
  estimateOneRepMax(request: EstimateOneRepMaxRequest): Observable<OneRepMaxEstimateView> {
    return this.http.post<OneRepMaxEstimateView>('/api/strength/estimate-one-rep-max', request);
  }

  /** Records the set's estimate and, when asked, the training max set from it, in one save. */
  recordMaxFromSet(clientId: string, request: RecordMaxFromSetRequest): Observable<MaxFromSetView> {
    return this.http.post<MaxFromSetView>(
      `/api/strength/clients/${clientId}/maxes/from-set`,
      request,
    );
  }
}
