import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ExerciseView, MediaAssetView, MuscleGroup } from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import {
  exerciseClassificationLabel,
  exerciseEquipmentLabel,
  movementPatternLabel,
  muscleGroupLabel,
} from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { Icon } from '../../ui/icon';
import { selectOptions, UiSelect } from '../../ui/select';
import { ExerciseLibraryApi } from './exercise-library-api';
import {
  EQUIPMENT,
  emptyExercise,
  exerciseErrors,
  exerciseRequest,
  exerciseWriteError,
  type ExerciseValues,
  type FieldMessages,
  isStaleWrite,
  type LibraryFilters,
  mediaLine,
  MUSCLES,
  parseVideoLink,
  PATTERNS,
  staleExerciseMessage,
  TYPES,
  valuesFrom,
} from './exercise-library.models';

/**
 * New exercise and Edit, in one sheet (C10, R5.1b). A new exercise asks first for what most coaches
 * add (TrueCoach asks for a name and a video link): the name, a YouTube or Vimeo link, and what it
 * trains; More details holds the rest. A link is added to the coach's media on save and shown with
 * the exercise; an upload is added at once. Only ready media can be shown with an exercise, which an
 * upload is once it returns (it is scanned inside the request, MED-006).
 */
@Component({
  selector: 'app-exercise-sheet',
  imports: [Button, Checkbox, Control, Field, FormSummary, Icon, UiSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <app-field [label]="nameLabel" [errors]="shows('name') ? errors()['name'] : null">
        <input
          appControl
          name="exercise-name"
          autocomplete="off"
          maxlength="160"
          [value]="values().name"
          (input)="set({ name: $any($event.target).value })"
          (blur)="attempt.touch('name')"
        />
      </app-field>

      <app-field
        [label]="videoLabel"
        [help]="videoHelp()"
        [errors]="shows('videoLink') ? errors()['videoLink'] : null"
      >
        <input
          appControl
          name="video-link"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="youtube.com/watch?v=…"
          i18n-placeholder
          [value]="values().videoLink"
          (input)="set({ videoLink: $any($event.target).value })"
          (blur)="attempt.touch('videoLink')"
        />
      </app-field>

      <div class="grid">
        <app-select
          [label]="typeLabel"
          [options]="typeOptions"
          [value]="values().classification"
          (valueChange)="set({ classification: $any($event) })"
        />
        <app-select
          [label]="muscleLabel"
          [options]="muscleOptions"
          [value]="values().primaryMuscle"
          (valueChange)="setPrimary($any($event))"
        />
        <app-select
          [label]="patternLabel"
          [options]="patternOptions"
          [value]="values().pattern"
          (valueChange)="set({ pattern: $any($event) })"
        />
        <app-select
          [label]="equipmentLabel"
          [options]="equipmentOptions"
          [value]="values().equipment"
          (valueChange)="set({ equipment: $any($event) })"
        />
      </div>

      @if (!detailsOpen()) {
        <button
          appButton
          type="button"
          variant="text"
          class="more"
          [attr.aria-expanded]="false"
          (click)="openDetails()"
        >
          <app-icon name="plus" />
          <span i18n>More details</span>
        </button>
      } @else {
        <app-field
          [label]="instructionsLabel"
          [help]="instructionsHelp"
          [errors]="shows('instructions') ? errors()['instructions'] : null"
        >
          <textarea
            appControl
            name="instructions"
            rows="4"
            maxlength="8000"
            [value]="values().instructions"
            (input)="set({ instructions: $any($event.target).value })"
            (blur)="attempt.touch('instructions')"
          ></textarea>
        </app-field>

        <fieldset class="group">
          <legend i18n>Also works</legend>
          <div class="checks">
            @for (item of muscles; track item) {
              @if (item !== values().primaryMuscle) {
                <app-checkbox [label]="muscleName(item)">
                  <input
                    appControl
                    type="checkbox"
                    [checked]="values().secondaryMuscles.includes(item)"
                    (change)="toggleSecondary(item, $any($event.target).checked)"
                  />
                </app-checkbox>
              }
            }
          </div>
        </fieldset>

        <app-field
          [label]="tagsLabel"
          [help]="tagsHelp"
          [errors]="shows('tags') ? errors()['tags'] : null"
        >
          <input
            appControl
            name="tags"
            autocomplete="off"
            [value]="values().tags"
            (input)="set({ tags: $any($event.target).value })"
            (blur)="attempt.touch('tags')"
          />
        </app-field>

        <fieldset class="group">
          <legend i18n>Swaps a client may make</legend>
          <p class="muted" i18n>When a program allows a swap, the client chooses from these.</p>
          @if (searchable() || find()) {
            <app-field [label]="findLabel" hideLabel>
              <input
                appControl
                type="search"
                name="find-alternative"
                autocomplete="off"
                [placeholder]="findPlaceholder"
                [value]="find()"
                (input)="searchAlternatives($any($event.target).value)"
              />
            </app-field>
          }
          @for (id of unresolvedAlternatives(); track id) {
            <app-checkbox label="Previously selected exercise (unavailable)" i18n-label>
              <input
                appControl
                type="checkbox"
                [checked]="true"
                (change)="toggleAlternative(id, false)"
              />
            </app-checkbox>
          }
          @if (alternativesError(); as message) {
            <p role="alert">{{ message }}</p>
            <button appButton type="button" variant="text" (click)="loadAlternatives()" i18n>
              Try again
            </button>
          }
          @if (alternativesMore()) {
            <button
              appButton
              type="button"
              variant="text"
              [loading]="alternativesBusy()"
              (click)="loadAlternatives(true)"
              i18n
            >
              Show more exercises
            </button>
          }
          <div class="scroll" tabindex="0" [attr.aria-label]="alternativesLabel">
            @for (other of shownOthers(); track other.id) {
              <app-checkbox [label]="other.name">
                <input
                  appControl
                  type="checkbox"
                  [checked]="values().alternativeIds.includes(other.id)"
                  (change)="toggleAlternative(other.id, $any($event.target).checked)"
                />
              </app-checkbox>
            } @empty {
              <p class="muted" i18n>No other exercise matches.</p>
            }
          </div>
        </fieldset>

        <fieldset class="group">
          <legend i18n>Pictures and videos</legend>
          @if (mediaError(); as message) {
            <p class="problem-text" role="alert">{{ message }}</p>
          }
          @if (library().length === 0) {
            <p class="muted" i18n>
              Nothing in your media yet. Paste a video link above, or upload a picture or video.
            </p>
          } @else {
            <ul class="media" role="list">
              @for (asset of library(); track asset.id) {
                <li class="media-row">
                  <app-checkbox [label]="asset.title">
                    <input
                      appControl
                      type="checkbox"
                      [checked]="values().mediaAssetIds.includes(asset.id)"
                      (change)="toggleMedia(asset.id, $any($event.target).checked)"
                    />
                  </app-checkbox>
                  <span class="media-kind">{{ line(asset) }}</span>
                  @if (!values().mediaAssetIds.includes(asset.id)) {
                    @if (deleting() === asset.id) {
                      <span class="confirm" role="group" [attr.aria-label]="deleteGroupLabel">
                        <span i18n>Delete it from your media?</span>
                        <button
                          appButton
                          type="button"
                          variant="text"
                          (click)="deleting.set(null)"
                          i18n
                        >
                          Keep
                        </button>
                        <button
                          appButton
                          type="button"
                          variant="outlined"
                          [loading]="mediaBusy()"
                          (click)="deleteMedia(asset)"
                          i18n
                        >
                          Delete
                        </button>
                      </span>
                    } @else {
                      <button
                        appButton
                        type="button"
                        variant="text"
                        class="delete"
                        [attr.aria-label]="deleteLabel(asset)"
                        (click)="deleting.set(asset.id)"
                        i18n
                      >
                        Delete
                      </button>
                    }
                  }
                </li>
              }
            </ul>
          }
          <label class="upload" [class.busy]="uploading()">
            <input
              type="file"
              class="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              [disabled]="uploading()"
              (change)="upload($event)"
            />
            <app-icon name="camera" />
            @if (uploading()) {
              <ng-container i18n>Uploading…</ng-container>
            } @else {
              <ng-container i18n>Upload a picture or video</ng-container>
            }
          </label>
        </fieldset>
      }

      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problemCount() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(null)" i18n>
          Not now
        </button>
        <button appButton type="submit" [loading]="busy()" [disabled]="uploading()">
          @if (busy()) {
            <ng-container i18n>Saving…</ng-container>
          } @else if (exercise()) {
            <ng-container i18n>Save exercise</ng-container>
          } @else {
            <app-icon name="plus" />
            <ng-container i18n>Add exercise</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles: `
    :host {
      display: block;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    p {
      color: var(--tb-ink);
      margin: 0;
      overflow-wrap: anywhere;
    }

    .muted {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }

    .grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    }

    .more {
      align-self: flex-start;
    }

    .group {
      border: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    .group legend {
      color: var(--tb-ink);
      font-weight: 600;
      margin-block-end: 0.5rem;
      padding: 0;
    }

    .checks {
      display: grid;
      gap: 0.125rem 1rem;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr));
    }

    .scroll {
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-control);
      display: flex;
      flex-direction: column;
      max-block-size: 13rem;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0.25rem 0.75rem;
    }

    .scroll:focus-visible {
      outline: 2px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .media {
      display: flex;
      flex-direction: column;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .media-row {
      align-items: center;
      border-block-end: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: 0 0.75rem;
      padding-block: 0.25rem;
    }

    .media-row app-checkbox {
      flex: 1 1 12rem;
      min-inline-size: 0;
    }

    .media-kind {
      color: var(--tb-muted);
      font-size: 0.8125rem;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .confirm {
      align-items: center;
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.5rem;
      font-size: 0.875rem;
    }

    .upload {
      align-items: center;
      align-self: flex-start;
      border: 1px dashed var(--tb-line-strong);
      border-radius: var(--tb-radius-control);
      color: var(--tb-accent-ink);
      cursor: pointer;
      display: inline-flex;
      font-weight: 600;
      gap: 0.5rem;
      min-block-size: 2.75rem;
      padding: 0.5rem 1rem;
      position: relative;
    }

    .upload:hover {
      border-color: var(--tb-accent-ink);
    }

    .upload:focus-within {
      outline: 2px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .upload.busy {
      color: var(--tb-muted);
      cursor: progress;
    }

    // The native input stays in the label, invisible, so the whole label opens the file picker.
    .file {
      block-size: 1px;
      inline-size: 1px;
      opacity: 0;
      position: absolute;
    }

    .problem-text {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-control);
      color: var(--tb-danger);
      font-weight: 600;
      padding: 0.625rem 0.875rem;
    }

    .actions {
      background: var(--tb-surface);
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      inset-block-end: -1.5rem;
      justify-content: flex-end;
      margin-block-end: -1.5rem;
      margin-inline: -1.5rem;
      padding: 0.75rem 1.5rem;
      position: sticky;
    }

    input,
    textarea {
      scroll-margin-block-end: 5rem;
    }
  `,
})
export class ExerciseSheet implements OnInit {
  private readonly api = inject(ExerciseLibraryApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild(FormSummary);

  /** The exercise being edited; null for a new one. */
  readonly exercise = input<ExerciseView | null>(null);
  /** The library's filters, so a new exercise starts as what the coach was looking at. */
  readonly filters = input<LibraryFilters | null>(null);
  /** The saved exercise, or null when the coach closed the sheet without saving. */
  readonly closed = output<ExerciseView | null>();
  readonly dirtyChange = output<boolean>();
  /** The sheet read a newer copy of the exercise, so the library behind it should read again (WEA-3). */
  readonly reloaded = output<void>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly typeOptions = selectOptions(TYPES, exerciseClassificationLabel);
  protected readonly muscleOptions = selectOptions(MUSCLES, muscleGroupLabel);
  protected readonly patternOptions = selectOptions(PATTERNS, movementPatternLabel);
  protected readonly equipmentOptions = selectOptions(EQUIPMENT, exerciseEquipmentLabel);
  protected readonly muscles = MUSCLES;
  protected readonly muscleName = muscleGroupLabel;
  protected readonly line = mediaLine;

  protected readonly nameLabel = $localize`Exercise name`;
  protected readonly videoLabel = $localize`Video link (optional)`;
  protected readonly typeLabel = $localize`Type`;
  protected readonly muscleLabel = $localize`Main muscle`;
  protected readonly patternLabel = $localize`Movement pattern`;
  protected readonly equipmentLabel = $localize`Equipment`;
  protected readonly instructionsLabel = $localize`How to do it`;
  protected readonly instructionsHelp = $localize`Clients read this in their workout, beside the demo.`;
  protected readonly tagsLabel = $localize`Tags`;
  protected readonly tagsHelp = $localize`Separate them with commas, like knee-friendly, home.`;
  protected readonly findLabel = $localize`Find an exercise`;
  protected readonly findPlaceholder = $localize`Find an exercise…`;
  protected readonly alternativesLabel = $localize`Exercises a client may swap to`;
  protected readonly deleteGroupLabel = $localize`Delete from your media`;

  /** The exercise as last read: the one opened, or the saved copy read again after a stale save (WEA-3). */
  private readonly current = linkedSignal<ExerciseView | null>(() => this.exercise());
  protected readonly values = linkedSignal<ExerciseValues>(() => {
    const exercise = this.current();
    return exercise ? valuesFrom(exercise) : emptyExercise(this.filters() ?? undefined);
  });
  /** Editing shows every field; a new exercise starts with the few most coaches fill in. */
  protected readonly detailsOpen = linkedSignal(() => this.exercise() !== null);
  protected readonly others = signal<ExerciseView[]>([]);
  /**
   * A library of more than eight exercises gets a search box. Decided from the whole library, not
   * the rows on screen: a search empties those rows while it runs, and the box must not go with them.
   */
  protected readonly searchable = signal(false);
  private readonly knownAlternatives = signal<ReadonlyMap<string, ExerciseView>>(new Map());
  protected readonly alternativesBusy = signal(false);
  protected readonly alternativesMore = signal(false);
  protected readonly alternativesError = signal<string | null>(null);
  private alternativesOffset = 0;
  protected readonly find = signal('');
  protected readonly library = signal<MediaAssetView[]>([]);
  protected readonly mediaError = signal<string | null>(null);
  protected readonly mediaBusy = signal(false);
  protected readonly uploading = signal(false);
  protected readonly deleting = signal<string | null>(null);
  /** A link already added to the coach's media by a save that then failed, so a retry reuses it. */
  private registered: { link: string; id: string } | null = null;
  private loaded = false;

  protected readonly errors = computed<FieldMessages>(() => exerciseErrors(this.values()));
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);
  // A link opens on its own site from the workout (C18); only an upload plays inside TB Gym.
  protected readonly videoHelp = computed(() => {
    const link = parseVideoLink(this.values().videoLink);
    return link
      ? $localize`${link.provider}:provider: video found. Clients open it on ${link.provider}:provider: from their workout.`
      : $localize`Paste a YouTube or Vimeo link. Clients open it on that site from their workout.`;
  });
  protected readonly shownOthers = computed(() => {
    const selected = this.values().alternativeIds;
    const known = this.knownAlternatives();
    const rows = new Map(this.others().map((item) => [item.id, item]));
    for (const id of selected) {
      if (known.has(id)) rows.set(id, known.get(id)!);
    }
    return [...rows.values()].sort(
      (a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)),
    );
  });

  protected readonly unresolvedAlternatives = computed(() =>
    this.values().alternativeIds.filter((id) => !this.knownAlternatives().has(id)),
  );

  protected searchAlternatives(query: string): void {
    this.find.set(query);
    this.others.set([]);
    this.alternativesOffset = 0;
    void this.loadAlternatives();
  }

  protected loadAlternatives(more = false): Promise<void> {
    return this.scope.run('alternatives', async (owner) => {
      const query = this.find();
      const skip = more ? this.alternativesOffset : 0;
      this.alternativesBusy.set(true);
      this.alternativesError.set(null);
      try {
        const page = await owner.wait(firstValueFrom(this.api.search({ query, skip, take: 25 })));
        if (!query) this.searchable.set(Number(page.total) > 8);
        const eligible = page.items.filter(
          (item) => item.id !== this.exercise()?.id && !item.isArchived,
        );
        this.knownAlternatives.update(
          (known) => new Map([...known, ...eligible.map((item) => [item.id, item] as const)]),
        );
        this.others.update((rows) => [
          ...new Map([...(more ? rows : []), ...eligible].map((item) => [item.id, item])).values(),
        ]);
        this.alternativesOffset = skip + page.items.length;
        this.alternativesMore.set(
          page.items.length > 0 && this.alternativesOffset < Number(page.total),
        );
      } catch {
        if (!owner.current) return;
        this.alternativesError.set($localize`Exercises could not be loaded. Try again.`);
      } finally {
        if (owner.current) this.alternativesBusy.set(false);
      }
    });
  }

  ngOnInit(): void {
    if (this.detailsOpen()) void this.loadDetails();
  }

  protected set(change: Partial<ExerciseValues>): void {
    this.values.update((values) => ({ ...values, ...change }));
    this.dirtyChange.emit(true);
  }

  protected setPrimary(muscle: MuscleGroup): void {
    this.set({
      primaryMuscle: muscle,
      secondaryMuscles: this.values().secondaryMuscles.filter((item) => item !== muscle),
    });
  }

  protected toggleSecondary(muscle: MuscleGroup, on: boolean): void {
    const rest = this.values().secondaryMuscles.filter((item) => item !== muscle);
    this.set({ secondaryMuscles: on ? [...rest, muscle] : rest });
  }

  protected toggleAlternative(id: string, on: boolean): void {
    const rest = this.values().alternativeIds.filter((item) => item !== id);
    this.set({ alternativeIds: on ? [...rest, id] : rest });
  }

  protected toggleMedia(id: string, on: boolean): void {
    const rest = this.values().mediaAssetIds.filter((item) => item !== id);
    this.set({ mediaAssetIds: on ? [...rest, id] : rest });
  }

  protected openDetails(): void {
    this.detailsOpen.set(true);
    void this.loadDetails();
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>('textarea[name="instructions"]')
          ?.focus(),
      { injector: this.injector },
    );
  }

  protected deleteLabel(asset: MediaAssetView): string {
    return $localize`Delete ${asset.title}:title: from your media`;
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  /** The other exercises (for swaps) and the coach's ready media, read once when details open. */
  private async loadDetails(): Promise<void> {
    return this.scope.run('loadDetails', async (owner) => {
      if (this.loaded) return;
      this.loaded = true;
      try {
        const ids = this.values().alternativeIds;
        const [media, selected] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.listMedia()),
            Promise.all(ids.map((id) => firstValueFrom(this.api.get(id)).catch(() => null))),
            this.loadAlternatives(),
          ]),
        );
        this.knownAlternatives.update(
          (known) =>
            new Map([
              ...known,
              ...selected
                .filter((item): item is ExerciseView => item !== null)
                .map((item) => [item.id, item] as const),
            ]),
        );
        this.library.set(media.items.filter((item) => item.status === 'Ready'));
      } catch {
        if (!owner.current) return;
        this.mediaError.set(
          $localize`Your media and other exercises could not be loaded. Close and open the sheet again.`,
        );
      }
    });
  }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    input.value = '';
    if (!file || this.uploading()) return;
    return this.scope.run('upload', async (owner) => {
      this.uploading.set(true);
      this.mediaError.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const title = this.values().name.trim() || file.name;
        const asset = await owner.wait(firstValueFrom(this.api.uploadMedia(title, file)));
        this.library.update((items) => [asset, ...items]);
        if (asset.status === 'Ready') this.toggleMedia(asset.id, true);
      } catch (error) {
        if (!owner.current) return;
        this.mediaError.set(
          exerciseWriteError(
            error,
            $localize`The file could not be uploaded. Try a JPEG, PNG, WebP, MP4 or WebM file.`,
          ),
        );
      } finally {
        if (owner.current) {
          this.uploading.set(false);
        }
      }
    });
  }

  protected async deleteMedia(asset: MediaAssetView): Promise<void> {
    if (this.mediaBusy()) return;
    return this.scope.run('deleteMedia', async (owner) => {
      this.mediaBusy.set(true);
      this.mediaError.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(firstValueFrom(this.api.deleteMedia(asset.id, Number(asset.version))));
        this.library.update((items) => items.filter((item) => item.id !== asset.id));
        this.deleting.set(null);
      } catch (error) {
        if (!owner.current) return;
        // A file changed since the list was read: read the list again, as the sentence says.
        if (isStaleWrite(error)) {
          const media = await owner.wait(firstValueFrom(this.api.listMedia())).catch(() => null);
          if (!owner.current) return;
          if (media) this.library.set(media.items.filter((item) => item.status === 'Ready'));
        }
        this.mediaError.set(
          exerciseWriteError(error, $localize`It could not be deleted. Try again.`),
        );
      } finally {
        if (owner.current) {
          this.mediaBusy.set(false);
        }
      }
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy() || this.uploading()) return;
    return this.scope.run('submit', async (owner) => {
      if (this.problemCount() > 0) {
        this.error.set(null);
        this.attempt.attempt();
        afterNextRender(
          () =>
            this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
          { injector: this.injector },
        );
        return;
      }
      this.busy.set(true);
      this.error.set(null);
      const values = this.values();
      try {
        await owner.wait(this.csrf.refresh());
        // A pasted link becomes the exercise's first video, so its card and the client's workout show it.
        const linkId = await owner.wait(this.registerLink(values, owner));
        const media = linkId
          ? [linkId, ...values.mediaAssetIds.filter((id) => id !== linkId)]
          : [...values.mediaAssetIds];
        const request = exerciseRequest(values, media);
        const current = this.current();
        const saved = await owner.wait(
          firstValueFrom(
            current
              ? this.api.update(current.id, { ...request, version: Number(current.version) })
              : this.api.create(request),
          ),
        );
        this.registered = null;
        this.closed.emit(saved);
      } catch (error) {
        if (!owner.current) return;
        const current = this.current();
        if (current && isStaleWrite(error) && (await this.readAgain(current.id, owner))) {
          this.error.set(staleExerciseMessage());
          this.summary()?.focus();
          return;
        }
        this.error.set(
          exerciseWriteError(error, $localize`The exercise could not be saved. Try again.`),
        );
        this.summary()?.focus();
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  /**
   * After a stale save: the exercise as saved now, so the form shows what someone else saved and the next
   * save carries its version, and the library behind reads again. True when the newer copy arrived.
   */
  private async readAgain(id: string, owner: TenantOperation): Promise<boolean> {
    try {
      const fresh = await owner.wait(firstValueFrom(this.api.get(id)));
      this.current.set(fresh);
      this.attempt.reset();
      this.dirtyChange.emit(false);
      this.reloaded.emit();
      return true;
    } catch {
      return false;
    }
  }

  private async registerLink(
    values: ExerciseValues,
    owner: TenantOperation,
  ): Promise<string | null> {
    const link = parseVideoLink(values.videoLink);
    if (!link) return null;
    const key = `${link.provider}:${link.id}`;
    if (this.registered?.link === key) return this.registered.id;
    const asset = await owner.wait(
      firstValueFrom(
        this.api.registerVideoLink({
          title: values.name.trim(),
          provider: link.provider,
          externalMediaId: link.id,
        }),
      ),
    );
    this.registered = { link: key, id: asset.id };
    return asset.id;
  }
}
