import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adjustedRecord,
  calculationRecord,
  clientPlan,
  earlierRecord,
  publishedPlans,
  TODAY,
} from '../../../testing/client-nutrition-fixtures';
import { press, settle, tick } from '../../../testing/dom';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { AssignMealPlan } from './assign-plan-sheet';
import { ClientNutritionApi } from './client-nutrition-api';
import { mapPlan, mapWorkedOut, type NutritionCover } from './client-nutrition.models';
import { MealPlanApi } from './meal-plan-api';

const COVER: NutritionCover = {
  id: 'e-1',
  label: 'Online Coaching',
  start: '2026-07-21',
  last: '2026-10-28',
};

interface Api {
  assign?: ReturnType<typeof vi.fn>;
}

function library(items = publishedPlans()) {
  return vi.fn(() => of({ total: items.length, skip: 0, take: 100, items }));
}

async function render(
  inputs: Record<string, unknown> = {},
  api: Api = {},
  listPlans = library(),
  tenant = signal('t-1'),
) {
  await TestBed.configureTestingModule({
    imports: [AssignMealPlan],
    providers: [
      { provide: ClientNutritionApi, useValue: api },
      { provide: MealPlanApi, useValue: { listPlans } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AssignMealPlan);
  for (const [name, value] of Object.entries({
    clientId: 'client-1',
    firstName: 'Rana',
    today: TODAY,
    locale: 'en-US',
    timeZone: 'Asia/Beirut',
    covers: [COVER],
    existing: [],
    calculations: [mapWorkedOut(calculationRecord()), mapWorkedOut(earlierRecord())],
    declared: [],
    ...inputs,
  })) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, listPlans };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function choosePlan(host: ParentNode, name: string) {
  const label = Array.from(host.querySelectorAll('label.choice')).find((item) =>
    textOf(item).startsWith(name),
  );
  const radio = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`No meal plan reads "${name}".`);
  radio.click();
}

/** Opens the calendar of the date field and chooses a day, turning pages as a person would. */
async function chooseDay(fixture: Parameters<typeof settle>[0], host: ParentNode, iso: string) {
  const dateField = host.querySelector('app-date-field')!;
  dateField.querySelector<HTMLButtonElement>('button.trigger')!.click();
  await settle(fixture);
  for (let turn = 0; turn < 36; turn++) {
    const target = dateField.querySelector<HTMLButtonElement>(`button.day[data-date="${iso}"]`);
    if (target) {
      target.click();
      await settle(fixture);
      return;
    }
    const first = dateField.querySelector<HTMLElement>('button.day')!.dataset['date']!;
    dateField
      .querySelector<HTMLButtonElement>(
        `button[aria-label="${iso < first ? 'Previous month' : 'Next month'}"]`,
      )!
      .click();
    await settle(fixture);
  }
  throw new Error(`The calendar never showed ${iso}.`);
}

const problem = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ status, error: body });

describe('Assign a meal plan', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists the published meal plans with their length, and chooses none for the coach', async () => {
    const { host } = await render();

    const names = Array.from(host.querySelectorAll('label.choice')).map((item) => textOf(item));
    expect(names).toEqual([
      'Lean bulk 7 days, built for about 2,000 calories a day',
      'Spring cut 14 days, built for about 2,100 calories a day',
    ]);
    expect(host.querySelectorAll('input[name="plan"]:checked').length).toBe(0);
  });

  it('chooses the plan itself when there is only one to choose', async () => {
    const [first] = publishedPlans();
    const { host } = await render({}, {}, library([first]));
    expect(host.querySelector<HTMLInputElement>('input[name="plan"]')!.checked).toBe(true);
  });

  it('says there is none to assign when nothing is published', async () => {
    const { host } = await render({}, {}, library([]));
    expect(host.querySelector('[data-no-plans]')).not.toBeNull();
  });

  it('says what the client declared before anything is chosen', async () => {
    const none = await render();
    expect(textOf(none.host.querySelector('[data-declared]'))).toBe(
      'Rana has no allergens declared.',
    );
    TestBed.resetTestingModule();
    const some = await render({ declared: ['Milk', 'Peanuts'] });
    expect(textOf(some.host.querySelector('[data-declared]'))).toBe(
      'Rana declared these allergens: Peanuts and milk.',
    );
  });

  it('carries the newest targets, offers the earlier ones, and runs from today under their plan', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('[data-targets]'))).toBe(
      '2,155 calories a day 140 g protein · 264 g carbs · 60 g fat, worked out Fri 9 Oct',
    );
    expect(host.querySelectorAll('select[name="targets"] option').length).toBe(2);
    expect(textOf(host.querySelector('[data-cover]'))).toBe(
      'Online Coaching, Tue 21 Jul – Wed 28 Oct',
    );
  });

  it('names the coach’s own macros as theirs in the targets it carries (INV-2)', async () => {
    const { host } = await render({
      calculations: [mapWorkedOut(adjustedRecord()), mapWorkedOut(calculationRecord())],
    });

    expect(textOf(host.querySelector('[data-targets]'))).toBe(
      '2,060 calories a day 150 g protein · 230 g carbs · 60 g fat, your macros set today',
    );
    expect(
      Array.from(host.querySelectorAll('select[name="targets"] option')).map((option) =>
        textOf(option),
      ),
    ).toEqual(['today, your macros, 2,060 calories a day', 'Fri 9 Oct, 2,155 calories a day']);
  });

  it('sends the meal plan, the targets, the plan it sits under and the day', async () => {
    const assign = vi.fn(() =>
      of(clientPlan({ id: 'cplan-9', startDate: TODAY, endDateExclusive: '2026-10-24' })),
    );
    const { fixture, host } = await render({}, { assign });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    choosePlan(host, 'Spring cut');
    await settle(fixture);
    expect(textOf(host)).toContain('Runs Sat 10 Oct – Fri 23 Oct');
    press(host, 'Assign meal plan');
    await settle(fixture);

    expect(assign).toHaveBeenCalledWith('client-1', {
      mealPlanTemplateVersionId: 'plan-v5',
      enrollmentId: 'e-1',
      calculationSnapshotId: 'calc-2',
      startDate: TODAY,
      acknowledgeAllergenWarnings: false,
    });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed.mock.calls[0][0]).toMatchObject({ id: 'cplan-9', name: 'Spring cut' });
  });

  it('asks for a plan before sending anything', async () => {
    const assign = vi.fn();
    const { fixture, host } = await render({}, { assign });

    press(host, 'Assign meal plan');
    await settle(fixture);

    expect(textOf(host)).toContain('Choose the meal plan to assign.');
    expect(textOf(host)).toContain('Check what is marked above.');
    expect(assign).not.toHaveBeenCalled();
  });

  it('says when there are no targets yet, and offers to work them out', async () => {
    const assign = vi.fn();
    const { fixture, host } = await render({ calculations: [] }, { assign });
    const workOut = vi.fn();
    fixture.componentInstance.workOut.subscribe(workOut);

    expect(host.querySelector('[data-no-targets]')).not.toBeNull();
    choosePlan(host, 'Lean bulk');
    await settle(fixture);
    press(host, 'Assign meal plan');
    await settle(fixture);
    expect(textOf(host)).toContain(
      'Work out targets first: a meal plan carries them to the client.',
    );
    expect(assign).not.toHaveBeenCalled();

    press(host, 'Work out targets');
    expect(workOut).toHaveBeenCalledTimes(1);
  });

  it('says before sending that the plan would run past their Nutrition, and the latest start', async () => {
    const assign = vi.fn();
    const { fixture, host } = await render({}, { assign });

    choosePlan(host, 'Spring cut');
    await chooseDay(fixture, host, '2026-10-20');
    press(host, 'Assign meal plan');
    await settle(fixture);

    expect(textOf(host)).toContain(
      'Rana’s Nutrition covers Tue 21 Jul – Wed 28 Oct, so a 14-day meal plan can start Tue 21 Jul to Thu 15 Oct.',
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('says before sending that they already have a meal plan on those days', async () => {
    const assign = vi.fn();
    const running = mapPlan(clientPlan(), TODAY);
    const { fixture, host } = await render({ existing: [running] }, { assign });

    choosePlan(host, 'Lean bulk');
    await settle(fixture);
    press(host, 'Assign meal plan');
    await settle(fixture);

    expect(textOf(host)).toContain(
      'Rana already has Spring cut from Mon 5 Oct to Sun 18 Oct. A new one can start on Mon 19 Oct or later.',
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('asks the coach to look at the recipes when the server finds a declared allergen', async () => {
    const assign = vi
      .fn()
      .mockReturnValueOnce(
        throwError(() =>
          problem(409, {
            code: 'allergen_review_required',
            message: 'One or more declared recipe allergens conflict.',
          }),
        ),
      )
      .mockReturnValueOnce(of(clientPlan({ id: 'cplan-9' })));
    const { fixture, host } = await render({ declared: ['Milk'] }, { assign });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    choosePlan(host, 'Lean bulk');
    await settle(fixture);
    press(host, 'Assign meal plan');
    await settle(fixture);

    expect(host.querySelector('[data-review]')).not.toBeNull();
    expect(textOf(host)).toContain('Look at the recipes first.');
    expect(host.querySelector('.refusal')).toBeNull();
    expect(closed).not.toHaveBeenCalled();

    // The box has to be ticked before the plan goes.
    press(host, 'Assign anyway');
    await settle(fixture);
    expect(textOf(host)).toContain('Tick the box to say you have looked at the recipes.');
    expect(assign).toHaveBeenCalledTimes(1);

    tick(host, 'I have looked at the recipes and want to assign this plan.');
    await settle(fixture);
    press(host, 'Assign anyway');
    await settle(fixture);
    expect(assign).toHaveBeenLastCalledWith(
      'client-1',
      expect.objectContaining({ acknowledgeAllergenWarnings: true }),
    );
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('forgets that review when another meal plan is chosen', async () => {
    const assign = vi.fn(() =>
      throwError(() => problem(409, { code: 'allergen_review_required', message: 'Review.' })),
    );
    const { fixture, host } = await render({ declared: ['Milk'] }, { assign });

    choosePlan(host, 'Lean bulk');
    await settle(fixture);
    press(host, 'Assign meal plan');
    await settle(fixture);
    expect(host.querySelector('[data-review]')).not.toBeNull();

    choosePlan(host, 'Spring cut');
    await settle(fixture);
    expect(host.querySelector('[data-review]')).toBeNull();
  });

  it('keeps the sheet and says in words when the server refuses the days', async () => {
    const assign = vi.fn(() =>
      throwError(() =>
        problem(409, {
          code: 'nutrition_plan_conflict',
          message: 'The plan conflicts with current nutrition state.',
        }),
      ),
    );
    const { fixture, host } = await render({}, { assign });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    choosePlan(host, 'Lean bulk');
    await settle(fixture);
    press(host, 'Assign meal plan');
    await settle(fixture);

    expect(textOf(host.querySelector('.refusal'))).toBe(
      'Rana already has a meal plan on some of these days. Pick a start after it ends.',
    );
    expect(closed).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>('input[name="plan"]:checked')).not.toBeNull();
  });

  it('puts the server’s own words in front of the coach for a refusal it does not know', async () => {
    const assign = vi.fn(() =>
      throwError(() => problem(400, { errors: { plan: ['The plan is wrong.'] } })),
    );
    const { fixture, host } = await render({}, { assign });

    choosePlan(host, 'Lean bulk');
    await settle(fixture);
    press(host, 'Assign meal plan');
    await settle(fixture);
    expect(textOf(host.querySelector('.refusal'))).toBe('The plan is wrong.');
  });

  it('reads the library again when it could not be read', async () => {
    const listPlans = vi
      .fn()
      .mockReturnValueOnce(throwError(() => problem(500, {})))
      .mockReturnValue(of({ total: 2, skip: 0, take: 100, items: publishedPlans() }));
    const { fixture, host } = await render({}, {}, listPlans);

    expect(textOf(host)).toContain('The meal plans could not be loaded.');
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelectorAll('label.choice').length).toBe(2);
  });

  it('lets the coach pick which of two plans of theirs the meal plan sits under', async () => {
    const covers: NutritionCover[] = [
      COVER,
      { id: 'e-2', label: 'Nutrition add-on', start: '2026-10-13', last: '2026-11-30' },
    ];
    const assign = vi.fn(() => of(clientPlan()));
    const { fixture, host } = await render({ covers }, { assign });

    expect(host.querySelectorAll('select[name="cover"] option').length).toBe(2);
    choosePlan(host, 'Lean bulk');
    await settle(fixture);
    press(host, 'Assign meal plan');
    await settle(fixture);
    expect(assign).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ enrollmentId: 'e-1' }),
    );
  });

  it('closes without a plan when the coach says not now', async () => {
    const { fixture, host } = await render();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(null);
  });
});
