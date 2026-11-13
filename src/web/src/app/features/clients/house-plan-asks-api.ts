import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type {
  BookHousePlanAskRequest,
  CloseHousePlanAskRequest,
  HousePlanAskView,
} from '../../core/api/generated';
import { toHousePlanAsk, type HousePlanAsk } from './house-plan-asks.models';

/**
 * The house's staff on a self-directed trainee's asks for a paid plan (SUB-020, notes plan N9c2). Kept out of
 * `ApiClient`, like `FormerClientsApi`, so it loads with the client screens alone. The server answers 404
 * outside the house and for a Coach's other clients (ADR 0026), and refuses every write on a released client.
 */
@Injectable({ providedIn: 'root' })
export class HousePlanAsksApi {
  private readonly http = inject(HttpClient);

  /** Every ask of the trainee's, newest first, with who booked or closed it. */
  list(clientProfileId: string): Observable<HousePlanAsk[]> {
    return this.http
      .get<HousePlanAskView[]>(`/api/commercial/clients/${clientProfileId}/house-plan-asks`)
      .pipe(map((items) => items.map(toHousePlanAsk)));
  }

  /**
   * Books the plan asked for and records its receipt, the exact price, in one step. The key is bound to the
   * ask, amount, currency and reference, so a retry of the same booking is answered with the first.
   */
  book(
    clientProfileId: string,
    askId: string,
    request: BookHousePlanAskRequest,
  ): Observable<HousePlanAsk> {
    return this.http
      .post<HousePlanAskView>(
        `/api/commercial/clients/${clientProfileId}/house-plan-asks/${askId}/book`,
        request,
      )
      .pipe(map(toHousePlanAsk));
  }

  /** Closes an ask with a reason the trainee reads; the same reason again answers the first closing. */
  close(clientProfileId: string, askId: string, reason: string): Observable<HousePlanAsk> {
    const body: CloseHousePlanAskRequest = { reason };
    return this.http
      .post<HousePlanAskView>(
        `/api/commercial/clients/${clientProfileId}/house-plan-asks/${askId}/close`,
        body,
      )
      .pipe(map(toHousePlanAsk));
  }
}
