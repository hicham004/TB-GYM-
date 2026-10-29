import { Location } from '@angular/common';
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
  CreateRecipeDraftRequest,
  CreateRecipeRequest,
  PublishRecipeDraftRequest,
  RecipeDetail,
  RecipeDraftContent,
  RecipeDraftSaveView,
  RecipeDraftView,
  ProviderFoodSearchPage,
  RecipeIngredientView,
  RecipeSummary,
  ReviewAiMealDraftRequest,
  SaveRecipeDraftRequest,
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
import { field, fill, menuChoices, press, settle } from '../../../testing/dom';
import { provideMediaUploads } from '../../../testing/media-uploads';
import {
  draftSaved,
  OATS_FOOD,
  recipeDetail,
  recipeDraftView,
  recipeSummary,
  YOGURT_FOOD,
} from '../../../testing/recipe-fixtures';
import type { AutosaveTiming } from '../training/program-autosave';
import { RecipeApi } from './recipe-api';
import { RECIPE_AUTOSAVE_TIMING, RecipeEditor } from './recipe-editor';

@Component({ template: '' })
class RecipesStub {}

/** Every change goes to the coach's draft on the next tick; a failed save waits ten minutes. */
const AT_ONCE: AutosaveTiming = { quietMs: 0, maxWaitMs: 0, retryMs: 600_000, retryMaxMs: 600_000 };

interface Options {
  url?: string;
  getRecipe?: () => Observable<RecipeDetail>;
  getDraft?: () => Observable<RecipeDraftView>;
  createDraft?: () => Observable<RecipeDraftSaveView>;
  saveDraft?: () => Observable<RecipeDraftSaveView>;
  publishDraft?: () => Observable<RecipeSummary>;
  aiConfigured?: boolean;
  /** The workspace's raw-to-cooked conversions; white rice boiled unless given. */
  conversions?: CookingConversionView[];
  uploadsOff?: boolean;
}

async function render(options: Options = {}) {
  const isNew = (options.url ?? '').startsWith('/nutrition/recipes/new');
  const api = {
    getRecipe: vi.fn(options.getRecipe ?? (() => of(recipeDetail()))),
    // The editor saves only through the coach's draft since critique B5d; these stay unsent.
    createRecipe: vi.fn<(request: CreateRecipeRequest) => Observable<unknown>>(() =>
      of(recipeSummary({ id: 'recipe-new' })),
    ),
    addVersion: vi.fn<(id: string, request: AddRecipeVersionRequest) => Observable<unknown>>(() =>
      of(recipeSummary()),
    ),
    publishVersion: vi.fn(() => of(recipeSummary())),
    listDrafts: vi.fn(() => of([])),
    getDraft: vi.fn(options.getDraft ?? (() => of(recipeDraftView()))),
    createDraft: vi.fn<(request: CreateRecipeDraftRequest) => Observable<RecipeDraftSaveView>>(
      options.createDraft ?? (() => of(draftSaved(isNew ? 'draft-new' : 'draft-1', 1))),
    ),
    saveDraft: vi.fn<
      (id: string, request: SaveRecipeDraftRequest) => Observable<RecipeDraftSaveView>
    >(options.saveDraft ?? (() => of(draftSaved(isNew ? 'draft-new' : 'draft-1', 2)))),
    discardDraft: vi.fn<(id: string, version: number) => Observable<undefined>>(() =>
      of(undefined),
    ),
    publishDraft: vi.fn<
      (id: string, request: PublishRecipeDraftRequest) => Observable<RecipeSummary>
    >(
      options.publishDraft ??
        (() => of(isNew ? recipeSummary({ id: 'recipe-new' }) : recipeSummary())),
    ),
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
    searchUsda: vi.fn((): Observable<ProviderFoodSearchPage> =>
      of({ skip: 0, take: 10, items: [] }),
    ),
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
      { provide: RECIPE_AUTOSAVE_TIMING, useValue: AT_ONCE },
      provideMediaUploads(options.uploadsOff),
    ],
  });
  const harness = await RecipeHarness.create(options.url ?? '/nutrition/recipes/recipe-oats');
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    api,
    toast,
    router: TestBed.inject(Router),
    location: TestBed.inject(Location),
  };
}

/** What the coach's draft last held, as the newest save sent it. */
function lastContent(api: Awaited<ReturnType<typeof render>>['api']): RecipeDraftContent {
  const saved = api.saveDraft.mock.calls.at(-1)?.[1].content;
  const started = api.createDraft.mock.calls.at(-1)?.[0].content;
  const content = saved ?? started;
  if (!content) throw new Error('Nothing was saved to the draft.');
  return content;
}

/** A line as the draft keeps it: its food, its amount and nothing else. */
const keptLine = (foodItemVersionId: string, quantity: number) => ({
  foodItemVersionId,
  quantity,
  yieldFactorId: null,
  retentionFactorId: null,
  suggestion: null,
  convertedRawGrams: null,
  convertedCookedGrams: null,
});

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
/** The dialog asking about typed work, whose answers sit in its footer. */
const confirmQuestion = () =>
  document.querySelector('app-confirm')?.closest<HTMLElement>('[role="dialog"]') ?? null;
/** The sheet around the weigh-it-cooked form, whose footer holds its buttons. */
const cookingDialog = () => cookingSheet()!.closest<HTMLElement>('[role="dialog"]')!;

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
    const { harness, host, api } = await render();

    expect(api.getRecipe).toHaveBeenCalledWith('recipe-oats');
    expect((host.querySelector('#recipe-name') as HTMLInputElement).value).toBe('Overnight oats');
    expect(lines(host)).toEqual(['Rolled oats', 'Greek yogurt']);
    expect(all(host, '.line-kcal').map(textOf)).toEqual(['304 kcal', '140 kcal']);
    expect(serving(host)).toBe('222 kcal');
    expect(all(host, '.macro dd').map(textOf)).toEqual(['15.2 g', '31.2 g', '4.8 g']);
    expect(textOf(host.querySelector('.allergens'))).toBe('Contains gluten, milk');
    expect(textOf(host.querySelector('.standing'))).toContain('Published');
    expect(textOf(host.querySelector('.standing'))).not.toContain('In progress');
    expect(host.querySelector('.save-status')).toBeNull();
    // Nothing changed since it was published, so there is nothing to publish or discard.
    expect(named(host, 'Publish changes').disabled).toBe(true);
    expect(host.textContent).not.toContain('Discard changes');
    // Unfinished work is kept as it is typed (B5d), so a draft version is the team's complete one.
    named(host, 'More save options').click();
    await settle(harness.fixture);
    const [saveAsDraft] = menuChoices(named(host, 'More save options'));
    expect(textOf(saveAsDraft.querySelector('.item-title'))).toBe('Save as draft');
    expect(textOf(saveAsDraft)).toContain('Your team sees it; meal plans don’t');
    expect(api.getDraft).not.toHaveBeenCalled();
    expect(api.grantPhotos).toHaveBeenCalledWith(['photo-1']);
    expect(host.querySelector('.photo img')?.getAttribute('src')).toBe(
      '/api/media/photo-1/content',
    );
  });

  it('says once when USDA search is not set up on this server, and still lists the coach’s foods', async () => {
    const { harness, host, api } = await render();
    api.searchUsda.mockReturnValue(
      of({
        skip: 0,
        take: 10,
        items: [],
        failureCode: 'usda_api_key_missing',
        message: 'USDA FoodData Central is not configured. Add the data.gov API key…',
      }),
    );
    const box = host.querySelector<HTMLInputElement>('#add-ingredient')!;
    box.dispatchEvent(new Event('focus'));
    typeInto(box, 'oats');
    await until(harness.fixture, () =>
      all(host, '.note').some((note) => textOf(note).startsWith('USDA')),
    );

    expect(textOf(host.querySelector('[role="option"] .name'))).toBe('Rolled oats');
    expect(all(host, '.note').map(textOf)).toEqual(['USDA search isn’t set up on this server.']);
    expect(host.textContent).not.toContain('data.gov');
  });

  it('says uploads are not set up beside the photo on a server with no media storage', async () => {
    const { host } = await render({ uploadsOff: true });

    expect(textOf(host.querySelector('.photo-actions'))).toContain(
      'Uploads aren’t set up on this server.',
    );
    expect(host.querySelector('.photo-actions input[type="file"]')).toBeNull();
    expect(named(host, 'Remove')).toBeTruthy();
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
    // The recipe is still published for the team; the changes are the coach's own, in progress.
    expect(textOf(host.querySelector('.standing'))).toContain('Published');
    expect(textOf(host.querySelector('.standing'))).toContain('In progress');
    expect(textOf(host.querySelector('.standing'))).toContain(
      'Only you see these changes. Meal plans use the published version until you publish them.',
    );
  });

  it('keeps a new recipe as the coach types, then publishes it from the draft', async () => {
    const { harness, host, api, router, toast, location } = await render({
      url: '/nutrition/recipes/new',
    });

    expect(api.getRecipe).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('.standing'))).toContain(
      'New recipe Your changes save as you type. Publish it to use it in meal plans.',
    );
    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Oats & yogurt');
    await until(harness.fixture, () => api.createDraft.mock.calls.length === 1);
    // The first pause starts the coach's draft, which the address keeps for a refresh.
    expect(api.createDraft.mock.calls[0][0]).toMatchObject({
      recipeId: null,
      recipeRevision: null,
      content: { name: 'Oats & yogurt', servings: 1, lines: [] },
    });
    await until(
      harness.fixture,
      () => location.path() === '/nutrition/recipes/new?draft=draft-new',
    );
    expect(textOf(host.querySelector('.standing'))).toContain(
      'In progress Only you see it until you publish it.',
    );
    expect(textOf(host.querySelector('.save-status'))).toMatch(
      /^Saved (at|on) .+, not published yet$/,
    );

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

    // Every save after the first carries the version the last one answered.
    expect(api.saveDraft.mock.calls.every(([id]) => id === 'draft-new')).toBe(true);
    expect(api.saveDraft.mock.calls[0][1].version).toBe(1);
    expect(lastContent(api)).toEqual({
      name: 'Oats & yogurt',
      servings: 1,
      instructions: 'Stir and chill.',
      lines: [keptLine('oats-food-v1', 100), keptLine('yogurt-food-v1', 100)],
      photoMediaAssetId: null,
      prepMinutes: 5,
      cookMinutes: 0,
      aiMealDraftOperationId: null,
    });
    expect(api.publishDraft).toHaveBeenCalledWith('draft-new', {
      version: 2,
      replaceNewer: false,
      keepAsDraft: false,
    });
    expect(api.createRecipe).not.toHaveBeenCalled();
    expect(api.getRecipe).toHaveBeenCalledWith('recipe-new');
    expect(toast.show).toHaveBeenCalledWith('Published. It’s in your meal plans’ recipes now.', {
      tone: 'success',
    });
    // Made a version, the recipe has no draft left: nothing is in progress.
    expect(textOf(host.querySelector('.standing'))).not.toContain('In progress');
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
    // The name is kept in the coach's draft as typed; nothing becomes a version.
    expect(api.publishDraft).not.toHaveBeenCalled();
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

  it('keeps changes in the coach’s draft of the recipe, from the revision it opened, and publishes them', async () => {
    const { harness, host, api, toast } = await render();

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Berry oats');
    typeInto(host.querySelector<HTMLInputElement>('#recipe-cook')!, '15');
    await until(harness.fixture, () => api.createDraft.mock.calls.length === 1);
    expect(api.createDraft.mock.calls[0][0]).toMatchObject({
      recipeId: 'recipe-oats',
      recipeRevision: 1,
    });
    await settle(harness.fixture);
    expect(named(host, 'Discard changes')).toBeTruthy();
    named(host, 'Publish changes').click();
    await until(harness.fixture, () => api.publishDraft.mock.calls.length === 1);

    expect(lastContent(api)).toMatchObject({
      name: 'Berry oats',
      photoMediaAssetId: 'photo-1',
      servings: 2,
      prepMinutes: null,
      cookMinutes: 15,
    });
    expect(lastContent(api).lines?.map((line) => line.quantity)).toEqual([80, 200]);
    expect(api.publishDraft.mock.calls[0]).toEqual([
      'draft-1',
      { version: expect.any(Number), replaceNewer: false, keepAsDraft: false },
    ]);
    expect(api.addVersion).not.toHaveBeenCalled();
    await until(harness.fixture, () => toast.show.mock.calls.length > 0);
    expect(toast.show).toHaveBeenCalledWith('Published. It’s in your meal plans’ recipes now.', {
      tone: 'success',
    });
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
    await until(harness.fixture, () => api.publishDraft.mock.calls.length === 1);
    expect(lastContent(api).lines?.map((line) => [line.foodItemVersionId, line.quantity])).toEqual([
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
    press(cookingDialog(), 'Use it');
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
    await until(harness.fixture, () => api.publishDraft.mock.calls.length === 1);
    // The draft keeps the raw grams the cooked amount came from, so weighing it raw again is exact.
    expect(lastContent(api).lines?.[1]).toEqual({
      foodItemVersionId: 'rice-v1',
      quantity: 290,
      yieldFactorId: 'y-rice',
      retentionFactorId: 'r-rice',
      suggestion: null,
      convertedRawGrams: 100,
      convertedCookedGrams: 290,
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
    press(cookingDialog(), 'Use it');
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
    await until(harness.fixture, () => api.publishDraft.mock.calls.length === 1);
    expect(lastContent(api).lines).toEqual([keptLine('rice-v1', 60)]);
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
    press(cookingDialog(), 'Not now');
    await until(harness.fixture, () => confirmQuestion() !== null);
    expect(textOf(confirmQuestion())).toContain('What you typed will be lost.');
    press(confirmQuestion()!, 'Keep editing');
    await until(harness.fixture, () => confirmQuestion() === null);
    // The answer is taken in before anyone can press again.
    await settle(harness.fixture);
    expect(field(cookingSheet()!, 'What it is').value).toBe('White rice, boiled');

    press(cookingDialog(), 'Not now');
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

  it('asks before replacing a version someone saved after the changes began', async () => {
    let publishes = 0;
    const { harness, host, api } = await render({
      // Someone saved version 2 while the coach's changes were open.
      getRecipe: () => of(recipeDetail({ currentRevision: publishes === 0 ? 1 : 2 })),
      publishDraft: () =>
        ++publishes === 1
          ? throwError(
              () =>
                new HttpErrorResponse({
                  status: 409,
                  error: { code: 'newer_recipe_version', message: 'x' },
                }),
            )
          : of(recipeSummary({ revision: 3 })),
    });

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Berry oats');
    await until(harness.fixture, () => api.createDraft.mock.calls.length === 1);
    named(host, 'Publish changes').click();
    await until(harness.fixture, () => host.querySelector('.banner.warn') !== null);
    // The recipe is read again for the number; nothing of the coach's is set aside.
    expect(textOf(host.querySelector('.banner.warn p'))).toBe(
      'Version 2 of this recipe was saved after you started these changes. Make yours the newest version? Version 2 stays in the recipe’s history.',
    );
    expect(named(host, 'Discard mine')).toBeTruthy();
    expect((host.querySelector('#recipe-name') as HTMLInputElement).value).toBe('Berry oats');

    named(host, 'Publish mine as the newest').click();
    await until(harness.fixture, () => api.publishDraft.mock.calls.length === 2);
    expect(api.publishDraft.mock.calls[1][1]).toMatchObject({
      replaceNewer: true,
      keepAsDraft: false,
    });
  });

  it('says when another tab moved on, and reloads the recipe as the server has it', async () => {
    const { harness, host, api } = await render({
      createDraft: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: 'recipe_draft_exists', message: 'x' },
            }),
        ),
    });

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Berry oats');
    await until(harness.fixture, () => host.querySelector('.banner.warn') !== null);
    expect(textOf(host.querySelector('.banner.warn'))).toContain(
      'This recipe was changed in another tab or on another device.',
    );
    expect(textOf(host.querySelector('.save-status'))).toBe('Not saved');
    // A screen reader hears the trouble once, not every pause's save.
    expect(textOf(host.querySelector('.save-live'))).toBe('Not saved');

    // Reloading reads the recipe again and opens the draft the other tab started.
    api.getRecipe.mockReturnValue(
      of(
        recipeDetail({
          draft: {
            id: 'draft-1',
            recipeId: 'recipe-oats',
            name: 'Berry oats',
            lineCount: 2,
            photoMediaAssetId: 'photo-1',
            updatedAtUtc: '2026-10-20T08:00:00Z',
          },
        }),
      ),
    );
    named(host, 'Reload recipe').click();
    await until(harness.fixture, () => api.getDraft.mock.calls.length === 1);
    await settle(harness.fixture);
    expect(api.getDraft).toHaveBeenCalledWith('draft-1');
    expect(host.querySelector('.banner.warn')).toBeNull();
    expect(all(host, '.amount input').map((input) => (input as HTMLInputElement).value)).toEqual([
      '120',
      '200',
    ]);
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
    // The draft carried the suggestion all along; making its version approves it on the server
    // (ADR 0035), so the editor sends no review of its own.
    expect(api.createDraft.mock.calls[0][0].content).toMatchObject({
      name: 'Oat bowl',
      aiMealDraftOperationId: 'ai-1',
      lines: [
        { foodItemVersionId: null, suggestion: { name: 'oats', quantity: 80, unit: 'g' } },
        { foodItemVersionId: null, suggestion: { name: 'yogurt', uncertain: true } },
      ],
    });
    expect(lastContent(api)).toMatchObject({ name: 'Oat bowl', aiMealDraftOperationId: 'ai-1' });
    expect(lastContent(api).lines?.map((line) => [line.foodItemVersionId, line.quantity])).toEqual([
      ['oats-food-v1', 80],
      ['yogurt-food-v1', 150],
    ]);
    expect(api.publishDraft).toHaveBeenCalledWith('draft-new', {
      version: 2,
      replaceNewer: false,
      keepAsDraft: false,
    });
    expect(api.review).not.toHaveBeenCalled();
    expect(api.createRecipe).not.toHaveBeenCalled();
  });

  it('lets go of a suggestion the coach turns down, in the draft as on the server', async () => {
    const { harness, host, api } = await render({
      url: '/nutrition/recipes/new',
      aiConfigured: true,
    });

    named(host, 'Describe a meal').click();
    await settle(harness.fixture);
    typeInto(host.querySelector<HTMLTextAreaElement>('.ai textarea')!, 'oat bowl with yogurt');
    await settle(harness.fixture);
    named(host, 'Suggest ingredients').click();
    await until(harness.fixture, () => all(host, '.line.unmatched').length === 2);
    await until(harness.fixture, () => api.createDraft.mock.calls.length === 1);

    named(host, 'Remove the suggestions left').click();
    await until(harness.fixture, () => api.review.mock.calls.length === 1);
    expect(api.review.mock.calls[0]).toEqual([
      'ai-1',
      expect.objectContaining({ approved: false }),
    ]);
    await until(harness.fixture, () => api.saveDraft.mock.calls.length > 0);
    expect(lastContent(api)).toMatchObject({ lines: [], aiMealDraftOperationId: null });
  });

  it('explains AI suggestions are not set up, beside where they would be', async () => {
    const { host } = await render({ url: '/nutrition/recipes/new', aiConfigured: false });
    expect(textOf(host.querySelector('.ai'))).toContain('AI suggestions aren’t set up');
    expect(host.querySelector('.ai button')).toBeNull();
  });

  it('sends the last changes before leaving, and asks only when they cannot be saved', async () => {
    const { harness, host, router, api } = await render({
      createDraft: () => throwError(() => new HttpErrorResponse({ status: 503 })),
    });

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Changed');
    await until(harness.fixture, () => api.createDraft.mock.calls.length === 1);
    expect(textOf(host.querySelector('.save-status'))).toBe('Not saved yet. Trying again…');
    const leaving = router.navigateByUrl('/nutrition/recipes');
    await until(harness.fixture, () => document.querySelector('[role="dialog"]') !== null);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(textOf(dialog)).toContain(
      'Your latest changes have not reached the server yet. If you leave now, they are lost.',
    );
    named(dialog, 'Stay').click();
    expect(await leaving).toBe(false);
    // Leaving tried once more before it asked.
    expect(api.createDraft).toHaveBeenCalledTimes(2);
  });

  it('leaves without asking once the changes are in the coach’s draft', async () => {
    const { harness, host, router, api } = await render();

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Changed');
    await settle(harness.fixture);
    expect(await router.navigateByUrl('/nutrition/recipes')).toBe(true);
    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('reopens the coach’s own draft of a recipe, and keeps saving it from its version', async () => {
    const { harness, host, api } = await render({
      getRecipe: () =>
        of(
          recipeDetail({
            draft: {
              id: 'draft-1',
              recipeId: 'recipe-oats',
              name: 'Berry oats',
              lineCount: 2,
              photoMediaAssetId: 'photo-1',
              updatedAtUtc: '2026-10-20T08:00:00Z',
            },
          }),
        ),
    });

    expect(api.getDraft).toHaveBeenCalledWith('draft-1');
    expect((host.querySelector('#recipe-name') as HTMLInputElement).value).toBe('Berry oats');
    expect(all(host, '.amount input').map((input) => (input as HTMLInputElement).value)).toEqual([
      '120',
      '200',
    ]);
    expect(textOf(host.querySelector('.standing'))).toContain('Published In progress');
    expect(textOf(host.querySelector('.save-status'))).toBe(
      'Saved on Tue 20 Oct, not published yet',
    );
    expect(named(host, 'Publish changes').disabled).toBe(false);
    expect(named(host, 'Discard changes')).toBeTruthy();

    typeInto(host.querySelector<HTMLInputElement>('#recipe-cook')!, '5');
    await until(harness.fixture, () => api.saveDraft.mock.calls.length === 1);
    expect(api.saveDraft.mock.calls[0][0]).toBe('draft-1');
    expect(api.saveDraft.mock.calls[0][1].version).toBe(4);
    expect(api.createDraft).not.toHaveBeenCalled();
  });

  it('says a version saved since the changes began, before Publish asks', async () => {
    const { host } = await render({
      getRecipe: () =>
        of(
          recipeDetail({
            currentRevision: 3,
            draft: {
              id: 'draft-1',
              recipeId: 'recipe-oats',
              name: 'Berry oats',
              lineCount: 2,
              photoMediaAssetId: 'photo-1',
              updatedAtUtc: '2026-10-20T08:00:00Z',
            },
          }),
        ),
    });

    expect(textOf(host.querySelector('.banner.info'))).toBe(
      'Version 3 of this recipe was saved after you started these changes. Publishing yours makes it the newest version.',
    );
  });

  it('reopens a new recipe from the draft in its address', async () => {
    const { host, api } = await render({
      url: '/nutrition/recipes/new?draft=draft-new',
      getDraft: () =>
        of(
          recipeDraftView({
            id: 'draft-new',
            recipeId: null,
            startedAtRevision: 0,
            content: {
              name: 'Lentil soup',
              servings: null,
              instructions: '',
              lines: [
                {
                  foodItemVersionId: null,
                  quantity: null,
                  suggestion: { name: 'lentils', quantity: 200, unit: 'g', uncertain: false },
                },
              ],
              photoMediaAssetId: null,
              prepMinutes: 2.5,
              cookMinutes: null,
              aiMealDraftOperationId: 'ai-7',
            },
            foods: [],
          }),
        ),
    });

    expect(api.getDraft).toHaveBeenCalledWith('draft-new');
    expect(api.getRecipe).not.toHaveBeenCalled();
    // Kept as typed: no servings yet, half a minute, a suggested ingredient still waiting for a food.
    expect((host.querySelector('#recipe-name') as HTMLInputElement).value).toBe('Lentil soup');
    expect(field(host, 'Servings it makes').value).toBe('');
    expect(field(host, 'Prep time (min)').value).toBe('2.5');
    expect(all(host, '.line.unmatched .line-suggested').map(textOf)).toEqual([
      'Suggested: 200 g lentils',
    ]);
    expect(textOf(host.querySelector('.standing'))).toContain(
      'In progress Only you see it until you publish it.',
    );
    expect(textOf(host.querySelector('.standing'))).not.toContain('New recipe');
  });

  it('opens a saved recipe’s draft with its recipe', async () => {
    const { harness, router, api } = await render({
      url: '/nutrition/recipes/new?draft=draft-1',
    });

    await until(harness.fixture, () => router.url === '/nutrition/recipes/recipe-oats');
    expect(api.getRecipe).toHaveBeenCalledWith('recipe-oats');
  });

  it('discards the coach’s changes, and the recipe as last saved comes back', async () => {
    const { harness, host, api, toast } = await render();

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Berry oats');
    await until(harness.fixture, () => api.createDraft.mock.calls.length === 1);
    await settle(harness.fixture);
    named(host, 'Discard changes').click();
    await until(harness.fixture, () => confirmQuestion() !== null);
    expect(textOf(confirmQuestion())).toContain(
      'The recipe goes back to how it was last saved. This can’t be undone.',
    );
    press(confirmQuestion()!, 'Discard changes');
    await until(harness.fixture, () => api.discardDraft.mock.calls.length === 1);
    expect(api.discardDraft).toHaveBeenCalledWith('draft-1', 1);
    await until(harness.fixture, () => toast.show.mock.calls.length > 0);
    expect(toast.show).toHaveBeenCalledWith('Changes discarded.');
    expect((host.querySelector('#recipe-name') as HTMLInputElement).value).toBe('Overnight oats');
    expect(textOf(host.querySelector('.standing'))).not.toContain('In progress');
  });

  it('discards a new recipe never saved and goes back to the recipes', async () => {
    const { harness, host, api, router, toast } = await render({ url: '/nutrition/recipes/new' });

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Lentil soup');
    await until(harness.fixture, () => api.createDraft.mock.calls.length === 1);
    await settle(harness.fixture);
    named(host, 'Discard changes').click();
    await until(harness.fixture, () => confirmQuestion() !== null);
    expect(textOf(confirmQuestion())).toContain(
      'It was never saved, so no meal plan has it. This can’t be undone.',
    );
    press(confirmQuestion()!, 'Discard recipe');
    await until(harness.fixture, () => router.url === '/nutrition/recipes');
    expect(api.discardDraft).toHaveBeenCalledWith('draft-new', 1);
    expect(toast.show).toHaveBeenCalledWith('Recipe discarded.');
  });

  it('saves as a draft version the team sees, through the coach’s draft', async () => {
    const { harness, host, api, toast } = await render({
      publishDraft: () => of(recipeSummary({ status: 'Draft', revision: 2, versionId: 'oats-v2' })),
    });

    typeInto(host.querySelector<HTMLInputElement>('#recipe-name')!, 'Berry oats');
    await until(harness.fixture, () => api.createDraft.mock.calls.length === 1);
    named(host, 'More save options').click();
    await settle(harness.fixture);
    menuChoices(named(host, 'More save options'))[0].click();
    await until(harness.fixture, () => api.publishDraft.mock.calls.length === 1);
    expect(api.publishDraft.mock.calls[0]).toEqual([
      'draft-1',
      { version: 1, replaceNewer: false, keepAsDraft: true },
    ]);
    await until(harness.fixture, () => toast.show.mock.calls.length > 0);
    expect(toast.show).toHaveBeenCalledWith(
      'Saved as a draft. Your team sees it; meal plans don’t until you publish it.',
      { tone: 'success' },
    );
  });

  it('says there is nothing to save as a draft when nothing changed', async () => {
    const { harness, host, api, toast } = await render();

    named(host, 'More save options').click();
    await settle(harness.fixture);
    menuChoices(named(host, 'More save options'))[0].click();
    await settle(harness.fixture);
    expect(toast.show).toHaveBeenCalledWith('No changes to save.');
    expect(api.publishDraft).not.toHaveBeenCalled();
    expect(api.createDraft).not.toHaveBeenCalled();
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
