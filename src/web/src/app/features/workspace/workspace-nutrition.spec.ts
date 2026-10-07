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
import { nutritionFormIssues, WorkspaceNutrition } from './workspace-nutrition';

async function render(settings: NutritionWorkspaceSettingsView = nutritionSettings()) {
  const api = {
    getSettings: vi.fn(() => of(settings)),
    updateSettings: vi.fn((request: { energyPolicyKey: string }) =>
      of({ ...settings, energyPolicyKey: request.energyPolicyKey, version: 8 }),
    ),
  };
  TestBed.configureTestingModule({
    imports: [WorkspaceNutrition],
    providers: [
      provideRouter([]),
      { provide: FoodApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
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

  it('says AI is not on yet when TB Gym has not allowed any', async () => {
    const { host } = await render(
      nutritionSettings({ aiMaximumMonthlyRequests: 0, aiMaximumMonthlyCost: 0 }),
    );
    expect(textOf(host.querySelector('#ai-heading')?.parentElement)).toContain(
      'TB Gym hasn’t turned on AI suggestions for workspaces yet.',
    );
    expect(host.querySelector('input[name="requests"]')).toBeNull();
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
