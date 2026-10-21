import { formatNumber } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  linkedSignal,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ProgressPhotoPose } from '../../core/api/generated';
import { Button } from '../../ui/button';
import { DateField } from '../../ui/date-field';
import { Skeleton } from '../../ui/skeleton';
import { EntryActions, EntrySheet, ReasonPicker, SHEET_STYLES } from './entry-sheet';
import {
  dayErrors,
  dayWords,
  entryRefusal,
  isStale,
  photoFileError,
  poseName,
  POSES,
  reasonErrors,
  reasonPicks,
  reasonValue,
  type PhotoTile,
  type ReasonPick,
} from './progress-entries.models';
import type { ProgressPhoto, ProgressPhotoImage } from './progress.models';

type SlotState = 'idle' | 'saved' | 'failed';

interface Slot {
  readonly file: File | null;
  readonly state: SlotState;
  /** Why this photo cannot be saved: the file itself, or the server's words. */
  readonly message: string | null;
}

type Slots = Record<ProgressPhotoPose, Slot>;

const emptySlot: Slot = { file: null, state: 'idle', message: null };
const emptySlots = (): Slots => ({ Front: emptySlot, Side: emptySlot, Back: emptySlot });

/**
 * Add progress photos as a set, in a sheet (R5.3c): one day, and a place for the front, side and back
 * shot. Each is optional, and each is its own upload, so one the server refuses (a front already
 * saved for that day, say) stays on screen with its reason while the others are saved. A second try
 * sends only the photos still to do.
 */
@Component({
  selector: 'app-add-photos',
  imports: [Button, DateField, EntryActions],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted">{{ privacy() }}</p>
      <p class="muted" i18n>The same spot, light and relaxed pose make photos easy to compare.</p>
      <app-date-field
        [label]="dayLabel"
        [errors]="shows('day', dayIssues()) ? dayIssues() : null"
        [(value)]="day"
        [max]="today()"
        [today]="today()"
        [firstDay]="firstDay()"
        (touched)="attempt.touch('day')"
      />
      @for (pose of poses; track pose) {
        <div class="slot" [attr.data-slot]="pose">
          <div class="slot-head">
            <strong>{{ name(pose) }}</strong>
            @if (slots()[pose].state === 'saved') {
              <span class="saved" i18n>Saved</span>
            }
          </div>
          @if (slots()[pose].file; as chosen) {
            <p class="file" dir="auto">{{ chosen.name }} · {{ size(chosen) }}</p>
          }
          @if (slots()[pose].state !== 'saved') {
            <div class="slot-actions">
              <button
                appButton
                type="button"
                variant="outlined"
                [disabled]="busy()"
                (click)="picker.click()"
              >
                @if (slots()[pose].file) {
                  <ng-container i18n>Choose another</ng-container>
                } @else {
                  <ng-container i18n>Choose photo</ng-container>
                }
                <span class="tb-visually-hidden"> {{ name(pose) }}</span>
              </button>
              @if (slots()[pose].file) {
                <button
                  appButton
                  type="button"
                  variant="text"
                  [disabled]="busy()"
                  (click)="clear(pose)"
                >
                  <ng-container i18n>Clear</ng-container>
                  <span class="tb-visually-hidden"> {{ name(pose) }}</span>
                </button>
              }
              <input
                #picker
                class="file-input"
                type="file"
                accept="image/jpeg,image/png"
                tabindex="-1"
                aria-hidden="true"
                [attr.data-file]="pose"
                (change)="choose(pose, $event)"
              />
            </div>
          }
          @if (slots()[pose].message; as message) {
            <p class="slot-problem" role="alert">{{ message }}</p>
          }
        </div>
      }
      @if (attempt.wasTried() && nothingYet()) {
        <p class="problem-text" role="alert" i18n>Choose at least one photo.</p>
      } @else if (attempt.wasTried() && problems() > 0) {
        <p class="problem-text" role="alert" i18n>Check what is marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text refusal" role="alert">{{ message }}</p>
      }
      <app-entry-actions
        [saveLabel]="saveLabel"
        [busyLabel]="savingLabel"
        [busy]="busy()"
        (notNow)="closed.emit(saved())"
      />
    </form>
  `,
  styles: [
    SHEET_STYLES,
    `
      .slot {
        background: var(--tb-surface-2);
        border-radius: var(--tb-radius-control);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem 0.875rem;
      }

      .slot-head {
        align-items: baseline;
        display: flex;
        gap: 0.5rem;
        justify-content: space-between;
      }

      .saved {
        color: var(--tb-success);
        font-size: 0.875rem;
        font-weight: 600;
      }

      .file {
        color: var(--tb-muted);
        font-size: 0.875rem;
      }

      .slot-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .file-input {
        display: none;
      }

      .slot-problem {
        color: var(--tb-danger);
        font-size: 0.875rem;
        font-weight: 600;
      }
    `,
  ],
})
export class AddPhotos extends EntrySheet {
  /** How many photos were saved, when the sheet closes (0 when none). */
  readonly closed = output<number>();
  /** Some photos were saved while the sheet stays open: the page reads its list again. */
  readonly changed = output<void>();

  protected readonly dayLabel = $localize`Day the photos were taken`;
  protected readonly saveLabel = $localize`Save photos`;
  protected readonly savingLabel = $localize`Uploading…`;
  protected readonly poses = POSES;

  protected readonly day = linkedSignal(() => this.today());
  protected readonly slots = signal<Slots>(emptySlots());
  protected readonly saved = signal(0);

  protected readonly dayIssues = computed(() =>
    dayErrors(this.day(), this.today(), 'photographed'),
  );
  /** The photos still to send: chosen, and not saved yet (a refused one is tried again). */
  protected readonly toDo = computed(() =>
    POSES.filter(
      (pose) => this.slots()[pose].file !== null && this.slots()[pose].state !== 'saved',
    ),
  );
  protected readonly nothingYet = computed(() => this.toDo().length === 0 && this.saved() === 0);
  protected readonly problems = computed(
    () => this.dayIssues().length + (this.nothingYet() ? 1 : 0),
  );
  protected readonly privacy = computed(() => {
    const audience = this.audience();
    if (!audience.coach) {
      // The owner sees every client's record and photos too (CLI-013, audit LOST-3), as the intake says.
      const space = this.tenants.selectedMembership()?.tenantName;
      return space
        ? $localize`Your coach and the owner of ${space}:space: can see these photos. If you remove one later, it disappears from their view.`
        : $localize`Your coach and the owner of your coaching space can see these photos. If you remove one later, it disappears from their view.`;
    }
    return audience.firstName
      ? $localize`${audience.firstName}:name: can see these photos too. Removing one takes it out of your view, and they keep it.`
      : $localize`The client can see these photos too. Removing one takes it out of your view, and they keep it.`;
  });

  constructor() {
    super();
    effect(() =>
      this.dirtyChange.emit(
        POSES.some(
          (pose) => this.slots()[pose].file !== null && this.slots()[pose].state !== 'saved',
        ),
      ),
    );
  }

  protected name(pose: ProgressPhotoPose): string {
    return poseName(pose);
  }

  protected size(file: File): string {
    const megabytes = file.size / (1024 * 1024);
    return megabytes >= 0.1
      ? $localize`${formatNumber(megabytes, this.audience().locale, '1.0-1')}:size: MB`
      : $localize`${formatNumber(Math.max(1, file.size / 1024), this.audience().locale, '1.0-0')}:size: KB`;
  }

  protected choose(pose: ProgressPhotoPose, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // So the same file can be chosen again after it was cleared.
    input.value = '';
    if (file === null) return;
    const message = photoFileError(file);
    this.setSlot(pose, { file: message === null ? file : null, state: 'idle', message });
  }

  protected clear(pose: ProgressPhotoPose): void {
    this.setSlot(pose, emptySlot);
  }

  private setSlot(pose: ProgressPhotoPose, slot: Slot): void {
    this.slots.update((current) => ({ ...current, [pose]: slot }));
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const poses = this.toDo();
    if (poses.length === 0) {
      // Everything chosen is already saved: nothing is left to send.
      this.closed.emit(this.saved());
      return;
    }
    const day = this.day();
    const dayText = dayWords(day, this.today(), this.audience().locale);
    await this.scope.run('send', async (owner) => {
      this.busy.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        let failed = 0;
        let savedNow = 0;
        for (const pose of poses) {
          const file = this.slots()[pose].file!;
          this.setSlot(pose, { file, state: 'idle', message: null });
          try {
            await owner.wait(
              firstValueFrom(
                this.entries.addPhoto(
                  this.clientId(),
                  pose,
                  // Today is left to the server, which knows the coaching space's own day.
                  day === this.today() ? null : day,
                  file,
                ),
              ),
            );
            this.setSlot(pose, { file, state: 'saved', message: null });
            savedNow++;
          } catch (error) {
            if (!owner.current) return;
            failed++;
            this.setSlot(pose, {
              file,
              state: 'failed',
              message: entryRefusal(error, $localize`This photo could not be saved. Try again.`, {
                day: dayText,
                what: poseName(pose),
              }),
            });
            if (isStale(error)) this.stale.emit();
          }
        }
        if (savedNow > 0) {
          this.saved.update((count) => count + savedNow);
          this.changed.emit();
        }
        if (failed === 0) {
          this.closed.emit(this.saved());
        } else {
          this.error.set(
            savedNow > 0
              ? $localize`Some photos were saved. The ones marked above were not.`
              : $localize`Nothing was saved. The reasons are marked above.`,
          );
          this.reveal();
        }
      } catch {
        if (!owner.current) return;
        this.error.set($localize`The photos could not be saved. Try again.`);
        this.reveal();
      } finally {
        if (owner.current) this.busy.set(false);
      }
    });
  }
}

/**
 * One photo, opened (R5.3c): the small version first, the full size only when asked, because a photo
 * is health-adjacent and its full bytes should travel only when somebody wants them. An active photo
 * can be removed here, with a reason; the server keeps it in the client's own history and takes it out
 * of the coach's view.
 */
@Component({
  selector: 'app-photo-view',
  imports: [Button, EntryActions, ReasonPicker, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      <p class="about">
        <strong>{{ title() }}</strong
        >&ngsp;
        <span class="muted">{{ tile().addedBy }}</span>
      </p>
      @switch (state()) {
        @case ('loading') {
          <div aria-busy="true"><app-skeleton [label]="loadingLabel" [lines]="4" /></div>
        }
        @case ('error') {
          <p class="problem-text" role="alert">{{ loadError() }}</p>
          <button appButton type="button" variant="outlined" (click)="open()" i18n>
            Try again
          </button>
        }
        @default {
          @if (url(); as source) {
            <img class="photo" [src]="source" [alt]="alt()" />
            @if (preview()) {
              <button appButton type="button" variant="outlined" (click)="showFullSize()" i18n>
                Load full size
              </button>
            }
          }
        }
      }
      @if (tile().photo.status === 'Removed') {
        <p class="muted" i18n>
          You removed this photo. It stays in your own history and your coach cannot see it.
        </p>
      }
      @if (removing()) {
        <form class="remove" (submit)="$event.preventDefault(); remove()" novalidate>
          <app-reason-picker
            [label]="reasonLabel"
            [picks]="picks()"
            [errors]="shows('reason', reasonIssues()) ? reasonIssues() : null"
            [(pick)]="pick"
            [(typed)]="typed"
            (touched)="attempt.touch('reason')"
          />
          <p class="muted">{{ removeNote() }}</p>
          @if (error(); as message) {
            <p class="problem-text refusal" role="alert">{{ message }}</p>
          }
          <app-entry-actions
            [saveLabel]="removeLabel"
            [busyLabel]="removingLabel"
            [busy]="busy()"
            [cancelLabel]="keepLabel"
            (notNow)="stopRemoving()"
          />
        </form>
      } @else {
        <div class="foot">
          @if (tile().photo.status === 'Active') {
            <button appButton type="button" variant="outlined" (click)="startRemoving()" i18n>
              Remove photo
            </button>
          }
          <button appButton type="button" (click)="closed.emit(null)" i18n>Close</button>
        </div>
      }
    </div>
  `,
  styles: [
    SHEET_STYLES,
    `
      .photo {
        background: var(--tb-surface-2);
        border-radius: var(--tb-radius-control);
        display: block;
        inline-size: 100%;
        max-block-size: 60dvh;
        object-fit: contain;
      }

      .remove {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .foot {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        justify-content: flex-end;
      }
    `,
  ],
})
export class PhotoView extends EntrySheet implements OnInit {
  readonly tile = input.required<PhotoTile>();
  /** The photo as it is after the removal, or null when the sheet was closed without one. */
  readonly closed = output<ProgressPhoto | null>();

  protected readonly loadingLabel = $localize`Opening the photo…`;
  protected readonly reasonLabel = $localize`Why remove it?`;
  protected readonly removeLabel = $localize`Remove photo`;
  protected readonly removingLabel = $localize`Removing…`;
  protected readonly keepLabel = $localize`Keep it`;

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly loadError = signal('');
  private readonly image = signal<ProgressPhotoImage | null>(null);
  private readonly full = signal(false);
  protected readonly removing = signal(false);
  protected readonly pick = signal<ReasonPick | null>(null);
  protected readonly typed = signal('');

  protected readonly picks = computed(() => reasonPicks('photo', this.audience()));
  protected readonly reasonIssues = computed(() => reasonErrors(this.pick(), this.typed()));
  protected readonly preview = computed(() => {
    const image = this.image();
    return image !== null && image.thumbnailUrl !== null && !this.full();
  });
  /** The small version first; the full image only when asked, or when there is nothing smaller. */
  protected readonly url = computed(() => {
    const image = this.image();
    if (image === null) return null;
    return image.thumbnailUrl !== null && !this.full() ? image.thumbnailUrl : image.fullUrl;
  });
  protected readonly title = computed(
    () =>
      `${this.tile().pose} · ${dayWords(this.tile().photo.photoDate, this.today(), this.audience().locale)}`,
  );
  protected readonly alt = computed(() => $localize`${this.title()}:photo: progress photo`);
  protected readonly removeNote = computed(() =>
    this.audience().coach
      ? $localize`It leaves your view. The client keeps it in their own history.`
      : $localize`It leaves your coach’s view. You keep it in your own history.`,
  );

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(this.removing() && this.pick() !== null));
  }

  /** Opened once the inputs are set: the photo to open is one of them. */
  ngOnInit(): void {
    void this.open();
  }

  protected open(): Promise<void> {
    return this.scope.run('open', async (owner) => {
      this.state.set('loading');
      try {
        await owner.wait(this.csrf.refresh());
        this.image.set(await owner.wait(firstValueFrom(this.entries.openPhoto(this.tile().photo))));
        this.state.set('ready');
      } catch (error) {
        if (!owner.current) return;
        this.loadError.set(apiErrorMessage(error, $localize`The photo could not be opened.`));
        this.state.set('error');
      }
    });
  }

  /** The grant that opened the preview already covers the full size, so this asks for nothing more. */
  protected showFullSize(): void {
    this.full.set(true);
  }

  protected startRemoving(): void {
    this.removing.set(true);
  }

  protected stopRemoving(): void {
    this.removing.set(false);
    this.pick.set(null);
    this.typed.set('');
    this.error.set(null);
    this.attempt.reset();
  }

  protected async remove(): Promise<void> {
    if (this.busy()) return;
    if (this.reasonIssues().length > 0) {
      this.refuse();
      return;
    }
    const photo = this.tile().photo;
    const request = { reason: reasonValue(this.pick(), this.typed()), version: photo.version };
    let removed: ProgressPhoto | null = null;
    const ok = await this.send(
      async (owner) => {
        removed = await owner.wait(
          firstValueFrom(this.entries.removePhoto(this.clientId(), photo.id, request)),
        );
      },
      $localize`The photo could not be removed. Try again.`,
    );
    if (ok) this.closed.emit(removed);
  }
}
