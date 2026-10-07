import { CdkDrag, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  LOCALE_ID,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import {
  filterRecipes,
  kcalText,
  macroLine,
  macroSplit,
  type PlanDragItem,
  type PlanRecipe,
} from './meal-plan-builder.models';

interface RecipeRow {
  recipe: PlanRecipe;
  drag: PlanDragItem;
  kcal: string;
  macros: string;
  split: { protein: number; carbs: number; fat: number } | null;
  addLabel: string;
  inMealLabel: string;
}

/**
 * The recipes beside the meal-plan grid (C7): search, and each published recipe with its calories
 * and macros per serving. Beside the grid (`drag`) every row can be dragged onto a meal or under a
 * day; in a sheet (`pick`) every row is a button, which is also how a keyboard or a phone adds one.
 */
@Component({
  selector: 'app-meal-plan-library',
  imports: [Button, CdkDrag, CdkDragPlaceholder, CdkDropList, Icon, RouterLink, Skeleton],
  templateUrl: './meal-plan-library.html',
  styleUrl: './meal-plan-library.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MealPlanLibrary {
  private readonly locale = inject(LOCALE_ID);

  readonly recipes = input.required<readonly PlanRecipe[]>();
  readonly mode = input<'drag' | 'pick'>('drag');
  readonly state = input<'loading' | 'ready' | 'error'>('ready');
  /** The ids of the grid's lists a row can be dropped into. */
  readonly connectedTo = input<string[]>([]);
  /** Recipes the open meal already offers, so a second tap is visible and changes nothing. */
  readonly added = input<ReadonlySet<string>>(new Set());

  readonly pickRecipe = output<PlanRecipe>();
  readonly retry = output<void>();

  protected readonly search = signal('');
  protected readonly loadingLabel = $localize`Loading your recipes…`;
  /** Nothing is ever dropped back into the library. */
  protected readonly never = () => false;
  protected readonly dragDelay = { touch: 250, mouse: 0 };

  protected readonly rows = computed<RecipeRow[]>(() =>
    filterRecipes(this.recipes(), this.search()).map((recipe) => {
      const split = macroSplit({
        calories: recipe.perServing.calories,
        protein: recipe.perServing.protein,
        carbs: recipe.perServing.carbs,
        fat: recipe.perServing.fat,
      });
      return {
        recipe,
        drag: { kind: 'recipe', recipe },
        kcal: $localize`${kcalText(recipe.perServing.calories, this.locale)}:kcal: a serving`,
        macros: macroLine(recipe.perServing, this.locale),
        split: split ? { protein: split.protein, carbs: split.carbs, fat: split.fat } : null,
        addLabel: $localize`Add ${recipe.name}:recipe:`,
        inMealLabel: $localize`${recipe.name}:recipe: is in this meal`,
      };
    }),
  );
  protected readonly noMatch = computed(
    () => $localize`No recipe matches “${this.search().trim()}:search:”.`,
  );
}
