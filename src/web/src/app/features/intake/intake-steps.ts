import { Title } from '@angular/platform-browser';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { BodyweightUnit, ClientIntakeProfile } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { Button } from '../../ui/button';
import type { IsoDate } from '../../ui/calendar';
import { Icon } from '../../ui/icon';
import { IntakeFields } from './intake-fields';
import {
  firstOpenStep,
  followSaved,
  groupTitle,
  hasChanges,
  healthPrivacy,
  INTAKE_STEPS,
  isStepDone,
  mergeSteps,
  stepErrors,
  stepLede,
  stepName,
  toCompleteRequest,
  toUpdateRequest,
  valuesFromProfile,
  type IntakeSaver,
  type IntakeStepId,
  type IntakeValues,
} from './intake.models';

/**
 * A new client's first questions as five short steps (R5.3b) instead of one long form: who they are,
 * what they want, how they live and eat, their health, and the weight they start from. Each Continue
 * saves that step's answers (so closing the tab loses nothing already passed) and moves on; a person
 * who left half way starts at the first step the saved profile does not finish. The last step finishes
 * setting up. The server stays the authority: this asks, checks the same limits in words, and shows the
 * server's own reason when it refuses.
 */
@Component({
  selector: 'app-intake-steps',
  imports: [Button, Icon, IntakeFields],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './intake-steps.html',
  styleUrl: './intake-steps.scss',
})
export class IntakeSteps {
  private readonly pageTitle = inject(Title);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly originalTitle = this.pageTitle.getTitle();
  private destroyed = false;

  readonly profile = input.required<ClientIntakeProfile>();
  readonly saver = input.required<IntakeSaver>();
  /** Today in the coaching space, for the adult rule and the weighing day. */
  readonly today = input.required<IsoDate>();
  readonly firstDay = input<number | null>(null);
  /** The unit the person chose in their account, which the starting weight begins in. */
  readonly weightUnit = input<BodyweightUnit>('Kilogram');
  /** Named beside the health questions, which only the person, their coach and the owner can read. */
  readonly spaceName = input('');
  /** Whether something has been typed that has not been saved, for the page's leave warning. */
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly refusal = signal<string | null>(null);
  protected readonly stepIds = INTAKE_STEPS;
  protected readonly progressLabel = $localize`Steps`;

  private readonly saved = computed(() =>
    valuesFromProfile(this.profile(), { today: this.today(), weightUnit: this.weightUnit() }),
  );
  /** What is in the boxes: the saved answers, except in a step the person has typed in. */
  protected readonly values = linkedSignal<IntakeValues, IntakeValues>({
    source: this.saved,
    computation: (saved, previous) =>
      previous ? followSaved(previous.value, previous.source, saved) : saved,
  });

  private readonly chosen = signal<IntakeStepId | null>(null);
  private readonly passed = signal<ReadonlySet<IntakeStepId>>(new Set());
  protected readonly step = computed(() => this.chosen() ?? firstOpenStep(this.profile()));
  protected readonly index = computed(() => INTAKE_STEPS.indexOf(this.step()));
  protected readonly isLast = computed(() => this.index() === INTAKE_STEPS.length - 1);

  protected readonly title = computed(() => groupTitle(this.step(), { kind: 'self' }));
  protected readonly lede = computed(() => stepLede(this.step()));
  protected readonly kicker = computed(
    () => $localize`Step ${this.index() + 1}:step: of ${INTAKE_STEPS.length}:total:`,
  );
  protected readonly privacy = computed(() => healthPrivacy(this.spaceName()));

  protected readonly progress = computed(() =>
    INTAKE_STEPS.map((id, position) => ({
      id,
      number: position + 1,
      name: stepName(id),
      current: id === this.step(),
      done: id !== this.step() && (this.passed().has(id) || isStepDone(id, this.profile())),
    })),
  );

  private readonly check = computed(() => ({ today: this.today(), required: true }));
  private readonly errors = computed(() => stepErrors(this.step(), this.values(), this.check()));
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);
  /** Only the messages that have earned a place on screen: a box left, or Continue pressed. */
  protected readonly shown = computed(() =>
    Object.fromEntries(
      Object.entries(this.errors()).filter(([field, messages]) =>
        this.attempt.shows(field, messages),
      ),
    ),
  );
  private readonly dirty = computed(() => hasChanges(this.values(), this.saved()));

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.pageTitle.setTitle(this.originalTitle);
    });
    effect(() => this.dirtyChange.emit(this.dirty()));
    effect(() =>
      this.pageTitle.setTitle(
        `${this.title()} (${this.kicker().toLowerCase()}) | ${this.originalTitle}`,
      ),
    );
  }

  protected back(): void {
    const previous = INTAKE_STEPS[this.index() - 1];
    if (previous) this.go(previous);
  }

  protected async next(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        { injector: this.injector },
      );
      return;
    }

    const step = this.step();
    const sent = mergeSteps(this.saved(), this.values(), [step]);
    const version = this.profile().version;
    this.busy.set(true);
    this.refusal.set(null);
    try {
      const complete = step === 'start' ? toCompleteRequest(sent, version) : null;
      const outcome =
        step === 'start' && complete
          ? await this.saver().complete(complete)
          : await this.saver().save(toUpdateRequest(sent, version));
      // The page drops the steps when the workspace changes under a save: nothing left to tell.
      if (this.destroyed) return;
      if (!outcome.ok) {
        if (outcome.message === '') return;
        this.refusal.set(outcome.message);
        afterNextRender(
          () =>
            this.host.nativeElement
              .querySelector<HTMLElement>('.refusal')
              ?.scrollIntoView?.({ block: 'nearest' }),
          { injector: this.injector },
        );
        return;
      }
      const after = INTAKE_STEPS[this.index() + 1];
      if (after) this.go(after);
    } finally {
      this.busy.set(false);
    }
  }

  private go(step: IntakeStepId): void {
    this.passed.update((set) => new Set(set).add(this.step()));
    this.chosen.set(step);
    this.refusal.set(null);
    this.attempt.reset();
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }
}
