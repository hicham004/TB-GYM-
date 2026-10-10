import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allergens,
  calculationRecord,
  calculationView,
  clientPlan,
  earlierRecord,
  profile,
  publishedPlans,
  TODAY,
  workspace,
} from '../../../testing/client-nutrition-fixtures';
import { enrollment, plansOverview } from '../../../testing/client-service-fixtures';
import { press, settle, tick } from '../../../testing/dom';
import { mayaWeighIns, progressView } from '../../../testing/progress-fixtures';
import type { ClientCommercialOverview, CoachClientDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { ClientWorkspaceContext } from '../clients/client-workspace.context';
import { ProgressEntriesApi } from '../progress/progress-entries-api';
import { ClientNutrition } from './client-nutrition';
import { ClientNutritionApi } from './client-nutrition-api';
import { MealPlanApi } from './meal-plan-api';

type Api = Partial<Record<keyof ClientNutritionApi, ReturnType<typeof vi.fn>>>;

/** Online Coaching with Nutrition from Tue 21 Jul to Wed 28 Oct, as the workspace reads it. */
const NUTRITION_PLAN = () =>
  plansOverview([enrollment({ endDateExclusive: '2026-10-29', lastActiveDate: '2026-10-28' })]);

interface Options {
  api?: Api;
  profile?: CoachClientDetails | null;
  plans?: ClientCommercialOverview | null;
  weighIns?: ReturnType<typeof vi.fn>;
  tenant?: ReturnType<typeof signal<string>>;
}

async function render(options: Options = {}) {
  const api: Api = {
    allergens: vi.fn(() => of(allergens('Peanuts', 'Milk'))),
    calculations: vi.fn(() => of([calculationRecord(), earlierRecord()])),
    plans: vi.fn(() => of([clientPlan()])),
    calculate: vi.fn(() => of(calculationView({ id: 'calc-3' }))),
    assign: vi.fn(() => of(clientPlan({ id: 'cplan-2', startDate: TODAY }))),
    replaceAllergens: vi.fn(() => of(undefined)),
    ...options.api,
  };
  const progress = {
    weighIns: options.weighIns ?? vi.fn(() => of(progressView(mayaWeighIns()))),
  };
  const mealPlans = {
    listPlans: vi.fn(() => of({ total: 3, skip: 0, take: 100, items: publishedPlans() })),
  };
  const context = {
    clientId: signal('client-1'),
    profile: signal<CoachClientDetails | null>(
      options.profile === undefined ? profile() : options.profile,
    ),
    plans: signal<ClientCommercialOverview | null>(
      options.plans === undefined ? NUTRITION_PLAN() : options.plans,
    ),
    workspace: signal(workspace()),
    isFormer: signal(false),
  };
  const tenant = options.tenant ?? signal('tenant-1');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ClientWorkspaceContext, useValue: context },
      { provide: ClientNutritionApi, useValue: api },
      { provide: ProgressEntriesApi, useValue: progress },
      { provide: MealPlanApi, useValue: mealPlans },
      { provide: WorkspaceCalendar, useValue: { resolveToday: () => Promise.resolve(TODAY) } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  });
  const fixture = TestBed.createComponent(ClientNutrition);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, progress, context, tenant };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const card = (host: ParentNode, name: string) => host.querySelector(`[data-card="${name}"]`)!;
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};
const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

describe('A client’s Nutrition tab', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T09:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body
      .querySelectorAll('.cdk-overlay-container')
      .forEach((node) => node.replaceChildren());
    TestBed.resetTestingModule();
  });

  describe('what it shows', () => {
    it('shows the latest targets with their macros and how they were worked out', async () => {
      const { host } = await render();

      const targets = card(host, 'targets');
      expect(textOf(targets.querySelector('.calories'))).toBe('2,155 calories a day');
      expect(textOf(targets.querySelector('[data-worked-on]'))).toBe('Worked out Fri 9 Oct');
      expect(
        Array.from(targets.querySelectorAll('.macro')).map((item) => [
          textOf(item.querySelector('dt')),
          textOf(item.querySelector('.grams')),
          textOf(item.querySelector('.share')),
        ]),
      ).toEqual([
        ['Protein', '140 g', '26%'],
        ['Carbs', '264 g', '49%'],
        ['Fat', '60 g', '25%'],
      ]);
      expect(textOf(targets.querySelector('.chain'))).toContain('1,444');
      expect(textOf(targets.querySelector('.from'))).toBe(
        'Worked out from 70 kg, 168 cm, 30 years, female, seated work, 8,000 steps a day.',
      );
      expect(textOf(targets.querySelector('[data-work-out]'))).toBe('Work out again');
      expect(textOf(targets.querySelector('[data-earlier-targets] summary'))).toBe(
        'Earlier targets (1)',
      );
    });

    it('shows the meal plan they are on, with its dates and the targets they see', async () => {
      const { host } = await render();

      const plan = host.querySelector('[data-current-plan]')!;
      expect(textOf(plan.querySelector('.plan-name'))).toBe('Spring cut');
      expect(textOf(plan.querySelector('.meta'))).toBe('Mon 5 Oct – Sun 18 Oct · 14 days');
      expect(textOf(plan.querySelector('app-status-pill'))).toBe('Day 6 of 14');
      expect(textOf(plan.querySelector('.numbers'))).toBe(
        '2,155 calories · 140 g protein · 264 g carbs · 60 g fat',
      );
      expect(textOf(card(host, 'plan').querySelector('[data-assign]'))).toBe('Assign a meal plan');
    });

    it('lists the allergens declared, in the order the screen names them, and what they wrote', async () => {
      const { host } = await render();

      expect(
        Array.from(host.querySelectorAll('[data-declared] .chip')).map((item) => textOf(item)),
      ).toEqual(['Peanuts', 'Milk']);
      const told = card(host, 'told');
      expect(textOf(told.querySelector('h2'))).toBe('What Rana told you');
      expect(
        Array.from(told.querySelectorAll('.told > div')).map((item) => [
          textOf(item.querySelector('dt')),
          textOf(item.querySelector('dd')),
        ]),
      ).toEqual([
        ['Allergies', 'Peanuts'],
        ['Likes', 'Rice, chicken, labneh'],
        ['Dislikes', 'Okra'],
        ['Their goal', 'Run a 10k in under an hour by June.'],
      ]);
      expect(told.querySelector('a')!.getAttribute('href')).toBe('/clients/client-1/intake');
    });

    it('invites the first calculation, and says there is no plan or allergen yet', async () => {
      const { host } = await render({
        api: {
          allergens: vi.fn(() => of(allergens())),
          calculations: vi.fn(() => of([])),
          plans: vi.fn(() => of([])),
        },
      });

      expect(textOf(host.querySelector('[data-no-targets]'))).toBe(
        'No targets have been worked out for Rana yet. Work out their calories and macros from their weight, height, age and how active they are.',
      );
      expect(textOf(card(host, 'targets').querySelector('[data-work-out]'))).toBe(
        'Work out targets',
      );
      expect(textOf(host.querySelector('[data-no-plan]'))).toBe(
        'Rana has no meal plan running or coming.',
      );
      expect(textOf(host.querySelector('[data-none-declared]'))).toBe('None declared for Rana.');
    });

    it('keeps a plan that ended or was stopped in a closed list, never hidden', async () => {
      const { host } = await render({
        api: {
          plans: vi.fn(() =>
            of([
              clientPlan({ id: 'a' }),
              clientPlan({
                id: 'b',
                mealPlanName: 'Lean bulk',
                startDate: '2026-09-01',
                endDateExclusive: '2026-09-15',
              }),
              clientPlan({
                id: 'c',
                mealPlanName: 'Maintenance',
                startDate: '2026-09-16',
                endDateExclusive: '2026-10-01',
                status: 'Cancelled',
              }),
            ]),
          ),
        },
      });

      const others = host.querySelector('[data-earlier-plans]')!;
      expect(textOf(others.querySelector('summary'))).toBe('Other meal plans (2)');
      expect(Array.from(others.querySelectorAll('li')).map((item) => textOf(item))).toEqual([
        'Maintenance Wed 16 Sep – Wed 30 Sep Stopped 2,155 calories',
        'Lean bulk Tue 1 Sep – Mon 14 Sep Ended 2,155 calories',
      ]);
    });
  });

  describe('when it cannot be shown', () => {
    it('says the plan has no Nutrition, without asking the server', async () => {
      const { host, api } = await render({
        plans: plansOverview([enrollment({ features: ['Training'] })], {
          featureAccess: [
            {
              feature: 'Nutrition',
              isAllowed: false,
              reason: 'NoEntitlement',
              enrollmentId: null,
              accessibleFrom: null,
              accessibleUntilExclusive: null,
            },
          ],
        }),
      });

      expect(textOf(host.querySelector('[data-closed]'))).toBe(
        'Nutrition isn’t part of Rana’s plan.',
      );
      expect(api['allergens']).not.toHaveBeenCalled();
      expect(host.querySelector('[data-card]')).toBeNull();
    });

    it('says why when the server closes it, rather than that it could not be loaded', async () => {
      const refused = new HttpErrorResponse({ status: 403, error: { accessReason: 'Paused' } });
      const { host } = await render({
        plans: null,
        api: { allergens: vi.fn(() => throwError(() => refused)) },
      });

      expect(textOf(host.querySelector('[data-closed]'))).toBe(
        'Rana’s plan is paused, so their nutrition isn’t shown.',
      );
    });

    it('offers to try again when a read fails, and shows it once it works', async () => {
      const allergensRead = vi
        .fn()
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
        .mockReturnValue(of(allergens('Eggs')));
      const { fixture, host } = await render({ api: { allergens: allergensRead } });

      expect(textOf(host.querySelector('[data-error]'))).toContain(
        'Their nutrition could not be loaded.',
      );
      press(host, 'Try again');
      await settle(fixture);
      expect(host.querySelector('[data-error]')).toBeNull();
      expect(textOf(host.querySelector('[data-declared]'))).toBe('Eggs');
    });

    it('waits for the client’s record before reading anything', async () => {
      const { api } = await render({ profile: null });
      expect(api['allergens']).not.toHaveBeenCalled();
    });

    it('offers no Assign button when no plan of theirs has Nutrition to sit under', async () => {
      const { host } = await render({
        plans: plansOverview([enrollment({ features: ['Training'], storedStatus: 'Active' })]),
        api: { plans: vi.fn(() => of([])) },
      });

      expect(host.querySelector('[data-assign]')).toBeNull();
      expect(textOf(host.querySelector('[data-no-plan]'))).toBe(
        'Rana has no meal plan running or coming. Their plan has no Nutrition to assign one under.',
      );
    });
  });

  describe('working targets out', () => {
    it('reads the latest weigh-in first, then opens the sheet starting from what is known', async () => {
      const { fixture, host, progress } = await render();

      press(card(host, 'targets'), 'Work out again');
      await settle(fixture);
      await settle(fixture);

      expect(progress.weighIns).toHaveBeenCalledWith('client-1', 'Kilogram', '2026-07-19', null);
      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('.tb-modal__title'))).toContain(
        'Work out targets for Rana',
      );
      expect(sheet.querySelector<HTMLInputElement>('input[name="weight"]')!.value).toBe('80.2');
      expect(sheet.querySelector<HTMLInputElement>('input[name="height"]')!.value).toBe('168');
      expect(sheet.querySelector<HTMLInputElement>('input[name="age"]')!.value).toBe('30');
      expect(sheet.querySelector<HTMLInputElement>('input[name="steps"]')!.value).toBe('8000');
    });

    it('opens anyway, with the weight left to type, when the weigh-ins cannot be read', async () => {
      const { fixture, host } = await render({
        weighIns: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
      });

      press(card(host, 'targets'), 'Work out again');
      await settle(fixture);
      await settle(fixture);

      const sheet = dialog()!;
      expect(sheet.querySelector<HTMLInputElement>('input[name="weight"]')!.value).toBe('');
      expect(sheet.querySelector<HTMLInputElement>('input[name="height"]')!.value).toBe('168');
    });

    it('reads the list again once targets are worked out, and shows the new ones', async () => {
      const calculations = vi
        .fn()
        .mockReturnValueOnce(of([calculationRecord(), earlierRecord()]))
        .mockReturnValue(
          of([
            calculationRecord({ result: calculationView({ id: 'calc-3', calorieTarget: 2300 }) }),
            calculationRecord(),
            earlierRecord(),
          ]),
        );
      const { fixture, host, api } = await render({ api: { calculations } });

      press(card(host, 'targets'), 'Work out again');
      await settle(fixture);
      await settle(fixture);
      const sheet = dialog()!;
      sheet.querySelector<HTMLInputElement>('input[name="work"][value="Seated"]')!.click();
      sheet.querySelector<HTMLInputElement>('input[type="radio"][value="Female"]')!.click();
      await settle(fixture);
      press(sheet, '2 g a kilogram');
      await settle(fixture);
      press(sheet, 'Work out targets');
      await settle(fixture);
      await settle(fixture);

      expect(api['calculate']).toHaveBeenCalledTimes(1);
      expect(calculations).toHaveBeenCalledTimes(2);
      expect(textOf(card(host, 'targets').querySelector('.calories'))).toBe('2,300 calories a day');
      expect(textOf(card(host, 'targets').querySelector('[data-earlier-targets] summary'))).toBe(
        'Earlier targets (2)',
      );
    });
  });

  describe('assigning a meal plan', () => {
    it('sends the plan with the newest targets and says so, then reads the plans again', async () => {
      const plans = vi
        .fn()
        .mockReturnValueOnce(of([]))
        .mockReturnValue(
          of([clientPlan({ id: 'cplan-2', startDate: TODAY, endDateExclusive: '2026-10-24' })]),
        );
      const { fixture, host, api } = await render({ api: { plans } });

      press(card(host, 'plan'), 'Assign a meal plan');
      await settle(fixture);
      await settle(fixture);
      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('.tb-modal__title'))).toContain(
        'Assign a meal plan to Rana',
      );
      Array.from(sheet.querySelectorAll('label.choice'))
        .find((item) => textOf(item).startsWith('Spring cut'))!
        .querySelector<HTMLInputElement>('input')!
        .click();
      await settle(fixture);
      press(sheet, 'Assign meal plan');
      await settle(fixture);
      await settle(fixture);

      expect(api['assign']).toHaveBeenCalledWith('client-1', {
        mealPlanTemplateVersionId: 'plan-v5',
        enrollmentId: 'e-1',
        calculationSnapshotId: 'calc-2',
        startDate: TODAY,
        acknowledgeAllergenWarnings: false,
      });
      expect(toast()).toContain('Spring cut assigned from Sat 10 Oct.');
      expect(plans).toHaveBeenCalledTimes(2);
      expect(textOf(host.querySelector('[data-current-plan] .plan-name'))).toBe('Spring cut');
      expect(dialog()).toBeNull();
    });

    it('goes from the new targets straight to assigning a meal plan with them', async () => {
      const { fixture, host, api } = await render({
        api: { calculations: vi.fn(() => of([])), plans: vi.fn(() => of([])) },
      });

      press(card(host, 'targets'), 'Work out targets');
      await settle(fixture);
      await settle(fixture);
      const sheet = dialog()!;
      sheet.querySelector<HTMLInputElement>('input[name="work"][value="Seated"]')!.click();
      sheet.querySelector<HTMLInputElement>('input[type="radio"][value="Female"]')!.click();
      await settle(fixture);
      press(sheet, '2 g a kilogram');
      await settle(fixture);
      press(sheet, 'Work out targets');
      await settle(fixture);
      await settle(fixture);
      press(dialog()!, 'Assign a meal plan with these');
      await settle(fixture);
      await settle(fixture);

      const assign = dialog()!;
      expect(textOf(assign.querySelector('.tb-modal__title'))).toContain(
        'Assign a meal plan to Rana',
      );
      expect(textOf(assign.querySelector('[data-targets]'))).toContain('2,155 calories a day');
      expect(api['calculate']).toHaveBeenCalledTimes(1);
    });
  });

  describe('the allergens', () => {
    it('saves the list, says so, and shows it without a reload', async () => {
      const read = vi
        .fn()
        .mockReturnValueOnce(of(allergens('Peanuts', 'Milk')))
        .mockReturnValueOnce(of(allergens('Peanuts', 'Milk')))
        .mockReturnValue(of(allergens('Peanuts', 'Milk', 'Sesame')));
      const { fixture, host, api } = await render({ api: { allergens: read } });

      press(card(host, 'allergens'), 'Edit allergens');
      await settle(fixture);
      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('[data-theirs]'))).toBe(
        'What Rana wrote about allergies Peanuts',
      );
      tick(sheet, 'Sesame');
      await settle(fixture);
      press(sheet, 'Save allergens');
      await settle(fixture);
      await settle(fixture);

      expect(api['replaceAllergens']).toHaveBeenCalledWith('client-1', [
        'Peanuts',
        'Milk',
        'Sesame',
      ]);
      expect(toast()).toContain('Allergens saved for Rana.');
      expect(
        Array.from(host.querySelectorAll('[data-declared] .chip')).map((item) => textOf(item)),
      ).toEqual(['Peanuts', 'Milk', 'Sesame']);
    });

    it('asks before closing a sheet that holds typed work, and keeps it when told to', async () => {
      const { fixture, host } = await render();

      press(card(host, 'allergens'), 'Edit allergens');
      await settle(fixture);
      tick(dialog()!, 'Sesame');
      await settle(fixture);
      press(dialog()!, 'Not now');
      await settle(fixture);
      await settle(fixture);

      const question = dialog()!;
      expect(textOf(question)).toContain('Close without saving? What you typed will be lost.');
      press(question, 'Keep editing');
      await settle(fixture);
      await settle(fixture);
      expect(textOf(dialog())).toContain('Save allergens');

      press(dialog()!, 'Not now');
      await settle(fixture);
      await settle(fixture);
      press(dialog()!.querySelector('app-confirm')!, 'Close');
      await settle(fixture);
      await settle(fixture);
      expect(dialog()).toBeNull();
    });

    it('closes at once when nothing was typed', async () => {
      const { fixture, host } = await render();

      press(card(host, 'allergens'), 'Edit allergens');
      await settle(fixture);
      press(dialog()!, 'Not now');
      await settle(fixture);
      await settle(fixture);
      expect(dialog()).toBeNull();
    });
  });

  describe('after a change', () => {
    it('says it was saved when the page cannot read it back', async () => {
      const read = vi
        .fn()
        .mockReturnValueOnce(of(allergens('Peanuts')))
        .mockReturnValueOnce(of(allergens('Peanuts')))
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const { fixture, host } = await render({ api: { allergens: read } });

      press(card(host, 'allergens'), 'Edit allergens');
      await settle(fixture);
      tick(dialog()!, 'Sesame');
      await settle(fixture);
      press(dialog()!, 'Save allergens');
      await settle(fixture);
      await settle(fixture);

      expect(textOf(host.querySelector('[data-stale]'))).toBe(
        'That was saved, but the page could not read it back. Reload to see it.',
      );
    });

    it('starts again, and shows nothing of the old client, when the workspace changes', async () => {
      const tenant = signal('tenant-1');
      const { fixture, host, api } = await render({ tenant });

      expect(host.querySelector('[data-card="targets"]')).not.toBeNull();
      tenant.set('tenant-2');
      await settle(fixture);
      await settle(fixture);
      expect(api['allergens']).toHaveBeenCalledTimes(2);
    });
  });
});
