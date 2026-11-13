import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  ExerciseEquipment,
  ExercisePoolExerciseResult,
  ExercisePoolPage,
  MuscleGroup,
} from '../../core/api/generated';

export interface PoolQuery {
  readonly query?: string;
  readonly skip?: number;
  readonly take?: number;
  /** Only the exercises working this muscle, as their main muscle or another (LIB-006). */
  readonly muscle?: MuscleGroup | null;
  readonly equipment?: ExerciseEquipment | null;
}

/**
 * TB Gym's exercise pool for a client of the house (LIB-006, notes plan N9b1): the house's exercises in
 * use, in name order, searched and filtered as the coach's library is, with their demos, and one of them
 * read whole for its page (notes plan N9b4). Read only; the server answers 404 outside the house. Kept
 * out of `ApiClient`, which is in every page's first download.
 */
@Injectable({ providedIn: 'root' })
export class ExercisePoolApi {
  private readonly http = inject(HttpClient);

  search(query: PoolQuery = {}): Observable<ExercisePoolPage> {
    let params = new HttpParams().set('skip', query.skip ?? 0).set('take', query.take ?? 50);
    const text = query.query?.trim();
    if (text) params = params.set('query', text);
    // A filter goes only when it is set, after the ones the picker sends: the server refuses a value
    // it does not know, and the picker's requests stay as they were.
    if (query.muscle) params = params.set('muscle', query.muscle);
    if (query.equipment) params = params.set('equipment', query.equipment);
    return this.http.get<ExercisePoolPage>('/api/exercise-pool', { params });
  }

  /** One exercise of the pool, with its instructions and demos; a 404 when it is not in the pool. */
  get(exerciseId: string): Observable<ExercisePoolExerciseResult> {
    return this.http.get<ExercisePoolExerciseResult>(
      `/api/exercise-pool/${encodeURIComponent(exerciseId)}`,
    );
  }
}
