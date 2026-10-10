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
import { Icon } from '../../ui/icon';
import { ExerciseLibraryApi } from './exercise-library-api';
import {
  EQUIPMENT,
  emptyExercise,
  exerciseErrors,
  exerciseRequest,
  exerciseWriteError,
  type ExerciseValues,
  type FieldMessages,
  type LibraryFilters,
  mediaLine,
  MUSCLES,
  parseVideoLink,
  PATTERNS,
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
  imports: [Button, Checkbox, Control, Field, Icon],
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
        <app-field [label]="typeLabel">
          <select
            appControl
            name="type"
            (change)="set({ classification: $any($event.target).value })"
          >
            @for (item of types; track item) {
              <option [value]="item" [selected]="item === values().classification">
                {{ typeName(item) }}
              </option>
            }
          </select>
        </app-field>
        <app-field [label]="muscleLabel">
          <select appControl name="muscle" (change)="setPrimary($any($event.target).value)">
            @for (item of muscles; track item) {
              <option [value]="item" [selected]="item === values().primaryMuscle">
                {{ muscleName(item) }}
              </option>
            }
          </select>
        </app-field>
        <app-field [label]="patternLabel">
          <select appControl name="pattern" (change)="set({ pattern: $any($event.target).value })">
            @for (item of patterns; track item) {
              <option [value]="item" [selected]="item === values().pattern">
                {{ patternName(item) }}
              </option>
            }
          </select>
        </app-field>
        <app-field [label]="equipmentLabel">
          <select
            appControl
            name="equipment"
            (change)="set({ equipment: $any($event.target).value })"
          >
            @for (item of equipment; track item) {
              <option [value]="item" [selected]="item === values().equipment">
                {{ equipmentName(item) }}
              </option>
            }
          </select>
        </app-field>
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
          @if (others().length > 8) {
            <app-field [label]="findLabel" hideLabel>
              <input
                appControl
                type="search"
                name="find-alternative"
                autocomplete="off"
                [placeholder]="findPlaceholder"
                [value]="find()"
                (input)="find.set($any($event.target).value)"
              />
            </app-field>
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

      @if (attempt.wasTried() && problemCount() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text" role="alert">{{ message }}</p>
      }
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
    select,
    textarea {
      scroll-margin-block-end: 5rem;
    }
  `,
})
export class ExerciseSheet implements OnInit {
  private readonly api = inject(ExerciseLibraryApi);
  private readonly csrf = inject(CsrfService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The exercise being edited; null for a new one. */
  readonly exercise = input<ExerciseView | null>(null);
  /** The library's filters, so a new exercise starts as what the coach was looking at. */
  readonly filters = input<LibraryFilters | null>(null);
  /** The saved exercise, or null when the coach closed the sheet without saving. */
  readonly closed = output<ExerciseView | null>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly types = TYPES;
  protected readonly muscles = MUSCLES;
  protected readonly patterns = PATTERNS;
  protected readonly equipment = EQUIPMENT;
  protected readonly typeName = exerciseClassificationLabel;
  protected readonly muscleName = muscleGroupLabel;
  protected readonly patternName = movementPatternLabel;
  protected readonly equipmentName = exerciseEquipmentLabel;
  protected readonly line = mediaLine;

  protected readonly nameLabel = $localize`Exercise name`;
  protected readonly videoLabel = $localize`Video link (optional)`;
  protected readonly typeLabel = $localize`Type`;
  protected readonly muscleLabel = $localize`Main muscle`;
  protected readonly patternLabel = $localize`Movement pattern`;
  protected readonly equipmentLabel = $localize`Equipment`;
  protected readonly instructionsLabel = $localize`How to do it`;
  protected readonly instructionsHelp = $localize`Clients read this beside the video in their workout.`;
  protected readonly tagsLabel = $localize`Tags`;
  protected readonly tagsHelp = $localize`Separate them with commas, like knee-friendly, home.`;
  protected readonly findLabel = $localize`Find an exercise`;
  protected readonly findPlaceholder = $localize`Find an exercise…`;
  protected readonly alternativesLabel = $localize`Exercises a client may swap to`;
  protected readonly deleteGroupLabel = $localize`Delete from your media`;

  protected readonly values = linkedSignal<ExerciseValues>(() => {
    const exercise = this.exercise();
    return exercise ? valuesFrom(exercise) : emptyExercise(this.filters() ?? undefined);
  });
  /** Editing shows every field; a new exercise starts with the few most coaches fill in. */
  protected readonly detailsOpen = linkedSignal(() => this.exercise() !== null);
  protected readonly others = signal<ExerciseView[]>([]);
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
  protected readonly videoHelp = computed(() => {
    const link = parseVideoLink(this.values().videoLink);
    return link
      ? $localize`${link.provider}:provider: video found. Clients see it in their workout.`
      : $localize`Paste a YouTube or Vimeo link. Clients see it in their workout.`;
  });
  protected readonly shownOthers = computed(() => {
    const words = this.find().trim().toLocaleLowerCase();
    const chosen = this.values().alternativeIds;
    return this.others()
      .filter((other) => !words || other.name.toLocaleLowerCase().includes(words))
      .sort((a, b) => Number(chosen.includes(b.id)) - Number(chosen.includes(a.id)));
  });

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
    if (this.loaded) return;
    this.loaded = true;
    const id = this.exercise()?.id;
    try {
      const [others, media] = await Promise.all([
        firstValueFrom(this.api.search({ take: 100 })),
        firstValueFrom(this.api.listMedia()),
      ]);
      this.others.set(others.items.filter((item) => item.id !== id && !item.isArchived));
      this.library.set(media.items.filter((item) => item.status === 'Ready'));
    } catch {
      this.mediaError.set(
        $localize`Your media and other exercises could not be loaded. Close and open the sheet again.`,
      );
    }
  }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    input.value = '';
    if (!file || this.uploading()) return;
    this.uploading.set(true);
    this.mediaError.set(null);
    try {
      await this.csrf.refresh();
      const title = this.values().name.trim() || file.name;
      const asset = await firstValueFrom(this.api.uploadMedia(title, file));
      this.library.update((items) => [asset, ...items]);
      if (asset.status === 'Ready') this.toggleMedia(asset.id, true);
    } catch (error) {
      this.mediaError.set(
        exerciseWriteError(
          error,
          $localize`The file could not be uploaded. Try a JPEG, PNG, WebP, MP4 or WebM file.`,
        ),
      );
    } finally {
      this.uploading.set(false);
    }
  }

  protected async deleteMedia(asset: MediaAssetView): Promise<void> {
    if (this.mediaBusy()) return;
    this.mediaBusy.set(true);
    this.mediaError.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.deleteMedia(asset.id, Number(asset.version)));
      this.library.update((items) => items.filter((item) => item.id !== asset.id));
      this.deleting.set(null);
    } catch (error) {
      this.mediaError.set(
        exerciseWriteError(error, $localize`It could not be deleted. Try again.`),
      );
    } finally {
      this.mediaBusy.set(false);
    }
  }

  protected async submit(): Promise<void> {
    if (this.busy() || this.uploading()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        { injector: this.injector },
      );
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const values = this.values();
    try {
      await this.csrf.refresh();
      // A pasted link becomes the exercise's first video, so its card and the client's workout show it.
      const linkId = await this.registerLink(values);
      const media = linkId
        ? [linkId, ...values.mediaAssetIds.filter((id) => id !== linkId)]
        : [...values.mediaAssetIds];
      const request = exerciseRequest(values, media);
      const current = this.exercise();
      const saved = await firstValueFrom(
        current
          ? this.api.update(current.id, { ...request, version: Number(current.version) })
          : this.api.create(request),
      );
      this.registered = null;
      this.closed.emit(saved);
    } catch (error) {
      this.error.set(
        exerciseWriteError(error, $localize`The exercise could not be saved. Try again.`),
      );
    } finally {
      this.busy.set(false);
    }
  }

  private async registerLink(values: ExerciseValues): Promise<string | null> {
    const link = parseVideoLink(values.videoLink);
    if (!link) return null;
    const key = `${link.provider}:${link.id}`;
    if (this.registered?.link === key) return this.registered.id;
    const asset = await firstValueFrom(
      this.api.registerVideoLink({
        title: values.name.trim(),
        provider: link.provider,
        externalMediaId: link.id,
      }),
    );
    this.registered = { link: key, id: asset.id };
    return asset.id;
  }
}
