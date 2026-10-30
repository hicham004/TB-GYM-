import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { chooseDay, field, fill, formSummary, press, settle } from '../../../testing/dom';
import { TODAY } from '../../../testing/progress-fixtures';
import type { StartingWeight } from './progress-dashboard.models';
import { ProgressEntriesApi } from './progress-entries-api';
import type { Audience } from './progress-entries.models';
import { CorrectStart } from './start-weight-sheet';

const coach: Audience = { coach: true, firstName: 'Maya', locale: 'en' };

function start(overrides: Partial<StartingWeight> = {}): StartingWeight {
  return {
    id: 'start-1',
    date: '2026-09-02',
    valueKilograms: 79.4,
    enteredValue: 79.4,
    enteredUnit: 'Kilogram',
    version: 7,
    corrections: [],
    ...overrides,
  };
}

async function render(
  current: StartingWeight,
  api: Partial<Record<keyof ProgressEntriesApi, unknown>> = {},
) {
  await TestBed.configureTestingModule({
    imports: [CorrectStart],
    providers: [
      { provide: ProgressEntriesApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CorrectStart);
  fixture.componentRef.setInput('clientId', 'client-1');
  fixture.componentRef.setInput('audience', coach);
  fixture.componentRef.setInput('today', TODAY);
  fixture.componentRef.setInput('start', current);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function choose(host: ParentNode, words: string) {
  const label = Array.from(host.querySelectorAll('label')).find(
    (candidate) => textOf(candidate) === words,
  );
  const radio = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`No choice reads "${words}".`);
  radio.click();
}

describe('Correct start', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts from the start as it was typed and asks what was wrong', async () => {
    const { host } = await render(start());

    expect(textOf(host.querySelector('.about'))).toBe('79.4 kg Wed 2 Sep 2026');
    expect(field(host, 'Starting weight').value).toBe('79.4');
    expect(textOf(host)).toContain('Typed the wrong number');
    expect(textOf(host)).toContain('Weighed on another day');
    expect(textOf(host)).toContain('Something else');
    expect(textOf(host)).toContain(
      'The earlier start stays in its history. Weigh-ins are not changed.',
    );
    expect(host.querySelector('.earlier')).toBeNull();
  });

  it('sends the weight, the day and the reason with the version it was shown', async () => {
    const corrected = start({ valueKilograms: 97.4, enteredValue: 97.4, version: 8 });
    const correctStart = vi.fn(() => of(corrected));
    const { fixture, host } = await render(start(), { correctStart });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    fill(host, 'Starting weight', '97.4');
    await chooseDay(fixture, host, 'Day it was weighed', '2026-09-01');
    choose(host, 'Typed the wrong number');
    await settle(fixture);
    press(host, 'Save correction');
    await settle(fixture);

    expect(correctStart).toHaveBeenCalledWith('client-1', {
      value: 97.4,
      unit: 'Kilogram',
      measurementDate: '2026-09-01',
      reason: 'Typed the wrong number',
      version: 7,
    });
    expect(closed).toHaveBeenCalledWith(corrected);
  });

  it('refuses the start already saved and a missing reason without asking the server', async () => {
    const correctStart = vi.fn(() => of(start()));
    const { fixture, host } = await render(start(), { correctStart });

    press(host, 'Save correction');
    await settle(fixture);

    expect(textOf(host)).toContain(
      'That is the start already saved. Change the weight or the day, or close this.',
    );
    expect(textOf(host)).toContain('Choose what was wrong.');
    expect(correctStart).not.toHaveBeenCalled();
  });

  it('lists every earlier start with why it changed and who changed it', async () => {
    const { host } = await render(
      start({
        corrections: [
          {
            id: 'c-2',
            date: '2026-09-02',
            valueKilograms: 97.4,
            enteredValue: 97.4,
            enteredUnit: 'Kilogram',
            reason: 'Weighed on another day',
            byName: 'Lea Haddad',
            atUtc: '2026-10-08T09:00:00Z',
          },
          {
            id: 'c-1',
            date: '2026-09-01',
            valueKilograms: 79.4,
            enteredValue: 175,
            enteredUnit: 'Pound',
            reason: 'Typed the wrong number',
            byName: '',
            atUtc: '2026-10-01T09:00:00Z',
          },
        ],
      }),
    );

    const items = Array.from(host.querySelectorAll('.earlier li')).map(textOf);
    expect(textOf(host.querySelector('.earlier h3'))).toBe('Earlier starts');
    expect(items).toEqual([
      '97.4 kg Wed 2 Sep 2026 Weighed on another day Changed by Lea Haddad, Thu 8 Oct 2026',
      '175 lb Tue 1 Sep 2026 Typed the wrong number Changed Thu 1 Oct 2026',
    ]);
  });

  it('says a blocked client’s start cannot be corrected, in the Progress tab’s words', async () => {
    const correctStart = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403 })));
    const { fixture, host } = await render(start(), { correctStart });

    fill(host, 'Starting weight', '97.4');
    choose(host, 'Typed the wrong number');
    await settle(fixture);
    press(host, 'Save correction');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe(
      'Maya’s access is blocked, so their progress isn’t shown. Unblock them on Service & access.',
    );
  });

  it('asks the page to read the start again when it changed in another tab', async () => {
    const correctStart = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({ status: 409, error: { code: 'StartingWeightVersionConflict' } }),
      ),
    );
    const { fixture, host } = await render(start(), { correctStart });
    const stale = vi.fn();
    fixture.componentInstance.stale.subscribe(stale);

    fill(host, 'Starting weight', '97.4');
    choose(host, 'Typed the wrong number');
    await settle(fixture);
    press(host, 'Save correction');
    await settle(fixture);

    expect(stale).toHaveBeenCalledTimes(1);
    expect(textOf(formSummary(host))).toBe(
      'This entry changed while it was open. The list has been read again, so try once more.',
    );
  });
});
