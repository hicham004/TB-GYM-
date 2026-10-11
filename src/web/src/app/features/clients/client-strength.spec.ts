import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BENCH,
  library,
  mayaMaxes,
  maxPage,
  maxView,
  SQUAT,
  squatHistory,
  TODAY,
  workspace,
} from '../../../testing/client-strength-fixtures';
import { profile } from '../../../testing/client-nutrition-fixtures';
import { fill, press, settle } from '../../../testing/dom';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { ClientStrength } from './client-strength';
import { ClientWorkspaceContext } from './client-workspace.context';

type Api = Partial<
  Record<
    'listStrengthMaxes' | 'recordStrengthMax' | 'getExerciseHistory' | 'searchExercises',
    ReturnType<typeof vi.fn>
  >
>;

async function render(api: Api = {}, tenant = signal('tenant-1')) {
  const calls: Api = {
    listStrengthMaxes: vi.fn(() => of(maxPage(mayaMaxes()))),
    recordStrengthMax: vi.fn(() => of(maxView({ id: 'new', value: 100, program: null }))),
    getExerciseHistory: vi.fn(() => of(squatHistory())),
    searchExercises: vi.fn(() => of(library([]))),
    ...api,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: calls },
      {
        provide: ClientWorkspaceContext,
        useValue: {
          clientId: signal('client-1'),
          profile: signal(profile()),
          workspace: signal(workspace()),
        },
      },
      { provide: WorkspaceCalendar, useValue: { resolveToday: () => Promise.resolve(TODAY) } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  });
  const fixture = TestBed.createComponent(ClientStrength);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, calls };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};
const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

describe('A client’s strength history', () => {
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

  it('reads every max once, a program’s beside the recorded ones', async () => {
    const { calls } = await render();
    expect(calls.listStrengthMaxes).toHaveBeenCalledTimes(1);
    expect(calls.listStrengthMaxes).toHaveBeenCalledWith('client-1', undefined, 0, 100, true);
  });

  it('shows each lift once: its training max, how it moved, and the tested max beside it', async () => {
    const { host } = await render();

    const lifts = Array.from(host.querySelectorAll('[data-lift]'));
    expect(lifts.map((item) => textOf(item.querySelector('.lift-name')))).toEqual([
      'Back Squat',
      'Deadlift',
      'Bench Press',
    ]);
    const squat = lifts[0];
    expect(textOf(squat.querySelector('.now'))).toBe('62.5 kg Training max');
    expect(textOf(squat.querySelector('.meta'))).toBe('Set Tue 15 Sep · +2.5 kg since Wed 5 Aug');
    expect(textOf(squat.querySelector('[data-also]'))).toBe('Tested 1RM 92.5 kg · Sun 20 Sep');
    expect(squat.querySelector('app-sparkline')).not.toBeNull();
    expect(textOf(squat.querySelector('app-sparkline'))).toContain(
      'Back Squat Training max has moved from 60 kg on Wed 5 Aug to 62.5 kg.',
    );
    // A lift with one max has nothing to compare, and no chart.
    expect(textOf(lifts[1].querySelector('.meta'))).toBe('Set Tue 15 Sep');
    expect(lifts[1].querySelector('app-sparkline')).toBeNull();
  });

  it('lists every max of a lift behind a closed disclosure, with where each came from', async () => {
    const { host } = await render();

    const history = host.querySelector<HTMLDetailsElement>('[data-lift] [data-history]')!;
    expect(history.open).toBe(false);
    expect(textOf(history.querySelector('summary'))).toBe('All 3 on record');
    expect(Array.from(history.querySelectorAll('.entry')).map((item) => textOf(item))).toEqual([
      'Sun 20 Sep 92.5 kg Tested 1RM Tested Tested after the deload week.',
      'Tue 15 Sep 62.5 kg Training max Lean & Strong · Phase 2, from week 1, typed',
      'Wed 5 Aug 60 kg Training max Lean & Strong · Phase 1, from week 1, typed',
    ]);
  });

  it('says there is no max on record yet, and what will fill the list', async () => {
    const { host } = await render({ listStrengthMaxes: vi.fn(() => of(maxPage([]))) });
    expect(textOf(host.querySelector('[data-empty]'))).toBe(
      'No max is on record for Rana yet. A program’s training maxes show here, and so does any you record.',
    );
  });

  it('reads on when there are more maxes than one page', async () => {
    const first = maxPage(mayaMaxes().slice(0, 3), 6);
    const second = maxPage(mayaMaxes().slice(3), 6);
    const listStrengthMaxes = vi
      .fn()
      .mockReturnValueOnce(of(first))
      .mockReturnValueOnce(of(second));
    const { host } = await render({ listStrengthMaxes });

    expect(listStrengthMaxes).toHaveBeenCalledTimes(2);
    expect(listStrengthMaxes).toHaveBeenLastCalledWith('client-1', undefined, 100, 100, true);
    expect(host.querySelectorAll('[data-lift]')).toHaveLength(3);
  });

  it('says they could not be read, and reads again when asked', async () => {
    const listStrengthMaxes = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(maxPage(mayaMaxes())));
    const { fixture, host } = await render({ listStrengthMaxes });

    expect(textOf(host.querySelector('[data-error]'))).toContain(
      'Their maxes could not be loaded.',
    );
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelectorAll('[data-lift]')).toHaveLength(3);
  });

  it('records a max from a lift’s row, thanks the coach, and reads the list again quietly', async () => {
    const listStrengthMaxes = vi
      .fn()
      .mockReturnValueOnce(of(maxPage(mayaMaxes())))
      .mockReturnValue(
        of(
          maxPage([
            maxView({
              id: 'new',
              value: 100,
              effectiveDate: TODAY,
              createdAtUtc: '2026-10-10T09:00:00Z',
            }),
            ...mayaMaxes(),
          ]),
        ),
      );
    const { fixture, host, calls } = await render({ listStrengthMaxes });

    const squat = host.querySelector('[data-lift]')!;
    press(squat, 'Record a max');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('.tb-modal__title'))).toBe('Record a max for Back Squat');
    expect(
      sheet.querySelector<HTMLInputElement>(`input[name^="tb-exercise"][value="${SQUAT}"]`)!
        .checked,
    ).toBe(true);
    fill(sheet, 'Weight', '100');
    await settle(fixture);
    press(sheet, 'Record max');
    await settle(fixture);
    await settle(fixture);

    expect(calls.recordStrengthMax).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ exerciseId: SQUAT, kind: 'CoachWorkingMax', value: 100 }),
    );
    expect(toast()).toContain('Back Squat — Training max 100 kg recorded.');
    expect(listStrengthMaxes).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(host.querySelector('[data-skeleton], app-skeleton')).toBeNull();
    expect(textOf(host.querySelector('[data-lift] .now'))).toBe('100 kg Training max');
  });

  it('reads the list again, quietly, each time the program page changes something (R5.4c)', async () => {
    // Update maxes above gave the squat a new training max: the card must not keep the old one.
    const listStrengthMaxes = vi
      .fn()
      .mockReturnValueOnce(of(maxPage(mayaMaxes())))
      .mockReturnValue(
        of(
          maxPage([
            maxView({
              id: 'applied',
              value: 65,
              effectiveDate: TODAY,
              createdAtUtc: '2026-10-10T09:00:00Z',
            }),
            ...mayaMaxes(),
          ]),
        ),
      );
    const { fixture, host } = await render({ listStrengthMaxes });
    expect(textOf(host.querySelector('[data-lift] .now'))).toBe('62.5 kg Training max');

    fixture.componentRef.setInput('changes', 1);
    await settle(fixture);
    await settle(fixture);

    expect(listStrengthMaxes).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-skeleton], app-skeleton')).toBeNull();
    expect(textOf(host.querySelector('[data-lift] .now'))).toBe('65 kg Training max');
    // The same count again is no change.
    fixture.componentRef.setInput('changes', 1);
    await settle(fixture);
    expect(listStrengthMaxes).toHaveBeenCalledTimes(2);
  });

  it('records a max for any lift from the top, offering the lifts with maxes first', async () => {
    const { fixture, host } = await render();

    press(host.querySelector('.head')!, 'Record a max');
    await settle(fixture);

    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('.tb-modal__title'))).toBe('Record a max for Rana');
    const offered = Array.from(sheet.querySelectorAll('input[name^="tb-exercise"]')).map(
      (item) => (item as HTMLInputElement).value,
    );
    expect(offered).toEqual([SQUAT, BENCH, 'ex-deadlift']);
  });

  it('asks before closing a record sheet that holds typed work', async () => {
    const { fixture, host } = await render();

    press(host.querySelector('.head')!, 'Record a max');
    await settle(fixture);
    fill(dialog()!, 'Weight', '100');
    await settle(fixture);
    press(dialog()!, 'Not now');
    await settle(fixture);
    await settle(fixture);

    expect(textOf(dialog())).toContain('Close without saving? What you typed will be lost.');
    press(dialog()!.querySelector('app-confirm')!, 'Keep editing');
    await settle(fixture);
    await settle(fixture);
    expect(textOf(dialog())).toContain('Record max');
  });

  it('opens how they have done on a lift from its row, read from the server', async () => {
    const { fixture, host, calls } = await render();

    press(host.querySelector('[data-lift]')!, 'How they have done');
    await settle(fixture);
    await settle(fixture);

    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('.tb-modal__title'))).toBe('How Rana has done on Back Squat');
    expect(calls.getExerciseHistory).toHaveBeenCalledWith('client-1', SQUAT, 0, 50);
    expect(textOf(sheet.querySelector('[data-best]'))).toContain('Best estimated max 70 kg');
  });

  it('opens how they have done on another exercise from the top, on a choice of lifts', async () => {
    const { fixture, host, calls } = await render();

    press(host.querySelector('.head')!, 'Another exercise');
    await settle(fixture);

    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('.tb-modal__title'))).toBe(
      'How Rana has done on an exercise',
    );
    expect(sheet.querySelector('app-exercise-picker')).not.toBeNull();
    expect(calls.getExerciseHistory).not.toHaveBeenCalled();
  });
});
