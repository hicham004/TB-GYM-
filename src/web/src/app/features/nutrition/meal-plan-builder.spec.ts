import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateMealPlanDraftRequest,
  MealPlanDraftSaveView,
  MealPlanDraftView,
  MealPlanTemplateDetail,
  MealPlanTemplateSummary,
  MealPlanVersionView,
  RecipeSummary,
  SaveMealPlanDraftRequest,
} from '../../core/api/generated';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { LIBRARY_SEARCH_PAUSE } from '../../ui/paged-search';
import { UiToast } from '../../ui/toast';
import { field, fill, settle } from '../../../testing/dom';
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
import { MealPlanApi } from './meal-plan-api';
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
  timing?: AutosaveTiming;
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
    // Lunch offers two recipes: the client eats one, so the day counts their average.
    const lunch = all(first, '.meal-card')[1];
    expect(all(lunch, '.option-row').map(textOf)).toEqual([
      'Chicken & rice 1 serving · 600 kcal',
      'or Lentil soup 2 servings · 600 kcal',
    ]);
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
    expect(alerts(host)).toEqual(['Day 1 has no meals yet. Add one, or delete the day.']);
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

  it('deletes a day from its menu, with Undo', async () => {
    const { host, harness, toast } = await render();

    named(days(host)[0], 'More for day 1').click();
    await settle(harness.fixture);
    const remove = all(days(host)[0], 'app-menu .item').find((item) =>
      textOf(item).startsWith('Delete day'),
    );
    remove!.click();
    await settle(harness.fixture);

    expect(days(host)).toHaveLength(1);
    expect(textOf(host.querySelector('#days-title'))).toBe('1 day · 1 meal');
    const undo = toast.show.mock.calls.at(-1) as unknown as [string, { action: { run(): void } }];
    expect(undo[0]).toBe('Day 1 deleted.');
    undo[1].action.run();
    await settle(harness.fixture);
    expect(days(host)).toHaveLength(2);
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
