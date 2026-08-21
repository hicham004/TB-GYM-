import { Component, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  ClientExerciseView,
  ClientSetView,
  ClientTrainingDayResult,
  ClientWorkoutView,
  MediaAccessView,
} from '../../core/api/generated';
import { trainingAccessReasonLabel, workoutStatusLabel } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { nullableNumeric, numeric } from './training-builder.models';
import {
  applyWorkoutSetSave,
  applyWorkoutSetSaveToDay,
  hasLoadUnitForActualLoad,
  reconcileWorkoutSetDrafts,
  snapshotWorkoutSetDraft,
  toRecordSetRequest,
  updateWorkoutSetDraft,
  type WorkoutSetDraft,
  type WorkoutSetDrafts,
} from './workout-set-drafts';

@Component({
  selector: 'app-today-training',
  imports: [FormsModule],
  templateUrl: './today-training.html',
  styleUrl: './today-training.scss',
})
export class TodayTraining {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly tenants = inject(TenantStore);
  private loadedTenantId: string | null = null;
  private readonly workoutSaveQueues = new Map<string, Promise<void>>();
  private mediaTrigger: HTMLElement | null = null;

  protected readonly day = signal<ClientTrainingDayResult | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly activeMedia = signal<MediaAccessView | null>(null);
  protected readonly externalMediaUrl = signal<SafeResourceUrl | null>(null);
  protected readonly setDrafts = signal<WorkoutSetDrafts>({});
  protected readonly savingSetIds = signal<ReadonlySet<string>>(new Set());
  protected readonly savingWorkoutIds = signal<ReadonlySet<string>>(new Set());
  protected readonly workoutNotes: Record<string, string> = {};
  protected readonly mediaDialog = viewChild<ElementRef<HTMLElement>>('mediaDialog');
  protected readonly mediaCloseButton = viewChild<ElementRef<HTMLButtonElement>>('mediaClose');
  protected readonly accessReasonLabel = trainingAccessReasonLabel;
  protected readonly workoutStatusLabel = workoutStatusLabel;

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
    effect(() => {
      const closeButton = this.mediaCloseButton()?.nativeElement;
      if (this.activeMedia() && closeButton) {
        queueMicrotask(() => closeButton.focus());
      }
    });
  }

  protected async start(workout: ClientWorkoutView): Promise<void> {
    await this.runWrite(async () => {
      await firstValueFrom(this.api.startMyWorkout(workout.sessionId));
      await this.load(false);
      this.notice.set($localize`Workout started.`);
    });
  }

  protected async saveSet(workout: ClientWorkoutView, set: ClientSetView): Promise<void> {
    if (!workout.workoutExecutionId || !set.performanceId || workout.executionVersion === null) {
      return;
    }

    const workoutId = workout.workoutExecutionId;
    const setId = set.performanceId;
    const snapshot = snapshotWorkoutSetDraft(this.setDrafts(), setId);
    if (!snapshot || this.savingSetIds().has(setId)) {
      return;
    }
    if (!hasLoadUnitForActualLoad(snapshot, set.prescribedLoadUnit)) {
      this.error.set($localize`Select kg or lb before saving a load.`);
      return;
    }

    this.markSaving(setId, workoutId, true);
    const previous = this.workoutSaveQueues.get(workoutId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      this.clearMessages();
      try {
        await this.csrf.refresh();
        const currentWorkout = this.day()?.workouts.find(
          (item) => item.workoutExecutionId === workoutId,
        );
        if (
          currentWorkout?.executionVersion === null ||
          currentWorkout?.executionVersion === undefined
        ) {
          throw new Error('The workout version is no longer available.');
        }

        const response = await firstValueFrom(
          this.api.recordMyTrainingSet(
            workoutId,
            setId,
            toRecordSetRequest(
              snapshot,
              set.prescribedLoadUnit,
              numeric(currentWorkout.executionVersion),
            ),
          ),
        );
        this.day.update((day) => (day ? applyWorkoutSetSaveToDay(day, response) : day));
        this.setDrafts.update((drafts) => applyWorkoutSetSave(drafts, response, snapshot.revision));
        this.notice.set($localize`Set saved.`);
      } catch (error) {
        this.error.set(apiErrorMessage(error, $localize`The set could not be saved.`));
      } finally {
        this.markSaving(setId, workoutId, false);
      }
    });

    this.workoutSaveQueues.set(workoutId, operation);
    await operation;
    if (this.workoutSaveQueues.get(workoutId) === operation) {
      this.workoutSaveQueues.delete(workoutId);
    }
  }

  protected setDraft(set: ClientSetView): WorkoutSetDraft | null {
    return set.performanceId ? (this.setDrafts()[set.performanceId] ?? null) : null;
  }

  protected updateSetDraft(
    set: ClientSetView,
    changes: Partial<Omit<WorkoutSetDraft, 'revision' | 'dirty'>>,
  ): void {
    if (!set.performanceId) {
      return;
    }
    this.setDrafts.update((drafts) => updateWorkoutSetDraft(drafts, set.performanceId!, changes));
  }

  protected isWorkoutSaving(workout: ClientWorkoutView): boolean {
    return Boolean(
      workout.workoutExecutionId && this.savingWorkoutIds().has(workout.workoutExecutionId),
    );
  }

  protected hasUnsavedSets(workout: ClientWorkoutView): boolean {
    return workout.exercises.some((exercise) =>
      exercise.sets.some((set) => set.performanceId && this.setDrafts()[set.performanceId]?.dirty),
    );
  }

  protected async substitute(
    workout: ClientWorkoutView,
    exercise: ClientExerciseView,
    event: Event,
  ): Promise<void> {
    const exerciseId = (event.target as HTMLSelectElement).value;
    if (
      !exerciseId ||
      !workout.workoutExecutionId ||
      !exercise.performanceId ||
      workout.executionVersion === null
    ) {
      return;
    }
    const workoutId = workout.workoutExecutionId;
    await this.workoutSaveQueues.get(workoutId);
    const currentWorkout = this.day()?.workouts.find(
      (item) => item.workoutExecutionId === workoutId,
    );
    if (
      currentWorkout?.executionVersion === null ||
      currentWorkout?.executionVersion === undefined
    ) {
      return;
    }
    await this.runWrite(async () => {
      await firstValueFrom(
        this.api.substituteMyTrainingExercise(workoutId, exercise.performanceId!, {
          exerciseId,
          version: numeric(currentWorkout.executionVersion!),
        }),
      );
      await this.load(false);
      this.notice.set($localize`Approved substitution recorded.`);
    });
  }

  protected async addNote(workout: ClientWorkoutView): Promise<void> {
    const text = this.workoutNotes[workout.sessionId]?.trim();
    if (!workout.workoutExecutionId || !text) {
      return;
    }
    await this.runWrite(async () => {
      await firstValueFrom(
        this.api.addWorkoutNote(workout.workoutExecutionId!, {
          exercisePerformanceId: null,
          text,
        }),
      );
      this.workoutNotes[workout.sessionId] = '';
      await this.load(false);
      this.notice.set($localize`Workout note added.`);
    });
  }

  protected async complete(workout: ClientWorkoutView): Promise<void> {
    if (!workout.workoutExecutionId || workout.executionVersion === null) {
      return;
    }
    if (this.hasUnsavedSets(workout) || this.isWorkoutSaving(workout)) {
      this.error.set($localize`Save every edited set before completing the workout.`);
      return;
    }
    await this.runWrite(async () => {
      await firstValueFrom(
        this.api.completeMyWorkout(workout.workoutExecutionId!, {
          version: numeric(workout.executionVersion!),
        }),
      );
      await this.load(false);
      this.notice.set($localize`Workout completed.`);
    });
  }

  protected async showMedia(assetId: string, event: Event): Promise<void> {
    const trigger = event.currentTarget as HTMLElement | null;
    this.busy.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      const access = await firstValueFrom(this.api.createMediaAccess(assetId));
      this.mediaTrigger = trigger;
      this.activeMedia.set(access);
      this.externalMediaUrl.set(
        access.source === 'ExternalEmbed'
          ? this.sanitizer.bypassSecurityTrustResourceUrl(access.url)
          : null,
      );
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Exercise media could not be opened.`));
    } finally {
      this.busy.set(false);
    }
  }

  protected closeMedia(): void {
    this.activeMedia.set(null);
    this.externalMediaUrl.set(null);
    const trigger = this.mediaTrigger;
    this.mediaTrigger = null;
    setTimeout(() => trigger?.focus());
  }

  protected mediaDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMedia();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const dialog = this.mediaDialog()?.nativeElement;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], iframe',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected prescribedReps(set: ClientSetView): string {
    const minimum = nullableNumeric(set.prescribedRepetitionsMinimum);
    const maximum = nullableNumeric(set.prescribedRepetitionsMaximum);
    if (minimum === null && maximum === null) {
      return '-';
    }
    if (minimum === null) {
      return `${maximum}`;
    }
    return minimum === maximum || maximum === null ? `${minimum}` : `${minimum}-${maximum}`;
  }

  protected prescribedEffort(set: ClientSetView): string {
    if (set.prescribedTargetRpe !== null) {
      return `RPE ${numeric(set.prescribedTargetRpe)}`;
    }
    if (set.prescribedTargetRir !== null) {
      return `RIR ${numeric(set.prescribedTargetRir)}`;
    }
    return '-';
  }

  private async load(showLoading = true): Promise<void> {
    if (showLoading) {
      this.loading.set(true);
    }
    this.clearMessages();
    try {
      const day = await firstValueFrom(this.api.getMyTrainingToday());
      this.day.set(day);
      this.setDrafts.update((drafts) => reconcileWorkoutSetDrafts(day, drafts));
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Today's training could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async runWrite(command: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      await command();
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The workout change could not be saved.`));
    } finally {
      this.busy.set(false);
    }
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  private markSaving(setId: string, workoutId: string, saving: boolean): void {
    this.savingSetIds.update((ids) => {
      const next = new Set(ids);
      if (saving) {
        next.add(setId);
      } else {
        next.delete(setId);
      }
      return next;
    });
    this.savingWorkoutIds.update((ids) => {
      const next = new Set(ids);
      const workoutStillSaving =
        saving ||
        this.day()
          ?.workouts.find((workout) => workout.workoutExecutionId === workoutId)
          ?.exercises.some((exercise) =>
            exercise.sets.some(
              (set) => set.performanceId && this.savingSetIds().has(set.performanceId),
            ),
          );
      if (workoutStillSaving) {
        next.add(workoutId);
      } else {
        next.delete(workoutId);
      }
      return next;
    });
  }
}
