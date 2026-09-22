import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { formatNumber, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
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
  muscleGroupLabel,
} from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { SectionNav } from '../../ui/section-nav';
import { StatusLabel } from '../../ui/status-label';
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

/** The filters the last request actually used. Draft control values are applied only on Apply. */
interface AppliedFilters {
  query: string;
  equipment: ExerciseEquipment | '';
  movementPattern: MovementPattern | '';
  classification: ExerciseClassification | '';
  includeArchived: boolean;
}

/** One table row, owned by this screen: display labels resolved, transport shapes left behind. */
interface ExerciseRow {
  id: string;
  name: string;
  tags: string;
  movementPattern: string;
  primaryMuscle: string | null;
  equipment: string;
  classification: string;
  isArchived: boolean;
  source: ExerciseView;
}

const NO_FILTERS: AppliedFilters = {
  query: '',
  equipment: '',
  movementPattern: '',
  classification: '',
  includeArchived: false,
};

@Component({
  selector: 'app-exercise-library',
  imports: [
    Button,
    Checkbox,
    Control,
    Field,
    FormsModule,
    Icon,
    NgTemplateOutlet,
    SectionNav,
    StatusLabel,
  ],
  templateUrl: './exercise-library.html',
  styleUrls: ['./exercise-library.scss', './exercise-library.legacy.scss'],
})
export class ExerciseLibrary {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
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
  protected readonly listError = signal<string | null>(null);
  /** A media read that failed. Reported with the media it belongs to, never over the list. */
  protected readonly mediaError = signal<string | null>(null);
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
  protected readonly muscleLabel = muscleGroupLabel;

  /** What the current rows were requested with; reloads after a write repeat exactly this. */
  private readonly applied = signal<AppliedFilters>({ ...NO_FILTERS });

  protected readonly sections = [
    { label: $localize`Programs`, link: '/training/programs' },
    { label: $localize`Exercises`, link: '/training/exercises' },
  ];

  protected readonly rows = computed<ExerciseRow[]>(() =>
    this.exercises().map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      tags: exercise.tags.join(', '),
      movementPattern: movementPatternLabel(exercise.movementPattern),
      primaryMuscle: this.primaryMuscleOf(exercise),
      equipment: exerciseEquipmentLabel(exercise.equipment),
      classification: exerciseClassificationLabel(exercise.classification),
      isArchived: exercise.isArchived,
      source: exercise,
    })),
  );

  /** Every match is on screen. Otherwise the summary says how many of how many are shown. */
  protected readonly loadedAll = computed(() => this.exercises().length >= this.total());
  protected readonly totalText = computed(() => formatNumber(this.total(), this.locale, '1.0-0'));
  protected readonly loadedText = computed(() =>
    formatNumber(this.exercises().length, this.locale, '1.0-0'),
  );

  // Archive confirmation. The endpoint is called only by the dialog's own Archive exercise button.
  protected readonly pendingArchive = signal<ExerciseView | null>(null);
  protected readonly archiving = signal(false);
  /** The row whose action is waiting on the server, so only that button shows its progress. */
  protected readonly pendingRow = signal<string | null>(null);
  private archiveTrigger: HTMLElement | null = null;

  private readonly archiveDialog = viewChild<ElementRef<HTMLDialogElement>>('archiveDialog');
  private readonly archiveCancel = viewChild<ElementRef<HTMLButtonElement>>('archiveCancel');
  private readonly libraryRegion = viewChild<ElementRef<HTMLElement>>('libraryRegion');

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

  // ---------- archive and restore ----------

  /**
   * Archiving asks first. Nothing is sent from here: the dialog's own Archive exercise button is
   * the only caller of the endpoint, and Cancel or Escape returns focus to this button.
   */
  protected requestArchive(exercise: ExerciseView, event: Event): void {
    if (this.busy() || this.pendingRow() !== null) return;
    this.archiveTrigger = event.currentTarget as HTMLElement | null;
    this.pendingArchive.set(exercise);
    this.clearMessages();
    const dialog = this.archiveDialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
    // After the dialog's content has rendered, so the least destructive action holds focus.
    setTimeout(() => this.archiveCancel()?.nativeElement.focus());
  }

  /** Cancel and Escape both land here: no request, dialog closed, focus back on Archive. */
  protected cancelArchive(event?: Event): void {
    if (this.archiving()) {
      // A request is already on its way; closing now would hide its outcome.
      event?.preventDefault();
      return;
    }

    event?.preventDefault();
    this.closeArchiveDialog(true);
  }

  protected async confirmArchive(): Promise<void> {
    const exercise = this.pendingArchive();
    if (exercise === null || this.archiving()) return;
    this.archiving.set(true);
    try {
      await this.setArchived(exercise, true);
    } finally {
      // However it went, this confirmation is spent: it carries the version the list was read with,
      // and leaving it open would offer that stale version again — or, if anything escaped, leave
      // the dialog busy and uncancellable.
      this.archiving.set(false);
      this.closeArchiveDialog(false);
    }
  }

  /** Restoring is not destructive and needs no confirmation. */
  protected async restore(exercise: ExerciseView): Promise<void> {
    if (this.busy() || this.pendingRow() !== null) return;
    await this.setArchived(exercise, false);
  }

  private async setArchived(exercise: ExerciseView, isArchived: boolean): Promise<void> {
    return this.scope.run('archive', async (owner) => {
      this.pendingRow.set(exercise.id);
      this.clearMessages();
      try {
        // What the server said about the write itself, before the list is re-read.
        let outcome: 'applied' | 'conflict' | null = null;
        try {
          await owner.wait(this.csrf.refresh());
          await owner.wait(
            firstValueFrom(
              this.api.setExerciseArchived(exercise.id, {
                isArchived,
                version: numeric(exercise.version),
              }),
            ),
          );
          outcome = 'applied';
        } catch (error) {
          if (!owner.current) return;
          // Someone else changed this exercise. Nothing local is applied on top of that: the list
          // is re-read below, so the row and its version come back from the server.
          if (isConcurrencyConflict(error)) {
            outcome = 'conflict';
          } else {
            this.error.set(
              apiErrorMessage(error, $localize`The exercise-library change could not be saved.`),
            );
          }
        }

        if (outcome === null) return;

        // The announcement waits for the re-read, because both messages are claims about what the
        // list now shows. If the re-read failed, the retryable list error is the honest answer and
        // neither "archived" nor "reloaded, check it" may be said.
        const reloaded = await owner.wait(this.readList());
        if (!owner.current || !reloaded) return;
        this.notice.set(
          outcome === 'applied'
            ? isArchived
              ? $localize`Exercise archived.`
              : $localize`Exercise restored.`
            : $localize`This exercise was changed somewhere else, so nothing was applied. The list has been reloaded — check it and try again.`,
        );
      } finally {
        if (owner.current) {
          this.pendingRow.set(null);
          this.restoreFocusAfterChange(exercise.id);
        }
      }
    });
  }

  /**
   * After a reload the triggering button may be gone — an archived exercise leaves a list that
   * excludes archived ones. Focus follows the row when it is still there and falls back to the
   * library region, never to the document.
   */
  private restoreFocusAfterChange(exerciseId: string): void {
    setTimeout(() => {
      const region = this.libraryRegion()?.nativeElement;
      const row = Array.from(region?.querySelectorAll<HTMLElement>('[data-exercise]') ?? []).find(
        (candidate) => candidate.dataset['exercise'] === exerciseId,
      );
      (row?.querySelector<HTMLElement>('button') ?? region)?.focus();
    });
  }

  private closeArchiveDialog(restoreFocus: boolean): void {
    const dialog = this.archiveDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.pendingArchive.set(null);
    const trigger = this.archiveTrigger;
    this.archiveTrigger = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
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

  /** Apply, or Enter in the search field: the draft filters become the ones the server sees. */
  protected async search(): Promise<void> {
    return this.scope.run('search', async (owner) => {
      this.applied.set({
        query: this.query(),
        equipment: this.equipmentFilter(),
        movementPattern: this.patternFilter(),
        classification: this.classificationFilter(),
        includeArchived: this.includeArchived(),
      });
      this.loading.set(true);
      try {
        // A refused search is reported where the list is, and never escapes as a rejected promise
        // from a template handler that has nowhere to put it.
        await owner.wait(this.readList());
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  /**
   * Reads the list for the applied filters. Never rejects: a failure becomes the retryable list
   * error, and the rows go with it — rows fetched for other filters are not an answer to these
   * ones, and after a write they are not the current state either.
   *
   * Returns whether what is on screen is the server's answer, so a caller knows whether it may
   * announce an outcome.
   */
  private async readList(): Promise<boolean> {
    try {
      await this.loadExercises();
      return true;
    } catch (error) {
      this.exercises.set([]);
      this.total.set(0);
      this.listError.set(
        apiErrorMessage(error, $localize`The exercise library could not be loaded.`),
      );
      return false;
    }
  }

  /** Reads the editor's media. Never rejects: media belongs beside the list, not to it. */
  private async readMedia(): Promise<void> {
    try {
      await this.loadMedia();
      this.mediaError.set(null);
    } catch (error) {
      this.mediaError.set(
        apiErrorMessage(error, $localize`The media library could not be loaded.`),
      );
    }
  }

  private async load(showLoading = true): Promise<void> {
    return this.scope.run('load', async (owner) => {
      if (showLoading) {
        this.loading.set(true);
      }
      this.clearMessages();
      try {
        // Two independent reads. The exercise list is this screen; media is the editor's, and a
        // media outage must not take a list that loaded perfectly well off the screen with it.
        await owner.wait(Promise.all([this.readList(), this.readMedia()]));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private async loadExercises(): Promise<void> {
    return this.scope.run('loadExercises', async (owner) => {
      const filters = this.applied();
      const result = await owner.wait(
        firstValueFrom(
          this.api.searchExercises({
            query: filters.query,
            equipment: filters.equipment || undefined,
            movementPattern: filters.movementPattern || undefined,
            classification: filters.classification || undefined,
            includeArchived: filters.includeArchived,
          }),
        ),
      );
      this.exercises.set(result.items);
      this.total.set(numeric(result.total));
      this.listError.set(null);
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

  /**
   * Retries the failed list read with the filters that failed — the applied ones, not the drafts,
   * and the same ones whether the read failed on Apply, on the first load or after a write.
   */
  protected async retryList(): Promise<void> {
    return this.scope.run('retry', async (owner) => {
      this.loading.set(true);
      this.listError.set(null);
      try {
        await owner.wait(this.readList());
      } finally {
        if (owner.current) this.loading.set(false);
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

  private primaryMuscleOf(exercise: ExerciseView): string | null {
    const primary = exercise.muscles.find((muscle) => muscle.role === 'Primary');
    return primary === undefined ? null : muscleGroupLabel(primary.muscle);
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
    this.applied.set({ ...NO_FILTERS });
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.listError.set(null);
    this.mediaError.set(null);
    this.uploadTitle.set('');
    this.uploadFile.set(null);
    this.externalTitle.set('');
    this.externalProvider.set('YouTube');
    this.externalValue.set('');
    // A confirmation belongs to one workspace and one version. Switching workspace, signing out or
    // leaving the screen ends it without sending anything.
    this.archiving.set(false);
    this.pendingRow.set(null);
    this.closeArchiveDialog(false);
  }
}

/** A stale `version`: the exercise moved on between the list being read and the write. */
function isConcurrencyConflict(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return false;
  }

  const code = (error.error as { code?: unknown } | undefined)?.code;
  return code === undefined || code === 'concurrency_conflict';
}
