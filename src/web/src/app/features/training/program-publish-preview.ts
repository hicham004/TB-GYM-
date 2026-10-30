import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { trainingSetTypeLabel } from '../../core/i18n/display-labels';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { SegmentedControl } from '../../ui/segmented-control';
import { NeedsMaxLine } from './needs-max-line';
import { libraryNames, setSummary, type LibraryExercise } from './program-builder.models';
import { liftsNeedingMax } from './training-max-needs';
import type { DraftExercise, ProgramDraft } from './training-builder.models';

/**
 * A read-only look at the client's prescriptions, without inventing dates or calculated loads. It
 * repeats the builder's "Needs a training max for" line, since the weights are worked out only when the
 * program is assigned (critique B7a).
 */
@Component({
  selector: 'app-program-publish-preview',
  imports: [NeedsMaxLine, SegmentedControl, UiDisclosure, UiDisclosureContent],
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
  protected readonly needsMax = computed(() =>
    liftsNeedingMax(this.program().weeks).map((lift) => ({
      exerciseId: lift.exerciseId,
      name: lift.name || $localize`Exercise`,
    })),
  );
  protected readonly summary = setSummary;
  protected readonly typeLabel = trainingSetTypeLabel;

  protected swaps(exercise: DraftExercise): string {
    const names = libraryNames(this.library());
    return exercise.approvedAlternativeExerciseIds
      .map((id) => names.get(id) ?? $localize`An approved exercise`)
      .join(', ');
  }
}
