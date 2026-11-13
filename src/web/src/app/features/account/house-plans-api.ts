import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type {
  AskForHousePlanRequest,
  HousePlanAskView,
  HousePlanMoneySentRequest,
  HousePlansView,
} from '../../core/api/generated';
import { toHouseAsk, toHousePlans, type HouseAsk, type HousePlans } from './house-plans.models';

/**
 * A self-directed trainee asking TB Gym for a paid plan and saying they paid by Whish (SUB-020, notes plan
 * N9c2). Kept out of `ApiClient` so it loads only with My plan, like `CloseAccountApi`. The server answers
 * 404 to anyone who is not a current self-directed trainee of the house.
 */
@Injectable({ providedIn: 'root' })
export class HousePlansApi {
  private readonly http = inject(HttpClient);

  /** Whether asks are open, the house's Whish number, the options on sale and the trainee's asks. */
  plans(): Observable<HousePlans> {
    return this.http.get<HousePlansView>('/api/house-plans/me').pipe(map(toHousePlans));
  }

  /** Asks for one option; it books nothing. The same option again answers the ask already open. */
  ask(offerId: string): Observable<HouseAsk> {
    const body: AskForHousePlanRequest = { offerId };
    return this.http.post<HousePlanAskView>('/api/house-plans/me/asks', body).pipe(map(toHouseAsk));
  }

  /** Says the money for an ask was sent, once, with the Whish account it came from. */
  moneySent(askId: string, whishName: string, whishNumber: string): Observable<HouseAsk> {
    const body: HousePlanMoneySentRequest = { whishName, whishNumber };
    return this.http
      .post<HousePlanAskView>(
        `/api/house-plans/me/asks/${encodeURIComponent(askId)}/money-sent`,
        body,
      )
      .pipe(map(toHouseAsk));
  }
}
