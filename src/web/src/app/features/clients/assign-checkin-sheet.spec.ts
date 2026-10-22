import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CheckInAssignmentDetail,
  CheckInFormPage,
  CheckInFormSummary,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  chooseDay,
  chooseOption,
  formSummary,
  press,
  selectField,
  selectOptionsOf,
  selectShows,
  settle,
} from '../../../testing/dom';
import { AssignCheckIn, type WriteForm } from './assign-checkin-sheet';

const TODAY = '2026-10-22';

function form(overrides: Partial<CheckInFormSummary> = {}): CheckInFormSummary {
  return {
    id: 'form-1',
    title: 'Weekly check-in',
    description: null,
    status: 'Published',
    isArchived: false,
    currentVersionNumber: 2,
    draftVersionId: null,
    latestPublishedVersionId: 'version-2',
    latestPublishedVersionNumber: 2,
    questionCount: 6,
    latestPublishedAtUtc: '2026-10-21T22:30:00Z',
    version: 3,
    ...overrides,
  };
}

const DRAFT = {
  status: 'Draft',
  latestPublishedVersionId: null,
  latestPublishedVersionNumber: null,
  latestPublishedAtUtc: null,
  draftVersionId: 'version-9',
} as const;

const ASSIGNED = { assignment: { id: 'assignment-1' } } as unknown as CheckInAssignmentDetail;

async function render(
  list: (skip: number) => Observable<CheckInFormPage>,
  assign: () => Observable<CheckInAssignmentDetail> = () => of(ASSIGNED),
) {
  const api = {
    listCheckInForms: vi.fn((skip = 0) => list(skip)),
    assignCheckIn: vi.fn(assign),
  };
  await TestBed.configureTestingModule({
    imports: [AssignCheckIn],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AssignCheckIn);
  for (const [name, value] of Object.entries({
    clientId: 'client-1',
    firstName: 'Maya',
    today: TODAY,
    firstDay: 1,
    locale: 'en-US',
    timeZone: 'Asia/Beirut',
  })) {
    fixture.componentRef.setInput(name, value);
  }
  const closed: unknown[] = [];
  const write: WriteForm[] = [];
  const denied: string[] = [];
  const dirty: boolean[] = [];
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.write.subscribe((value) => write.push(value));
  fixture.componentInstance.denied.subscribe((value) => denied.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  await settle(fixture);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, closed, write, dirty, denied };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const page = (items: CheckInFormSummary[], total = items.length): CheckInFormPage => ({
  items,
  total,
});

describe('Assign a check-in (audit A14b)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('offers only the published forms in use, each with its size and publish day', async () => {
    const { fixture, host } = await render(() =>
      of(
        page([
          form(),
          form({ id: 'form-2', title: 'Monthly review', ...DRAFT }),
          form({ id: 'form-3', title: 'Old intake', isArchived: true }),
          form({ id: 'form-4', title: 'Recovery', questionCount: 1 }),
        ]),
      ),
    );

    expect(selectShows(host, 'Check-in form')).toBe('Choose…');
    expect(await selectOptionsOf(fixture, host, 'Check-in form')).toEqual([
      'Weekly check-in',
      'Recovery',
    ]);
    const field = selectField(host, 'Check-in form');
    field.querySelector<HTMLButtonElement>('button.trigger')!.click();
    await settle(fixture);
    expect(Array.from(field.querySelectorAll('.option-hint')).map((hint) => textOf(hint))).toEqual([
      '6 questions · published Thu 22 Oct',
      '1 question · published Thu 22 Oct',
    ]);
  });

  it('chooses the only form there is for the coach, which is not typed work', async () => {
    const { fixture, host, dirty } = await render(() => of(page([form()])));

    expect(selectShows(host, 'Check-in form')).toBe('Weekly check-in');
    expect(dirty.at(-1)).toBe(false);
    await chooseDay(fixture, host, 'Due', '2026-10-25');
    expect(dirty.at(-1)).toBe(true);
  });

  it('assigns the form’s published version, due on the day chosen, and hands it back', async () => {
    const { fixture, host, api, closed } = await render(() =>
      of(
        page([
          form(),
          form({ id: 'form-4', title: 'Recovery', latestPublishedVersionId: 'version-7' }),
        ]),
      ),
    );

    await chooseOption(fixture, host, 'Check-in form', 'Recovery');
    await chooseDay(fixture, host, 'Due', '2026-10-29');
    press(host, 'Assign check-in');
    await settle(fixture);

    expect(api.assignCheckIn).toHaveBeenCalledWith('client-1', {
      formVersionId: 'version-7',
      dueDate: '2026-10-29',
    });
    expect(closed).toEqual([ASSIGNED]);
  });

  it('refuses without a form or a day, says why under each and focuses the first', async () => {
    const { fixture, host, api } = await render(() =>
      of(page([form(), form({ id: 'form-4', title: 'Recovery' })])),
    );

    press(host, 'Assign check-in');
    await settle(fixture);

    expect(api.assignCheckIn).not.toHaveBeenCalled();
    expect(textOf(host)).toContain('Choose the form to send.');
    expect(textOf(host)).toContain('Choose the day it is due.');
    expect(textOf(formSummary(host))).toBe('Check what is marked above.');
    expect(document.activeElement).toBe(
      selectField(host, 'Check-in form').querySelector('button.trigger'),
    );
  });

  it('never offers a day before the workspace’s today', async () => {
    const { fixture, host } = await render(() => of(page([form()])));

    await expect(chooseDay(fixture, host, 'Due', '2026-10-21')).rejects.toThrow('cannot be chosen');
    await chooseDay(fixture, host, 'Due', TODAY);
  });

  it('keeps what was chosen and says the server’s words when it refuses', async () => {
    const { fixture, host, closed, denied } = await render(
      () => of(page([form()])),
      () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { title: 'This check-in form is archived.' },
            }),
        ),
    );

    await chooseDay(fixture, host, 'Due', '2026-10-25');
    press(host, 'Assign check-in');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe('This check-in form is archived.');
    expect(closed).toEqual([]);
    expect(denied).toEqual([]);
    expect(selectShows(host, 'Check-in form')).toBe('Weekly check-in');
  });

  it('hands a refusal for closed check-ins to the page with its reason (CHK-011)', async () => {
    const { fixture, host, closed, denied } = await render(
      () => of(page([form()])),
      () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              error: {
                title: 'Check-ins are not available for this client.',
                accessReason: 'Expired',
              },
            }),
        ),
    );

    await chooseDay(fixture, host, 'Due', '2026-10-25');
    press(host, 'Assign check-in');
    await settle(fixture);

    expect(denied).toEqual(['Expired']);
    expect(closed).toEqual([]);
  });

  it('with only drafts, says to publish one and opens the library', async () => {
    const { host, write } = await render(() => of(page([form({ ...DRAFT })])));

    const why = host.querySelector('[data-no-forms]')!;
    expect([textOf(why.querySelector('strong')), textOf(why.querySelector('span'))]).toEqual([
      'No check-in form is ready to send yet.',
      'Publish one of your drafts in Check-in forms, then come back to assign it to Maya.',
    ]);
    expect(host.querySelector('app-entry-actions')).toBeNull();
    press(host, 'Open check-in forms');
    expect(write).toEqual(['library']);
  });

  it('with no form at all, invites writing the first one', async () => {
    const { host, write } = await render(() => of(page([form({ isArchived: true })])));

    press(host, 'Write a check-in form');
    expect(write).toEqual(['new']);
  });

  it('reads every page of a long library, and reads again after a failure', async () => {
    let failed = false;
    const first = Array.from({ length: 100 }, (_, index) =>
      form({ id: `form-${index}`, title: `Form ${index}`, ...DRAFT }),
    );
    const { fixture, host, api } = await render((skip) => {
      if (!failed) {
        failed = true;
        return throwError(() => new HttpErrorResponse({ status: 500 }));
      }
      // A form renamed between the two reads comes again on the second page; it is offered once.
      return skip === 0
        ? of(page(first, 101))
        : of(page([first[99], form({ id: 'form-last', title: 'Last one' })], 101));
    });

    expect(textOf(host.querySelector('[role="alert"]'))).toContain(
      'Your check-in forms could not be loaded.',
    );
    press(host, 'Try again');
    await settle(fixture);
    await settle(fixture);

    expect(api.listCheckInForms.mock.calls.map((call) => call[0])).toEqual([0, 0, 100]);
    expect(selectShows(host, 'Check-in form')).toBe('Last one');
    expect(await selectOptionsOf(fixture, host, 'Check-in form')).toEqual(['Last one']);
    // Try again took itself away: focus went to what the forms brought.
    expect(document.activeElement).toBe(
      selectField(host, 'Check-in form').querySelector('button.trigger'),
    );
  });
});
