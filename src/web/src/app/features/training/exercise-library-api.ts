import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  CreateExerciseRequest,
  ExerciseClassification,
  ExerciseEquipment,
  ExerciseSearchResult,
  ExerciseView,
  MediaAccessBatchView,
  MediaAssetPage,
  MediaAssetView,
  MovementPattern,
  MuscleGroup,
  RegisterExternalMediaRequest,
  UpdateExerciseRequest,
} from '../../core/api/generated';

export interface ExerciseQuery {
  readonly query?: string;
  readonly muscle?: MuscleGroup | null;
  readonly movementPattern?: MovementPattern | null;
  readonly classification?: ExerciseClassification | null;
  readonly equipment?: ExerciseEquipment | null;
  readonly includeArchived?: boolean;
  readonly skip?: number;
  readonly take?: number;
}

/**
 * The exercise library's reads and writes (C10, R5.1b): search with every filter the server takes,
 * the exercise itself, and the coach's media it can show. Kept out of `ApiClient`, like
 * `ProductsApi`, so it loads only with this page.
 */
@Injectable({ providedIn: 'root' })
export class ExerciseLibraryApi {
  private readonly http = inject(HttpClient);

  search(query: ExerciseQuery): Observable<ExerciseSearchResult> {
    let params = new HttpParams()
      .set('skip', query.skip ?? 0)
      .set('take', query.take ?? 48)
      .set('includeArchived', query.includeArchived ?? false);
    const text = query.query?.trim();
    if (text) params = params.set('query', text);
    if (query.muscle) params = params.set('muscle', query.muscle);
    if (query.movementPattern) params = params.set('movementPattern', query.movementPattern);
    if (query.classification) params = params.set('classification', query.classification);
    if (query.equipment) params = params.set('equipment', query.equipment);
    return this.http.get<ExerciseSearchResult>('/api/exercises', { params });
  }

  get(exerciseId: string): Observable<ExerciseView> {
    return this.http.get<ExerciseView>(`/api/exercises/${exerciseId}`);
  }

  create(request: CreateExerciseRequest): Observable<ExerciseView> {
    return this.http.post<ExerciseView>('/api/exercises', request);
  }

  update(exerciseId: string, request: UpdateExerciseRequest): Observable<ExerciseView> {
    return this.http.put<ExerciseView>(`/api/exercises/${exerciseId}`, request);
  }

  setArchived(exerciseId: string, isArchived: boolean, version: number): Observable<ExerciseView> {
    return this.http.put<ExerciseView>(`/api/exercises/${exerciseId}/archive`, {
      isArchived,
      version,
    });
  }

  /** The coach's media library, newest first. */
  listMedia(skip = 0, take = 100): Observable<MediaAssetPage> {
    return this.http.get<MediaAssetPage>('/api/media', {
      params: new HttpParams().set('skip', skip).set('take', take),
    });
  }

  uploadMedia(title: string, file: File): Observable<MediaAssetView> {
    const body = new FormData();
    body.append('title', title);
    body.append('file', file, file.name);
    return this.http.post<MediaAssetView>('/api/media/uploads', body);
  }

  registerVideoLink(request: RegisterExternalMediaRequest): Observable<MediaAssetView> {
    return this.http.post<MediaAssetView>('/api/media/external', request);
  }

  deleteMedia(assetId: string, version: number): Observable<MediaAssetView> {
    return this.http.delete<MediaAssetView>(`/api/media/${assetId}`, { body: { version } });
  }

  /** At most 32 assets a call (MED-005); each gets its own path-scoped grant. */
  grant(assetIds: readonly string[]): Observable<MediaAccessBatchView> {
    return this.http.post<MediaAccessBatchView>('/api/media/access', { assetIds: [...assetIds] });
  }
}
