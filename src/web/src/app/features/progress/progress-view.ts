import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { RecordedMassUnit } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import type {
  BodyweightHistory,
  BodyweightObservation,
  ProgressViewModel,
} from './progress.models';

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
  protected readonly loading = signal(false);
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

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.clientId();
      const key = tenantId ? `${tenantId}:${clientId ?? 'me'}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected async changeDisplayUnit(): Promise<void> {
    await this.load();
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
    this.history.set(null);
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
}
