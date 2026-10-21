import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { SheetForm } from '../../core/forms/sheet-form';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { dayWords } from '../progress/progress-entries.models';
import { ClientNutritionApi } from './client-nutrition-api';
import {
  mapPlan,
  planDates,
  refusalCode,
  STOP_REASON_LIMIT,
  stopReasonErrors,
  stopRefusal,
  type PlanRow,
} from './client-nutrition.models';

/** What stopping came to: the plan as stopped, and whether it was stopped elsewhere first. */
export interface StopOutcome {
  readonly row: PlanRow;
  readonly already: boolean;
}

/**
 * Stop a meal plan, in a sheet (NCM-1, NUT-011): a plan assigned to the wrong client or on the wrong
 * dates no longer stays on the client's phone until it ends. The coach says why; the plan stops at once,
 * stays in the list as stopped with the reason, and its days come free for a corrected plan. Stopping
 * is one way, so the sheet says so before it is pressed. A plan stopped elsewhere meanwhile counts as
 * stopped; one that changed meanwhile is read again and the coach decides once more.
 */
@Component({
  selector: 'app-stop-meal-plan',
  imports: [Control, EntryActions, Field, FormSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="about" data-stopping>
        <strong dir="auto">{{ plan().name }}</strong
        >&ngsp;<span class="muted">{{ dates() }}</span>
      </p>
      <p data-effect>{{ effectWords() }}</p>
      <p class="muted" i18n>You can’t undo this. Assign a meal plan again to give them another.</p>
      <app-field
        [label]="reasonLabel"
        [help]="reasonHelp()"
        [errors]="shows('reason', reasonErrors()) ? reasonErrors() : null"
      >
        <textarea
          appControl
          name="reason"
          rows="3"
          [attr.maxlength]="limit"
          [value]="reason()"
          (input)="reason.set($any($event.target).value)"
          (blur)="attempt.touch('reason')"
        ></textarea>
      </app-field>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        }
      </app-form-summary>
      <app-entry-actions
        [saveLabel]="stopLabel"
        [busyLabel]="stoppingLabel"
        [busy]="busy()"
        [cancelLabel]="keepLabel"
        (notNow)="closed.emit(null)"
      />
    </form>
  `,
  styles: [SHEET_STYLES],
})
export class StopMealPlan extends SheetForm {
  private readonly api = inject(ClientNutritionApi);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** The plan to stop, as the page has it now (a re-read gives it a new version). */
  readonly plan = input.required<PlanRow>();
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<string>();
  readonly locale = input<string>('en');
  /** The plan as stopped, or null when the sheet was closed without stopping it. */
  readonly closed = output<StopOutcome | null>();
  /** The plan changed since the page read it, so the page reads its plans again. */
  readonly stale = output<void>();

  protected readonly limit = STOP_REASON_LIMIT;
  protected readonly reasonLabel = $localize`Why are you stopping it?`;
  protected readonly stopLabel = $localize`Stop meal plan`;
  protected readonly stoppingLabel = $localize`Stopping…`;
  protected readonly keepLabel = $localize`Keep it`;
  protected readonly reason = signal('');
  protected readonly reasonErrors = computed(() => stopReasonErrors(this.reason()));
  protected readonly reasonHelp = computed(
    () =>
      $localize`Kept with the plan, where you and your team see it. ${this.firstName()}:name: doesn’t.`,
  );
  protected readonly dates = computed(() => planDates(this.plan(), this.today(), this.locale()));
  protected readonly effectWords = computed(() => {
    const plan = this.plan();
    return plan.state === 'coming'
      ? $localize`It won’t start on ${dayWords(plan.start, this.today(), this.locale())}:day:, and its days come free for another meal plan.`
      : $localize`${this.firstName()}:name: stops seeing it at once, today included. What they logged is kept, and its days come free for another meal plan.`;
  });

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(this.reason().trim() !== ''));
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.reasonErrors().length > 0) {
      this.refuse();
      return;
    }
    const plan = this.plan();
    let outcome = null as StopOutcome | null;
    let changed = false as boolean;
    const ok = await this.send(
      async (owner) => {
        try {
          const summary = await owner.wait(
            firstValueFrom(
              this.api.stop(this.clientId(), plan.id, {
                reason: this.reason().trim(),
                version: plan.version,
              }),
            ),
          );
          outcome = { row: mapPlan(summary, this.today()), already: false };
        } catch (error) {
          const code = refusalCode(error);
          if (code === 'nutrition_plan_already_cancelled') {
            outcome = { row: { ...plan, state: 'stopped' }, already: true };
            return;
          }
          if (code === 'nutrition_plan_conflict') changed = true;
          throw error;
        }
      },
      (error) =>
        stopRefusal(
          refusalCode(error),
          apiErrorMessage(error, $localize`The meal plan could not be stopped. Try again.`),
        ),
    );
    if (changed) this.stale.emit();
    if (ok && outcome) this.closed.emit(outcome);
  }
}
