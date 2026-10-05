import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { trainingSetTypeLabel } from '../../core/i18n/display-labels';
import { Icon } from '../../ui/icon';
import { SegmentedControl } from '../../ui/segmented-control';
import { setSummary, type LibraryExercise } from './program-builder.models';
import type { DraftExercise, ProgramDraft } from './training-builder.models';

/** A read-only look at the client's prescriptions, without inventing dates or calculated loads. */
@Component({
  selector: 'app-program-publish-preview',
  imports: [Icon, SegmentedControl],
  templateUrl: './program-publish-preview.html',
  styleUrl: './program-publish-preview.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramPublishPreview {
  readonly program = input.required<ProgramDraft>();
  readonly library = input<readonly LibraryExercise[]>([]);
  protected readonly selected = signal('0');
  protected readonly options = computed(() =>
    this.program().weeks.map((week, index) => ({
      value: String(index),
      label: $localize`Week ${index + 1}:number:`,
    })),
  );
  protected readonly week = computed(
    () => this.program().weeks[Number(this.selected())] ?? this.program().weeks[0],
  );
  protected readonly sessions = computed(() =>
    [...this.week().sessions].sort((a, b) => a.dayOffset - b.dayOffset),
  );
  protected readonly summary = setSummary;
  protected readonly typeLabel = trainingSetTypeLabel;

  protected swaps(exercise: DraftExercise): string {
    const names = new Map(this.library().map((item) => [item.id, item.name]));
    return exercise.approvedAlternativeExerciseIds
      .map((id) => names.get(id) ?? $localize`An approved exercise`)
      .join(', ');
  }
}
