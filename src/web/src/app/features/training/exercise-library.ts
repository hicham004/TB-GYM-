import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CreateExerciseRequest,
  ExerciseClassification,
  ExerciseEquipment,
  ExerciseView,
  ExternalMediaProvider,
  MediaAssetView,
  MovementPattern,
  MuscleGroup,
} from '../../core/api/generated';
import {
  exerciseClassificationLabel,
  exerciseEquipmentLabel,
  mediaKindLabel,
  mediaSourceLabel,
  mediaStatusLabel,
  movementPatternLabel,
} from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { numeric } from './training-builder.models';

interface ExerciseEditor {
  id: string | null;
  version: number | null;
  name: string;
  instructions: string;
  equipment: ExerciseEquipment;
  movementPattern: MovementPattern;
  classification: ExerciseClassification;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  tags: string;
  alternativeIds: string[];
  mediaAssetIds: string[];
}

@Component({
  selector: 'app-exercise-library',
  imports: [FormsModule],
  templateUrl: './exercise-library.html',
  styleUrl: './exercise-library.scss',
})
export class ExerciseLibrary {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedTenantId: string | null = null;

  protected readonly exercises = signal<ExerciseView[]>([]);
  protected readonly total = signal(0);
  protected readonly media = signal<MediaAssetView[]>([]);
  protected readonly mediaTotal = signal(0);
  protected readonly editor = signal<ExerciseEditor | null>(null);
  protected readonly query = signal('');
  protected readonly equipmentFilter = signal<ExerciseEquipment | ''>('');
  protected readonly patternFilter = signal<MovementPattern | ''>('');
  protected readonly classificationFilter = signal<ExerciseClassification | ''>('');
  protected readonly includeArchived = signal(false);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly uploadTitle = signal('');
  protected readonly uploadFile = signal<File | null>(null);
  protected readonly externalTitle = signal('');
  protected readonly externalProvider = signal<ExternalMediaProvider>('YouTube');
  protected readonly externalValue = signal('');
  protected readonly classificationLabel = exerciseClassificationLabel;
  protected readonly equipmentLabel = exerciseEquipmentLabel;
  protected readonly kindLabel = mediaKindLabel;
  protected readonly mediaSourceLabel = mediaSourceLabel;
  protected readonly mediaStatusLabel = mediaStatusLabel;
  protected readonly patternLabel = movementPatternLabel;

  protected readonly equipment: ExerciseEquipment[] = [
    'None',
    'Barbell',
    'Dumbbell',
    'Kettlebell',
    'Machine',
    'Cable',
    'Band',
    'Bodyweight',
    'SpecialtyBar',
    'Other',
  ];
  protected readonly patterns: MovementPattern[] = [
    'Squat',
    'Hinge',
    'HorizontalPush',
    'VerticalPush',
    'HorizontalPull',
    'VerticalPull',
    'Carry',
    'Rotation',
    'Locomotion',
    'Isolation',
    'Mobility',
    'Other',
  ];
  protected readonly classifications: ExerciseClassification[] = [
    'Strength',
    'General',
    'Mobility',
    'Conditioning',
  ];
  protected readonly muscles: MuscleGroup[] = [
    'Chest',
    'Back',
    'Shoulders',
    'Biceps',
    'Triceps',
    'Forearms',
    'Quadriceps',
    'Hamstrings',
    'Glutes',
    'Calves',
    'Abdominals',
    'Adductors',
    'Abductors',
    'FullBody',
    'Other',
  ];

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  protected newExercise(): void {
    this.editor.set({
      id: null,
      version: null,
      name: '',
      instructions: '',
      equipment: 'Barbell',
      movementPattern: 'Other',
      classification: 'Strength',
      primaryMuscle: 'FullBody',
      secondaryMuscles: [],
      tags: '',
      alternativeIds: [],
      mediaAssetIds: [],
    });
    this.clearMessages();
  }

  protected edit(exercise: ExerciseView): void {
    this.editor.set({
      id: exercise.id,
      version: numeric(exercise.version),
      name: exercise.name,
      instructions: exercise.instructions ?? '',
      equipment: exercise.equipment,
      movementPattern: exercise.movementPattern,
      classification: exercise.classification,
      primaryMuscle:
        exercise.muscles.find((muscle) => muscle.role === 'Primary')?.muscle ?? 'FullBody',
      secondaryMuscles: exercise.muscles
        .filter((muscle) => muscle.role === 'Secondary')
        .map((muscle) => muscle.muscle),
      tags: exercise.tags.join(', '),
      alternativeIds: exercise.alternatives.map((item) => item.exerciseId),
      mediaAssetIds: [...exercise.mediaAssetIds],
    });
    this.clearMessages();
  }

  protected async save(): Promise<void> {
    return this.scope.run('save', async (owner) => {
      const editor = this.editor();
      if (!editor?.name.trim()) {
        this.error.set($localize`Exercise name is required.`);
        return;
      }

      const request: CreateExerciseRequest = {
        name: editor.name.trim(),
        instructions: editor.instructions.trim() || null,
        equipment: editor.equipment,
        movementPattern: editor.movementPattern,
        classification: editor.classification,
        muscles: [
          { muscle: editor.primaryMuscle, role: 'Primary' },
          ...editor.secondaryMuscles
            .filter((muscle) => muscle !== editor.primaryMuscle)
            .map((muscle) => ({ muscle, role: 'Secondary' as const })),
        ],
        tags: editor.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag, index, tags) => tag.length > 0 && tags.indexOf(tag) === index),
        alternatives: editor.alternativeIds.map((exerciseId) => ({ exerciseId, note: null })),
        mediaAssetIds: editor.mediaAssetIds,
      };

      await owner.wait(
        this.runWrite(async () => {
          if (editor.id && editor.version !== null) {
            await owner.wait(
              firstValueFrom(
                this.api.updateExercise(editor.id, { ...request, version: editor.version }),
              ),
            );
          } else {
            await owner.wait(firstValueFrom(this.api.createExercise(request)));
          }
          this.editor.set(null);
          await owner.wait(this.load(false));
          this.notice.set($localize`Exercise saved.`);
        }),
      );
    });
  }

  protected async toggleArchive(exercise: ExerciseView): Promise<void> {
    return this.scope.run('toggleArchive', async (owner) => {
      await owner.wait(
        this.runWrite(async () => {
          await owner.wait(
            firstValueFrom(
              this.api.setExerciseArchived(exercise.id, {
                isArchived: !exercise.isArchived,
                version: numeric(exercise.version),
              }),
            ),
          );
          await owner.wait(this.load(false));
          this.notice.set(
            exercise.isArchived ? $localize`Exercise restored.` : $localize`Exercise archived.`,
          );
        }),
      );
    });
  }

  protected fileSelected(event: Event): void {
    this.uploadFile.set((event.target as HTMLInputElement).files?.item(0) ?? null);
  }

  protected async upload(): Promise<void> {
    return this.scope.run('upload', async (owner) => {
      const file = this.uploadFile();
      if (!file) {
        this.error.set($localize`Choose an image or video.`);
        return;
      }
      await owner.wait(
        this.runWrite(async () => {
          await owner.wait(
            firstValueFrom(this.api.uploadMedia(this.uploadTitle().trim() || file.name, file)),
          );
          this.uploadFile.set(null);
          this.uploadTitle.set('');
          await owner.wait(this.loadMedia());
          this.notice.set($localize`Protected media uploaded.`);
        }),
      );
    });
  }

  protected async registerExternal(): Promise<void> {
    return this.scope.run('registerExternal', async (owner) => {
      const mediaId = this.externalMediaId(this.externalValue(), this.externalProvider());
      if (!this.externalTitle().trim() || !mediaId) {
        this.error.set($localize`Media title and a valid provider ID or URL are required.`);
        return;
      }
      await owner.wait(
        this.runWrite(async () => {
          await owner.wait(
            firstValueFrom(
              this.api.registerExternalMedia({
                title: this.externalTitle().trim(),
                provider: this.externalProvider(),
                externalMediaId: mediaId,
              }),
            ),
          );
          this.externalTitle.set('');
          this.externalValue.set('');
          await owner.wait(this.loadMedia());
          this.notice.set($localize`External media registered.`);
        }),
      );
    });
  }

  protected async deleteMedia(asset: MediaAssetView): Promise<void> {
    return this.scope.run('deleteMedia', async (owner) => {
      await owner.wait(
        this.runWrite(async () => {
          await owner.wait(
            firstValueFrom(this.api.deleteMedia(asset.id, { version: numeric(asset.version) })),
          );
          await owner.wait(this.loadMedia());
          this.notice.set($localize`Media deleted.`);
        }),
      );
    });
  }

  protected async search(): Promise<void> {
    return this.scope.run('search', async (owner) => {
      await owner.wait(this.loadExercises());
    });
  }

  private async load(showLoading = true): Promise<void> {
    return this.scope.run('load', async (owner) => {
      if (showLoading) {
        this.loading.set(true);
      }
      this.clearMessages();
      try {
        await owner.wait(Promise.all([this.loadExercises(), this.loadMedia()]));
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          apiErrorMessage(error, $localize`The exercise library could not be loaded.`),
        );
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private async loadExercises(): Promise<void> {
    return this.scope.run('loadExercises', async (owner) => {
      const result = await owner.wait(
        firstValueFrom(
          this.api.searchExercises({
            query: this.query(),
            equipment: this.equipmentFilter() || undefined,
            movementPattern: this.patternFilter() || undefined,
            classification: this.classificationFilter() || undefined,
            includeArchived: this.includeArchived(),
          }),
        ),
      );
      this.exercises.set(result.items);
      this.total.set(numeric(result.total));
    });
  }

  private async loadMedia(): Promise<void> {
    return this.scope.run('media', async (owner) => {
      const page = await owner.wait(firstValueFrom(this.api.listMedia()));
      this.media.set(page.items);
      this.mediaTotal.set(numeric(page.total));
    });
  }

  protected async loadMoreMedia(): Promise<void> {
    return this.scope.run('media', async (owner) => {
      if (this.media().length >= this.mediaTotal()) {
        return;
      }
      this.busy.set(true);
      try {
        const page = await owner.wait(firstValueFrom(this.api.listMedia(this.media().length)));
        this.media.update((items) => [...items, ...page.items]);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`More media could not be loaded.`));
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  private async runWrite(command: () => Promise<void>): Promise<void> {
    return this.scope.run('runWrite', async (owner) => {
      this.busy.set(true);
      this.clearMessages();
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(command());
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          apiErrorMessage(error, $localize`The exercise-library change could not be saved.`),
        );
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  private externalMediaId(value: string, provider: ExternalMediaProvider): string {
    const trimmed = value.trim();
    if (!trimmed.includes('/')) {
      return trimmed;
    }
    try {
      const url = new URL(trimmed);
      if (provider === 'YouTube') {
        return url.hostname.includes('youtu.be')
          ? (url.pathname.split('/').filter(Boolean)[0] ?? '')
          : (url.searchParams.get('v') ?? url.pathname.split('/').filter(Boolean).at(-1) ?? '');
      }
      return url.pathname.split('/').filter(Boolean).at(-1) ?? '';
    } catch {
      return '';
    }
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    this.exercises.set([]);
    this.total.set(0);
    this.media.set([]);
    this.mediaTotal.set(0);
    this.editor.set(null);
    this.query.set('');
    this.equipmentFilter.set('');
    this.patternFilter.set('');
    this.classificationFilter.set('');
    this.includeArchived.set(false);
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.uploadTitle.set('');
    this.uploadFile.set(null);
    this.externalTitle.set('');
    this.externalProvider.set('YouTube');
    this.externalValue.set('');
  }
}
