import { formatDate, formatNumber } from '@angular/common';
import type {
  AddFoodVersionRequest,
  AllergenCode,
  CreateFoodItemRequest,
  FoodItemView,
  FoodQuantityUnit,
  FoodSearchKind,
  FoodSearchResult,
  PreparationBasis,
  UnreportedNutrient,
} from '../../core/api/generated';
import { nullableNumeric, numeric } from '../training/training-builder.models';
import type { Macros } from './meal-plan-builder.models';
import { ALLERGEN_LABELS } from './nutrition.models';
import { allergenText, energySplit, grams, kcal, sourceWord, unitWord } from './recipe.models';

/**
 * The Foods page's own logic (C7, R4.4c), kept out of the components so it is tested on its own: a
 * row for each of the coach's foods and each USDA match, the food sheet's draft and its checks, the
 * calories it adds up to as it is typed, and the requests it sends.
 *
 * Calories as typed follow the workspace's energy policy, the same factors the server uses
 * (NutritionCalculations.cs); the server works them out again and what it saves is what the page
 * shows (NUT-002).
 */

export const MAX_FOOD_NAME = 300;
export const MAX_AMOUNT = 1_000_000;
/** USDA is asked only once a word is long enough to mean something; it is slower and paged. */
export const USDA_MINIMUM = 3;

export type UsdaKind = FoodSearchKind;

const PREPARATION_WORDS: Record<PreparationBasis, string> = {
  Raw: $localize`raw`,
  Cooked: $localize`cooked`,
  AsSold: $localize`as sold`,
  Prepared: $localize`prepared`,
};

export function preparationWord(basis: PreparationBasis): string {
  return PREPARATION_WORDS[basis];
}

const UNREPORTED_WORDS: Record<UnreportedNutrient, string> = {
  Fibre: $localize`fibre`,
  Polyols: $localize`sugar alcohols`,
  Ethanol: $localize`alcohol`,
};

/**
 * What a missing value is worth checking in Foods (NCM-9). USDA almost never reports sugar alcohols,
 * and reports alcohol only for drinks, so their absence is the usual case and flagging it marked every
 * import; a missing fibre is worth a look. The food's details still name everything USDA left out.
 */
const WORTH_CHECKING: ReadonlySet<UnreportedNutrient> = new Set(['Fibre']);

/** Whether carbs are typed as an EU label prints them, without the fibre (C6, NCM-3). */
export function carbsWithoutFibre(policyKey: string | null): boolean {
  return policyKey === 'Eu1169';
}

function macroLine(macros: Macros, locale: string): string {
  return $localize`P ${grams(macros.protein, locale)}:protein: · C ${grams(macros.carbs, locale)}:carbs: · F ${grams(macros.fat, locale)}:fat:`;
}

function per(quantity: number, unit: FoodQuantityUnit, locale: string): string {
  return unit === 'Serving' && quantity === 1
    ? $localize`per serving`
    : $localize`per ${formatNumber(quantity, locale, '1.0-2')}:quantity: ${unitWord(unit)}:unit:`;
}

// ---------- the list ----------

export interface FoodRow {
  id: string;
  name: string;
  /** The coach's own food, which is edited in place; a USDA copy is edited as a copy. */
  own: boolean;
  /** "Your food · raw · per 100 g". */
  meta: string;
  kcal: string;
  macros: string;
  split: { protein: number; carbs: number; fat: number } | null;
  allergens: string;
  /** Set when the label's calories and the macros disagree, or USDA left a nutrient out. */
  flag: string | null;
  /** USDA's id, so a match already copied says so. */
  externalId: string | null;
}

export function foodRow(view: FoodItemView, locale: string): FoodRow {
  const version = view.currentVersion;
  const macros: Macros = {
    calories: numeric(version.computedCalories),
    protein: numeric(version.proteinGrams),
    carbs: numeric(version.carbohydrateGrams),
    fat: numeric(version.fatGrams),
  };
  return {
    id: view.id,
    name: view.name,
    own: view.provenance !== 'UsdaFdc',
    meta: [
      sourceWord(view.provenance),
      preparationWord(version.preparationBasis),
      per(numeric(version.basisQuantity), version.basisUnit, locale),
    ].join(' · '),
    kcal: kcal(macros.calories, locale),
    macros: macroLine(macros, locale),
    split: energySplit(macros),
    allergens: allergenText(version.declaredAllergens),
    flag: version.hasCalorieDiscrepancy
      ? $localize`Label calories differ`
      : version.unreportedNutrients.some((nutrient) => WORTH_CHECKING.has(nutrient))
        ? $localize`Check ${unreportedText(version.unreportedNutrients.filter((nutrient) => WORTH_CHECKING.has(nutrient)))}:nutrients:`
        : null,
    externalId: view.provenance === 'UsdaFdc' ? (view.externalId ?? null) : null,
  };
}

export interface UsdaRow {
  fdcId: string;
  name: string;
  brand: string | null;
  /** What USDA states per 100 g, or null for a match without an energy figure. */
  kcal: string | null;
  macros: string | null;
  split: { protein: number; carbs: number; fat: number } | null;
  /** "FoodData Central 2646170 · Foundation", shown only behind the details switch (plan C7). */
  database: string;
}

export function usdaRow(result: FoodSearchResult, locale: string): UsdaRow {
  const protein = nullableNumeric(result.proteinGrams ?? null);
  const carbs = nullableNumeric(result.carbohydrateGrams ?? null);
  const fat = nullableNumeric(result.fatGrams ?? null);
  const calories = nullableNumeric(result.calories ?? null);
  const macros =
    protein !== null && carbs !== null && fat !== null
      ? { calories: calories ?? 0, protein, carbs: Math.max(carbs, 0), fat }
      : null;
  return {
    fdcId: result.externalId,
    name: result.name,
    brand: result.brand ? brandName(result.brand) : null,
    kcal: calories === null ? null : $localize`${kcal(calories, locale)}:calories: per 100 g`,
    macros: macros ? macroLine(macros, locale) : null,
    split: macros ? energySplit(macros) : null,
    database: $localize`FoodData Central ${result.externalId}:id: · ${result.dataType}:type:`,
  };
}

/** USDA writes most brands in capitals ("CHOBANI"); a name in mixed case is left as written. */
export function brandName(brand: string): string {
  const trimmed = brand.trim();
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s\-/&.(])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase());
}

/** Grams with a true minus sign: "−0.43 g". */
function signedGrams(value: number, locale: string): string {
  return $localize`${formatNumber(value, locale, '1.0-2').replace('-', '−')}:grams: g`;
}

/** "fibre and alcohol", or with `or` for a sentence that says none was reported. */
export function unreportedText(
  nutrients: readonly UnreportedNutrient[],
  type: 'conjunction' | 'disjunction' = 'conjunction',
): string {
  return new Intl.ListFormat('en-GB', { style: 'long', type }).format(
    nutrients.map((nutrient) => UNREPORTED_WORDS[nutrient]),
  );
}

/** "USDA didn’t report sugar alcohols or alcohol, so they were saved as 0." */
export function unreportedSentence(nutrients: readonly UnreportedNutrient[]): string {
  const list = unreportedText(nutrients, 'disjunction');
  return nutrients.length === 1
    ? $localize`USDA didn’t report ${list}:nutrients:, so it was saved as 0.`
    : $localize`USDA didn’t report ${list}:nutrients:, so they were saved as 0.`;
}

// ---------- the details sheet ----------

export interface FoodFacts {
  name: string;
  own: boolean;
  /** "Archived on 7 Oct 2026…", or null while the food is in use. */
  archived: string | null;
  /** "Your food · as sold" or "Copied from USDA · raw". */
  source: string;
  per: string;
  kcal: string;
  rows: { label: string; value: string; indent?: boolean }[];
  label: string | null;
  discrepancy: string | null;
  unreported: string | null;
  /** USDA's own carbohydrate when it was just below zero and is counted as 0 g. */
  reportedCarbs: string | null;
  allergens: string;
  database: string | null;
}

export function foodFacts(view: FoodItemView, tolerance: number | null, locale: string): FoodFacts {
  const version = view.currentVersion;
  const amount = (value: number | string) => grams(numeric(value), locale);
  const rows: FoodFacts['rows'] = [
    { label: $localize`Protein`, value: amount(version.proteinGrams) },
    { label: $localize`Carbs`, value: amount(version.carbohydrateGrams) },
  ];
  if (numeric(version.fibreGrams) > 0) {
    rows.push({
      label: $localize`of which fibre`,
      value: amount(version.fibreGrams),
      indent: true,
    });
  }
  if (numeric(version.polyolGrams) > 0) {
    rows.push({
      label: $localize`of which sugar alcohols`,
      value: amount(version.polyolGrams),
      indent: true,
    });
  }
  rows.push({ label: $localize`Fat`, value: amount(version.fatGrams) });
  if (numeric(version.ethanolGrams) > 0) {
    rows.push({ label: $localize`Alcohol`, value: amount(version.ethanolGrams) });
  }
  const label = nullableNumeric(version.providerCalories);
  const usda = view.provenance === 'UsdaFdc';
  const reported = nullableNumeric(version.reportedCarbohydrateGrams ?? null);
  return {
    name: view.name,
    own: !usda,
    archived: view.archivedAtUtc
      ? $localize`Archived on ${formatDate(view.archivedAtUtc, 'd MMM y', locale)}:date:. Recipes and plans that use it keep it.`
      : null,
    source: `${usda ? $localize`Copied from USDA` : sourceWord(view.provenance)} · ${preparationWord(version.preparationBasis)}`,
    per: per(numeric(version.basisQuantity), version.basisUnit, locale),
    kcal: kcal(numeric(version.computedCalories), locale),
    rows,
    label:
      label === null
        ? null
        : usda
          ? $localize`USDA states ${kcal(label, locale)}:calories:.`
          : $localize`The label says ${kcal(label, locale)}:calories:.`,
    discrepancy: version.hasCalorieDiscrepancy
      ? tolerance === null
        ? $localize`That is further from what the macros add up to than your settings allow, so check the numbers.`
        : $localize`That is more than ${kcal(tolerance, locale)}:tolerance: from what the macros add up to, so check the numbers.`
      : null,
    unreported: version.unreportedNutrients.length
      ? unreportedSentence(version.unreportedNutrients)
      : null,
    reportedCarbs:
      reported === null
        ? null
        : $localize`USDA lists ${signedGrams(reported, locale)}:grams: of carbs. It works carbs out from the other nutrients, which can land just below zero in a food with almost none, so it counts as 0 g, as on food labels.`,
    allergens: allergenText(version.declaredAllergens) || $localize`No allergens declared.`,
    database:
      usda && view.externalId
        ? $localize`FoodData Central ${view.externalId}:id: · ${view.externalDataType ?? ''}:type:`
        : null,
  };
}

// ---------- the food sheet ----------

export type FoodSheetMode = 'new' | 'edit' | 'copy';

/** The sheet's boxes; a number box left empty is null, which the checks name. */
export interface FoodDraft {
  name: string;
  amount: number | null;
  unit: FoodQuantityUnit;
  basis: PreparationBasis;
  protein: number | null;
  /** As the workspace's labels print it: total under US-style labels, without fibre under EU-style. */
  carbs: number | null;
  fat: number | null;
  fibre: number | null;
  polyols: number | null;
  alcohol: number | null;
  labelCalories: number | null;
  allergens: AllergenCode[];
}

export function emptyFoodDraft(): FoodDraft {
  return {
    name: '',
    amount: 100,
    unit: 'Gram',
    basis: 'AsSold',
    protein: null,
    carbs: null,
    fat: null,
    fibre: null,
    polyols: null,
    alcohol: null,
    labelCalories: null,
    allergens: [],
  };
}

/**
 * A saved food as the sheet opens it: to edit, or, for a USDA food, as a copy of the coach's own. Under
 * EU-style labels its total carbs are shown as an EU label prints them, without the fibre (C6).
 */
export function draftFromFood(view: FoodItemView, policyKey: string | null = null): FoodDraft {
  const version = view.currentVersion;
  const optional = (value: number | string) => numeric(value) || null;
  const total = numeric(version.carbohydrateGrams);
  // Rounded to the six places the database keeps, so a subtraction never shows a float's tail.
  const carbs = carbsWithoutFibre(policyKey)
    ? Math.max(Math.round((total - numeric(version.fibreGrams)) * 1e6) / 1e6, 0)
    : total;
  return {
    name: view.name,
    amount: numeric(version.basisQuantity),
    unit: version.basisUnit,
    basis: version.preparationBasis,
    protein: numeric(version.proteinGrams),
    carbs,
    fat: numeric(version.fatGrams),
    fibre: optional(version.fibreGrams),
    polyols: optional(version.polyolGrams),
    alcohol: optional(version.ethanolGrams),
    labelCalories: nullableNumeric(version.providerCalories),
    allergens: [...version.declaredAllergens],
  };
}

export function foodDraftSignature(draft: FoodDraft): string {
  return JSON.stringify({
    ...draft,
    name: draft.name.trim(),
    allergens: [...draft.allergens].sort(),
  });
}

export type FoodField = 'name' | 'amount' | 'protein' | 'carbs' | 'fat' | 'more';

export interface FoodProblem {
  field: FoodField;
  message: string;
}

const filled = (value: number | null): value is number => value !== null && Number.isFinite(value);

/** The total carbs a draft holds, the fibre included: what is saved (NUT-011). */
export function totalCarbs(draft: FoodDraft, policyKey: string | null): number | null {
  if (!filled(draft.carbs)) return null;
  return carbsWithoutFibre(policyKey) ? draft.carbs + (draft.fibre ?? 0) : draft.carbs;
}

/** Every check that stops a save, by box, in the order the sheet reads top to bottom. */
export function foodProblems(draft: FoodDraft, policyKey: string | null = null): FoodProblem[] {
  const problems: FoodProblem[] = [];
  const name = draft.name.trim();
  if (!name) problems.push({ field: 'name', message: $localize`Give the food a name.` });
  else if (name.length > MAX_FOOD_NAME) {
    problems.push({
      field: 'name',
      message: $localize`Keep the name under ${MAX_FOOD_NAME}:max: characters.`,
    });
  }
  if (!filled(draft.amount) || draft.amount <= 0 || draft.amount > MAX_AMOUNT) {
    problems.push({ field: 'amount', message: $localize`Enter an amount above 0.` });
  }
  const macros: [FoodField, number | null, string][] = [
    ['protein', draft.protein, $localize`Enter the protein, or 0.`],
    ['carbs', draft.carbs, $localize`Enter the carbs, or 0.`],
    ['fat', draft.fat, $localize`Enter the fat, or 0.`],
  ];
  for (const [field, value, message] of macros) {
    if (!filled(value) || value < 0 || value > MAX_AMOUNT) problems.push({ field, message });
  }
  const extras = [draft.fibre, draft.polyols, draft.alcohol, draft.labelCalories];
  const withoutFibre = carbsWithoutFibre(policyKey);
  if (extras.some((value) => filled(value) && (value < 0 || value > MAX_AMOUNT))) {
    problems.push({ field: 'more', message: $localize`Other nutrients can’t be below 0.` });
  } else if (withoutFibre && filled(draft.carbs) && (draft.polyols ?? 0) > draft.carbs) {
    // An EU label's carbs leave the fibre out but keep the sugar alcohols in (EU 1169/2011, Annex I).
    problems.push({
      field: 'more',
      message: $localize`Sugar alcohols are part of the carbs on an EU label, so they can’t be more than the carbs.`,
    });
  } else if (
    !withoutFibre &&
    filled(draft.carbs) &&
    (draft.fibre ?? 0) + (draft.polyols ?? 0) > draft.carbs
  ) {
    problems.push({
      field: 'more',
      message: $localize`Fibre and sugar alcohols are part of the carbs, so together they can’t be more than the carbs.`,
    });
  }
  if (
    !problems.length &&
    draft.unit !== 'Serving' &&
    filled(draft.amount) &&
    (draft.protein ?? 0) +
      (totalCarbs(draft, policyKey) ?? 0) +
      (draft.fat ?? 0) +
      (draft.alcohol ?? 0) >
      draft.amount
  ) {
    problems.push({
      field: 'amount',
      message: $localize`The nutrients weigh more than the amount they are for. Check the amount or the grams.`,
    });
  }
  return problems;
}

/**
 * The calories the server will work out, under the workspace's policy: Atwater v2, 4/4/9 on total
 * carbs plus alcohol at 7, or the EU's factors on available carbs, fibre, sugar alcohols and alcohol.
 * Under EU-style labels the carbs are typed as printed, so the fibre is not in them to take off again.
 * Null until the macros are typed.
 */
export function estimatedCalories(draft: FoodDraft, policyKey: string | null): number | null {
  const total = totalCarbs(draft, policyKey);
  if (!filled(draft.protein) || total === null || !filled(draft.fat)) return null;
  const fibre = draft.fibre ?? 0;
  const polyols = draft.polyols ?? 0;
  const alcohol = draft.alcohol ?? 0;
  if (policyKey === 'Eu1169') {
    const available = Math.max(total - fibre - polyols, 0);
    return (
      draft.protein * 4 + available * 4 + draft.fat * 9 + polyols * 2.4 + alcohol * 7 + fibre * 2
    );
  }
  return draft.protein * 4 + total * 4 + draft.fat * 9 + alcohol * 7;
}

/** How the workspace counts calories, in the words of Settings › Nutrition (C5). */
export function policyWords(policyKey: string | null): string {
  return policyKey === 'Eu1169'
    ? $localize`counted as on EU-style labels`
    : $localize`counted as on US-style labels`;
}

const COACH_SOURCE = 'Coach-authored food';
const COACH_RECORD = 'coach-entry-v1';

// The carbs go as typed and say how; the server adds an EU label's fibre back (C6).
function versionRequest(draft: FoodDraft, policyKey: string | null): AddFoodVersionRequest {
  return {
    basisQuantity: draft.amount ?? 0,
    basisUnit: draft.unit,
    preparationBasis: draft.basis,
    proteinGrams: draft.protein ?? 0,
    carbohydrateGrams: draft.carbs ?? 0,
    carbohydrateDeclaration: carbsWithoutFibre(policyKey) ? 'WithoutFibre' : 'TotalWithFibre',
    fatGrams: draft.fat ?? 0,
    fibreGrams: draft.fibre ?? 0,
    polyolGrams: draft.polyols ?? 0,
    ethanolGrams: draft.alcohol ?? 0,
    providerCalories: draft.labelCalories,
    sourceAttribution: COACH_SOURCE,
    sourceRecordVersion: COACH_RECORD,
    declaredAllergens: ALLERGEN_LABELS.map((item) => item.code).filter((code) =>
      draft.allergens.includes(code),
    ),
    name: null,
    baseRevision: null,
  };
}

/** A new food of the coach's own, which is also what a copy of a USDA food becomes. */
export function createFoodRequest(
  draft: FoodDraft,
  policyKey: string | null = null,
): CreateFoodItemRequest {
  return {
    name: draft.name.trim(),
    provenance: 'CoachAuthored',
    externalId: null,
    externalDataType: null,
    labelMediaAssetId: null,
    version: versionRequest(draft, policyKey),
  };
}

/** The next version of the coach's own food, named afresh, from the revision the sheet opened. */
export function editFoodRequest(
  draft: FoodDraft,
  baseRevision: number,
  policyKey: string | null = null,
): AddFoodVersionRequest {
  return { ...versionRequest(draft, policyKey), name: draft.name.trim(), baseRevision };
}
