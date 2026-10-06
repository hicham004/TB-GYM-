import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  ApplyTrainingMaxesRequest,
  CoachClientProgramView,
  EstimateRpeChartMaxRequest,
  PreviewTrainingMaxesRequest,
  RenameMesocycleRequest,
  RpeChartMaxEstimateView,
  TrainingMaxesPreviewView,
  TrainingMaxesView,
  TrainingMesocycleView,
} from '../../core/api/generated';

/**
 * The coach's read of a client's programs (C3, R3.4a) and of each program's own training maxes (P2).
 * Kept out of `ApiClient`, like `ClientListApi`, so it loads only with the Training section rather
 * than in every page's initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class ClientProgramApi {
  private readonly http = inject(HttpClient);

  /** Every program block of the client, newest first, with the state of each session (TRN-022). */
  getProgram(clientId: string): Observable<CoachClientProgramView> {
    return this.http.get<CoachClientProgramView>(`/api/training/clients/${clientId}/program`);
  }

  /** A program's training maxes: the one in use for each lift and the ones before it (STR-002). */
  getTrainingMaxes(mesocycleId: string): Observable<TrainingMaxesView> {
    return this.http.get<TrainingMaxesView>(
      `/api/training/mesocycles/${mesocycleId}/training-maxes`,
    );
  }

  /** What an update would change, worked out and not saved (STR-009). */
  previewTrainingMaxes(
    mesocycleId: string,
    request: PreviewTrainingMaxesRequest,
  ): Observable<TrainingMaxesPreviewView> {
    return this.http.post<TrainingMaxesPreviewView>(
      `/api/training/mesocycles/${mesocycleId}/training-maxes/preview`,
      request,
    );
  }

  /** Saves the update the coach reviewed: the preview's hash, the version and one idempotency key. */
  applyTrainingMaxes(
    mesocycleId: string,
    request: ApplyTrainingMaxesRequest,
  ): Observable<TrainingMesocycleView> {
    return this.http.post<TrainingMesocycleView>(
      `/api/training/mesocycles/${mesocycleId}/training-maxes/apply`,
      request,
    );
  }

  /** Renames the program; where it came from and when it runs never change (TRN-002). */
  renameProgram(
    mesocycleId: string,
    request: RenameMesocycleRequest,
  ): Observable<TrainingMesocycleView> {
    return this.http.put<TrainingMesocycleView>(
      `/api/training/mesocycles/${mesocycleId}/name`,
      request,
    );
  }

  /** The training max a weight implies on the RTS chart, read backwards (STR-011). */
  estimateMaxFromRpeChart(
    request: EstimateRpeChartMaxRequest,
  ): Observable<RpeChartMaxEstimateView> {
    return this.http.post<RpeChartMaxEstimateView>('/api/strength/estimate-max-from-rpe', request);
  }
}
