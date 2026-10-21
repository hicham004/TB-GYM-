import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  CorrectBodyMeasurementRequest,
  CorrectBodyweightRequest,
  MeasurementType,
  MeasurementUnit,
  RecordedMassUnit,
  RecordBodyMeasurementRequest,
  RecordBodyweightRequest,
  RemoveProgressPhotoRequest,
  ReplaceBodyweightDateRequest,
} from '../../core/api/generated';
import type {
  BodyMeasurement,
  BodyMeasurementHistory,
  BodyMeasurements,
  BodyweightDateCorrection,
  BodyweightHistory,
  BodyweightObservation,
  ProgressPhoto,
  ProgressPhotoImage,
  ProgressPhotoPose,
  ProgressPhotos,
  ProgressViewModel,
} from './progress.models';
import {
  mapDateCorrection,
  mapHistory,
  mapMeasurement,
  mapMeasurementHistory,
  mapMeasurements,
  mapObservation,
  mapProgress,
  mapProgressPhoto,
  mapProgressPhotoImage,
  mapProgressPhotos,
} from './progress.models';

export type { MeasurementType, MeasurementUnit, RecordedMassUnit };

/**
 * Every call the weigh-in, measurement and photo screens make, for one person: the client's own
 * (`clientId` null) or a client of the coach (`clientId` set). Which of the two routes a call takes is
 * decided here once, so a screen never branches on it. The server still decides who may do what.
 */
@Injectable({ providedIn: 'root' })
export class ProgressEntriesApi {
  private readonly api = inject(ApiClient);

  // ---- weight ----

  weighIns(
    clientId: string | null,
    unit: RecordedMassUnit,
    from: string | null,
    to: string | null,
  ): Observable<ProgressViewModel> {
    return (
      clientId
        ? this.api.getClientProgress(clientId, unit, from, to)
        : this.api.getMyProgress(unit, from, to)
    ).pipe(map(mapProgress));
  }

  /** The first and last day with a weigh-in, so "earlier" knows when there is no more. */
  weightSpan(clientId: string | null): Observable<{ firstDate: string | null }> {
    return (
      clientId ? this.api.getClientBodyweightSpan(clientId) : this.api.getMyBodyweightSpan()
    ).pipe(map((span) => ({ firstDate: span.firstDate ?? null })));
  }

  recordWeight(
    clientId: string | null,
    request: RecordBodyweightRequest,
  ): Observable<BodyweightObservation> {
    return (
      clientId
        ? this.api.recordClientBodyweight(clientId, request)
        : this.api.recordMyBodyweight(request)
    ).pipe(map(mapObservation));
  }

  correctWeight(
    clientId: string | null,
    observationId: string,
    request: CorrectBodyweightRequest,
  ): Observable<BodyweightHistory> {
    return (
      clientId
        ? this.api.correctClientBodyweight(clientId, observationId, request)
        : this.api.correctMyBodyweight(observationId, request)
    ).pipe(map(mapHistory));
  }

  moveWeight(
    clientId: string | null,
    observationId: string,
    request: ReplaceBodyweightDateRequest,
  ): Observable<BodyweightDateCorrection> {
    return (
      clientId
        ? this.api.replaceClientBodyweightDate(clientId, observationId, request)
        : this.api.replaceMyBodyweightDate(observationId, request)
    ).pipe(map(mapDateCorrection));
  }

  weightHistory(clientId: string | null, observationId: string): Observable<BodyweightHistory> {
    return (
      clientId
        ? this.api.getClientBodyweightHistory(clientId, observationId)
        : this.api.getMyBodyweightHistory(observationId)
    ).pipe(map(mapHistory));
  }

  // ---- measurements ----

  measurements(
    clientId: string | null,
    unit: MeasurementUnit,
    from: string | null,
    to: string | null,
  ): Observable<BodyMeasurements> {
    return (
      clientId
        ? this.api.getClientBodyMeasurements(clientId, unit, from, to)
        : this.api.getMyBodyMeasurements(unit, from, to)
    ).pipe(map(mapMeasurements));
  }

  recordMeasurement(
    clientId: string | null,
    request: RecordBodyMeasurementRequest,
  ): Observable<BodyMeasurement> {
    return (
      clientId
        ? this.api.recordClientBodyMeasurement(clientId, request)
        : this.api.recordMyBodyMeasurement(request)
    ).pipe(map(mapMeasurement));
  }

  correctMeasurement(
    clientId: string | null,
    measurementId: string,
    request: CorrectBodyMeasurementRequest,
  ): Observable<BodyMeasurementHistory> {
    return (
      clientId
        ? this.api.correctClientBodyMeasurement(clientId, measurementId, request)
        : this.api.correctMyBodyMeasurement(measurementId, request)
    ).pipe(map(mapMeasurementHistory));
  }

  measurementHistory(
    clientId: string | null,
    measurementId: string,
  ): Observable<BodyMeasurementHistory> {
    return (
      clientId
        ? this.api.getClientBodyMeasurementHistory(clientId, measurementId)
        : this.api.getMyBodyMeasurementHistory(measurementId)
    ).pipe(map(mapMeasurementHistory));
  }

  // ---- photos ----

  photos(
    clientId: string | null,
    from: string | null,
    to: string | null,
  ): Observable<ProgressPhotos> {
    return (
      clientId
        ? this.api.getClientProgressPhotos(clientId, from, to)
        : this.api.getMyProgressPhotos(from, to)
    ).pipe(map(mapProgressPhotos));
  }

  addPhoto(
    clientId: string | null,
    pose: ProgressPhotoPose,
    photoDate: string | null,
    file: File,
  ): Observable<ProgressPhoto> {
    return (
      clientId
        ? this.api.recordClientProgressPhoto(clientId, pose, photoDate, file)
        : this.api.recordMyProgressPhoto(pose, photoDate, file)
    ).pipe(map(mapProgressPhoto));
  }

  removePhoto(
    clientId: string | null,
    photoId: string,
    request: RemoveProgressPhotoRequest,
  ): Observable<ProgressPhoto> {
    return (
      clientId
        ? this.api.removeClientProgressPhoto(clientId, photoId, request)
        : this.api.removeMyProgressPhoto(photoId, request)
    ).pipe(map(mapProgressPhoto));
  }

  /** One grant for one photo: the preview first, the full size only when the viewer asks for it. */
  openPhoto(photo: ProgressPhoto): Observable<ProgressPhotoImage> {
    return this.api
      .createMediaAccess(photo.mediaAssetId)
      .pipe(map((access) => mapProgressPhotoImage(photo.id, access)));
  }

  /** One grant per screenful of tiles, so the thumbnails load without a request each. */
  thumbnails(assetIds: readonly string[]): Observable<ReadonlyMap<string, string>> {
    return this.api.createMediaAccessBatch(assetIds).pipe(
      map((batch) => {
        const urls = new Map<string, string>();
        for (const item of batch.items) {
          if (item.thumbnailUrl) urls.set(item.assetId, item.thumbnailUrl);
        }
        return urls;
      }),
    );
  }
}
