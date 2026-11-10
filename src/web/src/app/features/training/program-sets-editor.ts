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
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import {
  formulaShare,
  impossiblePercentage,
  isRpeLoaded,
  MAXIMUM_LOAD_STEP,
  parseReps,
  repsText,
  setIssue,
  setSummary,
  setWayOuts,
  takeWayOut,
  type SetIssue,
  type SetWayOut,
} from './program-builder.models';
import {
  type DraftExercise,
  type DraftSet,
  emptySet,
  takesTypedWeight,
  withExertionPreference,
} from './training-builder.models';

/** "Normal" is said "Working": the other kinds but a warm-up are working sets too (B1). */
const WORKING_HINT = $localize`Top, back-off, drop and failure sets are working sets too; a warm-up never counts in the summary or the records.`;
const PERCENTAGE_HINT = $localize`Of this client’s training max, set when you assign the program.`;
/** A last time + step set (N6a): the coach adds the step, never the app or the client (decision 21). */
const STEP_HINT = $localize`You add the step each week, after reading the logged sets.`;
const START_HINT = $localize`Optional. Without one, the client picks the weight.`;

/** The buttons a formula's limit offers (critique B7a), in the order they are offered. */
const WAY_OUT_LABELS: Record<SetWayOut, string> = {
  chart: $localize`Use the RTS chart for this set`,
  epley: $localize`Use the Epley curve for this set`,
  percentage: $localize`Use % of training max`,
  direct: $localize`Type a weight`,
  none: $localize`Let the client pick the weight`,
};

/** Where the cursor goes once a way out is taken: the box the coach fills next. */
const WAY_OUT_FIELD: Record<SetWayOut, string> = {
  chart: '[data-field="effort"]',
  epley: '[data-field="effort"]',
  percentage: '[data-field="load"]',
  direct: '[data-field="load"]',
  none: '[data-load-menu] button',
};

/** Whether a set's problem is a box under Rest, tempo & notes (a direct load says its own above). */
function refusedUnderMore(set: DraftSet): boolean {
  const field = setIssue(set)?.field;
  return (
    field === 'restSeconds' || (field === 'manualLoadOverride' && set.loadStrategy !== 'Direct')
  );
}

/** The same set editor on the grid and in the session sheet; all edits reach the owned draft. */
@Component({
  selector: 'app-program-sets-editor',
  imports: [
    Button,
    Control,
    Field,
    FormsModule,
    Icon,
    IconButton,
    UiDisclosure,
    UiDisclosureContent,
    UiMenu,
  ],
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
  /** The sets whose Rest, tempo & notes is open; a refused box in it opens it (critique B2b). */
  protected readonly moreOpen = signal<ReadonlySet<string>>(new Set());
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
    'LastTimeStep',
  ] as const;
  protected readonly maxStep = MAXIMUM_LOAD_STEP;
  protected readonly stepHint = STEP_HINT;
  protected readonly startHint = START_HINT;
  protected readonly typeItems: UiMenuItem[] = this.setTypes.map((action) => ({
    action,
    label: trainingSetTypeLabel(action),
    hint: action === 'Normal' ? WORKING_HINT : undefined,
  }));
  protected readonly loadItems: UiMenuItem[] = this.strategies.map((action) => ({
    action,
    label: trainingLoadStrategyLabel(action),
    hint: action === 'PercentageWorkingMax' ? PERCENTAGE_HINT : undefined,
  }));
  protected readonly unitItems = [
    { action: 'Kilogram', label: 'kg' },
    { action: 'Pound', label: 'lb' },
  ];
  protected readonly waysLabel = $localize`Ways to keep this set`;
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

  protected loadHelp(set: DraftSet): string | null {
    return set.loadStrategy === 'PercentageWorkingMax' ? PERCENTAGE_HINT : null;
  }

  /** A last time + step set's two boxes, in the set's own unit; nothing is converted. */
  protected stepLabel(set: DraftSet): string {
    const unit = set.loadUnit === 'Pound' ? 'lb' : 'kg';
    return $localize`Step (${unit}:unit:)`;
  }

  protected startLabel(set: DraftSet): string {
    const unit = set.loadUnit === 'Pound' ? 'lb' : 'kg';
    return $localize`Starting weight (${unit}:unit:)`;
  }

  protected effortLabel(set: DraftSet): string {
    return set.exertionDisplayPreference === 'Rpe' ? $localize`RPE target` : $localize`RIR target`;
  }

  /**
   * A chart or Epley set says its formula's own number for its reps and effort, as the server will
   * work the weight out at assignment; until it has one, what the formula covers.
   */
  protected effortHelp(set: DraftSet): string | null {
    if (!isRpeLoaded(set)) return null;
    const chart = set.loadStrategy === 'RpeChart';
    const share = formulaShare(set);
    if (share !== null) {
      const effort = `${set.exertionDisplayPreference === 'Rir' ? 'RIR' : 'RPE'} ${set.exertionTarget}`;
      return chart
        ? $localize`RTS chart: ${set.repetitionsMaximum}:reps: reps at ${effort}:effort: is ${share.toFixed(1)}:share:% of the training max.`
        : $localize`Epley curve: ${set.repetitionsMaximum}:reps: reps at ${effort}:effort: is ${share.toFixed(1)}:share:% of the training max.`;
    }
    if (!chart) return $localize`Epley curve: reps plus RIR up to 12`;
    return set.exertionDisplayPreference === 'Rpe'
      ? $localize`RTS chart: RPE 6.5 to 10, up to 12 reps`
      : $localize`RTS chart: RIR 0 to 3.5, up to 12 reps`;
  }

  /** A % set the chart says cannot be done is flagged, never refused (critique B7a). */
  protected warning(set: DraftSet): string | null {
    this.revision();
    return impossiblePercentage(set);
  }

  /** The ways out of a formula's limit, once its refusal is shown. */
  protected wayOuts(set: DraftSet): { way: SetWayOut; label: string }[] {
    this.revision();
    if (!this.checked().has(set.key)) return [];
    return setWayOuts(set).map((way) => ({ way, label: WAY_OUT_LABELS[way] }));
  }

  /**
   * Takes a way out and puts the cursor in the box the coach fills next. The set is checked again when
   * the coach leaves it, so a box that just appeared is not called empty before they type in it.
   */
  protected takeWay(set: DraftSet, way: SetWayOut): void {
    takeWayOut(set, way);
    this.changed();
    this.fillNext(set, WAY_OUT_FIELD[way]);
  }

  /** Puts the cursor in the set's box the coach fills next, which is not refused before they leave it. */
  private fillNext(set: DraftSet, selector: string): void {
    afterNextRender(
      () => {
        const row = Array.from(
          this.host.nativeElement.querySelectorAll<HTMLElement>('[data-set-key]'),
        ).find((element) => element.dataset['setKey'] === set.key);
        row?.querySelector<HTMLElement>(selector)?.focus();
        this.checked.update((keys) => new Set([...keys].filter((key) => key !== set.key)));
      },
      { injector: this.injector },
    );
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

  protected moreToggled(set: DraftSet, open: boolean): void {
    this.moreOpen.update((keys) => {
      const next = new Set(keys);
      if (open) next.add(set.key);
      else next.delete(set.key);
      return next;
    });
  }

  protected errors(set: DraftSet, field: SetIssue['field']): string[] | null {
    this.revision();
    const issue = this.checked().has(set.key) ? setIssue(set) : null;
    return issue?.field === field ? [issue.message] : null;
  }

  /** One Reps box for both numbers (B1): what the coach is typing, else the set's reps. */
  protected repsValue(set: DraftSet): string {
    return set.repetitionsEntry ?? repsText(set);
  }

  protected repsChanged(set: DraftSet, text: string): void {
    set.repetitionsEntry = text;
    const reps = parseReps(text);
    if (reps) Object.assign(set, reps);
    this.changed();
  }

  /**
   * Leaving the box writes the reps the usual way ("8–12"), unless they could not be read. The box
   * is written directly: its binding may already hold that text from before the coach typed.
   */
  protected repsSettled(set: DraftSet, box: HTMLInputElement): void {
    if (set.repetitionsEntry !== undefined && parseReps(set.repetitionsEntry)) {
      delete set.repetitionsEntry;
      box.value = repsText(set);
    }
  }

  protected repsErrors(set: DraftSet): string[] | null {
    return this.errors(set, 'repetitionsMinimum') ?? this.errors(set, 'repetitionsMaximum');
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
    if (!strategy) return;
    // A starting weight is optional, so it keeps only a weight the coach typed, never a share read as kg.
    if (strategy === 'LastTimeStep') {
      set.loadValue = takesTypedWeight(set.loadStrategy) ? this.loadValue(set) : null;
    }
    set.loadStrategy = strategy;
    // A step set takes no fixed load instead: its box is hidden and the server refuses one.
    if (strategy === 'None' || strategy === 'LastTimeStep') set.manualLoadOverride = null;
    this.changed();
    // The step is the box to fill next (N6a); its sentence shows until the coach leaves it.
    if (strategy === 'LastTimeStep') this.fillNext(set, '[data-field="step"]');
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
    const set = last ? { ...last, key: emptySet().key } : emptySet(exercise.isMainLift);
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
    // The fold's boxes are made when it opens, so it opens before the refused one is looked for.
    const set = this.exercise().sets.find((item) => item.key === key);
    if (set && refusedUnderMore(set)) this.moreToggled(set, true);
    afterNextRender(
      () => {
        const row = Array.from(
          this.host.nativeElement.querySelectorAll<HTMLElement>('[data-set-key]'),
        ).find((element) => element.dataset['setKey'] === key);
        const field =
          row?.querySelector<HTMLInputElement>('input[aria-invalid="true"]') ??
          row?.querySelector<HTMLInputElement>('input');
        field?.focus();
      },
      { injector: this.injector },
    );
  }

  protected removeLabel(index: number): string {
    return $localize`Remove set ${index + 1}:number: of ${this.exercise().exerciseName}:exercise:`;
  }
}
