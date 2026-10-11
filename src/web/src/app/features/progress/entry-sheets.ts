import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { GuardedSheets, type Closable } from '../../core/forms/guarded-sheets';
import type { GirthUnit, MassUnit } from '../../core/units/body-units';
import type { IsoDate } from '../../ui/calendar';
import { UiConfirm } from '../../ui/confirm';
import { CorrectMeasurement, LogMeasurements, MeasurementChanges } from './measurement-sheets';
import { AddPhotos, PhotoView } from './photo-sheets';
import {
  dayWords,
  type Audience,
  type MeasurementRow,
  type PhotoTile,
  type WeighInRow,
} from './progress-entries.models';
import type {
  BodyMeasurementHistory,
  BodyweightDateCorrection,
  BodyweightHistory,
  BodyweightObservation,
  ProgressPhoto,
} from './progress.models';
import { CorrectWeight, LogWeight, MoveWeighIn, WeighInChanges } from './weigh-in-sheets';

/** What an entry sheet changed, so the page reads that list again. */
export type EntryKind = 'weight' | 'measurements' | 'photos';

/**
 * Every sheet of the weigh-in, measurement and photo screens, opened from one place (R5.3c): the entries
 * page, the Progress dashboard's Log weight, and a coach's page for a client all open the same sheets.
 * A sheet that holds typed work asks before it closes, and a sheet that saved says so in a toast and
 * tells the page which list to read again.
 */
@Component({
  selector: 'app-entry-sheets',
  imports: [
    AddPhotos,
    CorrectMeasurement,
    CorrectWeight,
    LogMeasurements,
    LogWeight,
    MeasurementChanges,
    MoveWeighIn,
    PhotoView,
    UiConfirm,
    WeighInChanges,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: none' },
  template: `
    <ng-template #logWeightSheet let-sheet>
      <app-log-weight
        [clientId]="clientId()"
        [audience]="audience()"
        [today]="today()"
        [firstDay]="firstDay()"
        [startUnit]="weightUnit()"
        [existing]="existingWeights()"
        (dirtyChange)="dirty = $event"
        (stale)="changed.emit('weight')"
        (correct)="correctInstead($event, sheet)"
        (closed)="weightLogged($event, sheet)"
      />
    </ng-template>

    <ng-template #correctWeightSheet let-sheet>
      @if (weighIn(); as row) {
        <app-correct-weight
          [clientId]="clientId()"
          [audience]="audience()"
          [today]="today()"
          [firstDay]="firstDay()"
          [row]="row"
          (dirtyChange)="dirty = $event"
          (stale)="changed.emit('weight')"
          (closed)="weightCorrected($event, sheet)"
        />
      }
    </ng-template>

    <ng-template #moveWeighInSheet let-sheet>
      @if (weighIn(); as row) {
        <app-move-weigh-in
          [clientId]="clientId()"
          [audience]="audience()"
          [today]="today()"
          [firstDay]="firstDay()"
          [row]="row"
          [taken]="takenDays()"
          (dirtyChange)="dirty = $event"
          (stale)="changed.emit('weight')"
          (closed)="weightMoved($event, sheet)"
        />
      }
    </ng-template>

    <ng-template #weighInChangesSheet let-sheet>
      @if (weighIn(); as row) {
        <app-weigh-in-changes
          [clientId]="clientId()"
          [audience]="audience()"
          [today]="today()"
          [row]="row"
          (closed)="sheet.close()"
        />
      }
    </ng-template>

    <ng-template #logMeasurementsSheet let-sheet>
      <app-log-measurements
        [clientId]="clientId()"
        [audience]="audience()"
        [today]="today()"
        [firstDay]="firstDay()"
        [startUnit]="girthUnit()"
        (dirtyChange)="dirty = $event"
        (stale)="changed.emit('measurements')"
        (changed)="changed.emit('measurements')"
        (closed)="measurementsLogged($event, sheet)"
      />
    </ng-template>

    <ng-template #correctMeasurementSheet let-sheet>
      @if (measurement(); as row) {
        <app-correct-measurement
          [clientId]="clientId()"
          [audience]="audience()"
          [today]="today()"
          [row]="row"
          (dirtyChange)="dirty = $event"
          (stale)="changed.emit('measurements')"
          (closed)="measurementCorrected($event, sheet)"
        />
      }
    </ng-template>

    <ng-template #measurementChangesSheet let-sheet>
      @if (measurement(); as row) {
        <app-measurement-changes
          [clientId]="clientId()"
          [audience]="audience()"
          [today]="today()"
          [row]="row"
          (closed)="sheet.close()"
        />
      }
    </ng-template>

    <ng-template #addPhotosSheet let-sheet>
      <app-add-photos
        [clientId]="clientId()"
        [audience]="audience()"
        [today]="today()"
        [firstDay]="firstDay()"
        (dirtyChange)="dirty = $event"
        (stale)="changed.emit('photos')"
        (changed)="changed.emit('photos')"
        (closed)="photosAdded($event, sheet)"
      />
    </ng-template>

    <ng-template #photoSheet let-sheet>
      @if (photo(); as tile) {
        <app-photo-view
          [clientId]="clientId()"
          [audience]="audience()"
          [today]="today()"
          [tile]="tile"
          (dirtyChange)="dirty = $event"
          (stale)="changed.emit('photos')"
          (closed)="photoClosed($event, sheet)"
        />
      }
    </ng-template>

    <ng-template #confirmDialog let-dialog>
      @if (asking(); as question) {
        <app-confirm
          [message]="question.message"
          [confirmLabel]="question.confirm"
          [cancelLabel]="question.cancel"
          (answer)="dialog.close($event)"
        />
      }
    </ng-template>
  `,
})
export class EntrySheets extends GuardedSheets {
  /** The client a coach is entering for; null on the client's own pages. */
  readonly clientId = input<string | null>(null);
  readonly audience = input.required<Audience>();
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<IsoDate>();
  readonly firstDay = input<number | null>(null);
  /** The unit weights are logged in to begin with, and the tape the measurements start on. */
  readonly weightUnit = input<MassUnit>('Kilogram');
  readonly girthUnit = input<GirthUnit>('Centimetre');
  /** The weigh-ins the page has read, so a day that has one can be checked before anything is sent. */
  readonly weights = input<readonly WeighInRow[]>([]);
  /** A sheet saved something (or found the list stale): read that list again. */
  readonly changed = output<EntryKind>();

  private readonly logWeightSheet = viewChild.required<TemplateRef<unknown>>('logWeightSheet');
  private readonly correctWeightSheet =
    viewChild.required<TemplateRef<unknown>>('correctWeightSheet');
  private readonly moveWeighInSheet = viewChild.required<TemplateRef<unknown>>('moveWeighInSheet');
  private readonly weighInChangesSheet =
    viewChild.required<TemplateRef<unknown>>('weighInChangesSheet');
  private readonly logMeasurementsSheet =
    viewChild.required<TemplateRef<unknown>>('logMeasurementsSheet');
  private readonly correctMeasurementSheet =
    viewChild.required<TemplateRef<unknown>>('correctMeasurementSheet');
  private readonly measurementChangesSheet =
    viewChild.required<TemplateRef<unknown>>('measurementChangesSheet');
  private readonly addPhotosSheet = viewChild.required<TemplateRef<unknown>>('addPhotosSheet');
  private readonly photoSheet = viewChild.required<TemplateRef<unknown>>('photoSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmDialog');

  protected readonly weighIn = signal<WeighInRow | null>(null);
  protected readonly measurement = signal<MeasurementRow | null>(null);
  protected readonly photo = signal<PhotoTile | null>(null);

  protected readonly existingWeights = computed<ReadonlyMap<string, BodyweightObservation>>(
    () => new Map(this.weights().map((row) => [row.date, row.observation])),
  );
  protected readonly takenDays = computed<ReadonlySet<string>>(
    () => new Set(this.weights().map((row) => row.date)),
  );

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  // ---- opening ----

  logWeight(): void {
    const first = this.audience().firstName;
    this.show(
      this.logWeightSheet(),
      this.audience().coach && first
        ? $localize`Log weight for ${first}:name:`
        : $localize`Log weight`,
    );
  }

  correctWeight(row: WeighInRow): void {
    this.weighIn.set(row);
    this.show(this.correctWeightSheet(), $localize`Correct this weight`);
  }

  moveWeighIn(row: WeighInRow): void {
    this.weighIn.set(row);
    this.show(this.moveWeighInSheet(), $localize`Move it to the right day`);
  }

  weighInChanges(row: WeighInRow): void {
    this.weighIn.set(row);
    this.show(this.weighInChangesSheet(), $localize`Changes to this weight`);
  }

  logMeasurements(): void {
    const first = this.audience().firstName;
    this.show(
      this.logMeasurementsSheet(),
      this.audience().coach && first
        ? $localize`Log measurements for ${first}:name:`
        : $localize`Log measurements`,
    );
  }

  correctMeasurement(row: MeasurementRow): void {
    this.measurement.set(row);
    this.show(this.correctMeasurementSheet(), $localize`Correct this measurement`);
  }

  measurementChanges(row: MeasurementRow): void {
    this.measurement.set(row);
    this.show(this.measurementChangesSheet(), $localize`Changes to this measurement`);
  }

  addPhotos(): void {
    const first = this.audience().firstName;
    this.show(
      this.addPhotosSheet(),
      this.audience().coach && first
        ? $localize`Add photos for ${first}:name:`
        : $localize`Add photos`,
    );
  }

  viewPhoto(tile: PhotoTile): void {
    this.photo.set(tile);
    this.show(this.photoSheet(), $localize`${tile.pose}:pose: photo`);
  }

  // ---- what the sheets say back ----

  protected weightLogged(saved: BodyweightObservation | null, sheet: Closable): void {
    if (saved === null) return void this.closeAsking(sheet);
    const day =
      saved.measurementDate === this.today()
        ? $localize`today`
        : dayWords(saved.measurementDate, this.today(), this.audience().locale);
    this.saved(sheet, $localize`Weight logged for ${day}:day:.`, 'weight');
  }

  /** The chosen day already has a weight: close this sheet and open that one's correction. */
  protected correctInstead(logged: BodyweightObservation, sheet: Closable): void {
    const row = this.weights().find((item) => item.id === logged.id);
    if (!row) return;
    this.dirty = false;
    sheet.close(null);
    this.correctWeight(row);
  }

  protected weightCorrected(history: BodyweightHistory | null, sheet: Closable): void {
    if (history === null) return void this.closeAsking(sheet);
    this.saved(
      sheet,
      $localize`Weight corrected. The earlier number stays in its history.`,
      'weight',
    );
  }

  protected weightMoved(moved: BodyweightDateCorrection | null, sheet: Closable): void {
    if (moved === null) return void this.closeAsking(sheet);
    const day = dayWords(moved.replacement.measurementDate, this.today(), this.audience().locale);
    this.saved(
      sheet,
      $localize`Moved to ${day}:day:. The old entry is kept, marked as replaced.`,
      'weight',
    );
  }

  protected measurementsLogged(count: number, sheet: Closable): void {
    if (count === 0) return void this.closeAsking(sheet);
    this.saved(
      sheet,
      count === 1 ? $localize`Measurement saved.` : $localize`${count}:count: measurements saved.`,
      'measurements',
    );
  }

  protected measurementCorrected(history: BodyMeasurementHistory | null, sheet: Closable): void {
    if (history === null) return void this.closeAsking(sheet);
    this.saved(
      sheet,
      $localize`Measurement corrected. The earlier number stays in its history.`,
      'measurements',
    );
  }

  protected photosAdded(count: number, sheet: Closable): void {
    if (count === 0) return void this.closeAsking(sheet);
    this.saved(
      sheet,
      count === 1 ? $localize`Photo saved.` : $localize`${count}:count: photos saved.`,
      'photos',
    );
  }

  protected photoClosed(removed: ProgressPhoto | null, sheet: Closable): void {
    if (removed === null) return void this.closeAsking(sheet);
    this.saved(
      sheet,
      this.audience().coach
        ? $localize`Photo removed. The client keeps it in their own history.`
        : $localize`Photo removed. Your coach can no longer see it.`,
      'photos',
    );
  }

  // ---- the sheet itself ----

  /** A sheet saved: it closes, a toast says so, and the page reads that list again. */
  private saved(sheet: Closable, message: string, kind: EntryKind): void {
    this.done(sheet, message);
    this.changed.emit(kind);
  }
}
