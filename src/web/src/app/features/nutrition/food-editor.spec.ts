import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FoodItemView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { button, fill, settle } from '../../../testing/dom';
import { CHICKEN_FOOD, OATS_FOOD } from '../../../testing/food-fixtures';
import { FoodApi } from './food-api';
import { FoodEditor } from './food-editor';
import type { FoodSheetMode } from './food.models';

async function render(
  mode: FoodSheetMode,
  food: FoodItemView | null = null,
  policyKey = 'Atwater',
) {
  const api = {
    createFood: vi.fn(() => of(OATS_FOOD)),
    addVersion: vi.fn(() => of(OATS_FOOD)),
  };
  TestBed.configureTestingModule({
    imports: [FoodEditor],
    providers: [
      { provide: FoodApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
    ],
  });
  const fixture = TestBed.createComponent(FoodEditor);
  fixture.componentRef.setInput('mode', mode);
  fixture.componentRef.setInput('food', food);
  fixture.componentRef.setInput('policyKey', policyKey);
  const saved = vi.fn();
  fixture.componentInstance.saved.subscribe(saved);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, saved };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the food sheet', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('names every box still to fill on Save, and takes the coach to the first', async () => {
    const { fixture, host, api } = await render('new');
    button(host, 'Save food').click();
    await settle(fixture);

    expect(textOf(host.querySelector('.summary'))).toBe('Check the boxes marked below.');
    expect(
      Array.from(host.querySelectorAll('.tb-field__support--error')).map((node) => textOf(node)),
    ).toEqual([
      'Give the food a name.',
      'Enter the protein, or 0.',
      'Enter the carbs, or 0.',
      'Enter the fat, or 0.',
    ]);
    expect(document.activeElement?.getAttribute('name')).toBe('name');
    expect(api.createFood).not.toHaveBeenCalled();
  });

  it('says whether anything typed is not saved, so closing can ask first', async () => {
    const { fixture, host } = await render('copy', CHICKEN_FOOD);
    const dirty: boolean[] = [];
    fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));

    // The copy opens with USDA's numbers, which count as nothing typed.
    fill(host, 'Protein', '23');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);
    fill(host, 'Protein', '22.5');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(false);
  });

  it('adds up the calories under the EU policy as the macros are typed', async () => {
    const { fixture, host } = await render('new', null, 'Eu1169');
    fill(host, 'Protein', '10');
    fill(host, 'Carbs', '16');
    fill(host, 'Fat', '5');
    await settle(fixture);
    fill(host, 'Fibre (g)', '4');
    await settle(fixture);

    // Typed as an EU label prints them, the 16 g of carbs leave the fibre out: 10 × 4 + 16 × 4 + 5 × 9 + 4 × 2.
    expect(textOf(host.querySelector('.estimate'))).toBe(
      'About 157 kcal in 100 g, counted as on EU-style labels.',
    );
  });

  it('takes an EU label’s carbs as printed and sends the fibre back with them (C6)', async () => {
    const { fixture, host, api } = await render('new', null, 'Eu1169');
    // EU labels print the fibre on a line of its own, so its box is open from the start.
    expect(host.querySelector<HTMLDetailsElement>('details')!.open).toBe(true);
    expect(textOf(host.querySelector('input[name="carbs"]')?.closest('app-field'))).toContain(
      'As the label prints them, without the fibre',
    );

    // Porridge oats on a UK label: 11 g protein, 60 g carbs, 8 g fat, 9 g fibre, 374 kcal.
    fill(host, 'Name', 'Porridge oats');
    fill(host, 'Protein', '11');
    fill(host, 'Carbs', '60');
    fill(host, 'Fat', '8');
    fill(host, 'Fibre (g)', '9');
    fill(host, 'Calories on the label', '374');
    await settle(fixture);
    expect(textOf(host.querySelector('.estimate'))).toBe(
      'About 374 kcal in 100 g, counted as on EU-style labels.',
    );
    expect(textOf(host.querySelector('[data-stored-carbs]'))).toBe(
      'Saved as 69 g of carbs with the fibre, the way TB Gym counts carbs everywhere.',
    );

    button(host, 'Save food').click();
    await settle(fixture);
    expect(api.createFood).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          carbohydrateGrams: 60,
          fibreGrams: 9,
          providerCalories: 374,
          carbohydrateDeclaration: 'WithoutFibre',
        }),
      }),
    );
  });

  it('opens a saved food under the EU policy with its carbs as an EU label prints them', async () => {
    const { fixture, host, api } = await render('edit', OATS_FOOD, 'Eu1169');
    // The oats keep 68 g of carbs, their 10 g of fibre included.
    expect(host.querySelector<HTMLInputElement>('input[name="carbs"]')!.value).toBe('58');

    button(host, 'Save changes').click();
    await settle(fixture);
    expect(api.addVersion).toHaveBeenCalledWith(
      'food-oats',
      expect.objectContaining({
        carbohydrateGrams: 58,
        fibreGrams: 10,
        carbohydrateDeclaration: 'WithoutFibre',
      }),
    );
  });

  it('keeps total carbs under the US policy and says so', async () => {
    const { fixture, host, api } = await render('edit', OATS_FOOD);
    expect(host.querySelector<HTMLInputElement>('input[name="carbs"]')!.value).toBe('68');
    expect(textOf(host.querySelector('input[name="carbs"]')?.closest('app-field'))).toContain(
      'Total, fibre included',
    );
    expect(host.querySelector('[data-stored-carbs]')).toBeNull();

    button(host, 'Save changes').click();
    await settle(fixture);
    expect(api.addVersion).toHaveBeenCalledWith(
      'food-oats',
      expect.objectContaining({ carbohydrateGrams: 68, carbohydrateDeclaration: 'TotalWithFibre' }),
    );
  });

  it('opens the extra nutrients when fibre is the problem', async () => {
    const { fixture, host } = await render('new');
    fill(host, 'Name', 'Oat bran');
    fill(host, 'Protein', '17');
    fill(host, 'Carbs', '10');
    fill(host, 'Fat', '7');
    host.querySelector<HTMLElement>('summary')!.click();
    await settle(fixture);
    fill(host, 'Fibre (g)', '15');
    host.querySelector<HTMLElement>('summary')!.click();
    await settle(fixture);
    expect(host.querySelector<HTMLDetailsElement>('details')!.open).toBe(false);

    button(host, 'Save food').click();
    await settle(fixture);
    expect(host.querySelector<HTMLDetailsElement>('details')!.open).toBe(true);
    expect(textOf(host.querySelector('details .tb-field__support--error'))).toBe(
      'Fibre and sugar alcohols are part of the carbs, so together they can’t be more than the carbs.',
    );
  });

  it('saves an edit as the next version from the revision it opened, renamed', async () => {
    const { fixture, host, api, saved } = await render('edit', OATS_FOOD);
    expect(host.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('Rolled oats');
    expect(textOf(host.querySelector('.footer .hint'))).toBe(
      'Recipes that already use this food keep the numbers they were saved with.',
    );
    fill(host, 'Name', 'Jumbo oats');
    fill(host, 'Protein', '14');
    await settle(fixture);
    button(host, 'Save changes').click();
    await settle(fixture);

    expect(api.addVersion).toHaveBeenCalledWith(
      'food-oats',
      expect.objectContaining({
        name: 'Jumbo oats',
        proteinGrams: 14,
        baseRevision: 1,
        fibreGrams: 10,
      }),
    );
    expect(saved).toHaveBeenCalledWith(OATS_FOOD);
  });

  it('says when someone else changed the food since the sheet opened', async () => {
    const { fixture, host, api } = await render('edit', OATS_FOOD);
    api.addVersion.mockReturnValueOnce(
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { code: 'food_changed' } }),
      ) as never,
    );
    button(host, 'Save changes').click();
    await settle(fixture);

    expect(textOf(host.querySelector('.summary'))).toBe(
      'Someone changed this food after you opened it. Close this sheet and open the food again to see their change.',
    );
  });

  it('copies a USDA food as the coach’s own, naming what USDA left out', async () => {
    const { fixture, host, api } = await render('copy', CHICKEN_FOOD);
    expect(host.querySelector<HTMLDetailsElement>('details')!.open).toBe(false);
    expect(textOf(host.querySelector('details .note'))).toBe(
      'USDA didn’t report fibre, sugar alcohols or alcohol, so they were saved as 0. Check the label if you have it.',
    );
    button(host, 'Save my copy').click();
    await settle(fixture);

    expect(api.createFood).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chicken, breast, boneless, skinless, raw',
        provenance: 'CoachAuthored',
        externalId: null,
        version: expect.objectContaining({ preparationBasis: 'Raw', proteinGrams: 22.5 }),
      }),
    );
  });
});
