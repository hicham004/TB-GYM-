import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { OwnWorkoutView } from '../../core/api/generated';

const WORKOUTS = '/api/training/me/workouts';

/**
 * A workout of one's own (TRN-033, notes plan N9b3 on N9b2's routes): started empty or from a finished
 * workout, its exercises from the house's pool, its empty sets added and its last set taken away while
 * it runs. Every change answers the whole workout, which carries the version the next change sends. Sets
 * are logged and the workout finished through the player's existing routes. The server decides who may
 * do each of these; kept out of `ApiClient`, which is in every page's first download.
 */
@Injectable({ providedIn: 'root' })
export class OwnWorkoutApi {
  private readonly http = inject(HttpClient);

  start(fromWorkoutId: string | null = null): Observable<OwnWorkoutView> {
    return this.http.post<OwnWorkoutView>(WORKOUTS, fromWorkoutId ? { fromWorkoutId } : {});
  }

  addExercise(workoutId: string, exerciseId: string, version: number): Observable<OwnWorkoutView> {
    return this.http.post<OwnWorkoutView>(`${WORKOUTS}/${workoutId}/exercises`, {
      exerciseId,
      version,
    });
  }

  removeExercise(
    workoutId: string,
    exercisePerformanceId: string,
    version: number,
  ): Observable<OwnWorkoutView> {
    return this.http.delete<OwnWorkoutView>(
      `${WORKOUTS}/${workoutId}/exercises/${exercisePerformanceId}`,
      { body: { version } },
    );
  }

  addSet(
    workoutId: string,
    exercisePerformanceId: string,
    version: number,
  ): Observable<OwnWorkoutView> {
    return this.http.post<OwnWorkoutView>(
      `${WORKOUTS}/${workoutId}/exercises/${exercisePerformanceId}/sets`,
      { version },
    );
  }

  removeSet(
    workoutId: string,
    setPerformanceId: string,
    version: number,
  ): Observable<OwnWorkoutView> {
    return this.http.delete<OwnWorkoutView>(`${WORKOUTS}/${workoutId}/sets/${setPerformanceId}`, {
      body: { version },
    });
  }
}
