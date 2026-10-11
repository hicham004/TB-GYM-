import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
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
    loadIncrement: 2.5,
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
  suggestion: null,
};
const bench = {
  exerciseId: 'bench',
  exerciseName: 'Bench press',
  current: entry({ id: 'max-3', value: 80, exerciseId: 'bench' }),
  weekOneSet: null,
  earlier: [],
  suggestion: null,
};

/** Maya's week 2 top set, 130 kg for 3 at RPE 8 (86.3%), suggests 150.637 kg for the squat. */
const suggestingSquat = {
  ...squat,
  suggestion: {
    value: 150.637,
    unit: 'Kilogram',
    basis: {
      load: 130,
      repetitions: 3,
      rpe: 8,
      methodKey: 'RpeChart',
      methodVersion: '1.0',
      loggedSet: {
        setPerformanceId: 'set-9',
        weekNumber: 2,
        performedOn: '2026-09-30',
        sessionName: 'Lower A',
      },
    },
    explanation: 'Best logged set v1: …',
  },
};

async function render(
  options: {
    block?: ReturnType<typeof runningBlock>;
    read?: () => unknown;
    keep?: () => unknown;
  } = {},
) {
  const api = {
    getTrainingMaxes: vi.fn(options.read ?? (() => of(maxes([squat, bench])))),
    keepTrainingMax: vi.fn(options.keep ?? (() => of(maxes([squat, bench])))),
  };
  const toast = { show: vi.fn() };
  const csrf = { refresh: vi.fn(async () => undefined) };
  TestBed.configureTestingModule({
    imports: [ProgramMaxes],
    providers: [
      { provide: ClientProgramApi, useValue: api },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: UiToast, useValue: toast },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(ProgramMaxes);
  fixture.componentRef.setInput('block', blockCard(options.block ?? runningBlock(), context));
  fixture.componentRef.setInput('firstName', 'Maya');
  const update = vi.fn();
  fixture.componentInstance.update.subscribe(update);
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, update, toast, csrf };
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
    expect(update).toHaveBeenCalledWith(null);
  });

  it('says what the logged sets suggest for a lift, and opens the update on it', async () => {
    const { fixture, host, update } = await render({
      read: () => of(maxes([suggestingSquat, bench])),
    });

    const lifts = Array.from(host.querySelectorAll('.lift'));
    const suggestion = lifts[0].querySelector('.suggestion');
    // In the program's 2.5 kg steps; the exact 150.637 kg is in How it is worked out (R5.4c).
    expect(textOf(suggestion?.querySelector('.suggestion-head'))).toBe(
      'Logged sets suggest about 150 kg, up from 120 kg.',
    );
    expect(textOf(suggestion?.querySelector('.detail'))).toBe(
      'From 130 kg for 3 reps at RPE 8 on Wed 30 Sep, week 2.',
    );
    const how = suggestion?.querySelector('details.how');
    expect(textOf(how?.querySelector('summary'))).toBe('How it is worked out');
    expect(how?.hasAttribute('open')).toBe(false);
    expect(textOf(how?.querySelector('p'))).toBe('Best logged set v1: …');
    expect(lifts[1].querySelector('.suggestion')).toBeNull();
    // Nothing changed on its own: the max in use is still the one shown.
    expect(textOf(lifts[0].querySelector('.value'))).toBe('120 kg');

    const [review, keep] = Array.from(suggestion?.querySelectorAll('button') ?? []);
    expect(textOf(review)).toBe('Review the new weights');
    expect(textOf(keep)).toBe('Keep 120 kg');
    expect(review.getAttribute('aria-describedby')).toBe('suggestion-squat');
    review.click();
    await settle(fixture);

    expect(update).toHaveBeenCalledWith('squat');
  });

  it('keeps the max in use over a suggestion, and says so where the suggestion was', async () => {
    const keptSquat = {
      ...squat,
      kept: { suggestedValue: 150.637, unit: 'Kilogram', keptOn: '2026-10-01' },
    };
    const { fixture, host, api, toast, csrf } = await render({
      read: () => of(maxes([suggestingSquat, bench])),
      keep: () => of(maxes([keptSquat, bench])),
    });

    press(host, 'Keep 120 kg');
    await settle(fixture);

    expect(csrf.refresh).toHaveBeenCalled();
    expect(api.keepTrainingMax).toHaveBeenCalledWith('block-lean', {
      exerciseId: 'squat',
      loggedSetId: 'set-9',
    });
    expect(host.querySelector('.suggestion')).toBeNull();
    const kept = query(host, '#kept-squat');
    expect(textOf(kept)).toBe(
      'You kept 120 kg on Thu 1 Oct, when logged sets suggested about 150 kg.',
    );
    // The buttons the coach pressed are gone; the line that replaced them has the focus.
    expect(document.activeElement).toBe(kept);
    expect(toast.show).toHaveBeenCalledWith('Kept Back squat at 120 kg.', { tone: 'success' });
    // Nothing else is read: the answer already carries the maxes.
    expect(api.getTrainingMaxes).toHaveBeenCalledTimes(1);
  });

  it('says when a newer set moved the suggestion on, and reads the maxes again', async () => {
    const { fixture, host, api } = await render({
      read: () => of(maxes([suggestingSquat, bench])),
      keep: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: {
                code: 'training_max_suggestion_changed',
                message: 'Back squat has a newer logged set than the one you looked at.',
              },
            }),
        ),
    });

    press(host, 'Keep 120 kg');
    await settle(fixture);

    expect(textOf(query(host, '.problem[role="alert"]'))).toBe(
      'Maya logged a newer set since you looked, so the suggested max changed. Look at the new suggestion, then try again.',
    );
    expect(api.getTrainingMaxes).toHaveBeenCalledTimes(2);
  });

  it('brings the suggestion into view when the coach arrived to review maxes', async () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      const { fixture, host } = await render({ read: () => of(maxes([suggestingSquat])) });
      expect(scrollIntoView).not.toHaveBeenCalled();

      fixture.componentRef.setInput('reveal', true);
      await settle(fixture);

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(query(host, '#suggestion-squat'));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('suggests nothing on a program that is over', async () => {
    const { host } = await render({
      block: cancelledBlock(),
      read: () => of(maxes([suggestingSquat])),
    });

    expect(host.querySelector('.suggestion')).toBeNull();
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
