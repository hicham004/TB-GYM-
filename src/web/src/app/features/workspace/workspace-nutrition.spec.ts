import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NutritionWorkspaceSettingsView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, fill, leave, settle } from '../../../testing/dom';
import { nutritionSettings } from '../../../testing/food-fixtures';
import { FoodApi } from '../nutrition/food-api';
import { RecipeApi } from '../nutrition/recipe-api';
import { nutritionFormIssues, WorkspaceNutrition } from './workspace-nutrition';

async function render(
  settings: NutritionWorkspaceSettingsView = nutritionSettings(),
  available: boolean | 'fails' = true,
) {
  const api = {
    getSettings: vi.fn(() => of(settings)),
    updateSettings: vi.fn((request: { energyPolicyKey: string }) =>
      of({ ...settings, energyPolicyKey: request.energyPolicyKey, version: 8 }),
    ),
  };
  // The same answer the recipe editor reads (LOST-4).
  const recipes = {
    aiAvailability: vi.fn(() =>
      available === 'fails'
        ? throwError(() => new HttpErrorResponse({ status: 503 }))
        : of({ isConfigured: available }),
    ),
  };
  TestBed.configureTestingModule({
    imports: [WorkspaceNutrition],
    providers: [
      provideRouter([]),
      { provide: FoodApi, useValue: api },
      { provide: RecipeApi, useValue: recipes },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantId: 'tenant-1', role: 'Owner' }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(WorkspaceNutrition);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the nutrition form’s checks', () => {
  const ceiling = { requests: 100, cost: 3 };
  const none = { requests: 0, cost: 0 };
  const form = { policy: 'Atwater', tolerance: 25, requests: 50, cost: 2 };

  it('accepts an allowance within TB Gym’s ceiling', () => {
    expect(nutritionFormIssues(form, ceiling, none, 'en-US')).toEqual({
      tolerance: [],
      requests: [],
      cost: [],
    });
  });

  it('refuses raising an allowance above the ceiling, but keeps one saved before it was lowered', () => {
    const above = { ...form, requests: 101, cost: 3.5 };
    expect(nutritionFormIssues(above, ceiling, none, 'en-US')).toEqual({
      tolerance: [],
      requests: ['TB Gym allows up to 100 a month.'],
      cost: ['TB Gym allows up to USD 3.00 a month.'],
    });
    expect(
      nutritionFormIssues(above, ceiling, { requests: 101, cost: 3.5 }, 'en-US').requests,
    ).toEqual([]);
  });

  it('refuses a tolerance out of range and a part suggestion', () => {
    const issues = nutritionFormIssues(
      { ...form, tolerance: 600, requests: 1.5 },
      ceiling,
      none,
      'en-US',
    );
    expect(issues.tolerance).toEqual(['Enter a number from 0 to 500 kcal.']);
    expect(issues.requests).toEqual(['Enter a whole number, or 0 to turn suggestions off.']);
  });
});

describe('Settings › Nutrition', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows how calories are counted, the label check and TB Gym’s AI ceiling', async () => {
    const { host } = await render();

    expect(host.querySelector<HTMLInputElement>('input[value="Atwater"]')!.checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[name="tolerance"]')!.value).toBe('25');
    expect(textOf(host.querySelector('#ai-heading')?.parentElement)).toContain(
      'TB Gym allows up to 100 a month. 0 turns suggestions off.',
    );
    expect(textOf(host.querySelector('#ai-heading')?.parentElement)).toContain(
      'TB Gym allows up to USD 3.00.',
    );
  });

  it('names each way of counting after the labels it matches, and says how to choose', async () => {
    const { host } = await render();

    const choices = Array.from(host.querySelectorAll('.choice'));
    expect(choices.map((choice) => textOf(choice.querySelector('.choice-title')))).toEqual([
      'US-style labels',
      'EU-style labels',
    ]);
    expect(textOf(choices[0].querySelector('.choice-text'))).toBe(
      'Carbs include fibre; protein and carbs count 4 kcal a gram, fat 9, alcohol 7. The usual way in the US and in most apps.',
    );
    expect(textOf(choices[1].querySelector('.choice-text'))).toBe(
      'Fibre is listed apart from the carbs and counts 2 kcal a gram; sugar alcohols 2.4, alcohol 7. Carbs are typed as the label prints them. Used in the EU and the UK.',
    );
    const help = host.querySelector('#counting-help');
    expect(textOf(help)).toBe(
      'Choose the kind of food labels your clients read, so the app’s calories match the packet.',
    );
    expect(host.querySelector('fieldset.choices')?.getAttribute('aria-describedby')).toBe(
      'counting-help',
    );
    expect(textOf(host.querySelector('#counting-heading')?.parentElement)).toContain(
      'Most foods come out the same either way; high-fibre foods and sugar-free sweets differ.',
    );
  });

  it('says AI is not on yet when TB Gym has not allowed any', async () => {
    const { host } = await render(
      nutritionSettings({ aiMaximumMonthlyRequests: 0, aiMaximumMonthlyCost: 0 }),
      false,
    );
    expect(textOf(host.querySelector('#ai-heading')?.parentElement)).toContain(
      'TB Gym hasn’t turned on AI suggestions for coaching spaces yet.',
    );
    expect(host.querySelector('input[name="requests"]')).toBeNull();
  });

  it('says AI is not on when the recipe editor would say so, whatever the ceiling (LOST-4)', async () => {
    // A ceiling above zero with no provider set up: the recipe editor offers no suggestion, so
    // Settings does not promise one either.
    for (const answer of [false, 'fails'] as const) {
      const { host } = await render(nutritionSettings(), answer);
      expect(textOf(host.querySelector('#ai-heading')?.parentElement)).toContain(
        'TB Gym hasn’t turned on AI suggestions for coaching spaces yet.',
      );
      expect(textOf(host.querySelector('#ai-heading')?.parentElement)).not.toContain(
        'Your coaches can start a recipe from a description.',
      );
      TestBed.resetTestingModule();
    }

    const { host } = await render(nutritionSettings(), true);
    expect(textOf(host.querySelector('#ai-heading')?.parentElement)).toContain(
      'Your coaches can start a recipe from a description.',
    );
  });

  it('saves the defaults with the version it read', async () => {
    const { fixture, host, api } = await render();
    host.querySelector<HTMLInputElement>('input[value="Eu1169"]')!.click();
    fill(host, 'Suggestions a month', '80');
    await settle(fixture);
    button(host, 'Save settings').click();
    await settle(fixture);

    expect(api.updateSettings).toHaveBeenCalledWith({
      energyPolicyKey: 'Eu1169',
      providerCalorieTolerance: 25,
      aiMonthlyRequestLimit: 80,
      aiMonthlyCostLimit: 2,
      aiCostCurrency: 'USD',
      version: 7,
    });
  });

  it('refuses an allowance above the ceiling beside its box, without asking the server', async () => {
    const { fixture, host, api } = await render();
    fill(host, 'Suggestions a month', '150');
    leave(host, 'Suggestions a month');
    await settle(fixture);
    expect(textOf(host.querySelector('.tb-field__support--error'))).toBe(
      'TB Gym allows up to 100 a month.',
    );
    button(host, 'Save settings').click();
    await settle(fixture);
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it('offers their settings when someone saved first', async () => {
    const { fixture, host, api } = await render();
    api.updateSettings.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409 })) as never,
    );
    button(host, 'Save settings').click();
    await settle(fixture);
    expect(textOf(host.querySelector('.error'))).toContain(
      'Someone saved these settings after you opened them.',
    );
    button(host, 'Show their settings').click();
    await settle(fixture);
    expect(api.getSettings).toHaveBeenCalledTimes(2);
  });
});
