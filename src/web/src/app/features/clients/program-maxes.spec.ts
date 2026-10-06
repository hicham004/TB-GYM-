import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { cancelledBlock, runningBlock } from '../../../testing/client-program-fixtures';
import { press, query, settle } from '../../../testing/dom';
import { ClientProgramApi } from './client-program-api';
import { blockCard, type ProgramContext } from './client-program.models';
import { ProgramMaxes } from './program-maxes';

const context: ProgramContext = { locale: 'en-US', today: '2026-10-01', firstName: 'Maya' };

const entry = (fields: Record<string, unknown>) => ({
  id: 'max-1',
  value: 100,
  unit: 'Kilogram',
  source: 'SavedMax',
  basis: null,
  effectiveFromWeek: 1,
  setOn: '2026-09-14',
  reason: 'Assignment training max.',
  ...fields,
});

function maxes(lifts: object[]) {
  return {
    mesocycleId: 'block-lean',
    version: 4,
    loadUnit: 'Kilogram',
    isClosed: false,
    maxes: lifts,
  };
}

const squat = {
  exerciseId: 'squat',
  exerciseName: 'Back squat',
  current: entry({
    id: 'max-2',
    value: 120,
    source: 'Typed',
    effectiveFromWeek: 3,
    setOn: '2026-09-28',
  }),
  weekOneSet: { repetitions: 5, rpe: 8, load: 80 },
  earlier: [entry({})],
};
const bench = {
  exerciseId: 'bench',
  exerciseName: 'Bench press',
  current: entry({ id: 'max-3', value: 80, exerciseId: 'bench' }),
  weekOneSet: null,
  earlier: [],
};

async function render(
  options: { block?: ReturnType<typeof runningBlock>; read?: () => unknown } = {},
) {
  const api = {
    getTrainingMaxes: vi.fn(options.read ?? (() => of(maxes([squat, bench])))),
  };
  TestBed.configureTestingModule({
    imports: [ProgramMaxes],
    providers: [
      { provide: ClientProgramApi, useValue: api },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(ProgramMaxes);
  fixture.componentRef.setInput('block', blockCard(options.block ?? runningBlock(), context));
  fixture.componentRef.setInput('firstName', 'Maya');
  const update = vi.fn();
  fixture.componentInstance.update.subscribe(update);
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, update };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the training maxes panel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('shows each lift with its number, where it came from and how it moved', async () => {
    const { host, api } = await render();

    expect(api.getTrainingMaxes).toHaveBeenCalledWith('block-lean');
    expect(textOf(query(host, 'h2'))).toBe('Training maxes');
    const lifts = Array.from(host.querySelectorAll('.lift'));
    expect(lifts).toHaveLength(2);
    expect(textOf(lifts[0].querySelector('.name'))).toBe('Back squat');
    expect(textOf(lifts[0].querySelector('.value'))).toBe('120 kg');
    expect(textOf(lifts[0].querySelector('.source'))).toBe('Typed by you · Mon 28 Sep');
    expect(Array.from(lifts[0].querySelectorAll('.detail')).map(textOf)).toEqual([
      'Up 20 kg from 100 kg',
      'Applies from week 3. Earlier weeks keep 100 kg.',
    ]);
    expect(textOf(lifts[1].querySelector('.source'))).toBe('From Maya’s recorded max · Mon 14 Sep');
    // The older max is kept, one tap away.
    expect(textOf(lifts[0].querySelector('summary'))).toBe('Earlier maxes 1');
    expect(textOf(lifts[0].querySelector('.history li'))).toContain('100 kg');
    expect(lifts[1].querySelector('details')).toBeNull();
  });

  it('marks itself filled, so the page makes room for it', async () => {
    const { host } = await render();

    expect(host.hasAttribute('data-filled')).toBe(true);
  });

  it('asks the page to open the update sheet, the one button on the panel', async () => {
    const { fixture, host, update } = await render();

    press(host, 'Update maxes for the coming weeks');
    await settle(fixture);

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('shows nothing for a program that works no weight out from a max', async () => {
    const { host } = await render({ read: () => of(maxes([])) });

    expect(host.querySelector('section')).toBeNull();
    expect(host.hasAttribute('data-filled')).toBe(false);
  });

  it('keeps the maxes of a program that is over, without a way to change them', async () => {
    const { host } = await render({ block: cancelledBlock() });

    expect(host.querySelector('.lift')).not.toBeNull();
    expect(textOf(query(host, '.note'))).toBe(
      'This program is over, so its maxes stay as they were.',
    );
    expect(Array.from(host.querySelectorAll('button')).map(textOf)).toEqual([]);
  });

  it('says when the maxes could not be read, and reads them again on request', async () => {
    let fail = true;
    const { fixture, host, api } = await render({
      read: () =>
        fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(maxes([bench])),
    });
    expect(textOf(query(host, '[role="alert"]'))).toBe('The training maxes could not be loaded.');

    fail = false;
    press(host, 'Try again');
    await settle(fixture);

    expect(api.getTrainingMaxes).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(textOf(query(host, '.name'))).toBe('Bench press');
  });

  it('reads the maxes again when the program changes, and not before', async () => {
    const { fixture, api } = await render();
    await settle(fixture);
    expect(api.getTrainingMaxes).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('block', blockCard(runningBlock({ version: 5 }), context));
    await settle(fixture);

    expect(api.getTrainingMaxes).toHaveBeenCalledTimes(2);
  });
});
