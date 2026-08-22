import type {
  AiMealDraftView as ContractAiMealDraftView,
  ClientNutritionDayView as ContractClientNutritionDayView,
  ClientNutritionPlanSummary as ContractClientNutritionPlanSummary,
  FoodItemPage as ContractFoodItemPage,
  MealPlanTemplatePage as ContractMealPlanTemplatePage,
  NutritionCalculationView as ContractNutritionCalculationView,
  NutritionWorkspaceSettingsView as ContractNutritionWorkspaceSettingsView,
  ProviderFoodSearchPage as ContractProviderFoodSearchPage,
  RecipePage as ContractRecipePage,
} from '../../core/api/generated';

export interface NutritionSettings {
  energyPolicyKey: string;
  energyPolicyVersion: string;
  providerCalorieTolerance: number;
  aiMonthlyRequestLimit: number;
  aiMonthlyCostLimit: number;
  aiCostCurrency: string;
  version: number;
}

export interface FoodItem {
  id: string;
  name: string;
  provenance: 'UsdaFdc' | 'CoachAuthored' | 'LabelTranscribed';
  currentRevision: number;
  versionId: string;
  basisQuantity: number;
  basisUnit: 'Gram' | 'Millilitre' | 'Serving';
  preparationBasis: 'Raw' | 'Cooked' | 'AsSold' | 'Prepared';
  calories: number;
  providerCalories: number | null;
  discrepancy: boolean;
  protein: number;
  carbohydrate: number;
  fat: number;
}

export interface FoodPage {
  total: number;
  items: FoodItem[];
}

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

export interface MealPlanSummary {
  id: string;
  versionId: string;
  revision: number;
  name: string;
  dayCount: number;
  status: 'Draft' | 'Published';
  targetCalories: number;
  slotCount: number;
}

export interface MealPlanPage {
  total: number;
  items: MealPlanSummary[];
}

export interface NutritionCalculation {
  id: string;
  bmrMethodKey: string;
  bmrEstimate: number;
  activityModelPal: number;
  tdeeEstimate: number;
  coachGoalAdjustment: number;
  calorieTarget: number;
  protein: number;
  carbohydrate: number;
  fat: number;
  warnings: string[];
}

export interface ClientNutritionPlan {
  id: string;
  sourceMealPlanTemplateVersionId: string;
  enrollmentId: string;
  startDate: string;
  endDateExclusive: string;
  calorieTarget: number;
}

export interface NutritionChoice {
  id: string;
  recipeName: string;
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
  safetyNotice: string;
  logVersion: number | null;
}

export interface ProviderFoodSearch {
  items: { externalId: string; name: string; dataType: string }[];
  failureCode: string | null;
  message: string | null;
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

export function mapNutritionSettings(
  value: ContractNutritionWorkspaceSettingsView,
): NutritionSettings {
  return {
    ...value,
    providerCalorieTolerance: numeric(value.providerCalorieTolerance),
    aiMonthlyRequestLimit: numeric(value.aiMonthlyRequestLimit),
    aiMonthlyCostLimit: numeric(value.aiMonthlyCostLimit),
    version: numeric(value.version),
  };
}

export function mapFoodPage(value: ContractFoodItemPage): FoodPage {
  return {
    total: numeric(value.total),
    items: value.items.map((item) => ({
      id: item.id,
      name: item.name,
      provenance: item.provenance,
      currentRevision: numeric(item.currentRevision),
      versionId: item.currentVersion.id,
      basisQuantity: numeric(item.currentVersion.basisQuantity),
      basisUnit: item.currentVersion.basisUnit,
      preparationBasis: item.currentVersion.preparationBasis,
      calories: numeric(item.currentVersion.computedCalories),
      providerCalories: nullableNumeric(item.currentVersion.providerCalories),
      discrepancy: item.currentVersion.hasCalorieDiscrepancy,
      protein: numeric(item.currentVersion.proteinGrams),
      carbohydrate: numeric(item.currentVersion.carbohydrateGrams),
      fat: numeric(item.currentVersion.fatGrams),
    })),
  };
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

export function mapMealPlanPage(value: ContractMealPlanTemplatePage): MealPlanPage {
  return {
    total: numeric(value.total),
    items: value.items.map((item) => ({
      id: item.id,
      versionId: item.versionId,
      revision: numeric(item.revision),
      name: item.name,
      dayCount: numeric(item.dayCount),
      status: item.status,
      targetCalories: numeric(item.targetCalories),
      slotCount: numeric(item.slotCount),
    })),
  };
}

export function mapCalculation(value: ContractNutritionCalculationView): NutritionCalculation {
  return {
    id: value.id,
    bmrMethodKey: value.bmrMethodKey,
    bmrEstimate: numeric(value.bmrEstimate),
    activityModelPal: numeric(value.activityModelPal),
    tdeeEstimate: numeric(value.tdeeEstimate),
    coachGoalAdjustment: numeric(value.coachGoalAdjustment),
    calorieTarget: numeric(value.calorieTarget),
    protein: numeric(value.proteinGrams),
    carbohydrate: numeric(value.carbohydrateGrams),
    fat: numeric(value.fatGrams),
    warnings: value.warnings,
  };
}

export function mapClientPlan(value: ContractClientNutritionPlanSummary): ClientNutritionPlan {
  return { ...value, calorieTarget: numeric(value.calorieTarget) };
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
      choices: slot.choices.map((choice) => ({
        id: choice.id,
        recipeName: choice.recipeName,
        servings: numeric(choice.servings),
        calories: numeric(choice.calories),
        protein: numeric(choice.proteinGrams),
        carbohydrate: numeric(choice.carbohydrateGrams),
        fat: numeric(choice.fatGrams),
      })),
    })),
    safetyNotice: value.safetyNotice,
    logVersion: value.dailyLogVersion === null ? null : numeric(value.dailyLogVersion),
  };
}

export function mapProviderSearch(value: ContractProviderFoodSearchPage): ProviderFoodSearch {
  return {
    items: value.items.map((item) => ({
      externalId: item.externalId,
      name: item.name,
      dataType: item.dataType,
    })),
    failureCode: value.failureCode ?? null,
    message: value.message ?? null,
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
