import type {
  AiMealDraftView as ContractAiMealDraftView,
  AllergenCode,
  ClientNutritionDayView as ContractClientNutritionDayView,
  RecipePage as ContractRecipePage,
} from '../../core/api/generated';

/** The order allergens are offered in, and the names a coach reads for each stored code. */
export const ALLERGEN_LABELS: readonly { code: AllergenCode; label: string }[] = [
  { code: 'GlutenCereals', label: $localize`Gluten` },
  { code: 'Crustaceans', label: $localize`Crustaceans (shrimp, crab)` },
  { code: 'Eggs', label: $localize`Eggs` },
  { code: 'Fish', label: $localize`Fish` },
  { code: 'Peanuts', label: $localize`Peanuts` },
  { code: 'Soybeans', label: $localize`Soy` },
  { code: 'Milk', label: $localize`Milk` },
  { code: 'TreeNuts', label: $localize`Tree nuts` },
  { code: 'Celery', label: $localize`Celery` },
  { code: 'Mustard', label: $localize`Mustard` },
  { code: 'Sesame', label: $localize`Sesame` },
  { code: 'SulphurDioxideAndSulphites', label: $localize`Sulphites` },
  { code: 'Lupin', label: $localize`Lupin` },
  { code: 'Molluscs', label: $localize`Molluscs (mussels, squid)` },
];

export interface RecipeSummary {
  id: string;
  versionId: string;
  revision: number;
  name: string;
  status: 'Draft' | 'Published';
  servings: number;
  calories: number;
  protein: number;
  carbohydrate: number;
  fat: number;
  allergens: string[];
}

export interface RecipePage {
  total: number;
  items: RecipeSummary[];
}

export interface NutritionChoice {
  id: string;
  recipeName: string;
  /** The client's copy of the recipe, which their day opens (R4.4d); null when there is none. */
  recipeId: string | null;
  /** That copy's cover photo, shown on the meal card once granted; null when it has none. */
  photoId: string | null;
  servings: number;
  calories: number;
  protein: number;
  carbohydrate: number;
  fat: number;
}

export interface NutritionSlot {
  id: string;
  name: string;
  order: number;
  choices: NutritionChoice[];
  selectedChoiceId: string | null;
  actualServings: number | null;
  /** The server's calories for the amount logged (CLIENT-10); null while the meal is not logged. */
  loggedCalories: number | null;
}

export interface NutritionDay {
  planId: string;
  planDayId: string;
  date: string;
  targetCalories: number;
  targetProtein: number;
  targetCarbohydrate: number;
  targetFat: number;
  dailyLogId: string | null;
  logStatus: 'InProgress' | 'Completed' | null;
  selectedCalories: number;
  selectedProtein: number;
  selectedCarbohydrate: number;
  selectedFat: number;
  slots: NutritionSlot[];
  customFoods: {
    id: string;
    name: string;
    amount: number;
    unit: 'Gram' | 'Millilitre' | 'Serving';
    calories: number;
    protein: number;
    carbohydrate: number;
    fat: number;
  }[];
  safetyNotice: string;
  logVersion: number | null;
}

export interface AiMealDraft {
  id: string;
  status: 'Pending' | 'Failed' | 'AwaitingCoachReview' | 'Approved' | 'Rejected';
  model: string | null;
  modelVersion: string | null;
  validatedDraftJson: string | null;
  uncertainFieldsJson: string | null;
  failureCode: string | null;
  createdRecipeVersionId: string | null;
}

export function mapRecipePage(value: ContractRecipePage): RecipePage {
  return {
    total: numeric(value.total),
    items: value.items.map((item) => ({
      id: item.id,
      versionId: item.versionId,
      revision: numeric(item.revision),
      name: item.name,
      status: item.status,
      servings: numeric(item.servings),
      calories: numeric(item.calories),
      protein: numeric(item.proteinGrams),
      carbohydrate: numeric(item.carbohydrateGrams),
      fat: numeric(item.fatGrams),
      allergens: item.declaredAllergens,
    })),
  };
}

export function mapNutritionDay(value: ContractClientNutritionDayView): NutritionDay {
  return {
    planId: value.planId,
    planDayId: value.planDayId,
    date: value.date,
    targetCalories: numeric(value.targetCalories),
    targetProtein: numeric(value.targetProteinGrams),
    targetCarbohydrate: numeric(value.targetCarbohydrateGrams),
    targetFat: numeric(value.targetFatGrams),
    dailyLogId: value.dailyLogId,
    logStatus: value.logStatus,
    selectedCalories: numeric(value.selectedCalories),
    selectedProtein: numeric(value.selectedProteinGrams),
    selectedCarbohydrate: numeric(value.selectedCarbohydrateGrams),
    selectedFat: numeric(value.selectedFatGrams),
    slots: value.slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      order: numeric(slot.order),
      selectedChoiceId: slot.selectedChoiceId,
      actualServings: nullableNumeric(slot.actualServings),
      loggedCalories: nullableNumeric(slot.loggedCalories ?? null),
      choices: slot.choices.map((choice) => ({
        id: choice.id,
        recipeName: choice.recipeName,
        recipeId: choice.recipeId ?? null,
        photoId: choice.recipePhotoMediaAssetId ?? null,
        servings: numeric(choice.servings),
        calories: numeric(choice.calories),
        protein: numeric(choice.proteinGrams),
        carbohydrate: numeric(choice.carbohydrateGrams),
        fat: numeric(choice.fatGrams),
      })),
    })),
    customFoods: (value.customFoods ?? []).map((food) => ({
      id: food.id,
      name: food.name,
      amount: numeric(food.amount),
      unit: food.unit,
      calories: numeric(food.calories),
      protein: numeric(food.proteinGrams),
      carbohydrate: numeric(food.carbohydrateGrams),
      fat: numeric(food.fatGrams),
    })),
    safetyNotice: value.safetyNotice,
    logVersion: value.dailyLogVersion === null ? null : numeric(value.dailyLogVersion),
  };
}

export function mapAiDraft(value: ContractAiMealDraftView): AiMealDraft {
  return {
    id: value.id,
    status: value.status,
    model: value.model,
    modelVersion: value.modelVersion,
    validatedDraftJson: value.validatedDraftJson,
    uncertainFieldsJson: value.uncertainFieldsJson,
    failureCode: value.failureCode,
    createdRecipeVersionId: value.createdRecipeVersionId,
  };
}

export function numeric(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function nullableNumeric(value: number | string | null): number | null {
  return value === null ? null : numeric(value);
}
