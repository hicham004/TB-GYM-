import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MacroSplitView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { field, fill, segment, settle } from '../../../testing/dom';
import type { FilledSplit } from './daily-target.models';
import { MealPlanApi, type MacroSplitRequest } from './meal-plan-api';
import { type FillStart, MealPlanFillTargets } from './meal-plan-fill-targets';

const SPLIT: MacroSplitView = {
  calorieTarget: 2000,
  proteinGrams: 150,
  fatPercentage: 30,
  fatGrams: '66.666666666666666666666666667',
  carbohydrateGrams: 200,
  methodKey: 'Nut008MacroSplit',
  methodVersion: '1.0',
  warnings: [],
};

async function render(
  start: Partial<FillStart> = {},
  answer: () => Observable<MacroSplitView> = () => of(SPLIT),
) {
  const api = {
    macroSplit: vi.fn<(request: MacroSplitRequest) => Observable<MacroSplitView>>(answer),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: MealPlanApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(MealPlanFillTargets);
  fixture.componentRef.setInput('start', {
    calories: 2000,
    protein: 150,
    share: null,
    client: null,
    ...start,
  });
  const filled: FilledSplit[] = [];
  const cancelled = vi.fn();
  fixture.componentInstance.filled.subscribe((split) => filled.push(split));
  fixture.componentInstance.cancelled.subscribe(cancelled);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, filled, cancelled };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const submit = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button[type="submit"]')!;

describe('Fill in fat and carbs (critique B5c2)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts from the card’s calories and protein, and fat at a quarter of the calories', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('.muted'))).toBe(
      'Fat takes the share of the calories you pick, and carbs what protein and fat leave.',
    );
    expect(field(host, 'Calories (kcal)').value).toBe('2000');
    expect(field(host, 'Protein (g)').value).toBe('150');
    expect(field(host, 'Fat (percent of calories)').value).toBe('25');
    expect(segment(host, 'Share of calories from fat', '25').checked).toBe(true);
    expect(textOf(submit(host))).toBe('Fill in fat and carbs');
    expect(host.querySelector('[data-weight]')).toBeNull();
  });

  it('asks the server, with a pick, and hands its split back', async () => {
    const { host, fixture, api, filled } = await render({ share: 20 });
    expect(field(host, 'Fat (percent of calories)').value).toBe('20');

    segment(host, 'Share of calories from fat', '30').click();
    await settle(fixture);
    expect(field(host, 'Fat (percent of calories)').value).toBe('30');
    submit(host).click();
    await settle(fixture);

    expect(api.macroSplit).toHaveBeenCalledWith({
      calorieTarget: 2000,
      proteinGrams: 150,
      fatPercentage: 30,
      bodyweightKilograms: null,
      isEnergyDeficit: false,
    });
    expect(filled).toEqual([
      { calories: 2000, protein: 150, carbs: 200, fat: 66.66666666666667, share: 30, warnings: [] },
    ]);
  });

  it('sends a typed share and the client’s weight, which it says the warnings use', async () => {
    const { host, fixture, api } = await render({
      client: { name: 'Maya Fakhoury', weight: 62.5, isEnergyDeficit: true },
    });
    expect(textOf(host.querySelector('[data-weight]'))).toBe(
      'The warnings use Maya Fakhoury’s weight, 62.5 kg.',
    );

    fill(host, 'Calories (kcal)', '1800');
    fill(host, 'Fat (percent of calories)', '15');
    await settle(fixture);
    expect(host.querySelector('app-segmented-control input:checked')).toBeNull();
    submit(host).click();
    await settle(fixture);

    expect(api.macroSplit).toHaveBeenCalledWith({
      calorieTarget: 1800,
      proteinGrams: 150,
      fatPercentage: 15,
      bodyweightKilograms: 62.5,
      isEnergyDeficit: true,
    });
  });

  it('asks for what is missing before sending anything', async () => {
    const { host, fixture, api, filled } = await render({ calories: null });

    submit(host).click();
    await settle(fixture);

    expect(api.macroSplit).not.toHaveBeenCalled();
    expect(filled).toEqual([]);
    expect(textOf(host.querySelector('app-form-summary'))).toBe('Check the fields marked above.');
    expect(field(host, 'Calories (kcal)').getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the server’s refusal on screen in its words, with what was typed', async () => {
    const refusal = new HttpErrorResponse({
      status: 400,
      error: {
        errors: {
          fatPercentage: [
            'Protein and fat come to more than 2,000 calories, so nothing is left for carbs. Lower the protein or the fat, or raise the calories.',
          ],
        },
      },
    });
    const { host, fixture, filled } = await render({ protein: 450 }, () =>
      throwError(() => refusal),
    );

    submit(host).click();
    await settle(fixture);

    expect(filled).toEqual([]);
    expect(textOf(host.querySelector('app-form-summary'))).toBe(
      'Protein and fat come to more than 2,000 calories, so nothing is left for carbs. Lower the protein or the fat, or raise the calories.',
    );
    expect(field(host, 'Protein (g)').value).toBe('450');
  });

  it('closes on Cancel without asking the server', async () => {
    const { host, fixture, api, cancelled } = await render();

    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => textOf(button) === 'Cancel')!
      .click();
    await settle(fixture);

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(api.macroSplit).not.toHaveBeenCalled();
  });
});
