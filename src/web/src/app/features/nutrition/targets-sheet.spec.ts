import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { field, fill, formSummary, leave, press, settle } from '../../../testing/dom';
import {
  calculationRecord,
  calculationView,
  TODAY,
} from '../../../testing/client-nutrition-fixtures';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ClientNutritionApi } from './client-nutrition-api';
import { mapWorkedOut, type Starting } from './client-nutrition.models';
import { WorkOutTargets } from './targets-sheet';

const STARTING: Starting = {
  weight: { value: 70, on: '2026-10-08' },
  height: 168,
  age: 30,
  steps: 8000,
};

interface Api {
  calculate?: ReturnType<typeof vi.fn>;
}

async function render(inputs: Record<string, unknown> = {}, api: Api = {}, tenant = signal('t-1')) {
  await TestBed.configureTestingModule({
    imports: [WorkOutTargets],
    providers: [
      { provide: ClientNutritionApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(WorkOutTargets);
  for (const [name, value] of Object.entries({
    clientId: 'client-1',
    firstName: 'Rana',
    starting: STARTING,
    today: TODAY,
    locale: 'en-US',
    ...inputs,
  })) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, tenant };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function radio(host: ParentNode, name: string, value: string): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (!found) throw new Error(`No ${name} choice "${value}".`);
  return found;
}

const chip = (host: ParentNode, words: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button.chip')).find(
    (item) => textOf(item) === words,
  ) ?? null;

/** Everything a coach must choose themselves. */
async function chooseTheirs(fixture: Parameters<typeof settle>[0], host: HTMLElement) {
  radio(host, 'work', 'Seated').click();
  host.querySelector<HTMLInputElement>('input[type="radio"][value="Female"]')!.click();
  await settle(fixture);
}

const refusal = (message: string) =>
  new HttpErrorResponse({ status: 400, error: { errors: { calculation: [message] } } });

describe('Work out targets', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts from what the record knows and says where each number came from', async () => {
    const { host } = await render();

    expect(field<HTMLInputElement>(host, 'Weight (kg)').value).toBe('70');
    expect(field<HTMLInputElement>(host, 'Height (cm)').value).toBe('168');
    expect(field<HTMLInputElement>(host, 'Age (years)').value).toBe('30');
    expect(field<HTMLInputElement>(host, 'Steps a day, on average').value).toBe('8000');
    const help = textOf(host);
    expect(help).toContain('From their weigh-in on Thu 8 Oct.');
    expect(help).toContain('From their profile.');
    expect(help).toContain('Counted from their birth date.');
  });

  it('leaves sex and the kind of work for the coach to choose, with no default', async () => {
    const { host } = await render();

    expect(host.querySelectorAll('input[type="radio"]:checked').length).toBe(1);
    // The one checked radio is the formula; sex and work have none.
    expect(radio(host, 'formula', 'MifflinStJeor').checked).toBe(true);
    expect(radio(host, 'work', 'Seated').checked).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[value="Female"]')!.checked).toBe(false);
    expect(chip(host, 'Hold weight 0')?.getAttribute('aria-pressed')).toBe('true');
    expect(chip(host, '25% fat')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('says what is missing in words and sends nothing', async () => {
    const calculate = vi.fn(() => of(calculationView()));
    const { fixture, host } = await render({}, { calculate });

    press(host, 'Work out targets');
    await settle(fixture);

    const written = textOf(host);
    expect(written).toContain('Choose female or male: the formulas ask for one.');
    expect(written).toContain('Choose the kind of work they do.');
    expect(written).toContain('Enter the grams of protein a day.');
    expect(written).toContain('Check the fields marked above.');
    expect(calculate).not.toHaveBeenCalled();
    expect(host.querySelector('[data-result]')).toBeNull();
  });

  it('tells a number outside the server’s limits in the unit shown', async () => {
    const { fixture, host } = await render();

    fill(host, 'Weight (kg)', '12');
    leave(host, 'Weight (kg)');
    fill(host, 'Height (cm)', '400');
    leave(host, 'Height (cm)');
    fill(host, 'Age (years)', '17');
    leave(host, 'Age (years)');
    await settle(fixture);

    const written = textOf(host);
    expect(written).toContain('Weight has to be between 20 and 500 kg.');
    expect(written).toContain('Height has to be between 50 and 300 cm.');
    expect(written).toContain('Age has to be between 18 and 120. The formulas are for adults.');
  });

  it('sends what was chosen, and shows the answer with the way to assign a plan', async () => {
    const calculate = vi.fn(() => of(calculationView()));
    const { fixture, host } = await render({}, { calculate });
    const recorded = vi.fn();
    fixture.componentInstance.recorded.subscribe(recorded);

    await chooseTheirs(fixture, host);
    press(host, 'Lose steadily −300');
    press(host, '2 g a kilogram');
    await settle(fixture);
    expect(field<HTMLInputElement>(host, 'Protein (grams a day)').value).toBe('140');
    expect(textOf(host)).toContain('That is 2 g for each kilogram of their weight.');
    press(host, 'Work out targets');
    await settle(fixture);

    expect(calculate).toHaveBeenCalledWith('client-1', {
      bmrMethodKey: 'MifflinStJeor',
      weightKilograms: 70,
      heightCentimeters: 168,
      ageYears: 30,
      sex: 'Female',
      bodyFatPercentage: null,
      occupationType: 'Seated',
      averageDailySteps: 8000,
      coachGoalAdjustment: -300,
      calorieTarget: null,
      proteinGrams: 140,
      fatPercentage: 25,
      isEnergyDeficit: true,
    });
    const result = host.querySelector('[data-result]');
    expect(result).not.toBeNull();
    expect(textOf(result)).toContain('2,155 calories a day');
    expect(textOf(result)).toContain('Saved as the latest targets for Rana.');
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(recorded.mock.calls[0][0]).toMatchObject({ id: 'calc-2', calories: 2154.8 });
  });

  it('hands the answer to the meal plan sheet, or closes with it', async () => {
    const calculate = vi.fn(() => of(calculationView()));
    const { fixture, host } = await render({}, { calculate });
    const assign = vi.fn();
    const closed = vi.fn();
    fixture.componentInstance.assign.subscribe(assign);
    fixture.componentInstance.closed.subscribe(closed);

    await chooseTheirs(fixture, host);
    press(host, '2 g a kilogram');
    await settle(fixture);
    press(host, 'Work out targets');
    await settle(fixture);
    press(host, 'Assign a meal plan with these');
    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ id: 'calc-2' }));
    press(host, 'Done');
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ id: 'calc-2' }));
  });

  it('works protein out from the weight, and turns the quick picks off without one', async () => {
    const { fixture, host } = await render({ starting: { ...STARTING, weight: null } });

    expect(chip(host, '1.8 g a kilogram')?.disabled).toBe(true);
    fill(host, 'Weight (kg)', '72.4');
    await settle(fixture);
    press(host, '1.8 g a kilogram');
    await settle(fixture);
    expect(field<HTMLInputElement>(host, 'Protein (grams a day)').value).toBe('130');
    expect(chip(host, '1.8 g a kilogram')?.getAttribute('aria-pressed')).toBe('true');
    // Typing the grams moves the line under it.
    fill(host, 'Protein (grams a day)', '145');
    await settle(fixture);
    expect(textOf(host)).toContain('That is 2 g for each kilogram of their weight.');
  });

  it('asks for body fat only for the formula that needs it', async () => {
    const calculate = vi.fn(() => of(calculationView()));
    const { fixture, host } = await render({}, { calculate });

    expect(host.querySelector('input[name="bodyFat"]')).toBeNull();
    radio(host, 'formula', 'KatchMcArdle').click();
    await settle(fixture);
    expect(host.querySelector('input[name="bodyFat"]')).not.toBeNull();
    await chooseTheirs(fixture, host);
    press(host, '2 g a kilogram');
    await settle(fixture);
    press(host, 'Work out targets');
    await settle(fixture);
    expect(textOf(host)).toContain('This formula needs their body fat.');
    expect(calculate).not.toHaveBeenCalled();

    fill(host, 'Body fat (percent)', '28');
    await settle(fixture);
    press(host, 'Work out targets');
    await settle(fixture);
    expect(calculate).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ bmrMethodKey: 'KatchMcArdle', bodyFatPercentage: 28 }),
    );
  });

  it('keeps what was typed and says why when the server refuses', async () => {
    const calculate = vi.fn(() =>
      throwError(() =>
        refusal("Protein and fat calories cannot exceed the calorie target. (Parameter 'input')"),
      ),
    );
    const { fixture, host } = await render({}, { calculate });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    await chooseTheirs(fixture, host);
    fill(host, 'Protein (grams a day)', '600');
    await settle(fixture);
    press(host, 'Work out targets');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe(
      'Protein and fat together come to more calories than the target. Lower the protein or the fat share, or raise the goal.',
    );
    expect(document.activeElement).toBe(formSummary(host));
    expect(field<HTMLInputElement>(host, 'Protein (grams a day)').value).toBe('600');
    expect(host.querySelector('[data-result]')).toBeNull();
    expect(closed).not.toHaveBeenCalled();
  });

  it('carries the last calculation’s own choices into the next', async () => {
    const last = mapWorkedOut(calculationRecord());
    const { host } = await render({
      last,
      starting: { ...STARTING, weight: { value: 68, on: TODAY } },
    });

    expect(radio(host, 'work', 'Seated').checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[value="Female"]')!.checked).toBe(true);
    expect(chip(host, 'Lose steadily −300')?.getAttribute('aria-pressed')).toBe('true');
    // Protein follows the new weight at the same grams for each kilogram.
    expect(field<HTMLInputElement>(host, 'Protein (grams a day)').value).toBe('136');
  });

  it('tells the page it holds typed work, and stops once the targets are saved', async () => {
    const calculate = vi.fn(() => of(calculationView()));
    const { fixture, host } = await render({}, { calculate });
    const dirty = vi.fn();
    fixture.componentInstance.dirtyChange.subscribe(dirty);

    await chooseTheirs(fixture, host);
    expect(dirty).toHaveBeenLastCalledWith(true);
    press(host, '2 g a kilogram');
    await settle(fixture);
    press(host, 'Work out targets');
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it('drops the answer when the workspace changes while it is being worked out', async () => {
    const answer = new Subject<ReturnType<typeof calculationView>>();
    const calculate = vi.fn(() => answer);
    const { fixture, host, tenant } = await render({}, { calculate });
    const recorded = vi.fn();
    fixture.componentInstance.recorded.subscribe(recorded);

    await chooseTheirs(fixture, host);
    press(host, '2 g a kilogram');
    await settle(fixture);
    press(host, 'Work out targets');
    await settle(fixture);
    tenant.set('t-2');
    answer.next(calculationView());
    answer.complete();
    await settle(fixture);

    expect(recorded).not.toHaveBeenCalled();
    expect(host.querySelector('[data-result]')).toBeNull();
  });

  it('closes without targets when the coach says not now', async () => {
    const { fixture, host } = await render();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(null);
  });
});
