import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ExercisePoolPage } from '../../core/api/generated';

export interface PoolQuery {
  readonly query?: string;
  readonly skip?: number;
  readonly take?: number;
}

/**
 * TB Gym's exercise pool for a client of the house (LIB-006, notes plan N9b1): the house's exercises in
 * use, in name order, searched as the coach's library is, with their demos. Read only; the server answers
 * 404 outside the house. Kept out of `ApiClient`, which is in every page's first download.
 */
@Injectable({ providedIn: 'root' })
export class ExercisePoolApi {
  private readonly http = inject(HttpClient);

  search(query: PoolQuery = {}): Observable<ExercisePoolPage> {
    let params = new HttpParams().set('skip', query.skip ?? 0).set('take', query.take ?? 50);
    const text = query.query?.trim();
    if (text) params = params.set('query', text);
    return this.http.get<ExercisePoolPage>('/api/exercise-pool', { params });
  }
}
