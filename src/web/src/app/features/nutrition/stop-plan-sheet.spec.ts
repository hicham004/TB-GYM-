import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientPlan, TODAY } from '../../../testing/client-nutrition-fixtures';
import { fill, press, settle } from '../../../testing/dom';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ClientNutritionApi } from './client-nutrition-api';
import { mapPlan, type PlanRow } from './client-nutrition.models';
import { StopMealPlan, type StopOutcome } from './stop-plan-sheet';

/** Spring cut, running since Mon 5 Oct; today is Sat 10 Oct. */
const RUNNING = () => mapPlan(clientPlan(), TODAY);

async function render(plan: PlanRow = RUNNING(), stop = vi.fn(() => of(clientPlan()))) {
  await TestBed.configureTestingModule({
    imports: [StopMealPlan],
    providers: [
      { provide: ClientNutritionApi, useValue: { stop } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('t-1') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(StopMealPlan);
  fixture.componentRef.setInput('clientId', 'client-1');
  fixture.componentRef.setInput('firstName', 'Rana');
  fixture.componentRef.setInput('plan', plan);
  fixture.componentRef.setInput('today', TODAY);
  fixture.componentRef.setInput('locale', 'en-US');
  const closed: (StopOutcome | null)[] = [];
  const stale = vi.fn();
  const dirty: boolean[] = [];
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.stale.subscribe(stale);
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, stop, closed, stale, dirty };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const refused = (code: string) =>
  new HttpErrorResponse({ status: 409, error: { code, message: 'Refused.' } });

describe('Stop a meal plan (NCM-1)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says what stopping a running plan does, and that it is one way', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('[data-stopping]'))).toBe('Spring cut Mon 5 Oct – Sun 18 Oct');
    expect(textOf(host.querySelector('[data-effect]'))).toBe(
      'Rana stops seeing it at once, today included. What they logged is kept, and its days come free for another meal plan.',
    );
    expect(textOf(host)).toContain(
      'You can’t undo this. Assign a meal plan again to give them another.',
    );
    expect(textOf(host)).toContain(
      'Kept with the plan, where you and your team see it. Rana doesn’t.',
    );
    expect(textOf(host.querySelector('.actions'))).toBe('Keep it Stop meal plan');
  });

  it('says a coming plan will not start', async () => {
    const { host } = await render(
      mapPlan(clientPlan({ startDate: '2026-10-19', endDateExclusive: '2026-10-26' }), TODAY),
    );

    expect(textOf(host.querySelector('[data-effect]'))).toBe(
      'It won’t start on Mon 19 Oct, and its days come free for another meal plan.',
    );
  });

  it('asks why before anything is sent', async () => {
    const { fixture, host, stop, closed } = await render();

    press(host, 'Stop meal plan');
    await settle(fixture);
    expect(textOf(host)).toContain('Say why, so it is on record.');
    expect(document.activeElement?.getAttribute('name')).toBe('reason');

    fill(host, 'Why are you stopping it?', 'x'.repeat(501));
    press(host, 'Stop meal plan');
    await settle(fixture);
    expect(textOf(host)).toContain('Keep the reason to 500 characters or fewer.');
    expect(stop).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
  });

  it('stops it with the reason, trimmed, and the version the page read', async () => {
    const stop = vi.fn(() =>
      of(
        clientPlan({
          status: 'Cancelled',
          version: 2,
          stoppedAtUtc: '2026-10-10T06:00:00Z',
          stopReason: 'Wrong dates',
        }),
      ),
    );
    const { fixture, host, closed, dirty } = await render(RUNNING(), stop);

    fill(host, 'Why are you stopping it?', '  Wrong dates  ');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);
    press(host, 'Stop meal plan');
    await settle(fixture);

    expect(stop).toHaveBeenCalledWith('client-1', 'cplan-1', { reason: 'Wrong dates', version: 1 });
    expect(closed).toHaveLength(1);
    expect(closed[0]!.already).toBe(false);
    expect(closed[0]!.row).toMatchObject({
      state: 'stopped',
      stopReason: 'Wrong dates',
      version: 2,
    });
  });

  it('counts a plan stopped elsewhere meanwhile as stopped', async () => {
    const stop = vi.fn(() => throwError(() => refused('nutrition_plan_already_cancelled')));
    const { fixture, host, closed } = await render(RUNNING(), stop);

    fill(host, 'Why are you stopping it?', 'Wrong dates');
    press(host, 'Stop meal plan');
    await settle(fixture);

    expect(closed).toEqual([{ row: { ...RUNNING(), state: 'stopped' }, already: true }]);
    expect(host.querySelector('.refusal')).toBeNull();
  });

  it('asks the page to read the plan again when it changed meanwhile, keeping the reason', async () => {
    const stop = vi.fn(() => throwError(() => refused('nutrition_plan_conflict')));
    const { fixture, host, closed, stale } = await render(RUNNING(), stop);

    fill(host, 'Why are you stopping it?', 'Wrong dates');
    press(host, 'Stop meal plan');
    await settle(fixture);

    expect(textOf(host.querySelector('.refusal'))).toBe(
      'This meal plan changed since the page read it. Close this and look at it again before you stop it.',
    );
    expect(stale).toHaveBeenCalledTimes(1);
    expect(closed).toEqual([]);
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Wrong dates');
  });

  it('keeps the plan on Keep it', async () => {
    const { fixture, host, stop, closed } = await render();

    press(host, 'Keep it');
    await settle(fixture);
    expect(closed).toEqual([null]);
    expect(stop).not.toHaveBeenCalled();
  });
});
