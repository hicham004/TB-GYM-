import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { MeasurementType, MeasurementUnit, RecordedMassUnit } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
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
import { mapProgressPhotoImage } from './progress.models';

@Component({
  selector: 'app-progress-view',
  imports: [DatePipe, DecimalPipe, FormsModule],
  templateUrl: './progress-view.html',
  styleUrl: './progress-view.scss',
})
export class ProgressView {
  readonly clientId = input<string | null>(null);
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private loadedKey: string | null = null;

  protected readonly coachMode = computed(() => this.clientId() !== null);
  protected readonly progress = signal<ProgressViewModel | null>(null);
  protected readonly history = signal<BodyweightHistory | null>(null);
  protected readonly correction = signal<BodyweightDateCorrection | null>(null);
  protected readonly measurements = signal<BodyMeasurements | null>(null);
  protected readonly measurementHistory = signal<BodyMeasurementHistory | null>(null);
  protected readonly photos = signal<ProgressPhotos | null>(null);
  protected readonly photosLoading = signal(false);
  // Object URLs are resolved on demand so an image is only fetched when the viewer opens it.
  protected readonly openPhotoId = signal<string | null>(null);
  protected readonly openPhotoImage = signal<ProgressPhotoImage | null>(null);
  // Opening a photo shows the downscaled preview; the full-resolution bytes of a health-adjacent
  // image are transferred only when the viewer asks for them.
  protected readonly fullSizeRequested = signal(false);
  // A photo stored before renditions existed has nothing smaller to fall back to, so it opens at
  // full resolution and must not offer to load a full size it is already showing.
  protected readonly showingThumbnail = computed(() => {
    const image = this.openPhotoImage();
    return image !== null && image.thumbnailUrl !== null && !this.fullSizeRequested();
  });
  protected readonly openPhotoUrl = computed(() => {
    const image = this.openPhotoImage();
    if (image === null) {
      return null;
    }

    return image.thumbnailUrl !== null && !this.fullSizeRequested()
      ? image.thumbnailUrl
      : image.fullUrl;
  });
  protected readonly measurementDays = computed(() =>
    (this.measurements()?.days ?? []).filter((day) => day.measurements.length > 0),
  );
  protected readonly loading = signal(false);
  protected readonly measurementsLoading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected displayUnit: RecordedMassUnit = 'Kilogram';
  protected entryUnit: RecordedMassUnit = 'Kilogram';
  protected entryValue: number | null = null;
  protected entryDate = '';
  protected correctingId: string | null = null;
  protected correctionValue: number | null = null;
  protected correctionUnit: RecordedMassUnit = 'Kilogram';
  protected correctionReason = '';
  protected redatingId: string | null = null;
  protected redateDate = '';
  protected redateReason = '';
  protected measurementDisplayUnit: MeasurementUnit = 'Centimetre';
  protected measurementType: MeasurementType = 'Waist';
  protected measurementUnit: MeasurementUnit = 'Centimetre';
  protected measurementValue: number | null = null;
  protected measurementDate = '';
  protected correctingMeasurementId: string | null = null;
  protected measurementCorrectionValue: number | null = null;
  protected measurementCorrectionUnit: MeasurementUnit = 'Centimetre';
  protected measurementCorrectionReason = '';
  protected photoPose: ProgressPhotoPose = 'Front';
  protected photoDate = '';
  protected removingPhotoId: string | null = null;
  protected photoRemovalReason = '';

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.clientId();
      const key = tenantId ? `${tenantId}:${clientId ?? 'me'}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
        void this.loadMeasurements();
        void this.loadPhotos();
      }
    });
  }

  protected async changeDisplayUnit(): Promise<void> {
    await this.load();
  }

  protected async changeMeasurementDisplayUnit(): Promise<void> {
    await this.loadMeasurements();
  }

  protected changeMeasurementType(): void {
    this.measurementUnit =
      this.measurementType === 'BodyFatPercentage'
        ? 'Percent'
        : this.measurementUnit === 'Percent'
          ? 'Centimetre'
          : this.measurementUnit;
  }

  protected async recordMeasurement(): Promise<void> {
    if (this.measurementValue === null || !Number.isFinite(this.measurementValue)) {
      this.error.set($localize`Enter a body measurement value.`);
      return;
    }

    await this.runMeasurement(
      async () => {
        const request = {
          measurementType: this.measurementType,
          value: this.measurementValue!,
          unit: this.measurementUnit,
          measurementDate: this.measurementDate || null,
        };
        const clientId = this.clientId();
        if (clientId) {
          await firstValueFrom(this.api.recordClientBodyMeasurement(clientId, request));
        } else {
          await firstValueFrom(this.api.recordMyBodyMeasurement(request));
        }
        this.measurementValue = null;
        this.measurementDate = '';
        await this.loadMeasurements(false);
      },
      $localize`Body measurement recorded.`,
    );
  }

  protected beginMeasurementCorrection(measurement: BodyMeasurement): void {
    this.correctingMeasurementId = measurement.id;
    this.measurementCorrectionValue = measurement.enteredValue;
    this.measurementCorrectionUnit = measurement.enteredUnit;
    this.measurementCorrectionReason = '';
    this.measurementHistory.set(null);
  }

  protected cancelMeasurementCorrection(): void {
    this.correctingMeasurementId = null;
    this.measurementCorrectionValue = null;
    this.measurementCorrectionReason = '';
  }

  protected async correctMeasurement(measurement: BodyMeasurement): Promise<void> {
    if (
      this.measurementCorrectionValue === null ||
      !Number.isFinite(this.measurementCorrectionValue) ||
      !this.measurementCorrectionReason.trim()
    ) {
      this.error.set($localize`Enter the corrected measurement and a reason.`);
      return;
    }

    await this.runMeasurement(
      async () => {
        const request = {
          value: this.measurementCorrectionValue!,
          unit: this.measurementCorrectionUnit,
          reason: this.measurementCorrectionReason,
          version: measurement.version,
        };
        const clientId = this.clientId();
        const corrected = clientId
          ? await firstValueFrom(
              this.api.correctClientBodyMeasurement(clientId, measurement.id, request),
            )
          : await firstValueFrom(this.api.correctMyBodyMeasurement(measurement.id, request));
        this.measurementHistory.set(corrected);
        this.correctingMeasurementId = null;
        await this.loadMeasurements(false);
      },
      $localize`Measurement correction saved with its prior value preserved.`,
    );
  }

  protected async showMeasurementHistory(measurementId: string): Promise<void> {
    this.error.set(null);
    try {
      const clientId = this.clientId();
      this.measurementHistory.set(
        clientId
          ? await firstValueFrom(this.api.getClientBodyMeasurementHistory(clientId, measurementId))
          : await firstValueFrom(this.api.getMyBodyMeasurementHistory(measurementId)),
      );
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Measurement history could not be loaded.`));
    }
  }

  protected async record(): Promise<void> {
    if (this.entryValue === null || !Number.isFinite(this.entryValue)) {
      this.error.set($localize`Enter a bodyweight value.`);
      return;
    }

    await this.run(
      async () => {
        const request = {
          value: this.entryValue!,
          unit: this.entryUnit,
          measurementDate: this.entryDate || null,
        };
        const clientId = this.clientId();
        if (clientId) {
          await firstValueFrom(this.api.recordClientBodyweight(clientId, request));
        } else {
          await firstValueFrom(this.api.recordMyBodyweight(request));
        }
        this.entryValue = null;
        this.entryDate = '';
        await this.load(false);
      },
      $localize`Bodyweight recorded.`,
    );
  }

  protected beginCorrection(observation: BodyweightObservation): void {
    this.correctingId = observation.id;
    this.correctionValue = observation.enteredValue;
    this.correctionUnit = observation.enteredUnit;
    this.correctionReason = '';
    this.cancelRedate();
    this.history.set(null);
    this.correction.set(null);
  }

  protected cancelCorrection(): void {
    this.correctingId = null;
    this.correctionValue = null;
    this.correctionReason = '';
  }

  protected async correct(observation: BodyweightObservation): Promise<void> {
    if (
      this.correctionValue === null ||
      !Number.isFinite(this.correctionValue) ||
      !this.correctionReason.trim()
    ) {
      this.error.set($localize`Enter the corrected value and a reason.`);
      return;
    }

    await this.run(
      async () => {
        const request = {
          value: this.correctionValue!,
          unit: this.correctionUnit,
          reason: this.correctionReason,
          version: observation.version,
        };
        const clientId = this.clientId();
        const corrected = clientId
          ? await firstValueFrom(
              this.api.correctClientBodyweight(clientId, observation.id, request),
            )
          : await firstValueFrom(this.api.correctMyBodyweight(observation.id, request));
        this.history.set(corrected);
        this.correctingId = null;
        await this.load(false);
      },
      $localize`Correction saved with its prior value preserved.`,
    );
  }

  /**
   * Correcting a mis-dated entry is a separate flow from correcting a wrong value: it moves the same
   * weight to another date rather than changing what was measured, so the two never share a form.
   */
  protected beginRedate(observation: BodyweightObservation): void {
    this.redatingId = observation.id;
    this.redateDate = observation.measurementDate;
    this.redateReason = '';
    this.cancelCorrection();
    this.history.set(null);
    this.correction.set(null);
  }

  protected cancelRedate(): void {
    this.redatingId = null;
    this.redateDate = '';
    this.redateReason = '';
  }

  protected async redate(observation: BodyweightObservation): Promise<void> {
    if (!this.redateReason.trim() || !this.redateDate) {
      this.error.set($localize`Enter the correct date and a reason.`);
      return;
    }

    if (this.redateDate === observation.measurementDate) {
      this.error.set($localize`Pick a different date, or correct the value instead.`);
      return;
    }

    await this.run(
      async () => {
        const request = {
          measurementDate: this.redateDate,
          reason: this.redateReason.trim(),
          version: observation.version,
        };
        const clientId = this.clientId();
        const corrected = clientId
          ? await firstValueFrom(
              this.api.replaceClientBodyweightDate(clientId, observation.id, request),
            )
          : await firstValueFrom(this.api.replaceMyBodyweightDate(observation.id, request));
        this.correction.set(corrected);
        this.cancelRedate();
        await this.load(false);
      },
      $localize`Moved to the correct date. The original entry is kept as a voided record.`,
    );
  }

  protected async showHistory(observationId: string): Promise<void> {
    this.error.set(null);
    try {
      const clientId = this.clientId();
      this.history.set(
        clientId
          ? await firstValueFrom(this.api.getClientBodyweightHistory(clientId, observationId))
          : await firstValueFrom(this.api.getMyBodyweightHistory(observationId)),
      );
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Correction history could not be loaded.`));
    }
  }

  private async load(showSpinner = true): Promise<void> {
    if (showSpinner) {
      this.loading.set(true);
    }
    this.error.set(null);
    try {
      const clientId = this.clientId();
      this.progress.set(
        clientId
          ? await firstValueFrom(this.api.getClientProgress(clientId, this.displayUnit))
          : await firstValueFrom(this.api.getMyProgress(this.displayUnit)),
      );
    } catch (error) {
      this.progress.set(null);
      this.error.set(apiErrorMessage(error, $localize`Bodyweight progress could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadMeasurements(showSpinner = true): Promise<void> {
    if (showSpinner) {
      this.measurementsLoading.set(true);
    }
    this.error.set(null);
    try {
      const clientId = this.clientId();
      this.measurements.set(
        clientId
          ? await firstValueFrom(
              this.api.getClientBodyMeasurements(clientId, this.measurementDisplayUnit),
            )
          : await firstValueFrom(this.api.getMyBodyMeasurements(this.measurementDisplayUnit)),
      );
    } catch (error) {
      this.measurements.set(null);
      this.error.set(apiErrorMessage(error, $localize`Body measurements could not be loaded.`));
    } finally {
      this.measurementsLoading.set(false);
    }
  }

  private async run(action: () => Promise<void>, success: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.csrf.refresh();
      await action();
      this.notice.set(success);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The bodyweight change could not be saved.`));
    } finally {
      this.busy.set(false);
    }
  }

  protected async recordPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file === null) {
      return;
    }

    const clientId = this.clientId();
    const photoDate = this.photoDate === '' ? null : this.photoDate;
    await this.runPhoto(
      async () => {
        await firstValueFrom(
          clientId
            ? this.api.recordClientProgressPhoto(clientId, this.photoPose, photoDate, file)
            : this.api.recordMyProgressPhoto(this.photoPose, photoDate, file),
        );
        // Clear the picker so re-selecting the same file still raises a change event.
        input.value = '';
        await this.loadPhotos(false);
      },
      $localize`Progress photo saved.`,
    );
  }

  protected startPhotoRemoval(photo: ProgressPhoto): void {
    this.removingPhotoId = photo.id;
    this.photoRemovalReason = '';
  }

  protected cancelPhotoRemoval(): void {
    this.removingPhotoId = null;
    this.photoRemovalReason = '';
  }

  protected async removePhoto(photo: ProgressPhoto): Promise<void> {
    if (this.photoRemovalReason.trim() === '') {
      this.error.set($localize`Enter a reason so the removal stays auditable.`);
      return;
    }

    const clientId = this.clientId();
    const request = { reason: this.photoRemovalReason.trim(), version: photo.version };
    await this.runPhoto(
      async () => {
        await firstValueFrom(
          clientId
            ? this.api.removeClientProgressPhoto(clientId, photo.id, request)
            : this.api.removeMyProgressPhoto(photo.id, request),
        );
        this.cancelPhotoRemoval();
        this.closePhoto();
        await this.loadPhotos(false);
      },
      $localize`Progress photo removed.`,
    );
  }

  protected async openPhoto(photo: ProgressPhoto): Promise<void> {
    if (this.openPhotoId() === photo.id) {
      this.closePhoto();
      return;
    }

    this.closePhoto();
    try {
      await this.csrf.refresh();
      const access = await firstValueFrom(this.api.createMediaAccess(photo.mediaAssetId));
      this.openPhotoId.set(photo.id);
      this.openPhotoImage.set(mapProgressPhotoImage(photo.id, access));
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The progress photo could not be opened.`));
    }
  }

  /**
   * Swaps the preview for the full-resolution image. The grant issued when the photo was opened
   * already covers both, so this needs no further request for access.
   */
  protected showFullSize(): void {
    this.fullSizeRequested.set(true);
  }

  protected closePhoto(): void {
    this.openPhotoId.set(null);
    this.openPhotoImage.set(null);
    this.fullSizeRequested.set(false);
  }

  private async loadPhotos(showSpinner = true): Promise<void> {
    if (showSpinner) {
      this.photosLoading.set(true);
    }

    try {
      const clientId = this.clientId();
      this.photos.set(
        clientId
          ? await firstValueFrom(this.api.getClientProgressPhotos(clientId))
          : await firstValueFrom(this.api.getMyProgressPhotos()),
      );
    } catch (error) {
      this.photos.set(null);
      this.error.set(apiErrorMessage(error, $localize`Progress photos could not be loaded.`));
    } finally {
      this.photosLoading.set(false);
    }
  }

  private async runPhoto(action: () => Promise<void>, success: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.csrf.refresh();
      await action();
      this.notice.set(success);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The progress photo could not be saved.`));
    } finally {
      this.busy.set(false);
    }
  }

  private async runMeasurement(action: () => Promise<void>, success: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.csrf.refresh();
      await action();
      this.notice.set(success);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The measurement could not be saved.`));
    } finally {
      this.busy.set(false);
    }
  }
}
