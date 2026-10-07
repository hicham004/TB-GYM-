import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  LOCALE_ID,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type { AllergenCode, FoodItemView } from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control, Field } from '../../ui/field';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { numeric } from '../training/training-builder.models';
import { FoodApi } from './food-api';
import {
  createFoodRequest,
  draftFromFood,
  editFoodRequest,
  emptyFoodDraft,
  estimatedCalories,
  type FoodDraft,
  foodDraftSignature,
  type FoodField,
  foodProblems,
  type FoodSheetMode,
  policyWords,
  unreportedText,
} from './food.models';
import { ALLERGEN_LABELS } from './nutrition.models';
import { kcal, unitWord } from './recipe.models';

type NumberKey =
  'amount' | 'protein' | 'carbs' | 'fat' | 'fibre' | 'polyols' | 'alcohol' | 'labelCalories';

/**
 * The food sheet (C7, R4.4c): a new food of the coach's own, the next version of one, or a copy of a
 * USDA food to change. The calories add up as the macros are typed, under the workspace's policy;
 * every check is said beside its box, and the first one takes focus on Save.
 */
@Component({
  selector: 'app-food-editor',
  imports: [Button, Checkbox, Control, Field, FormsModule, SegmentedControl],
  templateUrl: './food-editor.html',
  styleUrl: './food-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoodEditor {
  private readonly api = inject(FoodApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  readonly mode = input.required<FoodSheetMode>();
  /** The food to edit or copy; none for a new one. */
  readonly food = input<FoodItemView | null>(null);
  /** The workspace's energy policy, for the calories as typed. */
  readonly policyKey = input<string | null>(null);
  readonly saved = output<FoodItemView>();
  readonly cancelled = output<void>();
  /** Whether the sheet holds something not saved, so closing it can ask first. */
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  /** The sheet's boxes, starting from the food being edited or copied. */
  protected readonly draft = linkedSignal<FoodDraft>(() => {
    const food = this.food();
    return food && this.mode() !== 'new' ? draftFromFood(food) : emptyFoodDraft();
  });
  private readonly startSignature = computed(() => {
    const food = this.food();
    return foodDraftSignature(
      food && this.mode() !== 'new' ? draftFromFood(food) : emptyFoodDraft(),
    );
  });
  readonly dirty = computed(() => foodDraftSignature(this.draft()) !== this.startSignature());
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  /** Someone saved this food since the sheet opened (409 `food_changed`). */
  protected readonly stale = signal(false);
  /** Fibre, sugar alcohols, alcohol and label calories start open when the food has any of them. */
  protected readonly extrasOpen = linkedSignal(() => {
    const food = this.food();
    if (!food || this.mode() === 'new') return false;
    const draft = draftFromFood(food);
    return [draft.fibre, draft.polyols, draft.alcohol, draft.labelCalories].some(
      (value) => value !== null,
    );
  });

  protected readonly allergens = ALLERGEN_LABELS;
  protected readonly basisOptions: readonly SegmentOption[] = [
    { value: 'Raw', label: $localize`Raw` },
    { value: 'Cooked', label: $localize`Cooked` },
    { value: 'AsSold', label: $localize`As sold` },
    { value: 'Prepared', label: $localize`Prepared` },
  ];

  protected readonly problems = computed(() => foodProblems(this.draft()));
  protected readonly estimate = computed(() => {
    const draft = this.draft();
    const calories = estimatedCalories(draft, this.policyKey());
    if (calories === null || draft.amount === null || !(draft.amount > 0)) return null;
    const amount =
      draft.unit === 'Serving' && draft.amount === 1
        ? $localize`a serving`
        : `${draft.amount} ${unitWord(draft.unit)}`;
    return $localize`About ${kcal(calories, this.locale)}:calories: in ${amount}:amount:, ${policyWords(this.policyKey())}:policy:.`;
  });
  protected readonly saveLabel = computed(() =>
    this.mode() === 'edit'
      ? $localize`Save changes`
      : this.mode() === 'copy'
        ? $localize`Save my copy`
        : $localize`Save food`,
  );
  /** What USDA left out of the food being copied, so the coach knows which zeros to check. */
  protected readonly unreported = computed(() => {
    const food = this.food();
    return this.mode() === 'copy' && food?.currentVersion.unreportedNutrients.length
      ? unreportedText(food.currentVersion.unreportedNutrients)
      : null;
  });

  constructor() {
    effect(() => this.dirtyChange.emit(this.dirty()));
  }

  /** The messages for a box, once that box was left or a save was refused. */
  protected shown(field: FoodField): string[] | null {
    const messages = this.problems()
      .filter((problem) => problem.field === field)
      .map((problem) => problem.message);
    return this.attempt.shows(field, messages) ? messages : null;
  }

  protected setName(name: string): void {
    this.draft.update((draft) => ({ ...draft, name }));
  }

  protected setNumber(key: NumberKey, value: number | string | null): void {
    const parsed = value === null || value === '' ? null : numeric(value);
    this.draft.update((draft) => ({ ...draft, [key]: Number.isFinite(parsed) ? parsed : null }));
  }

  protected setUnit(unit: FoodDraft['unit']): void {
    this.draft.update((draft) => ({ ...draft, unit }));
  }

  protected setBasis(basis: string): void {
    this.draft.update((draft) => ({ ...draft, basis: basis as FoodDraft['basis'] }));
  }

  protected toggleAllergen(code: AllergenCode, checked: boolean): void {
    this.draft.update((draft) => ({
      ...draft,
      allergens: checked
        ? [...new Set([...draft.allergens, code])]
        : draft.allergens.filter((item) => item !== code),
    }));
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const problems = this.problems();
    if (problems.length) {
      this.attempt.attempt();
      if (problems.some((problem) => problem.field === 'more')) this.extrasOpen.set(true);
      this.focusFirst(problems[0].field);
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.csrf.refresh();
      const food = this.food();
      const view =
        this.mode() === 'edit' && food
          ? await firstValueFrom(
              this.api.addVersion(
                food.id,
                editFoodRequest(this.draft(), numeric(food.currentRevision)),
              ),
            )
          : await firstValueFrom(this.api.createFood(createFoodRequest(this.draft())));
      this.attempt.reset();
      this.saved.emit(view);
    } catch (error) {
      const code =
        error instanceof HttpErrorResponse
          ? (error.error as { code?: unknown } | null)?.code
          : null;
      if (code === 'food_changed') {
        this.stale.set(true);
      } else {
        this.saveError.set(
          apiErrorMessage(
            error,
            $localize`The food could not be saved. Your numbers are still here; try again.`,
          ),
        );
      }
      afterNextRender(() => this.summary()?.nativeElement.focus(), { injector: this.injector });
    } finally {
      this.saving.set(false);
    }
  }

  private focusFirst(field: FoodField): void {
    afterNextRender(
      () => {
        const target = this.host.nativeElement.querySelector<HTMLElement>(
          `[data-field="${field}"]`,
        );
        target?.focus();
      },
      { injector: this.injector },
    );
  }
}
