import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  field,
  fill,
  fold,
  formSummary,
  leave,
  press,
  segment,
  settle,
  toggleFold,
} from '../../../testing/dom';
import {
  calculationRecord,
  calculationView,
  energyModelView,
  previewView,
  RANA_WORDS,
  TODAY,
  versionTwoRecord,
} from '../../../testing/client-nutrition-fixtures';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ClientNutritionApi } from './client-nutrition-api';
import { mapEnergyModel, mapWorkedOut, type Starting } from './client-nutrition.models';
import { WorkOutTargets } from './targets-sheet';

const STARTING: Starting = {
  weight: { value: 70, on: '2026-10-08' },
  height: 168,
  age: 30,
  steps: 8000,
};

interface Api {
  calculate?: ReturnType<typeof vi.fn>;
  energyPreview?: ReturnType<typeof vi.fn>;
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

const PROTEIN = 'Protein for each kilogram of body weight';
const FAT = 'Share of calories from fat';

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
    const { fixture, host } = await render();

    // Sex and work have nothing chosen; the usual formula waits, folded under its name. The rows of
    // quick picks under protein and fat are not choices of that kind.
    const chosen = () =>
      Array.from(host.querySelectorAll('input[type="radio"]:checked')).filter(
        (input) => !input.closest('.picks'),
      ).length;
    expect(chosen()).toBe(0);
    expect(fold(host, 'Formula: Mifflin-St Jeor').open).toBe(false);
    await toggleFold(fixture, host, 'Formula: Mifflin-St Jeor');
    expect(chosen()).toBe(1);
    expect(radio(host, 'formula', 'MifflinStJeor').checked).toBe(true);
    expect(radio(host, 'work', 'Seated').checked).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[value="Female"]')!.checked).toBe(false);
    expect(chip(host, 'Hold weight 0')?.getAttribute('aria-pressed')).toBe('true');
    expect(segment(host, FAT, '25').checked).toBe(true);
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
    segment(host, PROTEIN, '2.0').click();
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
    segment(host, PROTEIN, '2.0').click();
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

    expect(segment(host, PROTEIN, '1.8').disabled).toBe(true);
    expect(textOf(host)).toContain(
      'Type the grams. With their weight above, you can pick grams for each kilogram.',
    );
    fill(host, 'Weight (kg)', '72.4');
    await settle(fixture);
    segment(host, PROTEIN, '1.8').click();
    await settle(fixture);
    expect(field<HTMLInputElement>(host, 'Protein (grams a day)').value).toBe('130');
    expect(segment(host, PROTEIN, '1.8').checked).toBe(true);
    // Typing the grams moves the line under it.
    fill(host, 'Protein (grams a day)', '145');
    await settle(fixture);
    expect(textOf(host)).toContain('That is 2 g for each kilogram of their weight.');
  });

  it('asks for body fat only for the formula that needs it', async () => {
    const calculate = vi.fn(() => of(calculationView()));
    const { fixture, host } = await render({}, { calculate });

    expect(host.querySelector('input[name="bodyFat"]')).toBeNull();
    await toggleFold(fixture, host, 'Formula: Mifflin-St Jeor');
    expect(host.querySelector('input[name="bodyFat"]')).toBeNull();
    radio(host, 'formula', 'KatchMcArdle').click();
    await settle(fixture);
    expect(host.querySelector('input[name="bodyFat"]')).not.toBeNull();
    await chooseTheirs(fixture, host);
    segment(host, PROTEIN, '2.0').click();
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

  it('keeps Formula open while a formula is chosen in it, the usual one included (critique B2b)', async () => {
    const { fixture, host } = await render();

    await toggleFold(fixture, host, 'Formula: Mifflin-St Jeor');
    radio(host, 'formula', 'KatchMcArdle').click();
    await settle(fixture);
    // A keyboard's arrows choose as they move: landing on the usual one must not hide the radios.
    radio(host, 'formula', 'MifflinStJeor').click();
    await settle(fixture);

    expect(fold(host, 'Formula: Mifflin-St Jeor').open).toBe(true);
    expect(radio(host, 'formula', 'MifflinStJeor').checked).toBe(true);
  });

  it('opens Formula on a refused body fat, with focus on the box (critique B2b)', async () => {
    const calculate = vi.fn(() => of(calculationView()));
    const { fixture, host } = await render({}, { calculate });
    await toggleFold(fixture, host, 'Formula: Mifflin-St Jeor');
    radio(host, 'formula', 'KatchMcArdle').click();
    await settle(fixture);
    await chooseTheirs(fixture, host);
    segment(host, PROTEIN, '2.0').click();
    await settle(fixture);
    await toggleFold(fixture, host, 'Formula: Katch-McArdle', false);

    press(host, 'Work out targets');
    await settle(fixture);

    expect(calculate).not.toHaveBeenCalled();
    expect(fold(host, 'Formula: Katch-McArdle').open).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('input[name="bodyFat"]'));
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

  it('puts each number in a block of its own: the box, then one row of picks with its caption (critique B5c)', async () => {
    const { fixture, host } = await render();

    for (const [block, label, caption, picks] of [
      ['protein', 'Protein (grams a day)', 'g per kg', ['1.6', '1.8', '2.0', '2.2']],
      ['fat', 'Fat (percent of calories)', '% of calories', ['20', '25', '30', '35']],
    ] as const) {
      const box = host.querySelector(`[data-block="${block}"]`)!;
      const entry = box.querySelector('app-field')!;
      const row = box.querySelector('.picks')!;
      // The box comes first, its picks under it.
      expect(entry.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(textOf(entry)).toContain(label);
      expect(textOf(row.querySelector('.caption'))).toBe(caption);
      expect(Array.from(row.querySelectorAll('label')).map(textOf)).toEqual([...picks]);
    }

    segment(host, FAT, '30').click();
    await settle(fixture);
    expect(field<HTMLInputElement>(host, 'Fat (percent of calories)').value).toBe('30');
    fill(host, 'Fat (percent of calories)', '28');
    await settle(fixture);
    expect(['20', '25', '30', '35'].some((share) => segment(host, FAT, share).checked)).toBe(false);
    expect(textOf(host.querySelector('[data-carbs]'))).toBe(
      'Carbs: the rest of the calories, after protein and fat.',
    );
  });

  it('says the carbs and the fat in grams once Work out has answered for these numbers', async () => {
    const last = mapWorkedOut(calculationRecord());
    const { fixture, host } = await render({ last });

    // Opened again on the numbers last worked out: the server's own grams (NUT-008).
    expect(textOf(host.querySelector('[data-carbs]'))).toBe('Carbs: the rest, 264 g (49%).');
    expect(textOf(host)).toContain('That is 60 g of fat a day.');

    // Another number, another answer: none is guessed in the browser.
    fill(host, 'Protein (grams a day)', '150');
    await settle(fixture);
    expect(textOf(host.querySelector('[data-carbs]'))).toBe(
      'Carbs: the rest of the calories, after protein and fat.',
    );
    expect(textOf(host)).not.toContain('g of fat a day');
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
    segment(host, PROTEIN, '2.0').click();
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
    segment(host, PROTEIN, '2.0').click();
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

/** Lets the sheet's pause before asking the preview pass, then the answer land. */
async function afterPause(fixture: Parameters<typeof settle>[0]) {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await settle(fixture);
}

/** A goal pick by its name, whatever its rate line says under it. */
const goalChip = (host: ParentNode, label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button.chip')).find((item) =>
    textOf(item.querySelector('.chip-head')).startsWith(label),
  ) ?? null;

const VERSION_TWO = () => mapEnergyModel(energyModelView(2));

describe('Work out targets under energy version 1, as every server is until B8c', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('asks what it always asked, with the words that hold for both versions (critique B8b)', async () => {
    const energyPreview = vi.fn(() => of(previewView()));
    const { fixture, host } = await render({}, { energyPreview });

    const legends = Array.from(host.querySelectorAll('legend')).map(textOf);
    expect(legends).toContain('How active they are');
    expect(
      Array.from(host.querySelectorAll('input[name="work"]')).map((input) =>
        input.getAttribute('value'),
      ),
    ).toEqual(['Seated', 'Mixed', 'Physical']);
    expect(host.querySelector('input[name="workouts"]')).toBeNull();
    expect(host.querySelector('[data-own-pal]')).toBeNull();
    expect(host.querySelector('[data-live]')).toBeNull();
    expect(textOf(host)).toContain(
      'From their profile. Steps from a phone or watch on a normal day, work included. Walking is counted inside the multiplier, never added on top.',
    );
    fill(host, 'Steps a day, on average', '9000');
    await settle(fixture);
    expect(textOf(host)).toContain(
      'From their phone or watch on a normal day, work included. Walking is counted inside the multiplier, never added on top.',
    );

    await toggleFold(fixture, host, 'Formula: Mifflin-St Jeor');
    expect(textOf(host)).toContain(
      'Older; less often within 10% of a measured value than Mifflin-St Jeor, and runs higher for heavier clients.',
    );
    await afterPause(fixture);
    expect(energyPreview).not.toHaveBeenCalled();
    expect(host.querySelector('[data-rate]')).toBeNull();
  });
});

describe('Work out targets under energy version 2 (critique B8b)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const v2Starting: Starting = { ...STARTING, workouts: 4 };

  it('asks four kinds of work and the workouts a week, filled in from their program', async () => {
    const { fixture, host } = await render(
      { model: VERSION_TWO(), starting: v2Starting },
      { energyPreview: vi.fn(() => of(previewView())) },
    );

    expect(
      Array.from(host.querySelectorAll('input[name="work"]')).map((input) =>
        textOf(input.closest('label')?.querySelector('strong')),
      ),
    ).toEqual(['Seated', 'Mixed', 'On their feet', 'Heavy manual']);
    expect(textOf(radio(host, 'work', 'OnTheirFeet').closest('label'))).toContain(
      'Teaching, retail, nursing, serving.',
    );
    expect(field<HTMLInputElement>(host, 'Workouts a week').value).toBe('4');
    expect(textOf(host)).toContain('From their program’s current week.');
    fill(host, 'Workouts a week', '3');
    await settle(fixture);
    expect(textOf(host)).toContain('How many times a week they train, from 0 to 7.');
  });

  it('says the server’s words for the multiplier, the steps and each goal as the coach types', async () => {
    const energyPreview = vi.fn(() => of(previewView()));
    const { fixture, host } = await render(
      { model: VERSION_TWO(), starting: v2Starting },
      { energyPreview },
    );

    // Before the answer, the line says what it waits for.
    expect(textOf(host.querySelector('[data-live]'))).toBe(
      'The multiplier shows here once their work, steps and workouts are in.',
    );
    await chooseTheirs(fixture, host);
    expect(textOf(host.querySelector('[data-live]'))).toBe('Working out the multiplier…');
    await afterPause(fixture);

    expect(energyPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        occupationType: 'Seated',
        averageDailySteps: 8000,
        workoutsPerWeek: 4,
        weightKilograms: 70,
        sex: 'Female',
        chosenPal: null,
        goalAdjustments: [-500, -300, 0, 250, 400],
      }),
    );
    expect(textOf(host.querySelector('[data-counts]'))).toBe(RANA_WORDS.activity);
    expect(textOf(host.querySelector('[data-walking]'))).toBe(RANA_WORDS.walking);
    expect(textOf(goalChip(host, 'Lose steadily'))).toBe(
      'Lose steadily −300 ≈ 0.3 kg a week · 87% of what they burn',
    );
    expect(textOf(goalChip(host, 'Hold weight'))).toBe(
      'Hold weight 0 no change · 100% of what they burn',
    );
    // The goal in the box says its own sentence.
    expect(textOf(host)).toContain('0 a day ≈ no change in weight, 100% of what they burn.');
    goalChip(host, 'Lose steadily')!.click();
    await settle(fixture);
    expect(textOf(host)).toContain(`${RANA_WORDS.goal}.`);

    // A changed number is asked again once typing pauses; the answer in between stays.
    const calls = energyPreview.mock.calls.length;
    fill(host, 'Steps a day, on average', '12000');
    await settle(fixture);
    expect(energyPreview).toHaveBeenCalledTimes(calls);
    expect(textOf(host.querySelector('[data-counts]'))).toBe(RANA_WORDS.activity);
    await afterPause(fixture);
    expect(energyPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ averageDailySteps: 12000 }),
    );
  });

  it('sends the workouts, and the coach’s own multiplier with their reason', async () => {
    const calculate = vi.fn(() => of(versionTwoRecord().result));
    const energyPreview = vi.fn(() => of(previewView()));
    const { fixture, host } = await render(
      { model: VERSION_TWO(), starting: v2Starting },
      { calculate, energyPreview },
    );

    await chooseTheirs(fixture, host);
    segment(host, PROTEIN, '2.0').click();
    expect(fold(host, 'Or choose the multiplier yourself').open).toBe(false);
    await toggleFold(fixture, host, 'Or choose the multiplier yourself');
    expect(radio(host, 'pal', 'table').checked).toBe(true);
    expect(textOf(radio(host, 'pal', '1.55').closest('label'))).toBe(
      '× 1.55 Moderate exercise 3 to 5 days a week.',
    );
    radio(host, 'pal', '1.55').click();
    await settle(fixture);
    fill(host, 'Why this multiplier? (optional)', 'Trains hard four days a week');
    await afterPause(fixture);
    expect(energyPreview).toHaveBeenLastCalledWith(expect.objectContaining({ chosenPal: 1.55 }));

    press(host, 'Work out targets');
    await settle(fixture);
    expect(calculate).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({
        occupationType: 'Seated',
        workoutsPerWeek: 4,
        chosenPal: 1.55,
        chosenPalReason: 'Trains hard four days a week',
      }),
    );
  });

  it('refuses a multiplier of their own in the server’s words, opening its fold', async () => {
    const calculate = vi.fn(() => of(versionTwoRecord().result));
    const { fixture, host } = await render(
      { model: VERSION_TWO(), starting: v2Starting },
      { calculate, energyPreview: vi.fn(() => of(previewView())) },
    );

    await chooseTheirs(fixture, host);
    segment(host, PROTEIN, '2.0').click();
    await toggleFold(fixture, host, 'Or choose the multiplier yourself');
    radio(host, 'pal', 'typed').click();
    await settle(fixture);
    fill(host, 'Their multiplier', '1.3');
    await settle(fixture);
    expect(textOf(host.querySelector('[data-live]'))).toBe(
      'Their multiplier shows here once you choose or type it.',
    );
    await toggleFold(fixture, host, 'Or choose the multiplier yourself', false);
    press(host, 'Work out targets');
    await settle(fixture);

    expect(calculate).not.toHaveBeenCalled();
    expect(fold(host, 'Or choose the multiplier yourself').open).toBe(true);
    expect(textOf(host)).toContain(
      'A multiplier of 1.3 is under 1.40, the lowest FAO/WHO/UNU’s scale gives a healthy adult’s whole day. Choose one from 1.40 to 2.40.',
    );
  });

  it('asks for the workouts when no program gives them', async () => {
    const calculate = vi.fn(() => of(versionTwoRecord().result));
    const { fixture, host } = await render(
      { model: VERSION_TWO() },
      { calculate, energyPreview: vi.fn(() => of(previewView())) },
    );

    expect(field<HTMLInputElement>(host, 'Workouts a week').value).toBe('');
    expect(textOf(host)).toContain('How many times a week they train, from 0 to 7.');
    await chooseTheirs(fixture, host);
    segment(host, PROTEIN, '2.0').click();
    await settle(fixture);
    press(host, 'Work out targets');
    await settle(fixture);
    expect(calculate).not.toHaveBeenCalled();
    expect(textOf(host)).toContain('Say how many workouts a week they do, from 0 to 7.');
  });

  it('shows the server’s words in How this was worked out', async () => {
    const calculate = vi.fn(() => of(versionTwoRecord().result));
    const { fixture, host } = await render(
      { model: VERSION_TWO(), starting: v2Starting },
      { calculate, energyPreview: vi.fn(() => of(previewView())) },
    );

    await chooseTheirs(fixture, host);
    segment(host, PROTEIN, '2.0').click();
    await settle(fixture);
    press(host, 'Work out targets');
    await settle(fixture);
    const result = host.querySelector('[data-result]')!;
    await toggleFold(fixture, result, 'How this was worked out');

    const said = (name: string) => textOf(result.querySelector(`[data-said="${name}"]`));
    expect(textOf(result.querySelector('[data-step="activity"] dt'))).toBe(
      'Times 1.63 for how active they are',
    );
    expect(said('activity')).toBe(RANA_WORDS.activity);
    expect(said('walking')).toBe(RANA_WORDS.walking);
    expect(said('goal')).toBe(RANA_WORDS.goal);
    expect(textOf(result)).toContain(
      'Worked out from 70 kg, 168 cm, 30 years, female, seated work, 8,000 steps a day, 4 workouts a week.',
    );
  });

  it('says when the preview could not be shown, and still works the targets out', async () => {
    const calculate = vi.fn(() => of(versionTwoRecord().result));
    const energyPreview = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503 })));
    const { fixture, host } = await render(
      { model: VERSION_TWO(), starting: v2Starting },
      { calculate, energyPreview },
    );

    await chooseTheirs(fixture, host);
    segment(host, PROTEIN, '2.0').click();
    await afterPause(fixture);
    expect(textOf(host.querySelector('[data-preview-failed]'))).toBe(
      'The multiplier could not be shown just now. Work out targets still works it out.',
    );
    press(host, 'Work out targets');
    await settle(fixture);
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('chooses version 1’s Physical again, and carries a multiplier the coach chose last time', async () => {
    const physical = mapWorkedOut(
      calculationRecord({ inputs: { ...calculationRecord().inputs!, occupationType: 'Physical' } }),
    );
    const first = await render(
      { model: VERSION_TWO(), starting: v2Starting, last: physical },
      { energyPreview: vi.fn(() => of(previewView())) },
    );
    expect(
      Array.from(first.host.querySelectorAll<HTMLInputElement>('input[name="work"]')).some(
        (input) => input.checked,
      ),
    ).toBe(false);
    TestBed.resetTestingModule();

    const chosen = mapWorkedOut(
      versionTwoRecord({
        inputs: { ...versionTwoRecord().inputs!, chosenPal: 1.62, chosenPalReason: 'Shift work' },
      }),
    );
    const { host } = await render(
      { model: VERSION_TWO(), starting: v2Starting, last: chosen },
      { energyPreview: vi.fn(() => of(previewView())) },
    );
    expect(fold(host, 'Or choose the multiplier yourself').open).toBe(true);
    expect(radio(host, 'pal', 'typed').checked).toBe(true);
    expect(field<HTMLInputElement>(host, 'Their multiplier').value).toBe('1.62');
    expect(field<HTMLTextAreaElement>(host, 'Why this multiplier? (optional)').value).toBe(
      'Shift work',
    );
  });
});
