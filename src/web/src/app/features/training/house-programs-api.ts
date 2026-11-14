import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import type {
  HouseProgramStartedView,
  HouseProgramsView,
  RecordOwnMaxRequest,
  StartHouseProgramRequest,
  StrengthMaxView,
} from '../../core/api/generated';
import {
  toHouseProgramStarted,
  toHousePrograms,
  type HouseProgramStarted,
  type HousePrograms,
} from './house-programs.models';

/**
 * TB Gym's programs for a self-directed trainee of the house (notes plan N9c4, TRN-034): the list with
 * whether each can start, Start under a Pro+ pass, and the trainee typing their own training max for a
 * program. Kept out of `ApiClient`, which is in every page's first download. The server answers 404 to
 * anyone who is not a current self-directed trainee of the house.
 */
@Injectable({ providedIn: 'root' })
export class HouseProgramsApi {
  private readonly http = inject(HttpClient);

  /** The programs offered, the pass and the program running, as the house's day sees them. */
  programs(): Observable<HousePrograms> {
    return this.http
      .get<HouseProgramsView>('/api/training/me/house-programs')
      .pipe(map(toHousePrograms));
  }

  /** Starts one as the trainee's own program from the house's day; the same key answers the same start. */
  start(listingId: string, request: StartHouseProgramRequest): Observable<HouseProgramStarted> {
    return this.http
      .post<HouseProgramStartedView>(
        `/api/training/me/house-programs/${encodeURIComponent(listingId)}/start`,
        request,
      )
      .pipe(map(toHouseProgramStarted));
  }

  /** Adds a training max the trainee typed, dated the house's day. Append-only and keyless: never retried. */
  recordMax(request: RecordOwnMaxRequest): Observable<StrengthMaxView> {
    return this.http.post<StrengthMaxView>('/api/strength/me/maxes', request);
  }
}
