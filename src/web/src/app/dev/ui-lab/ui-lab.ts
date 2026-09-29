import { JsonPipe } from '@angular/common';
import { Dir } from '@angular/cdk/bidi';
import {
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ActivatedRoute,
  IsActiveMatchOptions,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import { map } from 'rxjs';
import { FormAttempt } from '../../core/forms/form-attempt';
import { Avatar } from '../../ui/avatar';
import { AvatarStack } from '../../ui/avatar-stack';
import { Button, ButtonLink, IconButton } from '../../ui/button';
import { Card } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { EmptyState } from '../../ui/empty-state';
import { Control, Field } from '../../ui/field';
import { UiDialog } from '../../ui/dialog';
import { Icon } from '../../ui/icon';
import { ProgressRing } from '../../ui/progress-ring';
import { SegmentedControl } from '../../ui/segmented-control';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { Sparkline } from '../../ui/sparkline';
import { StatTile } from '../../ui/stat-tile';
import { StatusLabel } from '../../ui/status-label';
import { StatusPill } from '../../ui/status-pill';
import { UiTabPane, UiTabs } from '../../ui/tabs';
import { UiToast } from '../../ui/toast';
import {
  ARABIC,
  AVATAR_SAMPLES,
  CLASSIFICATION_OPTIONS,
  EDGE_OPTIONS,
  EQUIPMENT_OPTIONS,
  SET_TYPE_OPTIONS,
  STATUS_SAMPLES,
} from './ui-lab.fixtures';

/** Long enough to see the loading state and try to activate it again. */
export const LAB_SAVE_DELAY_MS = 1200;

/**
 * Development-only showcase of the design-system foundation, built from the real primitives and
 * real Angular forms. Everything is synthetic and local: there are no API calls, and "saving" is a
 * timer. Direction comes from the URL (`?dir=rtl`) so links, reloads and browser tests agree.
 */
@Component({
  selector: 'app-ui-lab',
  imports: [
    Avatar,
    AvatarStack,
    Button,
    ButtonLink,
    Card,
    Checkbox,
    Control,
    Dir,
    EmptyState,
    Field,
    Icon,
    IconButton,
    JsonPipe,
    ProgressRing,
    ReactiveFormsModule,
    RouterLink,
    RouterLinkActive,
    SegmentedControl,
    Skeleton,
    Sparkline,
    StatTile,
    StatusLabel,
    StatusPill,
    UiTabPane,
    UiTabs,
  ],
  templateUrl: './ui-lab.html',
  styleUrls: ['./ui-lab.scss', './ui-lab-kit.scss'],
  host: { class: 'tb-theme' },
})
export class UiLab {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly dialog = inject(UiDialog);
  private readonly sheet = inject(UiSheet);
  private readonly toast = inject(UiToast);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly summary = viewChild.required<ElementRef<HTMLElement>>('summary');
  private readonly dialogContent = viewChild.required<TemplateRef<unknown>>('dialogContent');
  private readonly sheetContent = viewChild.required<TemplateRef<unknown>>('sheetContent');

  protected readonly arabic = ARABIC;
  protected readonly avatars = AVATAR_SAMPLES;
  protected readonly classifications = CLASSIFICATION_OPTIONS;
  protected readonly edgeOptions = EDGE_OPTIONS;
  protected readonly equipment = EQUIPMENT_OPTIONS;
  protected readonly setTypes = SET_TYPE_OPTIONS;
  protected readonly statuses = STATUS_SAMPLES;
  protected readonly demoPeople = [
    { name: 'Maya Rahman', initials: 'MR' },
    { name: 'Rami Khoury', initials: 'RK' },
    { name: 'Lina Saleh', initials: 'LS' },
    { name: 'Nour Fares', initials: 'NF' },
    { name: 'Omar Nasser', initials: 'ON' },
  ];
  protected readonly periodOptions = [
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
    { value: 'quarter', label: '3 months' },
  ];
  protected readonly selectedPeriod = signal('week');
  protected readonly selectedKitTab = signal<string | undefined>('overview');

  /** The direction links are current only for their exact query string. */
  protected readonly exactLink: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'exact',
    fragment: 'ignored',
    matrixParams: 'ignored',
  };
  protected readonly direction = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((params) => (params.get('dir') === 'rtl' ? 'rtl' : 'ltr')),
    ),
    { initialValue: 'ltr' as const },
  );

  // Every lab button reports its presses, which proves disabled and loading buttons never fire.
  private readonly presses = signal<Record<string, number>>({});
  protected readonly lastPressed = signal<string | null>(null);
  protected readonly pressLog = computed(() =>
    Object.entries(this.presses()).map(([name, count]) => ({ name, count })),
  );
  protected readonly demoSaving = signal(false);
  protected readonly holdLoading = new FormControl(false, { nonNullable: true });
  private readonly holding = toSignal(this.holdLoading.valueChanges, { initialValue: false });
  protected readonly demoLoading = computed(() => this.demoSaving() || this.holding());

  // The exercise form: FormAttempt decides when each derived reason is due.
  protected readonly attempt = new FormAttempt();
  protected readonly form = this.formBuilder.group({
    name: ['', [Validators.required, Validators.maxLength(160)]],
    instructions: ['', [Validators.maxLength(8000)]],
    equipment: ['', [Validators.required]],
    classification: ['Strength'],
    mainLift: [false],
    includeInTemplates: [true],
    exerciseId: ['EX-2041'],
    workspace: [{ value: 'Sample Workspace', disabled: true }],
  });
  protected readonly saving = signal(false);
  protected readonly saveCount = signal(0);
  protected readonly saved = signal(false);

  // Standalone examples that use the control's own touched state instead of FormAttempt.
  protected readonly minimumReps = new FormControl('0', {
    nonNullable: true,
    validators: [Validators.required, Validators.min(1), Validators.max(100)],
  });
  protected readonly restSeconds = new FormControl('90', { nonNullable: true });
  protected readonly setType = new FormControl('Working', { nonNullable: true });
  protected readonly tempo = new FormControl('3-1-1-0', { nonNullable: true });
  protected readonly searchQuery = new FormControl('', { nonNullable: true });
  protected readonly coachNotes = new FormControl('', { nonNullable: true });
  protected readonly arabicName = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  protected readonly arabicEquipment = new FormControl('', { nonNullable: true });
  protected readonly arabicTempo = new FormControl('3-1-1-0', { nonNullable: true });
  protected readonly arabicIncludeArchived = new FormControl(false, { nonNullable: true });
  protected readonly arabicMainLift = new FormControl(true, { nonNullable: true });

  constructor() {
    // The "already touched" example shows an invalid state without any interaction.
    this.minimumReps.markAsTouched();
    inject(DestroyRef).onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
  }

  protected press(name: string): void {
    this.lastPressed.set(name);
    this.presses.update((counts) => ({ ...counts, [name]: (counts[name] ?? 0) + 1 }));
  }

  protected openDemoDialog(): void {
    this.dialog.open(this.dialogContent(), { title: 'Plan changes', direction: this.direction() });
  }

  protected openDemoSheet(): void {
    this.sheet.open(this.sheetContent(), { title: 'Quick actions', direction: this.direction() });
  }

  protected showDemoToast(): void {
    this.toast.show('Plan saved in this lab only.', {
      tone: 'success',
      durationMs: 8000,
      direction: this.direction(),
    });
  }

  protected startDemoSave(): void {
    this.press('Save changes (loading demo)');
    this.demoSaving.set(true);
    this.later(() => this.demoSaving.set(false));
  }

  protected nameReasons(): string[] {
    const name = this.form.controls.name;
    if (name.hasError('required')) return ['Enter a name for this exercise.'];
    if (name.hasError('maxlength')) {
      return ['Use 160 characters or fewer; names stay unique in this workspace.'];
    }
    return [];
  }

  protected instructionReasons(): string[] {
    return this.form.controls.instructions.hasError('maxlength')
      ? ['Use 8,000 characters or fewer.']
      : [];
  }

  protected equipmentReasons(): string[] {
    return this.form.controls.equipment.hasError('required')
      ? ['Choose the equipment this exercise uses.']
      : [];
  }

  protected formReasons(): string[] {
    return [...this.nameReasons(), ...this.instructionReasons(), ...this.equipmentReasons()];
  }

  protected minimumRepsReasons(): string[] {
    const control = this.minimumReps;
    if (!control.touched || control.valid) return [];
    return [
      'Enter a whole number of repetitions from 1 to 100.',
      'The minimum comes first; leave the maximum empty for a fixed count.',
    ];
  }

  protected arabicNameReasons(): string[] {
    return this.arabicName.touched && this.arabicName.invalid ? [this.arabic.nameError] : [];
  }

  /**
   * A refused submit reveals every outstanding reason and moves focus to the summary. A valid one
   * "saves" on a timer; the submit button is loading meanwhile, so a second press, Enter in a
   * field or a double click cannot start another save.
   */
  protected submit(): void {
    this.saved.set(false);
    if (this.formReasons().length > 0) {
      this.attempt.attempt();
      this.summary().nativeElement.focus();
      return;
    }

    this.saving.set(true);
    this.saveCount.update((count) => count + 1);
    this.later(() => {
      this.saving.set(false);
      this.saved.set(true);
      this.attempt.reset();
      this.form.markAsPristine();
      this.form.markAsUntouched();
    });
  }

  protected reset(): void {
    this.form.reset();
    this.attempt.reset();
    this.saved.set(false);
  }

  private later(action: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      action();
    }, LAB_SAVE_DELAY_MS);
    this.timers.add(timer);
  }
}
