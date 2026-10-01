import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { MeasurementType, MeasurementUnit, RecordedMassUnit } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
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
  private readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
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
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.clientId();
      const key = tenantId ? `${tenantId}:${clientId ?? 'me'}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        this.useStartingUnits();
        void this.load();
        void this.loadMeasurements();
        void this.loadPhotos();
      }
    });
  }

  /** A client's own page starts in the unit they saved in Me; a coach reading a client's, in kilograms. */
  private useStartingUnits(): void {
    const unit = this.clientId() === null ? this.auth.weightUnit() : 'Kilogram';
    this.displayUnit = unit;
    this.entryUnit = unit;
    this.correctionUnit = unit;
  }

  protected async changeDisplayUnit(): Promise<void> {
    return this.scope.run('changeDisplayUnit', async (owner) => {
      await owner.wait(this.load());
    });
  }

  protected async changeMeasurementDisplayUnit(): Promise<void> {
    return this.scope.run('changeMeasurementDisplayUnit', async (owner) => {
      await owner.wait(this.loadMeasurements());
    });
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
    return this.scope.run('recordMeasurement', async (owner) => {
      if (this.measurementValue === null || !Number.isFinite(this.measurementValue)) {
        this.error.set($localize`Enter a body measurement value.`);
        return;
      }

      await owner.wait(
        this.runMeasurement(
          async () => {
            const request = {
              measurementType: this.measurementType,
              value: this.measurementValue!,
              unit: this.measurementUnit,
              measurementDate: this.measurementDate || null,
            };
            const clientId = this.clientId();
            if (clientId) {
              await owner.wait(
                firstValueFrom(this.api.recordClientBodyMeasurement(clientId, request)),
              );
            } else {
              await owner.wait(firstValueFrom(this.api.recordMyBodyMeasurement(request)));
            }
            this.measurementValue = null;
            this.measurementDate = '';
            await owner.wait(this.loadMeasurements(false));
          },
          $localize`Body measurement recorded.`,
        ),
      );
    });
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
    return this.scope.run('correctMeasurement', async (owner) => {
      if (
        this.measurementCorrectionValue === null ||
        !Number.isFinite(this.measurementCorrectionValue) ||
        !this.measurementCorrectionReason.trim()
      ) {
        this.error.set($localize`Enter the corrected measurement and a reason.`);
        return;
      }

      await owner.wait(
        this.runMeasurement(
          async () => {
            const request = {
              value: this.measurementCorrectionValue!,
              unit: this.measurementCorrectionUnit,
              reason: this.measurementCorrectionReason,
              version: measurement.version,
            };
            const clientId = this.clientId();
            const corrected = clientId
              ? await owner.wait(
                  firstValueFrom(
                    this.api.correctClientBodyMeasurement(clientId, measurement.id, request),
                  ),
                )
              : await owner.wait(
                  firstValueFrom(this.api.correctMyBodyMeasurement(measurement.id, request)),
                );
            this.measurementHistory.set(corrected);
            this.correctingMeasurementId = null;
            await owner.wait(this.loadMeasurements(false));
          },
          $localize`Measurement correction saved with its prior value preserved.`,
        ),
      );
    });
  }

  protected async showMeasurementHistory(measurementId: string): Promise<void> {
    return this.scope.run('showMeasurementHistory', async (owner) => {
      this.error.set(null);
      try {
        const clientId = this.clientId();
        this.measurementHistory.set(
          clientId
            ? await owner.wait(
                firstValueFrom(this.api.getClientBodyMeasurementHistory(clientId, measurementId)),
              )
            : await owner.wait(firstValueFrom(this.api.getMyBodyMeasurementHistory(measurementId))),
        );
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Measurement history could not be loaded.`));
      }
    });
  }

  protected async record(): Promise<void> {
    return this.scope.run('record', async (owner) => {
      if (this.entryValue === null || !Number.isFinite(this.entryValue)) {
        this.error.set($localize`Enter a bodyweight value.`);
        return;
      }

      await owner.wait(
        this.run(
          async () => {
            const request = {
              value: this.entryValue!,
              unit: this.entryUnit,
              measurementDate: this.entryDate || null,
            };
            const clientId = this.clientId();
            if (clientId) {
              await owner.wait(firstValueFrom(this.api.recordClientBodyweight(clientId, request)));
            } else {
              await owner.wait(firstValueFrom(this.api.recordMyBodyweight(request)));
            }
            this.entryValue = null;
            this.entryDate = '';
            await owner.wait(this.load(false));
          },
          $localize`Bodyweight recorded.`,
        ),
      );
    });
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
    return this.scope.run('correct', async (owner) => {
      if (
        this.correctionValue === null ||
        !Number.isFinite(this.correctionValue) ||
        !this.correctionReason.trim()
      ) {
        this.error.set($localize`Enter the corrected value and a reason.`);
        return;
      }

      await owner.wait(
        this.run(
          async () => {
            const request = {
              value: this.correctionValue!,
              unit: this.correctionUnit,
              reason: this.correctionReason,
              version: observation.version,
            };
            const clientId = this.clientId();
            const corrected = clientId
              ? await owner.wait(
                  firstValueFrom(
                    this.api.correctClientBodyweight(clientId, observation.id, request),
                  ),
                )
              : await owner.wait(
                  firstValueFrom(this.api.correctMyBodyweight(observation.id, request)),
                );
            this.history.set(corrected);
            this.correctingId = null;
            await owner.wait(this.load(false));
          },
          $localize`Correction saved with its prior value preserved.`,
        ),
      );
    });
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
    return this.scope.run('redate', async (owner) => {
      if (!this.redateReason.trim() || !this.redateDate) {
        this.error.set($localize`Enter the correct date and a reason.`);
        return;
      }

      if (this.redateDate === observation.measurementDate) {
        this.error.set($localize`Pick a different date, or correct the value instead.`);
        return;
      }

      await owner.wait(
        this.run(
          async () => {
            const request = {
              measurementDate: this.redateDate,
              reason: this.redateReason.trim(),
              version: observation.version,
            };
            const clientId = this.clientId();
            const corrected = clientId
              ? await owner.wait(
                  firstValueFrom(
                    this.api.replaceClientBodyweightDate(clientId, observation.id, request),
                  ),
                )
              : await owner.wait(
                  firstValueFrom(this.api.replaceMyBodyweightDate(observation.id, request)),
                );
            this.correction.set(corrected);
            this.cancelRedate();
            await owner.wait(this.load(false));
          },
          $localize`Moved to the correct date. The original entry is kept as a voided record.`,
        ),
      );
    });
  }

  protected async showHistory(observationId: string): Promise<void> {
    return this.scope.run('showHistory', async (owner) => {
      this.error.set(null);
      try {
        const clientId = this.clientId();
        this.history.set(
          clientId
            ? await owner.wait(
                firstValueFrom(this.api.getClientBodyweightHistory(clientId, observationId)),
              )
            : await owner.wait(firstValueFrom(this.api.getMyBodyweightHistory(observationId))),
        );
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Correction history could not be loaded.`));
      }
    });
  }

  private async load(showSpinner = true): Promise<void> {
    return this.scope.run('load', async (owner) => {
      if (showSpinner) {
        this.loading.set(true);
      }
      this.error.set(null);
      try {
        const clientId = this.clientId();
        this.progress.set(
          clientId
            ? await owner.wait(
                firstValueFrom(this.api.getClientProgress(clientId, this.displayUnit)),
              )
            : await owner.wait(firstValueFrom(this.api.getMyProgress(this.displayUnit))),
        );
      } catch (error) {
        if (!owner.current) return;
        this.progress.set(null);
        this.error.set(apiErrorMessage(error, $localize`Bodyweight progress could not be loaded.`));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private async loadMeasurements(showSpinner = true): Promise<void> {
    return this.scope.run('loadMeasurements', async (owner) => {
      if (showSpinner) {
        this.measurementsLoading.set(true);
      }
      this.error.set(null);
      try {
        const clientId = this.clientId();
        this.measurements.set(
          clientId
            ? await owner.wait(
                firstValueFrom(
                  this.api.getClientBodyMeasurements(clientId, this.measurementDisplayUnit),
                ),
              )
            : await owner.wait(
                firstValueFrom(this.api.getMyBodyMeasurements(this.measurementDisplayUnit)),
              ),
        );
      } catch (error) {
        if (!owner.current) return;
        this.measurements.set(null);
        this.error.set(apiErrorMessage(error, $localize`Body measurements could not be loaded.`));
      } finally {
        if (owner.current) {
          this.measurementsLoading.set(false);
        }
      }
    });
  }

  private async run(action: () => Promise<void>, success: string): Promise<void> {
    return this.scope.run('run', async (owner) => {
      this.busy.set(true);
      this.error.set(null);
      this.notice.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(action());
        this.notice.set(success);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          apiErrorMessage(error, $localize`The bodyweight change could not be saved.`),
        );
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  protected async recordPhoto(event: Event): Promise<void> {
    return this.scope.run('recordPhoto', async (owner) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0] ?? null;
      if (file === null) {
        return;
      }

      const clientId = this.clientId();
      const photoDate = this.photoDate === '' ? null : this.photoDate;
      await owner.wait(
        this.runPhoto(
          async () => {
            await owner.wait(
              firstValueFrom(
                clientId
                  ? this.api.recordClientProgressPhoto(clientId, this.photoPose, photoDate, file)
                  : this.api.recordMyProgressPhoto(this.photoPose, photoDate, file),
              ),
            );
            // Clear the picker so re-selecting the same file still raises a change event.
            input.value = '';
            await owner.wait(this.loadPhotos(false));
          },
          $localize`Progress photo saved.`,
        ),
      );
    });
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
    return this.scope.run('removePhoto', async (owner) => {
      if (this.photoRemovalReason.trim() === '') {
        this.error.set($localize`Enter a reason so the removal stays auditable.`);
        return;
      }

      const clientId = this.clientId();
      const request = { reason: this.photoRemovalReason.trim(), version: photo.version };
      await owner.wait(
        this.runPhoto(
          async () => {
            await owner.wait(
              firstValueFrom(
                clientId
                  ? this.api.removeClientProgressPhoto(clientId, photo.id, request)
                  : this.api.removeMyProgressPhoto(photo.id, request),
              ),
            );
            this.cancelPhotoRemoval();
            this.closePhoto();
            await owner.wait(this.loadPhotos(false));
          },
          $localize`Progress photo removed.`,
        ),
      );
    });
  }

  protected async openPhoto(photo: ProgressPhoto): Promise<void> {
    return this.scope.run('openPhoto', async (owner) => {
      if (this.openPhotoId() === photo.id) {
        this.closePhoto();
        return;
      }

      this.closePhoto();
      try {
        await owner.wait(this.csrf.refresh());
        const access = await owner.wait(
          firstValueFrom(this.api.createMediaAccess(photo.mediaAssetId)),
        );
        this.openPhotoId.set(photo.id);
        this.openPhotoImage.set(mapProgressPhotoImage(photo.id, access));
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The progress photo could not be opened.`));
      }
    });
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
    return this.scope.run('loadPhotos', async (owner) => {
      if (showSpinner) {
        this.photosLoading.set(true);
      }

      try {
        const clientId = this.clientId();
        this.photos.set(
          clientId
            ? await owner.wait(firstValueFrom(this.api.getClientProgressPhotos(clientId)))
            : await owner.wait(firstValueFrom(this.api.getMyProgressPhotos())),
        );
      } catch (error) {
        if (!owner.current) return;
        this.photos.set(null);
        this.error.set(apiErrorMessage(error, $localize`Progress photos could not be loaded.`));
      } finally {
        if (owner.current) {
          this.photosLoading.set(false);
        }
      }
    });
  }

  private async runPhoto(action: () => Promise<void>, success: string): Promise<void> {
    return this.scope.run('runPhoto', async (owner) => {
      this.busy.set(true);
      this.error.set(null);
      this.notice.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(action());
        this.notice.set(success);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The progress photo could not be saved.`));
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  private async runMeasurement(action: () => Promise<void>, success: string): Promise<void> {
    return this.scope.run('runMeasurement', async (owner) => {
      this.busy.set(true);
      this.error.set(null);
      this.notice.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(action());
        this.notice.set(success);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The measurement could not be saved.`));
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  private resetTenantState(): void {
    this.loadedKey = null;
    this.progress.set(null);
    this.history.set(null);
    this.correction.set(null);
    this.measurements.set(null);
    this.measurementHistory.set(null);
    this.photos.set(null);
    this.photosLoading.set(false);
    this.openPhotoId.set(null);
    this.openPhotoImage.set(null);
    this.fullSizeRequested.set(false);
    this.loading.set(false);
    this.measurementsLoading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.displayUnit = 'Kilogram';
    this.entryUnit = 'Kilogram';
    this.entryValue = null;
    this.entryDate = '';
    this.correctingId = null;
    this.correctionValue = null;
    this.correctionUnit = 'Kilogram';
    this.correctionReason = '';
    this.redatingId = null;
    this.redateDate = '';
    this.redateReason = '';
    this.measurementDisplayUnit = 'Centimetre';
    this.measurementType = 'Waist';
    this.measurementUnit = 'Centimetre';
    this.measurementValue = null;
    this.measurementDate = '';
    this.correctingMeasurementId = null;
    this.measurementCorrectionValue = null;
    this.measurementCorrectionUnit = 'Centimetre';
    this.measurementCorrectionReason = '';
    this.photoPose = 'Front';
    this.photoDate = '';
    this.removingPhotoId = null;
    this.photoRemovalReason = '';
  }
}
