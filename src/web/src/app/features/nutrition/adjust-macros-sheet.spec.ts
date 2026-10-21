import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adjustedRecord,
  calculationRecord,
  clientPlan,
  TODAY,
} from '../../../testing/client-nutrition-fixtures';
import { field, fill, formSummary, press, settle } from '../../../testing/dom';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { AdjustMacros } from './adjust-macros-sheet';
import { ClientNutritionApi } from './client-nutrition-api';
import { mapPlan, mapWorkedOut, type WorkedOut } from './client-nutrition.models';

async function render(
  inputs: Record<string, unknown> = {},
  adjustMacros = vi.fn(() => of(adjustedRecord())),
) {
  await TestBed.configureTestingModule({
    imports: [AdjustMacros],
    providers: [
      { provide: ClientNutritionApi, useValue: { adjustMacros } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('t-1') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdjustMacros);
  for (const [name, value] of Object.entries({
    clientId: 'client-1',
    firstName: 'Rana',
    from: mapWorkedOut(calculationRecord()),
    today: TODAY,
    locale: 'en-US',
    timeZone: 'Asia/Beirut',
    ...inputs,
  })) {
    fixture.componentRef.setInput(name, value);
  }
  const closed: (WorkedOut | null)[] = [];
  const recorded: WorkedOut[] = [];
  const assign: WorkedOut[] = [];
  const dirty: boolean[] = [];
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.recorded.subscribe((value) => recorded.push(value));
  fixture.componentInstance.assign.subscribe((value) => assign.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    adjustMacros,
    closed,
    recorded,
    assign,
    dirty,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Adjust macros (INV-2)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts from the latest targets in whole grams and adds up what they make', async () => {
    const { host, dirty } = await render();

    expect(textOf(host.querySelector('[data-from]'))).toBe(
      'Starting from the targets worked out Fri 9 Oct 2,155 calories · 140 g protein · 264 g carbs · 60 g fat',
    );
    expect(field(host, 'Protein (g)').value).toBe('140');
    expect(field(host, 'Carbs (g)').value).toBe('264');
    expect(field(host, 'Fat (g)').value).toBe('60');
    // 140 × 4 + 264 × 4 + 60 × 9, a calorie over the unrounded targets.
    expect(textOf(host.querySelector('[data-sum]'))).toBe(
      'That makes 2,156 calories a day, 1 more than before.',
    );
    expect(dirty.at(-1)).toBe(false);
  });

  it('says what the grams make as the coach types, before and after the targets', async () => {
    const { fixture, host, dirty } = await render();

    fill(host, 'Protein (g)', '150');
    fill(host, 'Carbs (g)', '230');
    await settle(fixture);
    expect(textOf(host.querySelector('[data-sum]'))).toBe(
      'That makes 2,060 calories a day, 95 fewer than before.',
    );
    expect(host.querySelector('[data-sum]')!.getAttribute('aria-live')).toBe('polite');
    expect(dirty.at(-1)).toBe(true);

    fill(host, 'Carbs (g)', '');
    await settle(fixture);
    expect(textOf(host.querySelector('[data-sum]'))).toBe(
      'The calories add up here as you type the grams.',
    );
  });

  it('asks why, and refuses grams the server would, before anything is sent', async () => {
    const { fixture, host, adjustMacros } = await render();

    press(host, 'Save these macros');
    await settle(fixture);
    expect(textOf(host)).toContain('Say why, so it is on record.');
    expect(textOf(host)).toContain('Check the fields marked above.');

    fill(host, 'Carbs (g)', '1001');
    fill(host, 'Protein (g)', '');
    await settle(fixture);
    expect(textOf(host)).toContain('Between 0 and 1,000 grams a day.');
    expect(textOf(host)).toContain('Enter the grams of protein a day, or 0.');

    fill(host, 'Protein (g)', '0');
    fill(host, 'Carbs (g)', '0');
    fill(host, 'Fat (g)', '0');
    await settle(fixture);
    expect(textOf(host)).toContain(
      'The macros add up to 0 calories. Give at least one of them some grams.',
    );
    expect(adjustMacros).not.toHaveBeenCalled();
  });

  it('records the grams and the reason over the latest targets, and shows what came of it', async () => {
    const { fixture, host, adjustMacros, recorded, assign } = await render();

    fill(host, 'Protein (g)', '150');
    fill(host, 'Carbs (g)', '230');
    fill(host, 'Why are you changing them?', '  More protein while she cuts  ');
    await settle(fixture);
    press(host, 'Save these macros');
    await settle(fixture);

    expect(adjustMacros).toHaveBeenCalledWith('client-1', 'calc-2', {
      proteinGrams: 150,
      carbohydrateGrams: 230,
      fatGrams: 60,
      reason: 'More protein while she cuts',
    });
    const result = host.querySelector('[data-result]');
    expect(textOf(result)).toContain(
      'Saved as the latest targets for Rana. Nothing changes for them until you assign a meal plan with these.',
    );
    expect(textOf(result?.querySelector('.calories'))).toBe('2,060 calories a day');
    expect(textOf(result?.querySelector('[data-why]'))).toBe(
      'Why you changed them More protein while she cuts',
    );
    expect(result?.querySelector('[data-keeps]')).toBeNull();
    expect(recorded.map((item) => item.id)).toEqual(['calc-3']);

    press(host, 'Assign a meal plan with these');
    expect(assign.map((item) => item.id)).toEqual(['calc-3']);
  });

  it('says a meal plan already running keeps its own targets', async () => {
    const { fixture, host } = await render({ current: mapPlan(clientPlan(), TODAY) });

    fill(host, 'Why are you changing them?', 'More protein');
    await settle(fixture);
    press(host, 'Save these macros');
    await settle(fixture);

    expect(textOf(host.querySelector('[data-keeps]'))).toBe(
      'Spring cut keeps the targets it was assigned with. To give Rana these, stop it and assign a meal plan with these.',
    );
  });

  it('says a refusal in the coach’s words and keeps what was typed', async () => {
    const adjustMacros = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              errors: {
                macroOverride: [
                  "Carbohydrate must be 0 to 1000 grams a day. (Parameter 'Carbohydrate')",
                ],
              },
            },
          }),
      ),
    );
    const { fixture, host, recorded } = await render({}, adjustMacros);

    fill(host, 'Why are you changing them?', 'More protein');
    await settle(fixture);
    press(host, 'Save these macros');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe('Each macro is 0 to 1,000 grams a day.');
    expect(document.activeElement).toBe(formSummary(host));
    expect(field(host, 'Carbs (g)').value).toBe('264');
    expect(recorded).toEqual([]);
  });

  it('closes on Not now without sending', async () => {
    const { fixture, host, adjustMacros, closed } = await render();

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toEqual([null]);
    expect(adjustMacros).not.toHaveBeenCalled();
  });
});
