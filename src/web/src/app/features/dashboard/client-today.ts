import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ClientTrainingDayResult } from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { trainingReadAccessLabel, type UpcomingTraining } from '../training/training-read.models';

@Component({
  selector: 'app-client-today',
  imports: [DatePipe, RouterLink],
  templateUrl: './client-today.html',
  styleUrl: './client-today.scss',
})
export class ClientToday {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private generation = 0;
  protected readonly day = signal<ClientTrainingDayResult | null>(null);
  protected readonly upcoming = signal<UpcomingTraining | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly accessLabel = trainingReadAccessLabel;
  protected readonly primaryWorkout = computed(
    () =>
      this.upcoming()?.unfinishedWorkouts[0]?.workout ??
      this.day()?.workouts.find((item) => item.status !== 'Completed') ??
      this.day()?.workouts[0] ??
      null,
  );

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenant = this.tenants.selectedTenantId();
      ++this.generation;
      this.day.set(null);
      this.upcoming.set(null);
      if (tenant) void this.load();
    });
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const generation = ++this.generation;
      this.loading.set(true);
      this.error.set(false);
      try {
        const [day, upcoming] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getMyTrainingToday()),
            firstValueFrom(this.api.getMyUpcomingTraining()),
          ]),
        );
        if (generation !== this.generation) return;
        this.day.set(day);
        this.upcoming.set(upcoming);
      } catch {
        if (!owner.current) return;
        if (generation === this.generation) this.error.set(true);
      } finally {
        if (owner.current) {
          if (generation === this.generation) this.loading.set(false);
        }
      }
    });
  }

  private resetTenantState(): void {
    ++this.generation;
    this.day.set(null);
    this.upcoming.set(null);
    this.loading.set(false);
    this.error.set(false);
  }
}
