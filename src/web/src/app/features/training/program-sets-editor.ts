import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { trainingLoadStrategyLabel, trainingSetTypeLabel } from '../../core/i18n/display-labels';
import { Button, IconButton } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { UiMenu } from '../../ui/menu';
import { setIssue, setSummary, type SetIssue } from './program-builder.models';
import {
  type DraftExercise,
  type DraftSet,
  emptySet,
  withExertionPreference,
} from './training-builder.models';

/** The same set editor on the grid and in the session sheet; all edits reach the owned draft. */
@Component({
  selector: 'app-program-sets-editor',
  imports: [Button, Control, Field, FormsModule, Icon, IconButton, UiMenu],
  templateUrl: './program-sets-editor.html',
  styleUrl: './program-sets-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramSetsEditor {
  readonly exercise = input.required<DraftExercise>();
  readonly revision = input(0);
  readonly edited = output<void>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly chosenSet = signal<string | null>(null);
  protected readonly checked = signal<ReadonlySet<string>>(new Set());
  protected readonly summary = setSummary;
  protected readonly typeLabel = trainingSetTypeLabel;
  protected readonly strategyLabel = trainingLoadStrategyLabel;
  protected readonly setTypes = ['WarmUp', 'Normal', 'Top', 'BackOff', 'Drop', 'Failure'] as const;
  protected readonly strategies = [
    'None',
    'Direct',
    'PercentageWorkingMax',
    'RpeChart',
    'RpeBasedEpley',
  ] as const;
  protected readonly typeItems = this.setTypes.map((action) => ({
    action,
    label: trainingSetTypeLabel(action),
  }));
  protected readonly loadItems = this.strategies.map((action) => ({
    action,
    label: trainingLoadStrategyLabel(action),
  }));
  protected readonly unitItems = [
    { action: 'Kilogram', label: 'kg' },
    { action: 'Pound', label: 'lb' },
  ];
  protected readonly effortItems = [
    { action: 'Rpe', label: 'RPE' },
    { action: 'Rir', label: 'RIR' },
  ];

  protected loadLabel(set: DraftSet): string {
    const unit = set.loadUnit === 'Pound' ? 'lb' : 'kg';
    return set.loadStrategy === 'PercentageWorkingMax'
      ? $localize`% of training max`
      : $localize`Load (${unit}:unit:)`;
  }

  protected effortLabel(set: DraftSet): string {
    return set.exertionDisplayPreference === 'Rpe' ? $localize`RPE target` : $localize`RIR target`;
  }

  /** A chart set says what the chart covers, where the coach types the effort it needs. */
  protected effortHelp(set: DraftSet): string | null {
    if (set.loadStrategy !== 'RpeChart') return null;
    return set.exertionDisplayPreference === 'Rpe'
      ? $localize`RTS chart: RPE 6.5 to 10, up to 12 reps`
      : $localize`RTS chart: RIR 0 to 3.5, up to 12 reps`;
  }

  protected unitLabel(set: DraftSet): string {
    return set.loadUnit === 'Pound' ? $localize`Unit: lb` : $localize`Unit: kg`;
  }

  protected effortChoice(set: DraftSet): string {
    return set.exertionDisplayPreference === 'Rpe'
      ? $localize`Effort: RPE`
      : $localize`Effort: RIR`;
  }

  protected isOpen(set: DraftSet): boolean {
    return set.key === (this.chosenSet() ?? this.exercise().sets[0]?.key);
  }

  protected choose(set: DraftSet): void {
    this.chosenSet.set(set.key);
  }

  protected changed(): void {
    this.edited.emit();
  }

  protected check(set: DraftSet): void {
    this.checked.update((keys) => new Set([...keys, set.key]));
  }

  protected errors(set: DraftSet, field: SetIssue['field']): string[] | null {
    this.revision();
    const issue = this.checked().has(set.key) ? setIssue(set) : null;
    return issue?.field === field ? [issue.message] : null;
  }

  protected typeChanged(set: DraftSet, value: string): void {
    const type = this.setTypes.find((item) => item === value);
    if (type) {
      set.setType = type;
      this.changed();
    }
  }

  protected strategyChanged(set: DraftSet, value: string): void {
    const strategy = this.strategies.find((item) => item === value);
    if (strategy) {
      set.loadStrategy = strategy;
      if (strategy === 'None') set.manualLoadOverride = null;
      this.changed();
    }
  }

  protected loadValue(set: DraftSet): number | null {
    return set.loadStrategy === 'Direct' && set.manualLoadOverride !== null
      ? set.manualLoadOverride
      : set.loadValue;
  }

  protected loadValueChanged(set: DraftSet, value: number | null): void {
    if (set.loadStrategy === 'Direct' && set.manualLoadOverride !== null)
      set.manualLoadOverride = value;
    set.loadValue = value;
    this.changed();
  }

  protected unitChanged(set: DraftSet, value: string): void {
    if (value === 'Kilogram' || value === 'Pound') {
      set.loadUnit = value;
      this.changed();
    }
  }

  protected effortChanged(set: DraftSet, value: string): void {
    if (value === 'Rpe' || value === 'Rir') {
      Object.assign(set, withExertionPreference(set, value));
      this.changed();
    }
  }

  protected add(): void {
    const exercise = this.exercise();
    if (exercise.sets.length >= 20) return;
    const last = exercise.sets.at(-1);
    const set = last ? { ...last, key: emptySet().key } : emptySet();
    exercise.sets.push(set);
    this.chosenSet.set(set.key);
    this.changed();
    this.focus(set.key);
  }

  protected remove(index: number): void {
    const exercise = this.exercise();
    if (exercise.sets.length <= 1) return;
    exercise.sets.splice(index, 1);
    const next = exercise.sets[Math.min(index, exercise.sets.length - 1)];
    this.chosenSet.set(next.key);
    this.changed();
    this.focus(next.key);
  }

  /** Used after a refused publish to open and focus the set that needs the coach. */
  focus(key: string): void {
    this.chosenSet.set(key);
    this.checked.update((keys) => new Set([...keys, key]));
    afterNextRender(
      () => {
        const row = Array.from(
          this.host.nativeElement.querySelectorAll<HTMLElement>('[data-set-key]'),
        ).find((element) => element.dataset['setKey'] === key);
        const field =
          row?.querySelector<HTMLInputElement>('input[aria-invalid="true"]') ??
          row?.querySelector<HTMLInputElement>('input');
        const details = field?.closest('details');
        if (details) details.open = true;
        field?.focus();
      },
      { injector: this.injector },
    );
  }

  protected removeLabel(index: number): string {
    return $localize`Remove set ${index + 1}:number: of ${this.exercise().exerciseName}:exercise:`;
  }
}
