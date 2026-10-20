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
} from '@angular/core';
import type { BodyweightUnit, ClientIntakeProfile } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { Button } from '../../ui/button';
import type { IsoDate } from '../../ui/calendar';
import { Icon } from '../../ui/icon';
import { IntakeFields } from './intake-fields';
import {
  hasChanges,
  healthPrivacy,
  mergeSteps,
  stepErrors,
  toCompleteRequest,
  toUpdateRequest,
  valuesFromProfile,
  type IntakeSaver,
  type IntakeStepId,
  type IntakeSubject,
  type IntakeValues,
} from './intake.models';

/**
 * One group of answers in a sheet (R5.3b): the same boxes as the first-run step, saved on their own.
 * The weight group is the last part of setting up, so its button finishes setting up instead of saving.
 * A refusal stays in the sheet in the server's words and is scrolled into view above the sticky bar.
 */
@Component({
  selector: 'app-intake-edit',
  imports: [Button, Icon, IntakeFields],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      @if (step() === 'start') {
        <p class="muted" i18n>
          This is the weight their progress is measured from. It is recorded once; later weigh-ins
          are added from Progress.
        </p>
      }
      @if (privacy(); as sentence) {
        <p class="privacy">
          <app-icon name="lock" />
          <span>{{ sentence }}</span>
        </p>
      }
      <app-intake-fields
        [step]="step()"
        [(values)]="values"
        [errors]="shown()"
        [today]="today()"
        [firstDay]="firstDay()"
        [subject]="subject()"
        (touched)="attempt.touch($event)"
      />

      @if (attempt.wasTried() && problemCount() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (refusal(); as message) {
        <p class="problem-text refusal" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Not now
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (step() === 'start') {
            <ng-container i18n>Finish setting up</ng-container>
          } @else {
            <ng-container i18n>Save changes</ng-container>
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

    .privacy {
      align-items: flex-start;
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      display: flex;
      font-size: 0.9375rem;
      gap: 0.5rem;
      padding: 0.75rem 0.875rem;
    }

    .privacy app-icon {
      flex: none;
    }

    .problem-text {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-control);
      color: var(--tb-danger);
      font-weight: 600;
      padding: 0.625rem 0.875rem;
      // Scrolled into view clear of the sticky action bar below it.
      scroll-margin-block-end: 5rem;
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
  `,
})
export class IntakeEdit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private destroyed = false;

  readonly step = input.required<IntakeStepId>();
  readonly profile = input.required<ClientIntakeProfile>();
  readonly saver = input.required<IntakeSaver>();
  readonly subject = input<IntakeSubject>({ kind: 'self' });
  readonly today = input.required<IsoDate>();
  readonly firstDay = input<number | null>(null);
  readonly weightUnit = input<BodyweightUnit>('Kilogram');
  /** The coaching space's name, for who sees the client's own health answers. */
  readonly spaceName = input('');
  /** Whether it was saved: the sheet closes either way. */
  readonly closed = output<boolean>();
  /** Whether something has been typed that closing would lose. */
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly refusal = signal<string | null>(null);
  /** The client editing their own health answers is told who sees them, as on the first run (CLIENT-18). */
  protected readonly privacy = computed(() =>
    this.step() === 'health' && this.subject().kind === 'self'
      ? healthPrivacy(this.spaceName())
      : null,
  );

  private readonly saved = computed(() =>
    valuesFromProfile(this.profile(), { today: this.today(), weightUnit: this.weightUnit() }),
  );
  protected readonly values = linkedSignal<IntakeValues>(() => this.saved());

  /**
   * The date of birth, height and a goal are asked for once a profile is finished; a coach filling in
   * what they know of a client who is still setting up may leave them empty.
   */
  private readonly check = computed(() => ({
    today: this.today(),
    required: this.profile().onboardingStatus === 'Completed' || this.subject().kind === 'self',
  }));
  private readonly errors = computed(() => stepErrors(this.step(), this.values(), this.check()));
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);
  protected readonly shown = computed(() =>
    Object.fromEntries(
      Object.entries(this.errors()).filter(([field, messages]) =>
        this.attempt.shows(field, messages),
      ),
    ),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    effect(() => this.dirtyChange.emit(hasChanges(this.values(), this.saved(), [this.step()])));
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        { injector: this.injector },
      );
      return;
    }

    const sent = mergeSteps(this.saved(), this.values(), [this.step()]);
    const version = this.profile().version;
    this.busy.set(true);
    this.refusal.set(null);
    try {
      const complete = this.step() === 'start' ? toCompleteRequest(sent, version) : null;
      const outcome = complete
        ? await this.saver().complete(complete)
        : await this.saver().save(toUpdateRequest(sent, version));
      // The page closes the sheet when the workspace changes under a save: nothing left to tell.
      if (this.destroyed) return;
      if (outcome.ok) {
        this.closed.emit(true);
        return;
      }
      if (outcome.message === '') return;
      this.refusal.set(outcome.message);
      // The refusal is at the foot of the form, where the sticky action bar can cover it.
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>('.refusal')
            ?.scrollIntoView?.({ block: 'nearest' }),
        { injector: this.injector },
      );
    } finally {
      this.busy.set(false);
    }
  }
}
