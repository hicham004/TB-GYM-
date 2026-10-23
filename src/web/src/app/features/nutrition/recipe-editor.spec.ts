import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AddRecipeVersionRequest,
  AiMealDraftView,
  CookingConversionView,
  CreateRecipeRequest,
  RecipeDetail,
  RecipeIngredientView,
  ReviewAiMealDraftRequest,
} from '../../core/api/generated';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
import {
  conversionView,
  cookedRiceLine,
  RAW_RICE_FOOD,
  rawRiceLine,
} from '../../../testing/cooking-fixtures';
import { field, fill, press, settle } from '../../../testing/dom';
import {
  OATS_FOOD,
  recipeDetail,
  recipeSummary,
  YOGURT_FOOD,
} from '../../../testing/recipe-fixtures';
import { RecipeApi } from './recipe-api';
import { RecipeEditor } from './recipe-editor';

@Component({ template: '' })
class RecipesStub {}

interface Options {
  url?: string;
  getRecipe?: () => Observable<RecipeDetail>;
  addVersion?: () => Observable<unknown>;
  aiConfigured?: boolean;
  /** The workspace's raw-to-cooked conversions; white rice boiled unless given. */
  conversions?: CookingConversionView[];
}

async function render(options: Options = {}) {
  const api = {
    getRecipe: vi.fn(options.getRecipe ?? (() => of(recipeDetail()))),
    createRecipe: vi.fn<(request: CreateRecipeRequest) => Observable<unknown>>(() =>
      of(recipeSummary({ id: 'recipe-new' })),
    ),
    addVersion: vi.fn<(id: string, request: AddRecipeVersionRequest) => Observable<unknown>>(
      options.addVersion ?? (() => of(recipeSummary())),
    ),
    publishVersion: vi.fn(() => of(recipeSummary())),
    uploadPhoto: vi.fn(() => of({ id: 'photo-new' })),
    grantPhotos: vi.fn(() =>
      of({
        items: [
          {
            assetId: 'photo-1',
            url: '/api/media/photo-1/content',
            thumbnailUrl: '/api/media/photo-1/content/thumbnail',
          },
        ],
      }),
    ),
    searchFoods: vi.fn((query: string) =>
      of({
        total: 2,
        skip: 0,
        take: 20,
        items: [OATS_FOOD, YOGURT_FOOD].filter((food) =>
          food.name.toLowerCase().includes(query.toLowerCase()),
        ),
      }),
    ),
    searchUsda: vi.fn(() => of({ skip: 0, take: 10, items: [] })),
    importUsda: vi.fn(),
    listConversions: vi.fn(() => {
      const items = options.conversions ?? [conversionView()];
      return of({ total: items.length, skip: 0, take: 20, items });
    }),
    createConversion: vi.fn(),
    aiAvailability: vi.fn(() => of({ isConfigured: options.aiConfigured ?? false })),
    suggest: vi.fn<(prompt: string) => Observable<AiMealDraftView>>(() =>
      of(
        aiView({
          validatedDraftJson: JSON.stringify({
            name: 'Oat bowl',
            ingredients: [
              { name: 'oats', quantity: 80, unit: 'g', uncertain: false },
              { name: 'yogurt', quantity: 150, unit: 'g', uncertain: true },
            ],
          }),
        }),
      ),
    ),
    review: vi.fn<(id: string, request: ReviewAiMealDraftRequest) => Observable<AiMealDraftView>>(
      () =>
        of(
          aiView({
            status: 'Approved',
            createdRecipeId: 'recipe-new',
            createdRecipeVersionId: 'v1',
          }),
        ),
    ),
  };
  const toast = { show: vi.fn(() => ({ dismiss: vi.fn() })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'nutrition/recipes', component: RecipesStub },
        {
          path: 'nutrition/recipes/:recipeId',
          component: RecipeEditor,
          canDeactivate: [confirmBeforeLeaving],
        },
      ]),
      { provide: RecipeApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: UiToast, useValue: toast },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const harness = await RecipeHarness.create(options.url ?? '/nutrition/recipes/recipe-oats');
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    api,
    toast,
    router: TestBed.inject(Router),
  };
}

const RecipeHarness = {
  async create(url: string): Promise<RouterTestingHarness> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, RecipeEditor);
    await settle(harness.fixture);
    await settle(harness.fixture);
    return harness;
  },
};

function aiView(overrides: Partial<AiMealDraftView> = {}): AiMealDraftView {
  return {
    id: 'ai-1',
    status: 'AwaitingCoachReview',
    promptVersion: 'recipe-editor-v1',
    schemaVersion: 'meal-draft-v1',
    providerKey: 'Test',
    model: 'test',
    modelVersion: '1',
    validatedDraftJson: null,
    uncertainFieldsJson: null,
    failureCode: null,
    costAmount: 0.1,
    costCurrency: 'USD',
    createdRecipeVersionId: null,
    ...overrides,
  };
}

const all = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(selector));
const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function named(host: ParentNode, name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (candidate) => (candidate.getAttribute('aria-label') ?? textOf(candidate)) === name,
  );
  if (found.length !== 1) throw new Error(`${found.length} buttons are named "${name}".`);
  return found[0];
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/** Waits, a short macrotask at a time, until the page shows what the test needs. */
async function until(fixture: { detectChanges(): void }, check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    fixture.detectChanges();
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The page never got there.');
}

/** Searches with the box and picks the first food it lists. */
async function addIngredient(
  harness: RouterTestingHarness,
  host: HTMLElement,
  text: string,
  boxId = 'add-ingredient',
) {
  const box = host.querySelector<HTMLInputElement>(`#${boxId}`)!;
  box.dispatchEvent(new Event('focus'));
  typeInto(box, text);
  await until(harness.fixture, () =>
    textOf(host.querySelector('[role="option"] .name')).toLowerCase().includes(text),
  );
  all(host, '[role="option"]')[0].dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
  );
  await settle(harness.fixture);
}

const serving = (host: HTMLElement) => textOf(host.querySelector('.totals .big'));
const lines = (host: HTMLElement) => all(host, '.line .line-name').map(textOf);

/** The recipe as saved, its lines those given. */
function withLines(...ingredients: RecipeIngredientView[]): () => Observable<RecipeDetail> {
  const detail = recipeDetail();
  return () => of({ ...detail, latest: { ...detail.latest, ingredients } });
}

/** The weigh-it-cooked sheet, which the CDK draws outside the page. */
const cookingSheet = () => document.querySelector<HTMLElement>('app-cooking-conversion-sheet');
const confirmQuestion = () => document.querySelector<HTMLElement>('app-confirm');

/** Chooses the conversion listed as `name` in the sheet. */
function pickConversion(sheet: HTMLElement, name: string): void {
  const choice = all(sheet, '.choice').find(
    (item) => textOf(item.querySelector('.choice-name')) === name,
  );
  const radio = choice?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`No conversion is listed as "${name}".`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
}

describe('the recipe editor', () => {
  afterEach(() => {
    document.body
      .querySelectorAll('.cdk-overlay-container')
      .forEach((node) => node.replaceChildren());
    TestBed.resetTestingModule();
  });

  it('opens a recipe with its lines, one serving’s numbers, allergens and photo', async () => {
    const { host, api } = await render();

    expect(api.getRecipe).toHaveBeenCalledWith('recipe-oats');
    expect((host.querySelector('#recipe-name') as HTMLInputElement).value).toBe('Overnight oats');
    expect(lines(host)).toEqual(['Rolled oats', 'Greek yogurt']);
    expect(all(host, '.line-kcal').map(textOf)).toEqual(['304 kcal', '140 kcal']);
    expect(serving(host)).toBe('222 kcal');
    expect(all(host, '.macro dd').map(textOf)).toEqual(['15.2 g', '31.2 g', '4.8 g']);
    expect(textOf(host.querySelector('.allergens'))).toBe('Contains gluten, milk');
    expect(textOf(host.querySelector('.standing'))).toContain('Published');
    // Nothing changed since it was published, so there is nothing to publish.
    expect(named(host, 'Publish changes').disabled).toBe(true);
    expect(api.grantPhotos).toHaveBeenCalledWith(['photo-1']);
    expect(host.querySelector('.photo img')?.getAttribute('src')).toBe(
      '/api/media/photo-1/content',
    );
  });

  it('adds up one serving as amounts are typed', async () => {
    const { harness, host } = await render();

    typeInto(host.querySelector<HTMLInputElement>('#amount-' + amountKey(host, 0))!, '160');
    await settle(harness.fixture);
    expect(all(host, '.line-kcal').map(textOf)[0]).toBe('608 kcal');
    expect(serving(host)).toBe('374 kcal');

    typeInto(host.querySelector<HTMLInputElement>('#recipe-servings')!, '4');
    await settle(harness.fixture);
    expect(serving(host)).toBe('187 kcal');
    expect(textOf(host.querySelector('.standing'))).toContain('Changes not published');
  });

  it('builds a new recipe from the food search and publishes it in one save', async () => {
    const { harness, host, api, router, toast } = await render({ url: '/nutrition/recipes/new' });

    expect(api.getRecipe).not.toHaveBeenCalled();
    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Oats & yogurt');
    await addIngredient(harness, host, 'oats');
    await addIngredient(harness, host, 'yogurt');
    expect(lines(host)).toEqual(['Rolled oats', 'Greek yogurt']);
    // Each starts at its food's own measure, 100 g.
    expect(serving(host)).toBe('450 kcal');
    typeInto(host.querySelector<HTMLTextAreaElement>('#recipe-instructions')!, 'Stir and chill.');
    typeInto(host.querySelector<HTMLInputElement>('#recipe-prep')!, '5');
    typeInto(host.querySelector<HTMLInputElement>('#recipe-cook')!, '0');
    await settle(harness.fixture);

    named(host, 'Publish').click();
    await until(harness.fixture, () => router.url === '/nutrition/recipes/recipe-new');

    expect(api.createRecipe).toHaveBeenCalledWith({
      name: 'Oats & yogurt',
      instructions: 'Stir and chill.',
      servings: 1,
      ingredients: [
        {
          foodItemVersionId: 'oats-food-v1',
          quantity: 100,
          unit: 'Gram',
          basis: 'AsSold',
          yieldFactorId: null,
          retentionFactorId: null,
        },
        {
          foodItemVersionId: 'yogurt-food-v1',
          quantity: 100,
          unit: 'Gram',
          basis: 'AsSold',
          yieldFactorId: null,
          retentionFactorId: null,
        },
      ],
      photoMediaAssetId: null,
      publish: true,
      prepMinutes: 5,
      cookMinutes: 0,
    });
    expect(api.getRecipe).toHaveBeenCalledWith('recipe-new');
    expect(toast.show).toHaveBeenCalledWith('Published. It’s in your meal plans’ recipes now.', {
      tone: 'success',
    });
  });

  it('says what stops a save and takes the coach there, sending nothing', async () => {
    const { harness, host, api } = await render({ url: '/nutrition/recipes/new' });

    named(host, 'Publish').click();
    await settle(harness.fixture);
    expect(textOf(host.querySelector('.banner.danger'))).toBe('Give the recipe a name.');
    expect(document.activeElement?.id).toBe('recipe-name');

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Oats');
    await settle(harness.fixture);
    expect(host.querySelector('.banner.danger')).toBeNull();
    named(host, 'Publish').click();
    await settle(harness.fixture);
    expect(textOf(host.querySelector('.banner.danger'))).toBe('Add at least one ingredient.');
    expect(document.activeElement?.id).toBe('add-ingredient');
    expect(api.createRecipe).not.toHaveBeenCalled();
  });

  it('previews a chosen photo as a data: URL, which the CSP lets an img show (NCM-2)', async () => {
    const { harness, host, api } = await render();
    // img-src is 'self' data: in the CSP, so a blob: preview would show as a broken image.
    const original = URL.createObjectURL;
    const createObjectURL = vi.fn(() => 'blob:refused-by-the-csp');
    URL.createObjectURL = createObjectURL;
    try {
      const input = host.querySelector<HTMLInputElement>('.photo-actions input[type="file"]')!;
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'bowl.png', { type: 'image/png' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await until(
        harness.fixture,
        () => host.querySelector('.photo img')?.getAttribute('src')?.startsWith('data:') === true,
      );

      expect(api.uploadPhoto).toHaveBeenCalledWith(file);
      expect(host.querySelector('.photo img')!.getAttribute('src')).toBe(
        'data:image/png;base64,iVBORw==',
      );
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      URL.createObjectURL = original;
    }
  });

  it('saves changes as a new version, renamed, from the revision it opened', async () => {
    const { harness, host, api } = await render();

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Berry oats');
    typeInto(host.querySelector<HTMLInputElement>('#recipe-cook')!, '15');
    await settle(harness.fixture);
    named(host, 'Publish changes').click();
    await until(harness.fixture, () => api.addVersion.mock.calls.length === 1);

    const [id, request] = api.addVersion.mock.calls[0];
    expect(id).toBe('recipe-oats');
    expect(request).toMatchObject({
      name: 'Berry oats',
      photoMediaAssetId: 'photo-1',
      publish: true,
      baseRevision: 1,
      servings: 2,
      prepMinutes: null,
      cookMinutes: 15,
    });
    expect(request.ingredients.map((line) => line.quantity)).toEqual([80, 200]);
  });

  it('offers a food’s new numbers to the lines that copied it before it was edited', async () => {
    const detail = recipeDetail();
    const [oats, yogurt] = detail.latest.ingredients;
    const edited = {
      ...YOGURT_FOOD,
      name: 'Strained yogurt',
      currentRevision: 2,
      currentVersion: { ...YOGURT_FOOD.currentVersion, id: 'yogurt-food-v2', proteinGrams: 11 },
    };
    const { harness, host, api } = await render({
      getRecipe: () =>
        of({
          ...detail,
          latest: { ...detail.latest, ingredients: [oats, { ...yogurt, newerFood: edited }] },
        }),
    });

    expect(all(host, '.line-newer').map(textOf)).toEqual([
      'Strained yogurt was edited since this recipe was saved. Use its new numbers',
    ]);
    // A single line is offered on itself, with no banner over the list.
    expect(host.querySelector('.banner.info')).toBeNull();
    expect(named(host, 'Publish changes').disabled).toBe(true);

    named(host, 'Use its new numbers').click();
    await settle(harness.fixture);
    expect(all(host, '.line-name').map(textOf)).toEqual(['Rolled oats', 'Strained yogurt']);
    expect(host.querySelector('.line-newer')).toBeNull();
    expect(textOf(host.querySelector('.tb-visually-hidden[role="status"]'))).toContain(
      'Strained yogurt now has its new numbers.',
    );

    named(host, 'Publish changes').click();
    await until(harness.fixture, () => api.addVersion.mock.calls.length === 1);
    const [, request] = api.addVersion.mock.calls[0];
    expect(request.ingredients.map((line) => [line.foodItemVersionId, line.quantity])).toEqual([
      ['oats-food-v1', 80],
      ['yogurt-food-v2', 200],
    ]);
  });

  it('weighs a raw food cooked through a conversion, and saves it weighed that way (INV-6)', async () => {
    const [oats] = recipeDetail().latest.ingredients;
    const { harness, host, api } = await render({ getRecipe: withLines(oats, rawRiceLine()) });

    // Only the raw food weighed in grams can be weighed cooked.
    expect(
      all(host, '.line-cooking button').map((item) => item.getAttribute('aria-label')),
    ).toEqual(['Weigh it cooked: White rice, raw']);
    expect(all(host, '.line-kcal').map(textOf)).toEqual(['304 kcal', '353 kcal']);

    named(host, 'Weigh it cooked: White rice, raw').click();
    await until(harness.fixture, () => cookingSheet()?.querySelector('.choice') != null);
    expect(api.listConversions).toHaveBeenCalledWith('', 0, 20);
    // Titled as the button that opened it, the food named first in the sheet.
    expect(textOf(document.querySelector('[role="dialog"] h2'))).toBe('Weigh it cooked');
    expect(textOf(cookingSheet()?.querySelector('.about'))).toBe(
      'White rice, raw 353 kcal per 100 g raw',
    );
    pickConversion(cookingSheet()!, 'White rice, boiled');
    await settle(harness.fixture);
    press(cookingSheet()!, 'Use it');
    await until(harness.fixture, () => cookingSheet() === null);

    // The same rice, 290 g once cooked, holding what it held raw.
    expect(field(host, 'Amount of White rice, raw, weighed cooked').value).toBe('290');
    expect(all(host, '.line .unit').map(textOf)).toEqual(['g', 'g cooked']);
    expect(textOf(host.querySelector('.line.cooked .line-cooking span'))).toBe(
      'Weighed cooked: White rice, boiled, 100 g raw makes 290 g cooked.',
    );
    expect(all(host, '.line-kcal').map(textOf)).toEqual(['304 kcal', '353 kcal']);
    expect(textOf(host.querySelector('.tb-visually-hidden[role="status"]'))).toContain(
      'White rice, raw is weighed cooked now: 290 g.',
    );
    expect(named(host, 'Change conversion: White rice, raw')).toBeTruthy();

    named(host, 'Publish changes').click();
    await until(harness.fixture, () => api.addVersion.mock.calls.length === 1);
    expect(api.addVersion.mock.calls[0][1].ingredients[1]).toEqual({
      foodItemVersionId: 'rice-v1',
      quantity: 290,
      unit: 'Gram',
      basis: 'Cooked',
      yieldFactorId: 'y-rice',
      retentionFactorId: 'r-rice',
    });
  });

  it('opens a line saved cooked, and weighs it raw again with focus kept on its button', async () => {
    const { harness, host, api } = await render({ getRecipe: withLines(cookedRiceLine()) });

    expect(field(host, 'Amount of White rice, raw, weighed cooked').value).toBe('150');
    expect(textOf(host.querySelector('.line-cooking span'))).toBe(
      'Weighed cooked: White rice, boiled, 100 g raw makes 250 g cooked, keeping 90% of its protein, carbs and fat.',
    );
    expect(all(host, '.line-kcal').map(textOf)).toEqual(['191 kcal']);

    // Choosing the conversion it is weighed through already changes nothing.
    named(host, 'Change conversion: White rice, raw').click();
    await until(
      harness.fixture,
      () => cookingSheet()?.querySelector('.choice input:checked') != null,
    );
    expect(textOf(document.querySelector('[role="dialog"] h2'))).toBe('Change conversion');
    press(cookingSheet()!, 'Use it');
    await until(harness.fixture, () => cookingSheet() === null);
    expect(field(host, 'Amount of White rice, raw, weighed cooked').value).toBe('150');
    expect(named(host, 'Publish changes').disabled).toBe(true);
    expect(textOf(host.querySelector('.tb-visually-hidden[role="status"]'))).not.toContain(
      'weighed cooked now',
    );
    // The coach's own name for it is isolated, so an Arabic one keeps the sentence's order.
    expect(textOf(host.querySelector('.line-cooking bdi'))).toBe('White rice, boiled');

    named(host, 'Weigh it raw: White rice, raw').click();
    await settle(harness.fixture);
    expect(field(host, 'Amount of White rice, raw').value).toBe('60');
    expect(all(host, '.line .unit').map(textOf)).toEqual(['g']);
    // Weighed raw, nothing says any of it is lost to cooking.
    expect(all(host, '.line-kcal').map(textOf)).toEqual(['212 kcal']);
    expect(textOf(host.querySelector('.line-cooking'))).toBe('Weigh it cooked');
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Weigh it cooked: White rice, raw',
    );
    expect(textOf(host.querySelector('.tb-visually-hidden[role="status"]'))).toContain(
      'White rice, raw is weighed raw again: 60 g.',
    );

    named(host, 'Publish changes').click();
    await until(harness.fixture, () => api.addVersion.mock.calls.length === 1);
    expect(api.addVersion.mock.calls[0][1].ingredients).toEqual([
      {
        foodItemVersionId: 'rice-v1',
        quantity: 60,
        unit: 'Gram',
        basis: 'Raw',
        yieldFactorId: null,
        retentionFactorId: null,
      },
    ]);
  });

  it('asks before a conversion typed in the sheet is lost, and keeps the line as it was', async () => {
    const { harness, host, api } = await render({
      getRecipe: withLines(rawRiceLine()),
      conversions: [],
    });

    named(host, 'Weigh it cooked: White rice, raw').click();
    // With no conversion to choose, the sheet opens on adding one.
    await until(
      harness.fixture,
      () => cookingSheet()?.querySelector('[name="conversion-name"]') != null,
    );
    fill(cookingSheet()!, 'What it is', 'White rice, boiled');
    await settle(harness.fixture);
    press(cookingSheet()!, 'Not now');
    await until(harness.fixture, () => confirmQuestion() !== null);
    expect(textOf(confirmQuestion())).toContain('What you typed will be lost.');
    press(confirmQuestion()!, 'Keep editing');
    await until(harness.fixture, () => confirmQuestion() === null);
    // The answer is taken in before anyone can press again.
    await settle(harness.fixture);
    expect(field(cookingSheet()!, 'What it is').value).toBe('White rice, boiled');

    press(cookingSheet()!, 'Not now');
    await until(harness.fixture, () => confirmQuestion() !== null);
    press(confirmQuestion()!, 'Discard');
    await until(harness.fixture, () => cookingSheet() === null);
    expect(field(host, 'Amount of White rice, raw').value).toBe('100');
    expect(named(host, 'Publish changes').disabled).toBe(true);
    expect(api.createConversion).not.toHaveBeenCalled();
  });

  it('closes the cooking sheet when the editor opens another recipe in its place', async () => {
    const { harness, host } = await render({ getRecipe: withLines(rawRiceLine()) });

    named(host, 'Weigh it cooked: White rice, raw').click();
    await until(harness.fixture, () => cookingSheet()?.querySelector('.choice') != null);
    // Back to another recipe: the sheet would weigh a line no longer on screen.
    await harness.navigateByUrl('/nutrition/recipes/recipe-other');
    await until(harness.fixture, () => cookingSheet() === null);
    const other = () => harness.routeNativeElement as HTMLElement;
    await until(harness.fixture, () => lines(other()).length === 1);
    expect(lines(other())).toEqual(['White rice, raw']);
    // The editor was reused in place, so nothing but the close took the sheet away.
    expect(other()).toBe(host);
  });

  it('says a line weighed cooked whose food is no longer raw in grams needs its amount again', async () => {
    const asSold = {
      ...RAW_RICE_FOOD,
      currentVersion: {
        ...RAW_RICE_FOOD.currentVersion,
        id: 'rice-v2',
        preparationBasis: 'AsSold',
      },
    } satisfies RecipeIngredientView['newerFood'];
    const { harness, host } = await render({
      getRecipe: withLines(cookedRiceLine({ newerFood: asSold })),
    });

    named(host, 'Use its new numbers').click();
    await settle(harness.fixture);
    expect(textOf(host.querySelector('.tb-visually-hidden[role="status"]'))).toBe(
      'White rice, raw now has its new numbers. A food weighed cooked is no longer a raw food in grams, so type its amount again.',
    );
    expect(field(host, 'Amount of White rice, raw').value).toBe('');
    expect(host.querySelector('.line-cooking')).toBeNull();
  });

  it('tells the coach when someone saved the recipe since it opened', async () => {
    const { harness, host } = await render({
      addVersion: () =>
        throwError(
          () =>
            new HttpErrorResponse({ status: 409, error: { code: 'recipe_changed', message: 'x' } }),
        ),
    });

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Berry oats');
    await settle(harness.fixture);
    named(host, 'Publish changes').click();
    await until(harness.fixture, () => host.querySelector('.banner.warn') !== null);
    expect(textOf(host.querySelector('.banner.warn'))).toContain('saved again after you opened it');
    expect(named(host, 'Reload recipe')).toBeTruthy();
  });

  it('publishes an unchanged draft as it is, without a new version', async () => {
    const draft = recipeDetail({
      publishedVersionId: null,
      latest: { ...recipeDetail().latest, status: 'Draft', id: 'oats-v2' },
    });
    const { harness, host, api } = await render({ getRecipe: () => of(draft) });

    expect(textOf(host.querySelector('.standing'))).toContain('Draft');
    named(host, 'Publish').click();
    await until(harness.fixture, () => api.publishVersion.mock.calls.length === 1);
    expect(api.publishVersion).toHaveBeenCalledWith('oats-v2');
    expect(api.addVersion).not.toHaveBeenCalled();
  });

  it('starts from an AI suggestion whose ingredients the coach matches before saving', async () => {
    const { harness, host, api, router } = await render({
      url: '/nutrition/recipes/new',
      aiConfigured: true,
    });

    named(host, 'Describe a meal').click();
    await settle(harness.fixture);
    typeInto(host.querySelector<HTMLTextAreaElement>('.ai textarea')!, 'oat bowl with yogurt');
    await settle(harness.fixture);
    named(host, 'Suggest ingredients').click();
    await until(harness.fixture, () => all(host, '.line.unmatched').length === 2);

    expect(api.suggest).toHaveBeenCalledWith('oat bowl with yogurt');
    expect((host.querySelector('#recipe-name') as HTMLInputElement).value).toBe('Oat bowl');
    expect(all(host, '.line.unmatched .line-suggested').map(textOf)).toEqual([
      'Suggested: 80 g oats',
      'Suggested: 150 g yogurt',
    ]);

    typeInto(host.querySelector<HTMLTextAreaElement>('#recipe-instructions')!, 'Stir.');
    await settle(harness.fixture);
    named(host, 'Publish').click();
    await settle(harness.fixture);
    expect(textOf(host.querySelector('.banner.danger'))).toBe(
      'Choose a food for “oats”, or remove it.',
    );

    const [oats, yogurt] = all(host, '.line.unmatched app-recipe-food-search input').map(
      (input) => input.id,
    );
    await addIngredient(harness, host, 'oats', oats);
    await addIngredient(harness, host, 'yogurt', yogurt);
    // The suggested grams carry over to foods measured in grams.
    expect(all(host, '.amount input').map((input) => (input as HTMLInputElement).value)).toEqual([
      '80',
      '150',
    ]);

    named(host, 'Publish').click();
    await until(harness.fixture, () => router.url === '/nutrition/recipes/recipe-new');
    const [operation, request] = api.review.mock.calls[0];
    expect(operation).toBe('ai-1');
    expect(request).toMatchObject({ approved: true, recipeName: 'Oat bowl', publish: true });
    expect(
      request.ingredientMappings.map((line) => [line.foodItemVersionId, line.quantity]),
    ).toEqual([
      ['oats-food-v1', 80],
      ['yogurt-food-v1', 150],
    ]);
    expect(api.createRecipe).not.toHaveBeenCalled();
  });

  it('explains AI suggestions are not set up, beside where they would be', async () => {
    const { host } = await render({ url: '/nutrition/recipes/new', aiConfigured: false });
    expect(textOf(host.querySelector('.ai'))).toContain('AI suggestions aren’t set up');
    expect(host.querySelector('.ai button')).toBeNull();
  });

  it('asks before leaving with changes not saved, and stays when asked to', async () => {
    const { harness, host, router } = await render();

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Changed');
    await settle(harness.fixture);
    const leaving = router.navigateByUrl('/nutrition/recipes');
    await until(harness.fixture, () => document.querySelector('[role="dialog"]') !== null);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(textOf(dialog)).toContain('Your changes to this recipe aren’t saved.');
    named(dialog, 'Stay').click();
    expect(await leaving).toBe(false);
  });

  it('says a recipe that is not here is not here', async () => {
    const { host } = await render({
      getRecipe: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });
    expect(textOf(host.querySelector('h1'))).toBe('This recipe isn’t here');
  });
});

/** The key the editor gave a line, read from its amount box's id. */
function amountKey(host: HTMLElement, index: number): string {
  return all(host, '.amount input')[index].id.replace('amount-', '');
}
