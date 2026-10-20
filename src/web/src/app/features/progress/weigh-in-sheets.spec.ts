import { HttpErrorResponse } from '@angular/common/http';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, press, settle } from '../../../testing/dom';
import {
  dateCorrection,
  mayaWeighIns,
  observation,
  progressView,
  TODAY,
  weightHistory,
} from '../../../testing/progress-fixtures';
import { ProgressEntriesApi } from './progress-entries-api';
import { weighInRows, type Audience } from './progress-entries.models';
import { CorrectWeight, LogWeight, MoveWeighIn, WeighInChanges } from './weigh-in-sheets';

const client: Audience = { coach: false, firstName: null, locale: 'en' };
const coach: Audience = { coach: true, firstName: 'Maya', locale: 'en' };

type Api = Partial<Record<keyof ProgressEntriesApi, ReturnType<typeof vi.fn>>>;

async function render<T>(
  component: Type<T>,
  inputs: Record<string, unknown>,
  api: Api = {},
  tenant = signal('tenant-1'),
) {
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [
      { provide: ProgressEntriesApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries({ audience: client, today: TODAY, ...inputs })) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, tenant };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Chooses a radio (a unit, a reason) by the words beside it. */
function choose(host: ParentNode, words: string) {
  const label = Array.from(host.querySelectorAll('label')).find(
    (candidate) => textOf(candidate) === words,
  );
  const radio = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`No choice reads "${words}".`);
  radio.click();
}

const refusal = (status: number, code: string, title = 'Refused') =>
  new HttpErrorResponse({ status, error: { code, title } });

const row = (date = '2026-10-09') =>
  weighInRows(progressView(mayaWeighIns()), client).find((item) => item.date === date)!;

describe('Log weight', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('saves a weight for today and leaves the day to the server', async () => {
    const saved = observation({ measurementDate: TODAY });
    const recordWeight = vi.fn(() => of(saved));
    const { fixture, host } = await render(LogWeight, {}, { recordWeight });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    fill(host, 'Weight', '80.2');
    await settle(fixture);
    press(host, 'Save weight');
    await settle(fixture);

    expect(recordWeight).toHaveBeenCalledWith(null, {
      value: 80.2,
      unit: 'Kilogram',
      measurementDate: null,
    });
    expect(closed).toHaveBeenCalledWith(saved);
  });

  it('begins in the unit the client saved and sends the unit chosen', async () => {
    const recordWeight = vi.fn(() => of(observation()));
    const { fixture, host } = await render(LogWeight, { startUnit: 'Pound' }, { recordWeight });

    expect(
      host.querySelector<HTMLInputElement>('input[type="radio"][value="Pound"]')!.checked,
    ).toBe(true);
    fill(host, 'Weight', '176');
    await settle(fixture);
    press(host, 'Save weight');
    await settle(fixture);
    expect(recordWeight).toHaveBeenLastCalledWith(
      null,
      expect.objectContaining({ value: 176, unit: 'Pound' }),
    );
  });

  it('records for a client when a coach is the one logging', async () => {
    const recordWeight = vi.fn(() => of(observation()));
    const { fixture, host } = await render(
      LogWeight,
      { audience: coach, clientId: 'client-9' },
      { recordWeight },
    );

    expect(textOf(host.querySelector('p.muted'))).toBe('Recorded as a coach’s entry for Maya.');
    fill(host, 'Weight', '81');
    await settle(fixture);
    press(host, 'Save weight');
    await settle(fixture);
    expect(recordWeight).toHaveBeenCalledWith('client-9', expect.objectContaining({ value: 81 }));
  });

  it('says in words what is wrong before anything is sent, and sends nothing', async () => {
    const recordWeight = vi.fn(() => of(observation()));
    const { fixture, host } = await render(LogWeight, {}, { recordWeight });

    press(host, 'Save weight');
    await settle(fixture);
    expect(textOf(host)).toContain('Enter a weight.');
    expect(textOf(host)).toContain('Check the fields marked above.');
    expect(document.activeElement?.getAttribute('name')).toBe('value');

    fill(host, 'Weight', '12');
    await settle(fixture);
    expect(textOf(host)).toContain('Weight has to be between 20 and 500 kg.');
    press(host, 'Save weight');
    await settle(fixture);
    expect(recordWeight).not.toHaveBeenCalled();
  });

  it('says a day already has a weight, and offers to correct it rather than adding a second', async () => {
    const recordWeight = vi.fn(() => of(observation()));
    const logged = observation({ measurementDate: TODAY, enteredValue: 80.2 });
    const { fixture, host } = await render(
      LogWeight,
      { existing: new Map([[TODAY, logged]]) },
      { recordWeight },
    );
    const correct = vi.fn();
    fixture.componentInstance.correct.subscribe(correct);

    expect(textOf(host.querySelector('[data-already]'))).toContain(
      '80.2 kg is already logged for Sat 10 Oct.',
    );
    fill(host, 'Weight', '80.4');
    await settle(fixture);
    press(host, 'Correct that weight');
    await settle(fixture);

    expect(correct).toHaveBeenCalledWith(logged);
    expect(recordWeight).not.toHaveBeenCalled();
  });

  it('keeps what was typed and says why when the server refuses', async () => {
    const recordWeight = vi.fn(() => throwError(() => refusal(409, 'BodyweightDateAlreadyExists')));
    const { fixture, host } = await render(LogWeight, {}, { recordWeight });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    fill(host, 'Weight', '80.2');
    await settle(fixture);
    press(host, 'Save weight');
    await settle(fixture);

    expect(textOf(host.querySelector('.refusal'))).toBe(
      'A weight is already logged for Sat 10 Oct. Correct that one instead.',
    );
    expect(field(host).value).toBe('80.2');
    expect(closed).not.toHaveBeenCalled();
  });

  it('asks the page to read its list again when the server says it changed', async () => {
    const recordWeight = vi.fn(() => throwError(() => refusal(409, 'BodyweightVersionConflict')));
    const { fixture, host } = await render(LogWeight, {}, { recordWeight });
    const stale = vi.fn();
    fixture.componentInstance.stale.subscribe(stale);

    fill(host, 'Weight', '80.2');
    await settle(fixture);
    press(host, 'Save weight');
    await settle(fixture);

    expect(stale).toHaveBeenCalled();
    expect(textOf(host.querySelector('.refusal'))).toContain('changed while it was open');
  });

  it('tells the page it holds typed work, and stops when it is emptied', async () => {
    const { fixture, host } = await render(LogWeight, {}, {});
    const dirty = vi.fn();
    fixture.componentInstance.dirtyChange.subscribe(dirty);

    fill(host, 'Weight', '80');
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(true);
    fill(host, 'Weight', '');
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it('drops the answer when the workspace changes while it is being saved', async () => {
    const answer = new Subject<ReturnType<typeof observation>>();
    const recordWeight = vi.fn(() => answer);
    const { fixture, host, tenant } = await render(LogWeight, {}, { recordWeight });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    fill(host, 'Weight', '80.2');
    await settle(fixture);
    press(host, 'Save weight');
    await settle(fixture);
    tenant.set('tenant-2');
    answer.next(observation());
    answer.complete();
    await settle(fixture);

    expect(closed).not.toHaveBeenCalled();
  });

  it('closes without a weight when the person says not now', async () => {
    const { fixture, host } = await render(LogWeight, {}, {});
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(null);
  });
});

function field(host: HTMLElement) {
  return host.querySelector<HTMLInputElement>('input[name="value"]')!;
}

describe('Correct weight', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts from the number that was typed and asks what was wrong', async () => {
    const { host } = await render(CorrectWeight, { row: row() }, {});

    expect(textOf(host.querySelector('.about'))).toBe('80.2 kg Fri 9 Oct · Added by your coach');
    expect(field(host).value).toBe('80.2');
    expect(textOf(host)).toContain('Typed the wrong number');
    expect(textOf(host)).toContain('Misread the scale');
    expect(textOf(host)).toContain('Something else');
  });

  it('sends the new number with the reason and the version it was shown', async () => {
    const correctWeight = vi.fn(() => of(weightHistory()));
    const { fixture, host } = await render(CorrectWeight, { row: row() }, { correctWeight });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    fill(host, 'Correct weight', '79.4');
    choose(host, 'Typed the wrong number');
    await settle(fixture);
    press(host, 'Save correction');
    await settle(fixture);

    expect(correctWeight).toHaveBeenCalledWith(null, 'weight-2026-10-09', {
      value: 79.4,
      unit: 'Kilogram',
      reason: 'Typed the wrong number',
      version: 3,
    });
    expect(closed).toHaveBeenCalledWith(weightHistory());
  });

  it('asks for words when "Something else" is chosen and sends what was typed', async () => {
    const correctWeight = vi.fn(() => of(weightHistory()));
    const { fixture, host } = await render(CorrectWeight, { row: row() }, { correctWeight });

    fill(host, 'Correct weight', '79.4');
    choose(host, 'Something else');
    await settle(fixture);
    press(host, 'Save correction');
    await settle(fixture);
    expect(textOf(host)).toContain('Write what was wrong.');
    expect(correctWeight).not.toHaveBeenCalled();

    fill(host, 'What was wrong?', '  Scale was on carpet.  ');
    await settle(fixture);
    press(host, 'Save correction');
    await settle(fixture);
    expect(correctWeight).toHaveBeenCalledWith(
      null,
      'weight-2026-10-09',
      expect.objectContaining({ reason: 'Scale was on carpet.' }),
    );
  });

  it('refuses the number that is already saved, and no choice of reason', async () => {
    const correctWeight = vi.fn(() => of(weightHistory()));
    const { fixture, host } = await render(CorrectWeight, { row: row() }, { correctWeight });

    press(host, 'Save correction');
    await settle(fixture);
    expect(textOf(host)).toContain('That is the number already saved. Change it, or close this.');
    expect(textOf(host)).toContain('Choose what was wrong.');
    expect(correctWeight).not.toHaveBeenCalled();
  });

  it('starts in pounds when the weight was typed in pounds, and corrects in them', async () => {
    const correctWeight = vi.fn(() => of(weightHistory()));
    const { fixture, host } = await render(
      CorrectWeight,
      { row: row('2026-10-08') },
      { correctWeight },
    );

    expect(field(host).value).toBe('175.9');
    expect(
      host.querySelector<HTMLInputElement>('input[type="radio"][value="Pound"]')!.checked,
    ).toBe(true);
    fill(host, 'Correct weight', '176.4');
    choose(host, 'Misread the scale');
    await settle(fixture);
    press(host, 'Save correction');
    await settle(fixture);
    expect(correctWeight).toHaveBeenCalledWith(
      null,
      'weight-2026-10-08',
      expect.objectContaining({ value: 176.4, unit: 'Pound', reason: 'Misread the scale' }),
    );
  });

  it('keeps the form and says so when the entry changed while it was open', async () => {
    const correctWeight = vi.fn(() => throwError(() => refusal(409, 'BodyweightVersionConflict')));
    const { fixture, host } = await render(CorrectWeight, { row: row() }, { correctWeight });
    const stale = vi.fn();
    fixture.componentInstance.stale.subscribe(stale);

    fill(host, 'Correct weight', '79.4');
    choose(host, 'Typed the wrong number');
    await settle(fixture);
    press(host, 'Save correction');
    await settle(fixture);

    expect(stale).toHaveBeenCalled();
    expect(textOf(host.querySelector('.refusal'))).toContain('changed while it was open');
    expect(field(host).value).toBe('79.4');
  });
});

describe('Move to the right day', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('moves the weight to the chosen day with a reason, and trims what was typed', async () => {
    const moveWeight = vi.fn(() => of(dateCorrection()));
    const { fixture, host } = await render(
      MoveWeighIn,
      { row: row(), taken: new Set(['2026-10-09']) },
      { moveWeight },
    );
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    await chooseDay(fixture, host, 'Day it was really weighed', '2026-10-06');
    choose(host, 'Something else');
    await settle(fixture);
    fill(host, 'What was wrong?', '  Weighed on the road.  ');
    await settle(fixture);
    press(host, 'Move to that day');
    await settle(fixture);

    expect(moveWeight).toHaveBeenCalledWith(null, 'weight-2026-10-09', {
      measurementDate: '2026-10-06',
      reason: 'Weighed on the road.',
      version: 3,
    });
    expect(closed).toHaveBeenCalledWith(dateCorrection());
  });

  it('refuses the day it is on, and a reason that was not given, without asking the server', async () => {
    const moveWeight = vi.fn(() => of(dateCorrection()));
    const { fixture, host } = await render(MoveWeighIn, { row: row() }, { moveWeight });

    press(host, 'Move to that day');
    await settle(fixture);
    expect(textOf(host)).toContain('That is the day it is on now.');
    expect(textOf(host)).toContain('Choose what was wrong.');
    expect(moveWeight).not.toHaveBeenCalled();
  });

  it('says a day with a weight already cannot take another, before sending', async () => {
    const moveWeight = vi.fn(() => of(dateCorrection()));
    const { fixture, host } = await render(
      MoveWeighIn,
      { row: row(), taken: new Set(['2026-10-07', '2026-10-09']) },
      { moveWeight },
    );

    await chooseDay(fixture, host, 'Day it was really weighed', '2026-10-07');
    choose(host, 'Logged on the wrong day');
    await settle(fixture);
    press(host, 'Move to that day');
    await settle(fixture);
    expect(textOf(host)).toContain('A weight is already logged for that day.');
    expect(moveWeight).not.toHaveBeenCalled();
  });

  it('keeps the form open with the server’s answer when the day was taken meanwhile', async () => {
    const moveWeight = vi.fn(() => throwError(() => refusal(409, 'BodyweightDateAlreadyExists')));
    const { fixture, host } = await render(MoveWeighIn, { row: row() }, { moveWeight });

    await chooseDay(fixture, host, 'Day it was really weighed', '2026-10-06');
    choose(host, 'Logged on the wrong day');
    await settle(fixture);
    press(host, 'Move to that day');
    await settle(fixture);

    expect(textOf(host.querySelector('.refusal'))).toBe(
      'A weight is already logged for Tue 6 Oct. Correct that one instead.',
    );
    expect(textOf(host)).toContain('Move to that day');
  });
});

describe('Changes to a weight', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists what the number was before each correction, why, and when', async () => {
    const weightHistoryRead = vi.fn(() => of(weightHistory()));
    const { host } = await render(
      WeighInChanges,
      { row: row() },
      { weightHistory: weightHistoryRead },
    );

    expect(weightHistoryRead).toHaveBeenCalledWith(null, 'weight-2026-10-09');
    const item = host.querySelector('.changes li')!;
    expect(textOf(item.querySelector('strong'))).toBe('82.2 kg');
    expect(textOf(item)).toContain('Typed the wrong number');
    expect(textOf(item.querySelector('small'))).toMatch(/^Replaced /);
  });

  it('says so when the number was never corrected', async () => {
    const { host } = await render(
      WeighInChanges,
      { row: row() },
      { weightHistory: vi.fn(() => of(weightHistory({ previousValues: [] }))) },
    );

    expect(textOf(host)).toContain('has not been corrected');
    expect(host.querySelector('.changes')).toBeNull();
  });

  it('carries a moved weigh-in’s trail: the move and the correction made before it (CLIENT-14)', async () => {
    const { host } = await render(
      WeighInChanges,
      { row: row() },
      {
        weightHistory: vi.fn(() =>
          of(
            weightHistory({
              moves: [
                {
                  fromObservationId: 'weight-2026-10-08',
                  fromDate: '2026-10-08',
                  toDate: '2026-10-09',
                  reason: 'Logged on the wrong day',
                  movedByUserId: 'user-maya',
                  movedAtUtc: '2026-10-09T09:00:00Z',
                },
              ],
            }),
          ),
        ),
      },
    );

    const items = [...host.querySelectorAll('.changes li')];
    expect(items.map((item) => item.getAttribute('data-change'))).toEqual(['move', 'correction']);
    expect(textOf(items[0].querySelector('strong'))).toBe('Moved from Thu 8 Oct');
    expect(textOf(items[0])).toContain('Logged on the wrong day');
    expect(textOf(items[0].querySelector('small'))).toMatch(/^Moved Fri 9 Oct, /);
    expect(textOf(items[1].querySelector('strong'))).toBe('82.2 kg');
    expect(textOf(host)).not.toContain('has not been corrected');
  });

  it('says where an entry went when it was replaced', async () => {
    const { host } = await render(
      WeighInChanges,
      { row: row() },
      {
        weightHistory: vi.fn(() =>
          of(
            weightHistory({
              previousValues: [],
              void: {
                id: 'void-1',
                reason: 'Logged on the wrong day',
                voidedByUserId: 'user-maya',
                voidedAtUtc: '2026-10-10T08:00:00Z',
                replacementObservationId: 'weight-replacement',
              },
            }),
          ),
        ),
      },
    );

    expect(textOf(host)).toContain(
      'This entry was replaced on Sat 10 Oct: Logged on the wrong day',
    );
  });

  it('offers to try again when the changes could not be read', async () => {
    const weightHistoryRead = vi
      .fn()
      .mockReturnValueOnce(throwError(() => refusal(500, 'x')))
      .mockReturnValue(of(weightHistory()));
    const { fixture, host } = await render(
      WeighInChanges,
      { row: row() },
      { weightHistory: weightHistoryRead },
    );

    expect(textOf(host)).toContain('The changes could not be loaded.');
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelector('.changes li')).not.toBeNull();
  });
});

/** Opens the calendar of the date field named `label` and chooses a day, turning pages as a person would. */
async function chooseDay(
  fixture: Parameters<typeof settle>[0],
  scope: ParentNode,
  label: string,
  iso: string,
) {
  const dateField = Array.from(scope.querySelectorAll('app-date-field')).find(
    (candidate) => textOf(candidate.querySelector('label')) === label,
  )!;
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
