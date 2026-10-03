import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ClientEnrollment } from '../../core/api/api.models';
import type { TrainingMesocycleView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, press, query, settle, tick } from '../../../testing/dom';
import { ProgramAssign } from './program-assign';

function plan(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return {
    id: 'enrollment-1',
    productName: 'Online Coaching',
    offerLabel: '12 weeks',
    startDate: '2026-09-01',
    endDateExclusive: '2026-11-24',
    lastActiveDate: '2026-11-23',
    storedStatus: 'Active',
    effectiveStatus: 'Active',
    features: ['Training'],
    ...overrides,
  } as ClientEnrollment;
}

const templates = {
  total: 3,
  items: [
    {
      id: 'template-1',
      name: 'Full Body Reset',
      isArchived: false,
      versions: [
        { id: 'fbr-1', versionNumber: 1, isPublished: true, weekCount: 4 },
        { id: 'fbr-2', versionNumber: 2, isPublished: true, weekCount: 6 },
      ],
    },
    {
      id: 'template-2',
      name: 'Hypertrophy',
      isArchived: false,
      versions: [{ id: 'hyp-1', versionNumber: 1, isPublished: true, weekCount: 8 }],
    },
    {
      id: 'template-3',
      name: 'Old plan',
      isArchived: true,
      versions: [{ id: 'old-1', versionNumber: 1, isPublished: true, weekCount: 4 }],
    },
  ],
};

/** Back squat is worked out from a training max; the leg curl has its own weight. */
const version = {
  id: 'fbr-2',
  weeks: [
    {
      sessions: [
        {
          exercises: [
            {
              exerciseId: 'squat',
              exerciseName: 'Back squat',
              sets: [{ loadStrategy: 'PercentageWorkingMax' }],
            },
            { exerciseId: 'curl', exerciseName: 'Leg curl', sets: [{ loadStrategy: 'Direct' }] },
          ],
        },
      ],
    },
  ],
};

const recorded = {
  total: 1,
  items: [
    {
      id: 'max-1',
      exerciseId: 'squat',
      exerciseName: 'Back squat',
      kind: 'CoachWorkingMax',
      value: 100,
      unit: 'Kilogram',
    },
  ],
};

const assigned = {
  id: 'block-new',
  name: 'Full Body Reset',
  startDate: '2026-10-01',
} as TrainingMesocycleView;

interface Options {
  enrollments?: ClientEnrollment[];
  api?: Record<string, unknown>;
  today?: string;
}

async function render(options: Options = {}) {
  const api = {
    listProgramTemplates: vi.fn(() => of(templates)),
    listStrengthMaxes: vi.fn(() => of(recorded)),
    getProgramTemplateVersion: vi.fn(() => of(version)),
    assignClientMesocycle: vi.fn(() => of(assigned)),
    ...options.api,
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    imports: [ProgramAssign],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: csrf },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(ProgramAssign);
  fixture.componentRef.setInput('clientId', 'client-1');
  fixture.componentRef.setInput('firstName', 'Maya');
  fixture.componentRef.setInput('today', options.today ?? '2026-10-01');
  fixture.componentRef.setInput('enrollments', options.enrollments ?? [plan()]);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf, closed };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Assign program', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('offers each program once at its newest version, with the plan it goes under', async () => {
    const { host } = await render();

    const options = Array.from(query<HTMLSelectElement>(host, 'select').options).map(textOf);
    expect(options).toEqual([
      'Choose a program…',
      'Full Body Reset · 6 weeks',
      'Hypertrophy · 8 weeks',
    ]);
    // One plan needs no choosing: it is told, not asked.
    expect(textOf(host.querySelector('.plan-caption'))).toBe('Plan');
    expect(textOf(host.querySelector('.plan-line span:last-child'))).toBe(
      'Online Coaching · 12 weeks · 1 Sep – 23 Nov 2026',
    );
    expect(host.querySelectorAll('select')).toHaveLength(1);
  });

  it('starts today, and keeps the settings most coaches never touch on one line', async () => {
    const { host } = await render();

    expect(query<HTMLInputElement>(host, 'input[type="date"]').value).toBe('2026-10-01');
    expect(textOf(host.querySelector('.loads-title'))).toBe('Load settings');
    expect(textOf(host.querySelector('.loads-now'))).toBe('kg · rounded to the nearest 2.5');
    expect(host.querySelector<HTMLDetailsElement>('.loads')?.open).toBe(false);
  });

  it('starts on the day a plan that has not begun starts', async () => {
    const { host } = await render({ enrollments: [plan({ startDate: '2026-10-12' })] });

    expect(query<HTMLInputElement>(host, 'input[type="date"]').value).toBe('2026-10-12');
  });

  it('asks which plan when there are several that include training', async () => {
    const { host } = await render({
      enrollments: [
        plan(),
        plan({
          id: 'enrollment-2',
          startDate: '2026-11-24',
          endDateExclusive: '2027-02-16',
          lastActiveDate: '2027-02-15',
        }),
      ],
    });

    const selects = host.querySelectorAll('select');
    expect(selects).toHaveLength(2);
    expect(Array.from(selects[0].options).map(textOf)).toEqual([
      'Choose a plan…',
      'Online Coaching · 12 weeks · 1 Sep – 23 Nov 2026',
      'Online Coaching · 12 weeks · 24 Nov – 15 Feb 2027',
    ]);
    // The one running today is chosen already.
    expect(selects[0].value).toBe('enrollment-1');
  });

  it('asks for the training max of each exercise worked out from one, starting from the recorded max', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Program', 'fbr-2');
    await settle(fixture);

    expect(api['getProgramTemplateVersion']).toHaveBeenCalledWith('fbr-2');
    const fieldset = query<HTMLElement>(host, 'fieldset.maxes');
    expect(textOf(fieldset.querySelector('legend'))).toBe('Training maxes');
    expect(Array.from(fieldset.querySelectorAll('label')).map(textOf)).toEqual(['Back squat']);
    expect(query<HTMLInputElement>(fieldset, 'input').value).toBe('100');
    expect(textOf(fieldset)).toContain('Your recorded training max');
    // Typing a number of their own says so.
    fill(host, 'Back squat', '105');
    await settle(fixture);
    expect(textOf(fieldset)).toContain('Entered now');
    // A row with nothing yet says that, rather than "entered".
    fill(host, 'Back squat', '');
    await settle(fixture);
    expect(textOf(fieldset)).toContain('Nothing recorded yet');
    expect(textOf(fieldset)).not.toContain('Entered now');
  });

  it('never carries a max across kilograms and pounds', async () => {
    const { fixture, host } = await render();
    fill(host, 'Program', 'fbr-2');
    await settle(fixture);

    tick(host, 'lb');
    await settle(fixture);

    expect(query<HTMLInputElement>(host, 'fieldset.maxes input').value).toBe('');
    expect(textOf(host.querySelector('.unit'))).toBe('lb');
    expect(textOf(host.querySelector('.loads-now'))).toBe('lb · rounded to the nearest 2.5');
  });

  it('says where the program would run, and warns when that is past the end of the plan', async () => {
    const { fixture, host } = await render();
    fill(host, 'Program', 'fbr-2');
    await settle(fixture);

    expect(textOf(host.querySelector('.run'))).toBe('Runs Thu 1 Oct – Wed 11 Nov');
    expect(host.querySelector('.warn-text')).toBeNull();

    fill(host, 'Start date', '2026-10-20');
    await settle(fixture);

    expect(textOf(host.querySelector('.run'))).toBe('Runs Tue 20 Oct – Mon 30 Nov');
    expect(textOf(host.querySelector('.warn-text'))).toBe(
      'That is past the end of Maya’s plan on Mon 23 Nov 2026. Start earlier, or choose a plan that covers it.',
    );
  });

  it('refuses an empty form field by field, moves focus to the first, and sends nothing', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Assign program');
    await settle(fixture);

    expect(api['assignClientMesocycle']).not.toHaveBeenCalled();
    expect(textOf(host)).toContain('Choose a program.');
    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Check the fields marked above.');
    const program = query<HTMLSelectElement>(host, 'select');
    expect(program.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(program);
  });

  it('asks for a max before it assigns a program that needs one', async () => {
    const { fixture, host, api } = await render({
      api: { listStrengthMaxes: vi.fn(() => of({ total: 0, items: [] })) },
    });
    fill(host, 'Program', 'fbr-2');
    await settle(fixture);

    press(host, 'Assign program');
    await settle(fixture);

    expect(api['assignClientMesocycle']).not.toHaveBeenCalled();
    expect(textOf(host)).toContain('Enter the training max for Back squat.');
  });

  it('assigns with the plan, program, date, settings and maxes, under one key per exact payload', async () => {
    const failure = new HttpErrorResponse({ status: 503 });
    const { fixture, host, api, csrf, closed } = await render({
      api: {
        assignClientMesocycle: vi
          .fn()
          .mockReturnValueOnce(throwError(() => failure))
          .mockReturnValue(of(assigned)),
      },
    });
    fill(host, 'Program', 'fbr-2');
    await settle(fixture);

    press(host, 'Assign program');
    await settle(fixture);
    // The server could not be reached: nothing is lost, and the sheet says so.
    expect(closed).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('.problem-text'))).toBe('The program could not be assigned.');

    press(host, 'Assign program');
    await settle(fixture);

    const calls = (api['assignClientMesocycle'] as ReturnType<typeof vi.fn>).mock.calls;
    expect(csrf.refresh).toHaveBeenCalled();
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('client-1');
    expect(calls[1][1]).toEqual({
      enrollmentId: 'enrollment-1',
      templateVersionId: 'fbr-2',
      startDate: '2026-10-01',
      kind: 'Primary',
      loadUnit: 'Kilogram',
      loadIncrement: 2.5,
      loadRoundingMode: 'Nearest',
      workingMaxes: [
        { exerciseId: 'squat', strengthMaxRecordId: 'max-1', value: 100, unit: 'Kilogram' },
      ],
      idempotencyKey: expect.any(String),
    });
    // The retry of the same payload is the same request, so it cannot assign twice.
    expect(calls[1][1].idempotencyKey).toBe(calls[0][1].idempotencyKey);
    expect(closed).toHaveBeenCalledWith(assigned);
  });

  it('is a new request when anything about it changed', async () => {
    const failure = new HttpErrorResponse({ status: 503 });
    const { fixture, host, api } = await render({
      api: {
        assignClientMesocycle: vi
          .fn()
          .mockReturnValueOnce(throwError(() => failure))
          .mockReturnValueOnce(throwError(() => failure))
          .mockReturnValue(of(assigned)),
      },
    });
    fill(host, 'Program', 'fbr-2');
    await settle(fixture);
    press(host, 'Assign program');
    await settle(fixture);

    fill(host, 'Back squat', '110');
    await settle(fixture);
    press(host, 'Assign program');
    await settle(fixture);

    const calls = (api['assignClientMesocycle'] as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1][1].idempotencyKey).not.toBe(calls[0][1].idempotencyKey);
    expect(calls[1][1].workingMaxes[0]).toMatchObject({ value: 110, strengthMaxRecordId: null });
  });

  it('says an overlap in coach words and stays open', async () => {
    const overlap = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'mesocycle_overlap',
        message: 'The client already has an overlapping primary mesocycle.',
      },
    });
    const { fixture, host, closed } = await render({
      api: { assignClientMesocycle: vi.fn(() => throwError(() => overlap)) },
    });
    fill(host, 'Program', 'hyp-1');
    await settle(fixture);

    press(host, 'Assign program');
    await settle(fixture);

    expect(textOf(host.querySelector('.problem-text'))).toBe(
      'Maya already has a program on those dates. Choose other dates, or change the other program first.',
    );
    expect(closed).not.toHaveBeenCalled();
  });

  it('has nothing to assign when the plan does not include training', async () => {
    const { host } = await render({ enrollments: [plan({ features: ['Messaging'] })] });

    expect(textOf(host)).toContain('Maya has no plan that includes training');
    expect(host.querySelector('button[type="submit"]')).toBeNull();
  });

  it('points to the program builder when no program is published yet', async () => {
    const { host } = await render({
      api: { listProgramTemplates: vi.fn(() => of({ total: 0, items: [] })) },
    });

    expect(textOf(host.querySelector('.notice'))).toContain('You have no published programs yet.');
    expect(host.querySelector('.notice a')?.getAttribute('href')).toBe('/training/programs');
  });

  it('offers the next page of programs when there are more', async () => {
    const more = vi.fn(() =>
      of({
        total: 3,
        items: [
          {
            id: 'template-9',
            name: 'Zone 2 Base',
            isArchived: false,
            versions: [{ id: 'z2-1', versionNumber: 1, isPublished: true, weekCount: 3 }],
          },
        ],
      }),
    );
    const first = vi
      .fn()
      .mockReturnValueOnce(of({ total: 4, items: templates.items }))
      .mockImplementation(more);
    const { fixture, host } = await render({ api: { listProgramTemplates: first } });

    press(host, 'Show more programs');
    await settle(fixture);

    expect(first).toHaveBeenLastCalledWith(3);
    expect(Array.from(query<HTMLSelectElement>(host, 'select').options).map(textOf)).toContain(
      'Zone 2 Base · 3 weeks',
    );
  });

  it('can be closed without assigning', async () => {
    const { fixture, host, closed } = await render();

    press(host, 'Not now');
    await settle(fixture);

    expect(closed).toHaveBeenCalledWith(null);
  });
});
