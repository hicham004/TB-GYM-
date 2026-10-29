import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClientTargetsList,
  CreateMealPlanDraftRequest,
  MacroSplitView,
  MealPlanDraftSaveView,
  MealPlanDraftView,
  MealPlanTemplateDetail,
  MealPlanTemplateSummary,
  MealPlanVersionView,
  RecipeSummary,
  SaveMealPlanDraftRequest,
} from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { LIBRARY_SEARCH_PAUSE } from '../../ui/paged-search';
import { UiToast } from '../../ui/toast';
import { field, fill, menuChoices, segment, settle, tick } from '../../../testing/dom';
import {
  CHICKEN,
  draftContent,
  draftSummary,
  draftView,
  LENTILS,
  OATS,
  planDetail,
  planSummary,
  recipe,
  RECIPES,
  saveView,
  searchRecipes,
  versionView,
} from '../../../testing/meal-plan-fixtures';
import type { AutosaveTiming } from '../training/program-autosave';
import { MealPlanApi, type MacroSplitRequest } from './meal-plan-api';
import { MEAL_PLAN_AUTOSAVE_TIMING, MealPlanBuilder } from './meal-plan-builder';

@Component({ template: '' })
class PlansStub {}

/** Every change is sent at once, and a failed save waits longer than any test runs. */
const AT_ONCE: AutosaveTiming = { quietMs: 0, maxWaitMs: 0, retryMs: 600_000, retryMaxMs: 600_000 };
/** Changes wait to be sent, so a test can leave before they go. */
const HELD_BACK: AutosaveTiming = { ...AT_ONCE, quietMs: 600_000, maxWaitMs: 600_000 };

interface Options {
  url?: string;
  getPlan?: () => Observable<MealPlanTemplateDetail>;
  getDraft?: () => Observable<MealPlanDraftView>;
  getVersion?: () => Observable<MealPlanVersionView>;
  library?: RecipeSummary[];
  createDraft?: () => Observable<MealPlanDraftSaveView>;
  saveDraft?: () => Observable<MealPlanDraftSaveView>;
  publishDraft?: () => Observable<MealPlanTemplateSummary>;
  macroSplit?: (request: MacroSplitRequest) => Observable<MacroSplitView>;
  listClientTargets?: () => Observable<ClientTargetsList>;
  timing?: AutosaveTiming;
}

/**
 * The server's macro split (NUT-008) for a request, worked out here only to stand in for the server:
 * fat its share of the calories, carbs what protein and fat leave.
 */
function splitOf(request: MacroSplitRequest, warnings: string[] = []): MacroSplitView {
  const fatCalories = (request.calorieTarget * request.fatPercentage) / 100;
  return {
    calorieTarget: request.calorieTarget,
    proteinGrams: request.proteinGrams,
    fatPercentage: request.fatPercentage,
    fatGrams: fatCalories / 9,
    carbohydrateGrams: (request.calorieTarget - request.proteinGrams * 4 - fatCalories) / 4,
    methodKey: 'Nut008MacroSplit',
    methodVersion: '1.0',
    warnings,
  };
}

/** Maya, Lea's client, whose targets the split made at 25 %: 62 kg, eating below what she burns. */
function clientTargets(): ClientTargetsList {
  return {
    items: [
      {
        clientProfileId: 'client-maya',
        firstName: 'Maya',
        lastName: 'Fakhoury',
        coachUserId: 'user-lea',
        coachName: 'Lea Khoury',
        calculationId: 'calculation-maya',
        calculatedAtUtc: '2026-10-26T09:30:00Z',
        calorieTarget: 1802.35,
        proteinGrams: 120,
        carbohydrateGrams: 217.94,
        fatGrams: 50.07,
        fatPercentage: 25,
        bodyweightKilograms: 62,
        isEnergyDeficit: true,
        warnings: [],
      },
    ],
    total: 1,
    limit: 500,
  };
}

async function render(options: Options = {}) {
  const api = {
    getPlan: vi.fn(options.getPlan ?? (() => of(planDetail()))),
    getVersion: vi.fn(options.getVersion ?? (() => of(versionView()))),
    listPublishedRecipes: vi.fn(searchRecipes(options.library ?? RECIPES)),
    listDrafts: vi.fn(() => of([])),
    getDraft: vi.fn(options.getDraft ?? (() => of(draftView()))),
    createDraft: vi.fn<(request: CreateMealPlanDraftRequest) => Observable<MealPlanDraftSaveView>>(
      options.createDraft ?? (() => of(saveView())),
    ),
    saveDraft: vi.fn<
      (id: string, request: SaveMealPlanDraftRequest) => Observable<MealPlanDraftSaveView>
    >(options.saveDraft ?? (() => of(saveView('draft-1', 9)))),
    discardDraft: vi.fn(() => of(undefined)),
    publishDraft: vi.fn(
      options.publishDraft ?? (() => of(planSummary({ revision: 3, versionId: 'plan-v3' }))),
    ),
    macroSplit: vi.fn<(request: MacroSplitRequest) => Observable<MacroSplitView>>(
      options.macroSplit ?? ((request) => of(splitOf(request))),
    ),
    listClientTargets: vi.fn(options.listClientTargets ?? (() => of(clientTargets()))),
  };
  const toast = { show: vi.fn(() => ({ dismiss: vi.fn() })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'nutrition/plans', component: PlansStub },
        {
          path: 'nutrition/plans/:planId',
          component: MealPlanBuilder,
          canDeactivate: [confirmBeforeLeaving],
        },
      ]),
      { provide: MealPlanApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: UiToast, useValue: toast },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: MEAL_PLAN_AUTOSAVE_TIMING, useValue: options.timing ?? AT_ONCE },
      { provide: LIBRARY_SEARCH_PAUSE, useValue: 0 },
      { provide: AuthStore, useValue: { user: signal({ id: 'user-lea' }) } },
      {
        provide: WorkspaceCalendar,
        useValue: {
          today: signal('2026-10-29'),
          timeZone: signal('Asia/Beirut'),
          resolveToday: () => Promise.resolve('2026-10-29'),
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(options.url ?? '/nutrition/plans/plan-1', MealPlanBuilder);
  await settle(harness.fixture);
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    api,
    toast,
    router: TestBed.inject(Router),
  };
}

const all = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(selector));
const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** A button by the name it announces: its visible text, or the label of an icon-only one. */
function named(host: ParentNode, name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (candidate) =>
      (candidate.getAttribute('aria-label') ?? textOf(candidate)) === name && !candidate.disabled,
  );
  if (found.length !== 1) throw new Error(`${found.length} enabled buttons are named "${name}".`);
  return found[0];
}

/** Waits, a macrotask at a time, for a dialog with this title to open. */
async function dialogNamed(
  fixture: { detectChanges(): void },
  title: string,
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    const open = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
      (dialog) => textOf(dialog.querySelector('h2')) === title,
    );
    if (open) return open;
    await new Promise((resolve) => setTimeout(resolve));
  }
  throw new Error(`No dialog titled "${title}" opened.`);
}

const days = (host: HTMLElement) => all(host, 'section.day');
const mealsOf = (day: HTMLElement) => all(day, '.meal-name').map(textOf);
const status = (host: HTMLElement) => textOf(host.querySelector('.status'));
const alerts = (host: HTMLElement) => all(host, '.alert[role="alert"]').map(textOf);

describe('the meal-plan builder', () => {
  beforeEach(() => localStorage.removeItem('tb.adding-tip:meal-plan'));

  afterEach(() => {
    document.body
      .querySelectorAll('.cdk-overlay-container')
      .forEach((node) => node.replaceChildren());
    TestBed.resetTestingModule();
  });

  it('draws each day with its meals, options and total against the daily target', async () => {
    const { host, api } = await render();

    expect(api.getVersion).toHaveBeenCalledWith('plan-v2');
    expect(textOf(host.querySelector('#days-title'))).toBe('2 days · 3 meals');
    const [first, second] = days(host);
    expect(mealsOf(first)).toEqual(['Breakfast', 'Lunch']);
    expect(mealsOf(second)).toEqual(['Breakfast']);
    // Lunch offers two recipes: the client picks one, option 1 first, so the day counts their
    // average, which the card says with its macros (B5a).
    const [breakfast, lunch] = all(first, '.meal-card');
    expect(textOf(lunch.querySelector('.pick-one'))).toBe('Pick one of 2');
    expect(all(lunch, '.option-row').map(textOf)).toEqual([
      'Option 1 Chicken & rice 1 serving · 600 kcal',
      'Option 2 Lentil soup 2 servings · 600 kcal',
    ]);
    expect(lunch.querySelector('ol.option-list')).not.toBeNull();
    expect(textOf(lunch.querySelector('.meal-average'))).toBe(
      '≈ 600 kcal · protein 43 g · carbs 75 g · fat 12 g, the average of 2 options',
    );
    // A meal of one recipe is no choice: no count, no number, its calories alone.
    expect(breakfast.querySelector('.pick-one')).toBeNull();
    expect(breakfast.querySelector('.option-number')).toBeNull();
    expect(all(breakfast, '.option-row').map(textOf)).toEqual([
      'Overnight oats 1 serving · 400 kcal',
    ]);
    expect(breakfast.querySelector('.meal-average')).toBeNull();
    expect(textOf(breakfast.querySelector('.meal-kcal'))).toBe('400 kcal');
    expect(textOf(first.querySelector('.day-kcal'))).toBe('≈ 1,000 kcal');
    expect(textOf(first.querySelector('.day-against'))).toBe('1,000 kcal under');
    expect(textOf(first.querySelector('.day-macros'))).toBe('P 73 · C 125 · F 21');
    expect(textOf(second.querySelector('.day-kcal'))).toBe('600 kcal');
    // The targets as published, with their shares of the calories.
    expect((host.querySelector('.targets input') as HTMLInputElement).value).toBe('2000');
    expect(textOf(host.querySelector('.split-text'))).toBe('Protein 30% Carbs 40% Fat 30%');
    expect(host.querySelector('.split-warning')).toBeNull();
    expect(status(host)).toBe('Published: you can assign it');
    expect(all(host, '.save-buttons button').map(textOf)).toEqual(['Versions', 'Publish']);
    expect((all(host, '.save-buttons button')[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists the published recipes beside the grid, per serving, and searches them on the server', async () => {
    const { host, harness, api } = await render();

    const library = host.querySelector('app-meal-plan-library')!;
    expect(all(library, '.lib-item .name').map(textOf)).toEqual([
      'Chicken & rice',
      'Lentil soup',
      'Overnight oats',
    ]);
    expect(textOf(all(library, '.lib-item')[1].querySelector('.detail'))).toBe(
      '300 kcal a serving',
    );
    expect(api.listPublishedRecipes.mock.calls).toEqual([['', 0, 48]]);
    fill(library, 'Search recipes', 'oats');
    await settle(harness.fixture);
    expect(all(library, '.lib-item .name').map(textOf)).toEqual(['Overnight oats']);
    expect(api.listPublishedRecipes).toHaveBeenLastCalledWith('oats', 0, 48);

    fill(library, 'Search recipes', 'pizza');
    await settle(harness.fixture);
    expect(textOf(library.querySelector('[role="status"]'))).toBe('No recipe matches “pizza”.');
    named(library, 'Show all recipes').click();
    await settle(harness.fixture);
    expect(all(library, '.lib-item')).toHaveLength(3);
    expect(api.listPublishedRecipes).toHaveBeenCalledTimes(3);
  });

  it('reads a page of a big library, and keeps a recipe found by a search in the plan’s totals (WEA-14)', async () => {
    // Fifty salads sort first, so the first page of 48 holds none of the plan's own recipes.
    const salads = Array.from({ length: 50 }, (_, index) =>
      recipe({
        id: `recipe-salad-${index + 1}`,
        versionId: `salad-${index + 1}-v1`,
        name: `A salad ${String(index + 1).padStart(2, '0')}`,
        calories: 200,
      }),
    );
    const chili = recipe({
      id: 'recipe-chili',
      versionId: 'chili-v1',
      name: 'Turkey chili',
      calories: 500,
      proteinGrams: 45,
      carbohydrateGrams: 40,
      fatGrams: 15,
      declaredAllergens: [],
    });
    const { host, harness, api } = await render({ library: [...salads, ...RECIPES, chili] });

    const library = host.querySelector('app-meal-plan-library')!;
    expect(all(library, '.lib-item')).toHaveLength(48);
    named(library, 'Show more recipes').click();
    await settle(harness.fixture);
    expect(api.listPublishedRecipes).toHaveBeenLastCalledWith('', 48, 48);
    expect(all(library, '.lib-item')).toHaveLength(54);
    expect(all(library, '.more')).toHaveLength(0);

    // The sheet's own search finds the chili, which goes into day 2.
    named(host, 'Add a meal to day 2').click();
    const picker = await dialogNamed(harness.fixture, 'Add a meal to day 2');
    fill(picker, 'Search recipes', 'chili');
    await settle(harness.fixture);
    named(picker, 'Add Turkey chili').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(textOf(days(host)[1].querySelector('.day-kcal'))).toBe('1,100 kcal');

    // Another search beside the grid changes the list, never the day's total.
    fill(library, 'Search recipes', 'lentil');
    await settle(harness.fixture);
    expect(all(library, '.lib-item .name').map(textOf)).toEqual(['Lentil soup']);
    expect(textOf(days(host)[1].querySelector('.day-kcal'))).toBe('1,100 kcal');
  });

  it('keeps a change to the targets as the coach’s draft of this plan', async () => {
    const { host, harness, api } = await render();

    fill(host, 'Calories (kcal)', '2200');
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(api.createDraft).toHaveBeenCalledTimes(1);
    const [request] = api.createDraft.mock.calls[0];
    expect(request).toEqual(
      expect.objectContaining({
        mealPlanTemplateId: 'plan-1',
        sourceVersionId: 'plan-v2',
        templateRevision: 2,
      }),
    );
    expect(request.content.targetCalories).toBe(2200);
    // A round figure is a valid one to the browser too (R5.4c): "min 1, step 10" made 2200 a step mismatch.
    const calories = field<HTMLInputElement>(host, 'Calories (kcal)');
    expect(calories.validity.stepMismatch).toBe(false);
    for (const typed of ['2000', '2137', '1']) {
      calories.value = typed;
      expect(calories.validity.valid).toBe(true);
    }
    expect(request.content.days).toHaveLength(2);
    expect(status(host)).toMatch(/^Saved (at|on) .+, not published yet$/);
    expect(textOf(days(host)[0].querySelector('.day-against'))).toBe('1,200 kcal under');

    // The next change carries the version the first save answered.
    fill(host, 'Fat (g)', '70');
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(api.saveDraft).toHaveBeenCalledWith('draft-1', expect.objectContaining({ version: 8 }));
  });

  it('adds a meal to a day from the recipe sheet, named after the day’s next usual meal', async () => {
    const { host, harness, api } = await render();

    named(host, 'Add a meal to day 2').click();
    const picker = await dialogNamed(harness.fixture, 'Add a meal to day 2');
    named(picker, 'Add Chicken & rice').click();
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(mealsOf(days(host)[1])).toEqual(['Breakfast', 'Lunch']);
    expect(textOf(days(host)[1].querySelector('.day-kcal'))).toBe('1,200 kcal');
    const content = api.createDraft.mock.calls.at(-1)![0].content;
    expect(content.days?.[1].meals?.[1]).toEqual({
      name: 'Lunch',
      choices: [{ recipeVersionId: 'chicken-v1', servings: 1 }],
    });
  });

  it('edits a meal in its sheet: servings, another option, and Undo for a removed one', async () => {
    const { host, harness, toast } = await render();

    named(host, 'Edit Lunch on day 1').click();
    const editor = await dialogNamed(harness.fixture, 'Edit meal');
    fill(editor, 'Servings of Lentil soup', '3');
    await settle(harness.fixture);
    await settle(harness.fixture);
    // Lentils at 300 kcal a serving: 900, averaged with the chicken's 600, plus breakfast's 400.
    expect(textOf(days(host)[0].querySelector('.day-kcal'))).toBe('≈ 1,150 kcal');
    expect(textOf(editor.querySelector('.total'))).toContain(
      'the average of its options: 750 kcal',
    );

    named(editor, 'Remove Chicken & rice').click();
    await settle(harness.fixture);
    expect(all(days(host)[0], '.meal-card')[1].querySelectorAll('.option-row')).toHaveLength(1);
    const undo = toast.show.mock.calls.at(-1) as unknown as [string, { action: { run(): void } }];
    expect(undo[0]).toBe('Chicken & rice removed.');
    undo[1].action.run();
    await settle(harness.fixture);
    expect(all(days(host)[0], '.meal-card')[1].querySelectorAll('.option-row')).toHaveLength(2);

    named(editor, 'Add another option').click();
    const picker = await dialogNamed(harness.fixture, 'Add a recipe to Lunch');
    // The recipes the meal already offers are marked, not offered twice.
    expect(named(picker, 'Add Overnight oats')).toBeDefined();
    expect(
      all(picker, 'button[aria-label="Chicken & rice is in this meal"]')[0].hasAttribute(
        'disabled',
      ),
    ).toBe(true);
    named(picker, 'Add Overnight oats').click();
    await settle(harness.fixture);
    expect(all(days(host)[0], '.meal-card')[1].querySelectorAll('.option-row')).toHaveLength(3);
  });

  it('takes the coach to what stops Publish instead of sending it', async () => {
    const { host, harness, api } = await render({
      url: '/nutrition/plans/new?draft=draft-new',
      getDraft: () =>
        of(
          draftView({
            id: 'draft-new',
            mealPlanTemplateId: null,
            sourceVersionId: null,
            startedAtRevision: 0,
            content: draftContent({ name: ' ', days: [{ meals: [] }] }),
          }),
        ),
    });

    named(host, 'Publish').click();
    await settle(harness.fixture);
    expect(alerts(host)).toEqual(['Give the meal plan a name before publishing it.']);
    expect(document.activeElement?.classList.contains('name-input')).toBe(true);

    fill(host, 'Meal plan name', 'Cut');
    await settle(harness.fixture);
    named(host, 'Publish').click();
    await settle(harness.fixture);
    expect(alerts(host)).toEqual(['Day 1 has no meals yet. Add a meal to it.']);
    expect(days(host)[0].classList.contains('problem')).toBe(true);
    expect(api.publishDraft).not.toHaveBeenCalled();
  });

  it('publishes a new plan from its draft, then opens it as a plan the coach can assign', async () => {
    const published = planSummary({ id: 'plan-9', versionId: 'plan-9-v1', revision: 1 });
    const { host, harness, api, toast, router } = await render({
      url: '/nutrition/plans/new?draft=draft-new',
      getDraft: () =>
        of(
          draftView({
            id: 'draft-new',
            mealPlanTemplateId: null,
            sourceVersionId: null,
            startedAtRevision: 0,
          }),
        ),
      getPlan: () =>
        of(
          planDetail({
            id: 'plan-9',
            currentRevision: 1,
            versions: [{ ...planDetail().versions[0], id: 'plan-9-v1', revision: 1 }],
          }),
        ),
      publishDraft: () => of(published),
    });

    expect(status(host)).toBe('Saved on Tue 6 Oct, not published yet');
    named(host, 'Publish').click();
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(api.publishDraft).toHaveBeenCalledWith('draft-new', { version: 7, replaceNewer: false });
    expect(router.url).toBe('/nutrition/plans/plan-9');
    expect(api.getPlan).toHaveBeenCalledWith('plan-9');
    expect(toast.show).toHaveBeenCalledWith('Published. You can assign it to clients now.', {
      tone: 'success',
    });
  });

  it('opens the coach’s own changes first, and asks before publishing over a newer version', async () => {
    const newer = new HttpErrorResponse({
      status: 409,
      error: { code: 'newer_version_published', message: 'Newer.' },
    });
    let publishes = 0;
    const { host, harness, api } = await render({
      getPlan: () => of(planDetail({ currentRevision: 3, draft: draftSummary() })),
      publishDraft: () =>
        ++publishes === 1 ? throwError(() => newer) : of(planSummary({ revision: 4 })),
    });

    // The draft began at version 2; version 3 was published since.
    expect(api.getDraft).toHaveBeenCalledWith('draft-1');
    expect(mealsOf(days(host)[0])).toEqual(['Breakfast']);
    expect(textOf(days(host)[0].querySelector('.day-kcal'))).toBe('800 kcal');
    expect(textOf(host.querySelector('.older'))).toContain(
      'Version 3 was published after you started',
    );

    named(host, 'Publish').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(alerts(host)[0]).toContain(
      'Version 3 of this meal plan was published after you started',
    );
    named(host, 'Publish mine as the newest').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(api.publishDraft).toHaveBeenLastCalledWith('draft-1', {
      version: 7,
      replaceNewer: true,
    });
  });

  it('discards the coach’s changes after asking, and goes back to the published plan', async () => {
    const { host, harness, api, toast } = await render({
      getPlan: () => of(planDetail({ draft: draftSummary() })),
    });

    named(host, 'Discard changes').click();
    const question = await dialogNamed(harness.fixture, 'Discard your changes?');
    named(question, 'Discard changes').click();
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(api.discardDraft).toHaveBeenCalledWith('draft-1', 7);
    expect(toast.show).toHaveBeenCalledWith('Changes discarded.');
  });

  it('sends changes still waiting before the page goes', async () => {
    const { host, harness, api, router } = await render({ timing: HELD_BACK });

    fill(host, 'Protein (g)', '160');
    await settle(harness.fixture);
    expect(api.createDraft).not.toHaveBeenCalled();
    expect(status(host)).toBe('Saving…');

    await router.navigateByUrl('/nutrition/plans');
    await settle(harness.fixture);
    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/nutrition/plans');
  });

  it('offers a recipe published again since, and moves only this draft to it, with Undo', async () => {
    const newer = recipe({
      versionId: 'oats-v2',
      revision: 2,
      name: 'Berry oats',
      calories: 420,
      publishedVersionId: 'oats-v2',
    });
    // The library lists each recipe at its newest published version only.
    const { harness, host, api, toast } = await render({
      library: [CHICKEN, LENTILS, newer],
      getVersion: () =>
        of(
          versionView({
            recipes: [CHICKEN, LENTILS, { ...OATS, publishedVersionId: 'oats-v2' }, newer],
          }),
        ),
    });

    expect(all(host, '.update p').map(textOf)).toEqual([
      'Overnight oats (now Berry oats) was published again: 420 kcal a serving, 400 kcal before.',
    ]);
    named(host, 'Use the newest version').click();
    await settle(harness.fixture);

    expect(host.querySelector('.update')).toBeNull();
    const content = api.createDraft.mock.calls.at(-1)![0].content;
    const options = (content.days ?? [])
      .flatMap((day) => day.meals ?? [])
      .flatMap((meal) => meal.choices ?? [])
      .map((choice) => choice.recipeVersionId);
    expect(options).toContain('oats-v2');
    expect(options).not.toContain('oats-v1');
    const [message, settings] = toast.show.mock.calls.at(-1) as unknown as [
      string,
      { action: { label: string; run(): void } },
    ];
    expect([message, settings.action.label]).toEqual([
      'Berry oats now uses its newest version.',
      'Undo',
    ]);

    settings.action.run();
    await settle(harness.fixture);
    expect(all(host, '.update')).toHaveLength(1);
  });

  it('says a serving’s calories are unchanged when only the method or times were', async () => {
    const newer = recipe({ versionId: 'oats-v2', revision: 2, publishedVersionId: 'oats-v2' });
    const { host } = await render({
      library: [CHICKEN, LENTILS, newer],
      getVersion: () =>
        of(
          versionView({
            recipes: [CHICKEN, LENTILS, { ...OATS, publishedVersionId: 'oats-v2' }, newer],
          }),
        ),
    });

    expect(all(host, '.update p').map(textOf)).toEqual([
      'Overnight oats was published again; a serving is still 400 kcal.',
    ]);
  });

  /** Opens the kit menu whose button is named `name` and gives its choices. */
  async function openMenu(
    fixture: Parameters<typeof settle>[0],
    where: ParentNode,
    name: string,
  ): Promise<HTMLButtonElement[]> {
    const trigger = named(where, name);
    trigger.click();
    await settle(fixture);
    return menuChoices(trigger);
  }

  const titles = (items: HTMLButtonElement[]) =>
    items.map((item) => textOf(item.querySelector('.item-title')));

  /** The Undo toast shown last: its words, and its Undo. */
  function lastUndo(toast: { show: ReturnType<typeof vi.fn> }): [string, () => void] {
    const [message, settings] = toast.show.mock.calls.at(-1) as unknown as [
      string,
      { action: { label: string; run(): void } },
    ];
    expect(settings.action.label).toBe('Undo');
    return [message, () => settings.action.run()];
  }

  it('keeps every day in its place: copy, replace and clear, and Delete day on the last day only (critique B5c)', async () => {
    const { host, harness, toast } = await render();

    const first = await openMenu(harness.fixture, days(host)[0], 'More for day 1');
    expect(titles(first)).toEqual(['Copy this day to…', 'Replace with a copy of…', 'Clear meals']);
    expect(textOf(first[2].querySelector('.item-hint'))).toBe('Keeps the day, empties it');
    first[2].click();
    await settle(harness.fixture);
    expect(days(host)).toHaveLength(2);
    expect(mealsOf(days(host)[0])).toEqual([]);
    const [cleared, undoClear] = lastUndo(toast);
    expect(cleared).toBe('Day 1 cleared.');
    undoClear();
    await settle(harness.fixture);
    expect(mealsOf(days(host)[0])).toEqual(['Breakfast', 'Lunch']);

    const last = await openMenu(harness.fixture, days(host)[1], 'More for day 2');
    expect(titles(last)).toEqual([
      'Copy this day to…',
      'Replace with a copy of…',
      'Clear meals',
      'Delete day',
    ]);
    last[3].click();
    await settle(harness.fixture);
    expect(days(host)).toHaveLength(1);
    expect(textOf(host.querySelector('#days-title'))).toBe('1 day · 2 meals');
    const [deleted, undoDelete] = lastUndo(toast);
    expect(deleted).toBe('Day 2 deleted.');
    undoDelete();
    await settle(harness.fixture);
    expect(days(host)).toHaveLength(2);
  });

  it('copies a day to the days picked, replacing their meals, with Undo (critique B5c)', async () => {
    const { host, harness, toast, api } = await render();

    (await openMenu(harness.fixture, days(host)[0], 'More for day 1'))[0].click();
    const sheet = await dialogNamed(harness.fixture, 'Copy day 1 to…');
    expect(textOf(sheet.querySelector('.help'))).toBe(
      'Day 1’s meals go to the days you pick. Their own meals are replaced.',
    );
    expect(field<HTMLInputElement>(sheet, 'Day 1, this day').disabled).toBe(true);
    const submit = sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect([textOf(submit), submit.disabled]).toEqual(['Copy', true]);
    tick(sheet, 'Day 2, 1 meal');
    await settle(harness.fixture);
    expect(textOf(sheet.querySelector('.summary'))).toBe(
      '1 day picked. Day 2 has meals now; copying replaces them.',
    );
    named(sheet, 'Copy to day 2').click();
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(days(host)).toHaveLength(2);
    expect(mealsOf(days(host)[1])).toEqual(['Breakfast', 'Lunch']);
    const [message, undo] = lastUndo(toast);
    expect(message).toBe('Day 1’s meals copied to day 2.');
    const saved = api.createDraft.mock.calls.at(-1)![0].content.days ?? [];
    expect(saved.map((day) => (day.meals ?? []).map((meal) => meal.name))).toEqual([
      ['Breakfast', 'Lunch'],
      ['Breakfast', 'Lunch'],
    ]);
    undo();
    await settle(harness.fixture);
    expect(mealsOf(days(host)[1])).toEqual(['Breakfast']);
  });

  it('replaces a day with a copy of another, which a day with no meals cannot be (critique B5c)', async () => {
    const { host, harness, toast } = await render();
    (await openMenu(harness.fixture, days(host)[0], 'More for day 1'))[2].click();
    await settle(harness.fixture);
    // With day 1 cleared, day 2 has no other day to take meals from.
    const alone = await openMenu(harness.fixture, days(host)[1], 'More for day 2');
    expect(alone[1].getAttribute('aria-disabled')).toBe('true');
    expect(textOf(alone[1].querySelector('.item-hint'))).toBe('No other day has meals yet');
    named(days(host)[1], 'More for day 2').click();
    await settle(harness.fixture);

    // Day 3, a copy of day 2, is a day to copy; the empty day 1 cannot be picked.
    named(host, 'Add day').click();
    await settle(harness.fixture);
    (await openMenu(harness.fixture, days(host)[1], 'More for day 2'))[1].click();
    const sheet = await dialogNamed(harness.fixture, 'Replace day 2 with a copy of…');
    expect(field<HTMLInputElement>(sheet, 'Day 1, no meals').disabled).toBe(true);
    expect(field<HTMLInputElement>(sheet, 'Day 2, this day').disabled).toBe(true);
    expect(field<HTMLInputElement>(sheet, 'Day 3, 1 meal').disabled).toBe(false);
    const submit = sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect([textOf(submit), submit.disabled]).toEqual(['Replace day 2', true]);
    named(sheet, 'Cancel').click();
    await settle(harness.fixture);

    // The empty day 1 takes a copy of day 3, and keeps its place.
    (await openMenu(harness.fixture, days(host)[0], 'More for day 1'))[1].click();
    const again = await dialogNamed(harness.fixture, 'Replace day 1 with a copy of…');
    field<HTMLInputElement>(again, 'Day 3, 1 meal').click();
    await settle(harness.fixture);
    expect(textOf(again.querySelector('.summary'))).toBe('Day 3: Breakfast · 600 kcal');
    named(again, 'Replace day 1').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(days(host)).toHaveLength(3);
    expect(mealsOf(days(host)[0])).toEqual(['Breakfast']);
    expect(lastUndo(toast)[0]).toBe('Day 1 now has day 3’s meals.');
  });

  it('duplicates and deletes whole weeks from the week’s menu, with Undo (critique B5c)', async () => {
    const { host, harness, toast } = await render();
    named(host, 'Add week').click();
    await settle(harness.fixture);
    expect(days(host)).toHaveLength(9);
    expect(all(host, '.week-title').map(textOf)).toEqual(['Week 1', 'Week 2']);

    const week1 = await openMenu(harness.fixture, host, 'More for week 1');
    expect(titles(week1)).toEqual(['Duplicate week', 'Delete week']);
    expect(textOf(week1[0].querySelector('.item-hint'))).toBe(
      'A copy right after it; later weeks move on a week',
    );
    week1[0].click();
    await settle(harness.fixture);
    expect(days(host)).toHaveLength(16);
    expect(all(host, '.week-title').map(textOf)).toEqual(['Week 1', 'Week 2', 'Week 3']);
    const [copied, undoCopy] = lastUndo(toast);
    expect(copied).toBe('Week 1 duplicated as week 2. The weeks after it moved on a week.');
    undoCopy();
    await settle(harness.fixture);
    expect(days(host)).toHaveLength(9);

    // Week 2 holds two days, so it cannot be duplicated; it can be deleted.
    const week2 = await openMenu(harness.fixture, host, 'More for week 2');
    expect(week2[0].getAttribute('aria-disabled')).toBe('true');
    expect(textOf(week2[0].querySelector('.item-hint'))).toBe(
      'Only a full week of 7 days can be duplicated.',
    );
    week2[1].click();
    await settle(harness.fixture);
    expect(days(host)).toHaveLength(7);
    expect(all(host, '.week-title')).toHaveLength(0);
    expect(lastUndo(toast)[0]).toBe('Week 2 deleted.');
  });

  it('offers Copy a day here when Publish finds a day with no meals (critique B5c)', async () => {
    const { host, harness, api } = await render();
    (await openMenu(harness.fixture, days(host)[0], 'More for day 1'))[2].click();
    await settle(harness.fixture);

    named(host, 'Publish').click();
    await settle(harness.fixture);
    expect(all(host, '.alert[role="alert"] p').map(textOf)).toEqual([
      'Day 1 has no meals yet. Add a meal, or copy a day here.',
    ]);
    expect(api.publishDraft).not.toHaveBeenCalled();
    named(host, 'Copy a day here').click();
    const sheet = await dialogNamed(harness.fixture, 'Replace day 1 with a copy of…');
    field<HTMLInputElement>(sheet, 'Day 2, 1 meal').click();
    await settle(harness.fixture);
    named(sheet, 'Replace day 1').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(mealsOf(days(host)[0])).toEqual(['Breakfast']);
    expect(alerts(host)).toEqual([]);
  });

  it('fills in fat and carbs through the server’s split, keeps its share and says the arithmetic (critique B5c2)', async () => {
    const lowFat =
      'Fat is 15% of calories, under the coaching review floor of 20%. This is a warning, not a clinical determination.';
    const { host, harness, api, toast } = await render({
      macroSplit: (request) => of(splitOf(request, request.fatPercentage < 20 ? [lowFat] : [])),
    });

    named(host, 'Fill in fat and carbs').click();
    const sheet = await dialogNamed(harness.fixture, 'Fill in fat and carbs');
    await settle(harness.fixture);
    expect(field(sheet, 'Calories (kcal)').value).toBe('2000');
    expect(field(sheet, 'Protein (g)').value).toBe('150');
    expect(field(sheet, 'Fat (percent of calories)').value).toBe('25');
    named(sheet, 'Fill in fat and carbs').click();
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(api.macroSplit).toHaveBeenCalledWith({
      calorieTarget: 2000,
      proteinGrams: 150,
      fatPercentage: 25,
      bodyweightKilograms: null,
      isEnergyDeficit: false,
    });
    // The boxes show whole grams; the draft keeps the server's own, with the share they came from.
    expect(field(host, 'Fat (g)').value).toBe('56');
    expect(field(host, 'Carbs (g)').value).toBe('225');
    expect(all(host, '[data-target-note] p').map(textOf)).toEqual([
      'Fat is 25% of the calories, 56 g, and carbs are the rest, 225 g.',
    ]);
    const saved = api.createDraft.mock.calls.at(-1)![0].content;
    expect([saved.targetFatPercentage, saved.targetCarbohydrateGrams]).toEqual([25, 225]);
    expect(saved.targetFatGrams).toBeCloseTo(55.5556, 4);
    const [message, undo] = lastUndo(toast);
    expect(message).toBe('Fat and carbs filled in, fat at 25% of the calories.');

    // A share under the floor is worked out, and its warning is said in the card.
    named(host, 'Fill in fat and carbs').click();
    const again = await dialogNamed(harness.fixture, 'Fill in fat and carbs');
    await settle(harness.fixture);
    expect(field(again, 'Fat (percent of calories)').value).toBe('25');
    fill(again, 'Fat (percent of calories)', '15');
    named(again, 'Fill in fat and carbs').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(all(host, '[data-target-note] p').map(textOf)).toEqual([
      'Fat is 15% of the calories, 33 g, and carbs are the rest, 275 g.',
      'Fat is 15% of the calories, under the usual 20%. This is a flag for you to look at, not a rule.',
    ]);

    // A typed target is the coach's own: the share, the sentence and the warning go.
    fill(host, 'Fat (g)', '40');
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(host.querySelector('[data-target-note]')).toBeNull();
    const [, typed] = api.saveDraft.mock.calls.at(-1)!;
    expect([typed.content.targetFatPercentage, typed.content.targetFatGrams]).toEqual([null, 40]);

    // Undo puts back what the first fill replaced: the targets as published.
    undo();
    await settle(harness.fixture);
    expect([field(host, 'Fat (g)').value, field(host, 'Carbs (g)').value]).toEqual(['67', '200']);
    expect(host.querySelector('[data-target-note]')).toBeNull();
  });

  it('starts from a client’s latest targets, whose weight a fill then uses (critique B5c2)', async () => {
    const { host, harness, api, toast } = await render();

    named(host, 'Start from a client’s targets').click();
    const sheet = await dialogNamed(harness.fixture, 'Start from a client’s targets');
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(api.listClientTargets).toHaveBeenCalledTimes(1);
    sheet.querySelector<HTMLButtonElement>('.row')!.click();
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(
      ['Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)'].map(
        (label) => field(host, label).value,
      ),
    ).toEqual(['1802', '120', '218', '50']);
    expect(all(host, '[data-target-note] p').map(textOf)).toEqual([
      'From Maya Fakhoury’s targets, worked out Mon 26 Oct.',
      'Fat is 25% of the calories, 50 g, and carbs are the rest, 218 g.',
    ]);
    expect(lastUndo(toast)[0]).toBe('Maya Fakhoury’s targets are the daily target now.');
    const saved = api.createDraft.mock.calls.at(-1)![0].content;
    expect([
      saved.targetCalories,
      saved.targetCarbohydrateGrams,
      saved.targetFatPercentage,
    ]).toEqual([1802.35, 217.94, 25]);

    // A fill now says whose weight its warnings use, and sends it.
    named(host, 'Fill in fat and carbs').click();
    const fillSheet = await dialogNamed(harness.fixture, 'Fill in fat and carbs');
    await settle(harness.fixture);
    expect(textOf(fillSheet.querySelector('[data-weight]'))).toBe(
      'The warnings use Maya Fakhoury’s weight, 62 kg.',
    );
    segment(fillSheet, 'Share of calories from fat', '30').click();
    named(fillSheet, 'Fill in fat and carbs').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(api.macroSplit).toHaveBeenLastCalledWith({
      calorieTarget: 1802,
      proteinGrams: 120,
      fatPercentage: 30,
      bodyweightKilograms: 62,
      isEnergyDeficit: true,
    });
    // Fat and carbs are no longer hers, so only the fill's sentence stays.
    expect(all(host, '[data-target-note] p').map(textOf)).toEqual([
      'Fat is 30% of the calories, 60 g, and carbs are the rest, 195 g.',
    ]);

    // Typed, the targets are the coach's own: what the boxes showed is what is kept, whole.
    fill(host, 'Protein (g)', '125');
    await settle(harness.fixture);
    await settle(harness.fixture);
    const [, typed] = api.saveDraft.mock.calls.at(-1)!;
    expect([
      typed.content.targetCalories,
      typed.content.targetProteinGrams,
      typed.content.targetCarbohydrateGrams,
      typed.content.targetFatGrams,
      typed.content.targetFatPercentage,
    ]).toEqual([1802, 125, 195, 60, null]);
    expect(host.querySelector('[data-target-note]')).toBeNull();
  });

  it('adds a recipe without dragging: + chooses it, and every place it can go offers Add here (B5b)', async () => {
    const { host, harness, api, toast } = await render();
    const library = host.querySelector('app-meal-plan-library')!;
    const plus = named(library, 'Add Lentil soup');
    expect(plus.getAttribute('aria-pressed')).toBe('false');
    expect(all(host, '.add-here')).toHaveLength(0);

    plus.click();
    await settle(harness.fixture);
    expect(plus.getAttribute('aria-pressed')).toBe('true');
    expect(plus.closest('.lib-item')!.classList).toContain('chosen');
    expect(textOf(host.querySelector('app-adding-bar .text'))).toBe(
      'Adding Lentil soup: press Add here where it goes.',
    );
    // Each meal takes it as another option, but Lunch offers it already; each day takes a new meal.
    expect(all(host, '.add-here').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Add here: Breakfast, day 1',
      'Add here: a new meal on day 1',
      'Add here: Breakfast, day 2',
      'Add here: a new meal on day 2',
    ]);
    const lunch = all(days(host)[0], '.meal-card')[1];
    expect(textOf(lunch.querySelector('.add-here-note'))).toBe('Already in this meal');
    expect(all(host, '.add-meal')).toHaveLength(0);

    named(host, 'Add here: Breakfast, day 2').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    const breakfast = all(days(host)[1], '.meal-card')[0];
    expect(all(breakfast, '.option-name').map(textOf)).toEqual(['Overnight oats', 'Lentil soup']);
    expect(textOf(breakfast.querySelector('.pick-one'))).toBe('Pick one of 2');
    expect(toast.show).toHaveBeenLastCalledWith(
      'Added as option 2 of Breakfast: the client picks one.',
    );
    // One add ends the choice.
    expect(plus.getAttribute('aria-pressed')).toBe('false');
    expect(all(host, '.add-here')).toHaveLength(0);
    expect(host.querySelector('app-adding-bar')).toBeNull();
    expect(all(host, '.add-meal')).toHaveLength(2);

    named(library, 'Add Chicken & rice').click();
    await settle(harness.fixture);
    named(host, 'Add here: a new meal on day 2').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(mealsOf(days(host)[1])).toEqual(['Breakfast', 'Lunch']);
    expect(toast.show).toHaveBeenLastCalledWith('Added as a new meal, Lunch, on day 2.');
    const saved = (api.saveDraft.mock.calls.at(-1) ?? api.createDraft.mock.calls.at(-1))!;
    const content = (saved.at(-1) as { content: { days?: { meals?: unknown[] }[] } }).content;
    expect(content.days?.[1].meals).toEqual([
      {
        name: 'Breakfast',
        choices: [
          { recipeVersionId: 'oats-v1', servings: 1.5 },
          { recipeVersionId: 'lentils-v1', servings: 1 },
        ],
      },
      { name: 'Lunch', choices: [{ recipeVersionId: 'chicken-v1', servings: 1 }] },
    ]);
  });

  it('lets a chosen recipe go on a second press, Escape or Cancel, and keeps Escape for an open sheet', async () => {
    const { host, harness, api } = await render();
    const library = host.querySelector('app-meal-plan-library')!;
    const plus = named(library, 'Add Overnight oats');
    const addingStatus = () => textOf(all(host, '[role="status"]').at(-1));

    plus.click();
    await settle(harness.fixture);
    expect(addingStatus()).toBe(
      'Overnight oats chosen. Press Add here on a meal to offer it as another option, or under a day for a new meal.',
    );
    plus.click();
    await settle(harness.fixture);
    expect(plus.getAttribute('aria-pressed')).toBe('false');
    expect(all(host, '.add-here')).toHaveLength(0);
    expect(addingStatus()).toBe('Overnight oats not added.');

    plus.click();
    await settle(harness.fixture);
    // An Escape something else took for itself (an open sheet or menu) leaves the choice alone.
    const taken = (event: Event) => event.preventDefault();
    document.body.addEventListener('keydown', taken);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    document.body.removeEventListener('keydown', taken);
    await settle(harness.fixture);
    expect(plus.getAttribute('aria-pressed')).toBe('true');
    // Escape from an Add here lets it go, and focus goes back to the recipe's +.
    const here = named(host, 'Add here: Lunch, day 1');
    here.focus();
    here.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await settle(harness.fixture);
    expect(all(host, '.add-here')).toHaveLength(0);
    expect(document.activeElement).toBe(plus);

    plus.click();
    await settle(harness.fixture);
    named(host.querySelector('app-adding-bar')!, 'Cancel').click();
    await settle(harness.fixture);
    expect(host.querySelector('app-adding-bar')).toBeNull();
    expect(document.activeElement).toBe(plus);
    expect(api.createDraft).not.toHaveBeenCalled();
  });

  it('opens How adding works on a first visit, folds it at the first add, and keeps it folded', async () => {
    const first = await render();
    const how = () =>
      first.host.querySelector<HTMLDetailsElement>('app-meal-plan-library .how details')!;
    expect(how().open).toBe(true);
    expect(textOf(how().querySelector('summary'))).toBe('How adding works');
    expect(textOf(how().querySelector('.tip p'))).toBe(
      'Drop a recipe on a meal for another option, or under a day for a new meal. Without dragging, press + on a recipe, then Add here.',
    );
    expect(textOf(first.host.querySelector('app-meal-plan-library .help'))).toBe(
      'Drag a recipe onto a meal, or press + to add it.',
    );

    named(first.host, 'Add Chicken & rice').click();
    await settle(first.harness.fixture);
    expect(how().open).toBe(true);
    named(first.host, 'Add here: a new meal on day 2').click();
    await settle(first.harness.fixture);
    expect(how().open).toBe(false);
    expect(localStorage.getItem('tb.adding-tip:meal-plan')).toBe('closed');
    // Opened again by the coach, a later add leaves it open.
    how().querySelector('summary')!.click();
    await settle(first.harness.fixture);
    expect(how().open).toBe(true);
    named(first.host, 'Add Lentil soup').click();
    await settle(first.harness.fixture);
    named(first.host, 'Add here: Breakfast, day 1').click();
    await settle(first.harness.fixture);
    expect(how().open).toBe(true);
    // Got it folds it, and focus stays on its row.
    named(how(), 'Got it').click();
    await settle(first.harness.fixture);
    expect(how().open).toBe(false);
    expect(document.activeElement).toBe(how().querySelector('summary'));

    TestBed.resetTestingModule();
    const again = await render();
    expect(
      again.host.querySelector<HTMLDetailsElement>('app-meal-plan-library .how details')!.open,
    ).toBe(false);
  });

  it('chooses in a sheet where the recipes have no room beside the grid, as on a phone', async () => {
    const { host, harness } = await render();

    named(host, 'Recipes').click();
    const sheet = await dialogNamed(harness.fixture, 'Recipes');
    expect(textOf(sheet.querySelector('.sheet-help'))).toBe(
      'Choose a recipe, then press Add here where it goes.',
    );
    named(sheet, 'Add Lentil soup').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(textOf(host.querySelector('app-adding-bar .text'))).toBe(
      'Adding Lentil soup: press Add here where it goes.',
    );
    named(host, 'Add here: a new meal on day 1').click();
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(mealsOf(days(host)[0])).toEqual(['Breakfast', 'Lunch', 'Dinner']);
  });

  it('shows a phone one day at a time, chosen from the day chips', async () => {
    const { host, harness } = await render();

    const chips = all(host, '.day-chip input') as HTMLInputElement[];
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual(['Day 1', 'Day 2']);
    expect(days(host).map((day) => day.classList.contains('phone-hidden'))).toEqual([false, true]);
    chips[1].click();
    await settle(harness.fixture);
    expect(days(host).map((day) => day.classList.contains('phone-hidden'))).toEqual([true, false]);
  });

  it('says when the plan is not here', async () => {
    const { host } = await render({
      getPlan: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });

    expect(textOf(host.querySelector('h2'))).toBe('This meal plan isn’t here');
  });
});
