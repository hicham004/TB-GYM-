import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { MediaAccessView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { OATS_CHOICE, planRecipeView } from '../../../testing/client-recipe-fixtures';
import { button, settle } from '../../../testing/dom';
import type { NutritionChoice } from './nutrition.models';
import { ClientRecipeSheet } from './client-recipe';

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const textsOf = (host: HTMLElement, selector: string) =>
  Array.from(host.querySelectorAll(selector)).map(textOf);

const ACCESS: MediaAccessView = {
  assetId: 'photo-1',
  kind: 'Image',
  source: 'Upload',
  contentType: 'image/jpeg',
  url: '/api/media/photo-1/content?grant=1',
  expiresAtUtc: '2026-10-08T10:05:00Z',
  downloadAllowed: false,
  thumbnailUrl: '/api/media/photo-1/content/thumbnail?grant=1',
};

async function render(api: Partial<ApiClient> = {}, choice: NutritionChoice = OATS_CHOICE) {
  const refresh = vi.fn(() => Promise.resolve());
  await TestBed.configureTestingModule({
    imports: [ClientRecipeSheet],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getMyPlanRecipe: vi.fn(() => of(planRecipeView())),
          createMediaAccess: vi.fn(() => of(ACCESS)),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ClientRecipeSheet);
  fixture.componentRef.setInput('recipeId', 'plan-recipe-1');
  fixture.componentRef.setInput('choice', choice);
  await settle(fixture);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient),
    refresh,
  };
}

describe('a recipe in the client’s plan, in its sheet (R4.4d)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('shows the photo, the times, the client’s portion, the ingredients and the method', async () => {
    const { host, api, refresh } = await render();

    expect(api.getMyPlanRecipe).toHaveBeenCalledWith('plan-recipe-1');
    expect(textsOf(host, '.facts li')).toEqual(['Prep 10 min', 'No cooking', 'Makes 2 servings']);
    expect(textOf(host.querySelector('.portion-line'))).toBe('Your plan: 1 serving · 432 kcal');
    // The client's own portion first: their 1 serving of a recipe that makes 2.
    expect(textOf(host.querySelector('.note'))).toBe(
      'For your 1 serving. The method is for the whole recipe.',
    );
    expect(textsOf(host, '.ingredients li')).toEqual([
      'Rolled oats 40 g',
      'Chicken breast 75 g raw',
      'Milk 125 ml',
      'Protein bar 0.5 servings',
    ]);
    expect(textsOf(host, '.steps li')).toEqual([
      'Stir the oats into the milk.',
      'Chill overnight.',
    ]);

    // The photo is a grant asked for with a fresh antiforgery token, never a public address.
    const image = host.querySelector<HTMLImageElement>('.photo img')!;
    expect(image.getAttribute('src')).toBe(ACCESS.url);
    expect(image.alt).toBe('Overnight oats, as your coach made it');
    expect(api.createMediaAccess).toHaveBeenCalledWith('photo-1');
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.createMediaAccess).mock.invocationCallOrder[0],
    );
  });

  it('switches to the whole recipe the method is written for, and back', async () => {
    const { fixture, host } = await render();
    const options = Array.from(
      host.querySelectorAll<HTMLInputElement>('app-segmented-control input'),
    );
    expect(textOf(host.querySelector('app-segmented-control legend'))).toBe('Amounts for');
    expect(options.map((option) => [textOf(option.nextElementSibling), option.checked])).toEqual([
      ['Your portion', true],
      ['Whole recipe', false],
    ]);

    options[1].click();
    await settle(fixture);
    expect(textOf(host.querySelector('.note'))).toBe('For the whole recipe, 2 servings.');
    expect(textsOf(host, '.ingredients li')).toEqual([
      'Rolled oats 80 g',
      'Chicken breast 150.5 g raw',
      'Milk 250 ml',
      'Protein bar 1 serving',
    ]);

    options[0].click();
    await settle(fixture);
    expect(textsOf(host, '.ingredients li')[0]).toBe('Rolled oats 40 g');
  });

  it('offers no switch when the client’s portion is the whole recipe', async () => {
    const { host } = await render({}, { ...OATS_CHOICE, servings: 2 });

    expect(host.querySelector('app-segmented-control')).toBeNull();
    expect(textOf(host.querySelector('.note'))).toBe('For the whole recipe, 2 servings.');
    expect(textsOf(host, '.ingredients li')[0]).toBe('Rolled oats 80 g');
  });

  it('prints through the browser, leaving its own controls off the paper', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { host } = await render();

    button(host, 'Print recipe').click();
    expect(print).toHaveBeenCalledOnce();
    expect(host.querySelector('.print')?.classList).toContain('tb-print-hide');
    expect(host.querySelector('app-segmented-control')?.classList).toContain('tb-print-hide');
  });

  it('reads as a recipe without its photo when the grant fails, and asks for none without one', async () => {
    const failed = await render({
      createMediaAccess: vi.fn(() => throwError(() => new Error('403'))),
    });
    expect(failed.host.querySelector('.photo img')).toBeNull();
    expect(textsOf(failed.host, '.ingredients li')).toHaveLength(4);
    TestBed.resetTestingModule();

    const plain = await render({
      getMyPlanRecipe: vi.fn(() =>
        of(planRecipeView({ photoMediaAssetId: null, instructions: 'Stir and chill.' })),
      ),
    });
    expect(plain.host.querySelector('.photo')).toBeNull();
    expect(plain.api.createMediaAccess).not.toHaveBeenCalled();
    expect(textOf(plain.host.querySelector('.step'))).toBe('Stir and chill.');
    expect(plain.host.querySelector('.steps')).toBeNull();
  });

  it('says when the recipe could not be loaded and tries again', async () => {
    const getMyPlanRecipe = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValue(of(planRecipeView()));
    const { fixture, host } = await render({ getMyPlanRecipe });

    expect(textOf(host.querySelector('[role="alert"] p'))).toBe('This recipe could not be loaded.');
    button(host, 'Try again').click();
    await settle(fixture);
    await settle(fixture);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(textsOf(host, '.facts li')).toHaveLength(3);
    expect(getMyPlanRecipe).toHaveBeenCalledTimes(2);
  });
});
