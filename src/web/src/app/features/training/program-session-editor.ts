import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { TrainingLoadStrategy, TrainingSetType } from '../../core/api/generated';
import { trainingLoadStrategyLabel, trainingSetTypeLabel } from '../../core/i18n/display-labels';
import { Button, IconButton } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { SegmentedControl } from '../../ui/segmented-control';
import { DAYS, exerciseSummary, type LibraryExercise } from './program-builder.models';
import {
  type DraftExercise,
  type DraftSession,
  type DraftSet,
  emptySet,
  moveItem,
  withExertionPreference,
} from './training-builder.models';

/**
 * One session of the program in a sheet: its name, day and notes, and each exercise with its sets.
 * It edits the page's draft in place and says so through `edited`, so the grid behind it follows
 * every keystroke. Inline editing on the grid itself is R4.2; this is also the keyboard's way to
 * reorder or remove an exercise.
 */
@Component({
  selector: 'app-program-session-editor',
  imports: [Button, Checkbox, Control, Field, FormsModule, Icon, IconButton, SegmentedControl],
  templateUrl: './program-session-editor.html',
  styleUrl: './program-session-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramSessionEditor {
  readonly session = input.required<DraftSession>();
  readonly weekNumber = input.required<number>();
  readonly library = input<readonly LibraryExercise[]>([]);
  /** Increases on every edit, so the sheet redraws what changed in place. */
  readonly revision = input(0);
  /** A session saved with the program can be copied into the reusable library. */
  readonly canSaveToLibrary = input(false);
  readonly savingToLibrary = input(false);

  readonly edited = output<void>();
  readonly addExercise = output<void>();
  readonly saveToLibrary = output<void>();
  readonly remove = output<void>();
  /** An exercise to take out, by key; the page removes it and offers Undo. */
  readonly removeExercise = output<string>();
  readonly done = output<void>();

  protected readonly dayOptions = DAYS.map((day) => ({
    value: String(day),
    label: String(day + 1),
  }));
  protected readonly setTypes: TrainingSetType[] = [
    'WarmUp',
    'Normal',
    'Top',
    'BackOff',
    'Drop',
    'Failure',
  ];
  protected readonly loadStrategies: TrainingLoadStrategy[] = [
    'None',
    'Direct',
    'PercentageWorkingMax',
    'RpeBasedEpley',
  ];
  protected readonly setTypeLabel = trainingSetTypeLabel;
  protected readonly loadStrategyLabel = trainingLoadStrategyLabel;
  protected readonly summary = exerciseSummary;

  private readonly names = computed(
    () => new Map(this.library().map((exercise) => [exercise.id, exercise.name])),
  );

  protected day(): string {
    return String(this.session().dayOffset);
  }

  protected setDay(value: string): void {
    this.session().dayOffset = Number(value);
    this.changed();
  }

  protected changed(): void {
    this.edited.emit();
  }

  /** The swaps a coach can approve: the library's alternatives plus any approved before. */
  protected swapOptions(exercise: DraftExercise): { id: string; name: string }[] {
    const fromLibrary =
      this.library().find((item) => item.id === exercise.exerciseId)?.alternativeIds ?? [];
    const ids = [...new Set([...fromLibrary, ...exercise.approvedAlternativeExerciseIds])].filter(
      (id) => id !== exercise.exerciseId,
    );
    return ids.map((id) => ({ id, name: this.names().get(id) ?? $localize`An archived exercise` }));
  }

  protected isApproved(exercise: DraftExercise, id: string): boolean {
    return exercise.approvedAlternativeExerciseIds.includes(id);
  }

  protected toggleSwap(exercise: DraftExercise, id: string, approved: boolean): void {
    const others = exercise.approvedAlternativeExerciseIds.filter((item) => item !== id);
    exercise.approvedAlternativeExerciseIds = approved ? [...others, id] : others;
    this.changed();
  }

  /** A main lift is always done as written (TRN-010). */
  protected mainLiftChanged(exercise: DraftExercise, isMainLift: boolean): void {
    exercise.isMainLift = isMainLift;
    if (isMainLift) {
      exercise.modificationPolicy = 'Locked';
    }
    this.changed();
  }

  protected swapAllowedChanged(exercise: DraftExercise, allowed: boolean): void {
    exercise.modificationPolicy = allowed ? 'CoachApprovedSwap' : 'Locked';
    this.changed();
  }

  protected moveExercise(index: number, direction: -1 | 1): void {
    const session = this.session();
    session.exercises = moveItem(session.exercises, index, index + direction);
    this.changed();
  }

  protected addSet(exercise: DraftExercise): void {
    const last = exercise.sets.at(-1);
    exercise.sets.push(last ? { ...last, key: emptySet().key } : emptySet());
    this.changed();
  }

  protected removeSet(exercise: DraftExercise, index: number): void {
    if (exercise.sets.length > 1) {
      exercise.sets.splice(index, 1);
      this.changed();
    }
  }

  protected effortChanged(set: DraftSet, preference: DraftSet['exertionDisplayPreference']): void {
    Object.assign(set, withExertionPreference(set, preference));
    this.changed();
  }

  protected loadLabel(set: DraftSet): string {
    return set.loadStrategy === 'PercentageWorkingMax'
      ? $localize`% of training max`
      : $localize`Load`;
  }

  protected hasLoadValue(set: DraftSet): boolean {
    return set.loadStrategy === 'Direct' || set.loadStrategy === 'PercentageWorkingMax';
  }

  protected exerciseTitle(exercise: DraftExercise, index: number): string {
    return `${index + 1}. ${exercise.exerciseName || this.names().get(exercise.exerciseId) || $localize`Exercise`}`;
  }

  protected moveUpLabel(exercise: DraftExercise): string {
    return $localize`Move ${exercise.exerciseName}:exercise: up`;
  }

  protected moveDownLabel(exercise: DraftExercise): string {
    return $localize`Move ${exercise.exerciseName}:exercise: down`;
  }

  protected removeLabel(exercise: DraftExercise): string {
    return $localize`Remove ${exercise.exerciseName}:exercise:`;
  }

  protected removeSetLabel(index: number): string {
    return $localize`Remove set ${index + 1}:number:`;
  }
}
