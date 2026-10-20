import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type { AllergenCode, MealPlanTemplateSummary } from '../../core/api/generated';
import { SheetForm } from '../../core/forms/sheet-form';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { Skeleton } from '../../ui/skeleton';
import { dayWords } from '../progress/progress-entries.models';
import { ClientNutritionApi } from './client-nutrition-api';
import {
  allergenList,
  assignRefusal,
  mapPlan,
  refusalCode,
  runsWords,
  startIssue,
  workedOutOn,
  type NutritionCover,
  type PlanRow,
  type WorkedOut,
} from './client-nutrition.models';
import { MealPlanApi } from './meal-plan-api';

/**
 * Assign a meal plan, in a sheet (R5.3d): which plan, which worked-out targets it carries to the client,
 * under which of their plans and from which day. A start the server would refuse (outside their paid
 * Nutrition, or on top of a plan they already have) is told in words before anything is sent, and an
 * allergen the client declared that a recipe lists asks the coach to look first. The server decides.
 */
@Component({
  selector: 'app-assign-meal-plan',
  imports: [Button, Checkbox, Control, DateField, DecimalPipe, EntryActions, Field, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted" data-declared>
        @if (declared().length > 0) {
          <span i18n>{{ firstName() }} declared these allergens:</span>&ngsp;<strong>{{
            declaredWords()
          }}</strong
          >.
        } @else {
          <span i18n>{{ firstName() }} has no allergens declared.</span>
        }
      </p>

      <fieldset class="group">
        <legend i18n>Meal plan</legend>
        @if (library() === null && !loadFailed()) {
          <app-skeleton [label]="loadingLabel" [lines]="3" />
        } @else if (loadFailed()) {
          <div class="problem-text" role="alert">
            <span i18n>The meal plans could not be loaded.</span>&ngsp;
            <button appButton type="button" variant="text" (click)="load()" i18n>Try again</button>
          </div>
        } @else if (plans().length === 0) {
          <p class="about" data-no-plans>
            <span i18n
              >There is no published meal plan yet. Publish one in Nutrition, then come back.</span
            >
          </p>
        } @else {
          <div class="choices" role="radiogroup" [attr.aria-label]="planLabel">
            @for (plan of plans(); track plan.versionId) {
              <label class="choice" [class.chosen]="chosen() === plan.versionId">
                <input
                  type="radio"
                  name="plan"
                  [value]="plan.versionId"
                  [checked]="chosen() === plan.versionId"
                  [attr.aria-invalid]="shows('plan', planIssues()) ? 'true' : null"
                  [attr.aria-describedby]="shows('plan', planIssues()) ? 'plan-error' : null"
                  (change)="choose(plan.versionId)"
                />
                <span class="choice-text">
                  <strong>{{ plan.name }}</strong
                  >&ngsp;<span class="muted" i18n
                    >{{ plan.dayCount }} days, built for about
                    {{ plan.targetCalories | number: '1.0-0' }} calories a day</span
                  >
                </span>
              </label>
            }
          </div>
          @if (shows('plan', planIssues())) {
            <p class="problem" id="plan-error" role="status">{{ planIssues()[0] }}</p>
          }
        }
      </fieldset>

      <fieldset class="group">
        <legend i18n>Targets the client sees</legend>
        @if (picked(); as targets) {
          <p class="about" data-targets>
            <strong i18n>{{ targets.calories | number: '1.0-0' }} calories a day</strong>&ngsp;
            @if (targets.adjustment) {
              <span class="muted" i18n
                >{{ targets.protein | number: '1.0-0' }} g protein ·
                {{ targets.carbohydrate | number: '1.0-0' }} g carbs ·
                {{ targets.fat | number: '1.0-0' }} g fat, your macros set {{ pickedOn() }}</span
              >
            } @else {
              <span class="muted" i18n
                >{{ targets.protein | number: '1.0-0' }} g protein ·
                {{ targets.carbohydrate | number: '1.0-0' }} g carbs ·
                {{ targets.fat | number: '1.0-0' }} g fat, worked out {{ pickedOn() }}</span
              >
            }
          </p>
          @if (calculations().length > 1) {
            <app-field [label]="targetsLabel">
              <select
                appControl
                name="targets"
                [value]="pickedId() ?? ''"
                (change)="pickedId.set($any($event.target).value)"
              >
                @for (item of calculations(); track item.id) {
                  <option [value]="item.id" [selected]="item.id === pickedId()">
                    {{ workedWords(item) }}
                  </option>
                }
              </select>
            </app-field>
          }
          <button appButton type="button" variant="text" (click)="workOut.emit()" data-again i18n>
            Work out new targets first
          </button>
        } @else {
          <div class="about" data-no-targets>
            <span i18n
              >No targets have been worked out for {{ firstName() }} yet. A meal plan carries the
              calories and macros the client sees.</span
            >
            <button appButton type="button" variant="outlined" (click)="workOut.emit()" i18n>
              Work out targets
            </button>
          </div>
          @if (shows('targets', targetIssues())) {
            <p class="problem" role="status">{{ targetIssues()[0] }}</p>
          }
        }
      </fieldset>

      <fieldset class="group">
        <legend i18n>When</legend>
        @if (covers().length > 1) {
          <app-field [label]="coverLabel">
            <select
              appControl
              name="cover"
              [value]="coverId() ?? ''"
              (change)="coverId.set($any($event.target).value)"
            >
              @for (item of covers(); track item.id) {
                <option [value]="item.id" [selected]="item.id === coverId()">
                  {{ coverWords(item) }}
                </option>
              }
            </select>
          </app-field>
        } @else if (cover(); as only) {
          <p class="muted" data-cover>{{ coverWords(only) }}</p>
        }
        <app-date-field
          [label]="startLabel"
          [help]="runs()"
          [errors]="shows('start', startIssues()) ? startIssues() : null"
          [(value)]="start"
          [min]="cover()?.start ?? null"
          [today]="today()"
          (touched)="attempt.touch('start')"
        />
      </fieldset>

      @if (reviewing()) {
        <div class="review" role="status" data-review>
          <p>
            <strong i18n>Look at the recipes first.</strong>&ngsp;<span i18n
              >{{ firstName() }} declared an allergen that recipes in this plan list. TB Gym can’t
              tell you a recipe is safe, so check them and decide.</span
            >
          </p>
          <app-checkbox [label]="reviewedLabel">
            <input
              appControl
              type="checkbox"
              name="reviewed"
              [checked]="reviewed()"
              (change)="reviewed.set($any($event.target).checked)"
            />
          </app-checkbox>
          @if (shows('reviewed', reviewIssues())) {
            <p class="problem" role="status">{{ reviewIssues()[0] }}</p>
          }
        </div>
      }

      @if (attempt.wasTried() && problems() > 0) {
        <p class="problem-text" role="alert" i18n>Check what is marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text refusal" role="alert">{{ message }}</p>
      }
      <app-entry-actions
        [saveLabel]="reviewing() ? anywayLabel : saveLabel"
        [busyLabel]="assigningLabel"
        [busy]="busy()"
        (notNow)="closed.emit(null)"
      />
    </form>
  `,
  styles: [
    SHEET_STYLES,
    `
      .group {
        border: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin: 0;
        min-inline-size: 0;
        padding: 0;
      }

      .group > legend {
        color: var(--tb-ink);
        font-size: 1rem;
        font-weight: 600;
        margin-block-end: 0.5rem;
        padding: 0;
      }

      .choices {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .choice {
        align-items: flex-start;
        background: var(--tb-surface);
        border: 1px solid var(--tb-line-strong);
        border-radius: var(--tb-radius-control);
        color: var(--tb-ink);
        cursor: pointer;
        display: flex;
        gap: 0.625rem;
        min-block-size: 2.75rem;
        padding: 0.625rem 0.875rem;
      }

      .choice:hover {
        border-color: var(--tb-ink);
      }

      .choice.chosen {
        background: var(--tb-accent-soft);
        border-color: var(--tb-accent-ink);
      }

      .choice:has(input:focus-visible) {
        outline: 2px solid var(--tb-focus);
        outline-offset: 2px;
      }

      .choice input[type='radio'] {
        accent-color: var(--tb-accent-ink);
        block-size: 1.125rem;
        flex: none;
        inline-size: 1.125rem;
        margin: 0.125rem 0 0;
      }

      // A label's direct span is bold in the legacy global styles; the hint under a name is not.
      .choice-text {
        display: flex;
        flex-direction: column;
        font-weight: 400;
        gap: 0.125rem;
        min-inline-size: 0;
      }

      // The legacy global styles still colour a bare strong; these cards take the mode's own ink.
      .choice-text strong {
        color: var(--tb-ink);
      }

      .problem {
        color: var(--tb-danger);
        font-size: 0.875rem;
        margin: 0.25rem 0 0;
      }

      .about {
        align-items: flex-start;
        gap: 0.5rem;
      }

      .review {
        background: var(--tb-warning-soft);
        border-radius: var(--tb-radius-control);
        color: var(--tb-ink);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem 0.875rem;
        scroll-margin-block-end: 5rem;
      }
    `,
  ],
})
export class AssignMealPlan extends SheetForm implements OnInit {
  private readonly api = inject(ClientNutritionApi);
  private readonly mealPlans = inject(MealPlanApi);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<string>();
  readonly locale = input<string>('en');
  readonly timeZone = input<string>('UTC');
  /** The plans of theirs a meal plan may sit under, and the meal plans they already have. */
  readonly covers = input.required<readonly NutritionCover[]>();
  readonly existing = input<readonly PlanRow[]>([]);
  /** The targets worked out for them, newest first. */
  readonly calculations = input<readonly WorkedOut[]>([]);
  readonly declared = input<readonly AllergenCode[]>([]);
  /** The meal plan that was assigned, or null when the sheet was closed without one. */
  readonly closed = output<PlanRow | null>();
  /** The coach wants to work targets out first. */
  readonly workOut = output<void>();

  protected readonly loadingLabel = $localize`Reading the meal plans`;
  protected readonly planLabel = $localize`Meal plan`;
  protected readonly targetsLabel = $localize`Use the targets from`;
  protected readonly coverLabel = $localize`Under which plan`;
  protected readonly startLabel = $localize`First day`;
  protected readonly reviewedLabel = $localize`I have looked at the recipes and want to assign this plan.`;
  protected readonly saveLabel = $localize`Assign meal plan`;
  protected readonly anywayLabel = $localize`Assign anyway`;
  protected readonly assigningLabel = $localize`Assigning…`;

  protected readonly library = signal<MealPlanTemplateSummary[] | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly chosen = signal<string | null>(null);
  protected readonly pickedId = linkedSignal<string | null>(
    () => this.calculations()[0]?.id ?? null,
  );
  protected readonly coverId = linkedSignal<string | null>(() => {
    const today = this.today();
    const covers = this.covers();
    return (
      (covers.find((item) => item.start <= today && today <= item.last) ?? covers[0])?.id ?? null
    );
  });
  protected readonly start = linkedSignal(() => this.today());
  protected readonly reviewing = signal(false);
  protected readonly reviewed = signal(false);

  protected readonly plans = computed(() =>
    (this.library() ?? []).filter((item) => item.status === 'Published'),
  );
  protected readonly plan = computed(
    () => this.plans().find((item) => item.versionId === this.chosen()) ?? null,
  );
  protected readonly picked = computed(
    () => this.calculations().find((item) => item.id === this.pickedId()) ?? null,
  );
  protected readonly cover = computed(
    () => this.covers().find((item) => item.id === this.coverId()) ?? null,
  );
  protected readonly declaredWords = computed(() => allergenList(this.declared()));
  protected readonly pickedOn = computed(() => {
    const picked = this.picked();
    return picked
      ? workedOutOn(picked.calculatedAtUtc, this.timeZone(), this.today(), this.locale())
      : '';
  });

  protected readonly planIssues = computed(() =>
    this.plan() === null ? [$localize`Choose the meal plan to assign.`] : [],
  );
  protected readonly startIssues = computed(() => {
    const plan = this.plan();
    if (plan === null) return [];
    const issue = startIssue(
      this.cover(),
      this.existing(),
      this.start(),
      Number(plan.dayCount),
      this.today(),
      this.locale(),
      this.firstName(),
    );
    return issue === null ? [] : [issue];
  });
  protected readonly targetIssues = computed(() =>
    this.picked() === null
      ? [$localize`Work out targets first: a meal plan carries them to the client.`]
      : [],
  );
  protected readonly reviewIssues = computed(() =>
    this.reviewing() && !this.reviewed()
      ? [$localize`Tick the box to say you have looked at the recipes.`]
      : [],
  );
  protected readonly problems = computed(
    () =>
      this.planIssues().length +
      this.targetIssues().length +
      this.startIssues().length +
      this.reviewIssues().length,
  );
  protected readonly runs = computed(() => {
    const plan = this.plan();
    return plan
      ? runsWords(this.start(), Number(plan.dayCount), this.today(), this.locale())
      : null;
  });

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(this.chosen() !== null || this.start() !== this.today()));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    return this.scope.run('library', async (owner) => {
      this.loadFailed.set(false);
      try {
        const page = await owner.wait(firstValueFrom(this.mealPlans.listPlans(0, 100)));
        this.library.set(page.items);
        const published = page.items.filter((item) => item.status === 'Published');
        if (published.length === 1 && this.chosen() === null) {
          this.chosen.set(published[0].versionId);
        }
      } catch {
        if (owner.current) this.loadFailed.set(true);
      }
    });
  }

  protected choose(versionId: string): void {
    this.chosen.set(versionId);
    // A review was about the plan chosen before.
    this.reviewing.set(false);
    this.reviewed.set(false);
  }

  protected workedWords(item: WorkedOut): string {
    const calories = Math.round(item.calories).toLocaleString('en');
    const when = workedOutOn(item.calculatedAtUtc, this.timeZone(), this.today(), this.locale());
    return item.adjustment
      ? $localize`${when}:when:, your macros, ${calories}:calories: calories a day`
      : $localize`${when}:when:, ${calories}:calories: calories a day`;
  }

  protected coverWords(item: NutritionCover): string {
    const first = dayWords(item.start, this.today(), this.locale());
    const last = dayWords(item.last, this.today(), this.locale());
    return $localize`${item.label}:plan:, ${first}:first: – ${last}:last:`;
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    const plan = this.plan();
    const targets = this.picked();
    const cover = this.cover();
    if (this.problems() > 0 || plan === null || targets === null || cover === null) {
      this.refuse();
      return;
    }
    const acknowledge = this.reviewing() && this.reviewed();
    let assigned = null as PlanRow | null;
    let askedToReview = false as boolean;
    const ok = await this.send(
      async (owner) => {
        try {
          const summary = await owner.wait(
            firstValueFrom(
              this.api.assign(this.clientId(), {
                mealPlanTemplateVersionId: plan.versionId,
                enrollmentId: cover.id,
                calculationSnapshotId: targets.id,
                startDate: this.start(),
                acknowledgeAllergenWarnings: acknowledge,
              }),
            ),
          );
          assigned = mapPlan(summary, this.today());
        } catch (error) {
          if (refusalCode(error) === 'allergen_review_required') {
            askedToReview = true;
            return;
          }
          throw error;
        }
      },
      (error) => this.refusalWords(error, cover),
    );
    if (ok && askedToReview) {
      this.reviewing.set(true);
      this.reviewed.set(false);
      this.reveal('[data-review]');
      return;
    }
    if (ok && assigned) this.closed.emit(assigned);
  }

  private refusalWords(error: unknown, cover: NutritionCover): string {
    const message = apiErrorMessage(
      error,
      $localize`The meal plan could not be assigned. Try again.`,
    );
    const window = `${dayWords(cover.start, this.today(), this.locale())} – ${dayWords(cover.last, this.today(), this.locale())}`;
    return assignRefusal(refusalCode(error), message, this.firstName(), window);
  }
}
