import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  LOCALE_ID,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button, IconButton } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import {
  choiceMacros,
  kcalText,
  macroLine,
  mealTotal,
  type PlanChoice,
  type PlanMeal,
  type RecipeBook,
  servingsText,
} from './meal-plan-builder.models';

interface OptionRow {
  choice: PlanChoice;
  name: string;
  initials: string;
  perServing: string;
  amount: string | null;
  warning: string | null;
  servingsLabel: string;
  removeLabel: string;
}

/**
 * One meal of the plan in a sheet: its name and the recipes the client chooses between, each with
 * its servings. It edits the page's plan in place and says so through `edited`, so the grid behind
 * it follows every keystroke. Adding a recipe opens the recipe sheet on top of it.
 */
@Component({
  selector: 'app-meal-plan-meal-editor',
  imports: [Button, Control, Field, FormsModule, Icon, IconButton],
  templateUrl: './meal-plan-meal-editor.html',
  styleUrl: './meal-plan-meal-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MealPlanMealEditor {
  private readonly locale = inject(LOCALE_ID);

  readonly meal = input.required<PlanMeal>();
  readonly dayNumber = input.required<number>();
  readonly book = input.required<RecipeBook>();
  /** Increases on every edit, so the sheet redraws what changed in place. */
  readonly revision = input(0);
  /** False at a day's last place for meals, so the coach is told before trying. */
  readonly canAddOption = input(true);

  readonly edited = output<void>();
  readonly addOption = output<void>();
  /** An option to take out, by key; the page removes it and offers Undo. */
  readonly removeOption = output<string>();
  readonly remove = output<void>();
  readonly done = output<void>();

  protected readonly quickNames = [
    $localize`Breakfast`,
    $localize`Lunch`,
    $localize`Dinner`,
    $localize`Snack`,
    $localize`Pre-workout`,
    $localize`Post-workout`,
  ];

  protected readonly rows = computed<OptionRow[]>(() => {
    this.revision();
    const book = this.book();
    return this.meal().choices.map((choice) => {
      const recipe = book.get(choice.recipeVersionId);
      const name = recipe?.name ?? $localize`A recipe that is no longer in your library`;
      const macros = choiceMacros(choice, book);
      return {
        choice,
        name,
        initials: recipe?.initials ?? '?',
        perServing: recipe
          ? $localize`${kcalText(recipe.perServing.calories, this.locale)}:kcal: a serving · ${macroLine(recipe.perServing, this.locale)}:macros:`
          : '',
        amount:
          macros && choice.servings !== null
            ? $localize`${servingsText(choice.servings, this.locale)}:servings: = ${kcalText(macros.calories, this.locale)}:kcal: · ${macroLine(macros, this.locale)}:macros:`
            : null,
        warning: !recipe
          ? $localize`Choose another recipe: this one can’t be published in the plan.`
          : !recipe.isPublished
            ? $localize`This recipe is not published, so the plan can’t be published with it.`
            : null,
        servingsLabel: $localize`Servings of ${name}:recipe:`,
        removeLabel: $localize`Remove ${name}:recipe:`,
      };
    });
  });

  protected readonly total = computed(() => {
    this.revision();
    const meal = this.meal();
    if (meal.choices.length === 0) return null;
    const total = mealTotal(meal, this.book());
    const line = `${kcalText(total.macros.calories, this.locale)} · ${macroLine(total.macros, this.locale)}`;
    return total.isAverage
      ? $localize`This meal, the average of its options: ${line}:total:`
      : $localize`This meal: ${line}:total:`;
  });

  protected rename(name: string): void {
    this.meal().name = name;
    this.changed();
  }

  /** An emptied field is kept as nothing typed yet, not as 0. */
  protected setServings(choice: PlanChoice, value: number | string | null): void {
    const number = value === null || value === '' ? null : Number(value);
    choice.servings = number !== null && Number.isFinite(number) ? number : null;
    this.changed();
  }

  protected changed(): void {
    this.edited.emit();
  }
}
