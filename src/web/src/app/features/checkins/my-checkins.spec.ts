import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CheckInAssignmentListItem,
  CheckInAssignmentResponseSummary,
  CheckInResponseDetail,
} from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { announced, button, focusedId, press, settle } from '../../../testing/dom';
import { MyCheckIns } from './my-checkins';

function item(
  id: string,
  dueDate: string,
  response: Partial<CheckInAssignmentResponseSummary> | null = null,
): CheckInAssignmentListItem {
  return {
    assignment: {
      id,
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formVersionId: 'version-1',
      formVersionNumber: 2,
      clientProfileId: 'client-1',
      dueDate,
      assignedAtUtc: '2026-09-01T09:00:00Z',
      assignedByUserId: 'coach-1',
    },
    response:
      response === null
        ? null
        : {
            responseId: `r-${id}`,
            status: 'Submitted',
            submittedDate: dueDate,
            submittedAtUtc: `${dueDate}T18:00:00Z`,
            reviewedAtUtc: null,
            isLate: false,
            ...response,
          },
  };
}

const page = (total: number, ...items: CheckInAssignmentListItem[]) =>
  of({ clientProfileId: 'client-1', total, items });

function nextDetail(answered: number): CheckInResponseDetail {
  const questions = ['a', 'b', 'c', 'd'].map((key, index) => ({
    id: `q-${key}`,
    questionKey: key.repeat(32),
    order: index + 1,
    questionType: 'LongText' as const,
    prompt: `Question ${key}`,
    helpText: null,
    isRequired: false,
    scaleMinimum: null,
    scaleMaximum: null,
    scaleStep: null,
    options: [],
  }));
  return {
    assignment: item('due', '2026-09-27').assignment,
    version: {
      id: 'version-1',
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formDescription: 'Takes two minutes. Be honest.',
      versionNumber: 2,
      status: 'Published',
      derivedFromVersionId: null,
      publishedAtUtc: null,
      publishedByUserId: null,
      questions,
      version: 1,
    },
    response:
      answered === 0
        ? null
        : {
            id: 'r',
            assignmentId: 'due',
            clientProfileId: 'client-1',
            status: 'Draft',
            submittedAtUtc: null,
            submittedDate: null,
            isLate: false,
            reviewedAtUtc: null,
            reviewedByUserId: null,
            version: 3,
            answers: questions.slice(0, answered).map((question) => ({
              questionId: question.id,
              questionKey: question.questionKey,
              questionType: question.questionType,
              textValue: 'yes',
              numericValue: null,
              choices: [],
            })),
          },
  };
}

async function render(api: Partial<Record<keyof ApiClient, unknown>> = {}) {
  const selectedTenantId = signal<string | null>('tenant-1');
  const client = {
    listOwnCheckInAssignments: vi.fn(() => page(1, item('due', '2026-09-27'))),
    getOwnCheckInResponse: vi.fn(() => of(nextDetail(0))),
    getOwnCoach: vi.fn(() => of({ name: 'Lea Haddad' })),
    ...api,
  };
  await TestBed.configureTestingModule({
    imports: [MyCheckIns],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: client },
      { provide: TenantStore, useValue: { selectedTenantId } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(MyCheckIns);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    host,
    client,
    selectedTenantId,
    settle: () => settle(fixture),
    read: () => (host.textContent ?? '').replace(/\s+/g, ' '),
  };
}

describe('MyCheckIns', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('makes the check-in due first the one action, with its size and the coach’s note', async () => {
    const { host, read } = await render();

    const hero = host.querySelector('.hero')!;
    expect(hero.querySelector('h2')?.textContent?.trim()).toBe('Weekly check-in');
    expect(read()).toContain('Due Sun 27 Sep');
    expect(read()).toContain('4 questions');
    expect(read()).toContain('Takes two minutes. Be honest.');
    expect(read()).toContain('From Lea Haddad');
    expect(hero.querySelector('app-avatar')?.textContent?.trim()).toBe('LH');
    const start = hero.querySelector('a.hero-action')!;
    expect(start.textContent?.trim()).toBe('Start check-in');
    expect(start.getAttribute('href')).toBe('/checkins/me/due');
    // A client reads the date, not the form's version number (R2.4c words decision).
    expect(read()).not.toContain('v2');
    expect(focusedId()).toBe('');
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('continues a started check-in and shows how far it got', async () => {
    const { host, read } = await render({
      listOwnCheckInAssignments: vi.fn(() =>
        page(1, item('due', '2026-09-27', { status: 'Draft', submittedDate: null })),
      ),
      getOwnCheckInResponse: vi.fn(() => of(nextDetail(1))),
    });

    expect(read()).toContain('Started · due Sun 27 Sep');
    expect(read()).toContain('4 questions · , 1 answered');
    expect(host.querySelector('a.hero-action')?.textContent?.trim()).toBe('Continue check-in');
    expect(host.querySelector<HTMLElement>('.hero-progress span')?.style.inlineSize).toBe('25%');
  });

  it('lists the other open check-ins after the one due first', async () => {
    const { host } = await render({
      listOwnCheckInAssignments: vi.fn(() =>
        page(2, item('later', '2026-10-04'), item('due', '2026-09-27')),
      ),
    });

    expect(host.querySelector('a.hero-action')?.getAttribute('href')).toBe('/checkins/me/due');
    const also = host.querySelector('[aria-labelledby="open-heading"] a.row')!;
    expect(also.getAttribute('href')).toBe('/checkins/me/later');
    expect(also.textContent?.replace(/\s+/g, ' ')).toContain('Due Sun 4 Oct');
  });

  it('invites rather than showing an empty list when nothing is due', async () => {
    const { host, read } = await render({
      listOwnCheckInAssignments: vi.fn(() => page(0)),
    });

    expect(read()).toContain("You're all caught up");
    expect(host.querySelector('app-empty-state a')?.getAttribute('href')).toBe('/');
  });

  it('keeps sent check-ins collapsed, with status and lateness as plain facts', async () => {
    const sent = [
      item('s1', '2026-09-20', { status: 'Submitted' }),
      item('s2', '2026-09-13', { status: 'Reviewed', isLate: true, submittedDate: '2026-09-14' }),
      item('s3', '2026-09-06', { status: 'Reviewed' }),
      item('s4', '2026-08-30', { status: 'Reviewed' }),
    ];
    const { host, read, settle } = await render({
      listOwnCheckInAssignments: vi.fn(() => page(4, ...sent)),
    });

    const rows = () => Array.from(host.querySelectorAll('[aria-labelledby="sent-heading"] a.row'));
    expect(rows()).toHaveLength(3);
    expect(rows()[0].getAttribute('href')).toBe('/checkins/me/s1');
    expect(rows()[0].textContent).toContain('Waiting for your coach');
    expect(rows()[1].textContent?.replace(/\s+/g, ' ')).toContain(
      'Sent Mon 14 Sep · , after the due date',
    );
    expect(rows()[1].textContent).toContain('Reviewed');
    expect(read()).toContain("You're all caught up");

    // Looks like a button, full width, so it reads as pressable rather than as a stray line of text.
    const more = button(host, 'Show 1 more');
    expect(more.classList.contains('tb-button--outlined')).toBe(true);
    expect(more.classList.contains('more')).toBe(true);
    press(host, 'Show 1 more');
    await settle();
    expect(rows()).toHaveLength(4);
  });

  it('loads older check-ins page by page once the history is open', async () => {
    const listOwnCheckInAssignments = vi
      .fn()
      .mockReturnValueOnce(
        page(
          5,
          item('s1', '2026-09-20', {}),
          item('s2', '2026-09-13', {}),
          item('s3', '2026-09-06', {}),
          item('s4', '2026-08-30', {}),
        ),
      )
      .mockReturnValueOnce(page(5, item('s4', '2026-08-30', {}), item('s5', '2026-08-23', {})));
    const { host, settle } = await render({ listOwnCheckInAssignments });

    press(host, 'Show 1 more');
    await settle();
    press(host, 'Show older check-ins');
    await settle();

    expect(listOwnCheckInAssignments).toHaveBeenLastCalledWith(4, 50);
    expect(host.querySelectorAll('[aria-labelledby="sent-heading"] a.row')).toHaveLength(5);
    expect(host.textContent).not.toContain('Show older check-ins');
  });

  it('says why check-ins are closed instead of showing an empty page', async () => {
    const { host, read } = await render({
      listOwnCheckInAssignments: vi.fn(() =>
        throwError(
          () => new HttpErrorResponse({ status: 403, error: { accessReason: 'NoEntitlement' } }),
        ),
      ),
    });

    expect(read()).toContain('Check-ins are closed');
    expect(read()).toContain('Check-ins are not in your plan. Ask your coach.');
    expect(host.querySelector('app-empty-state')).toBeNull();
  });

  it('reports a failure as one, and retries it', async () => {
    const listOwnCheckInAssignments = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(page(1, item('due', '2026-09-27')));
    const { host, read, settle } = await render({ listOwnCheckInAssignments });

    expect(announced(host)).toContain('Your check-ins could not be loaded.');
    press(host, 'Try again');
    await settle();
    expect(read()).toContain('Start check-in');
  });

  it('starts over for another workspace, without the previous one’s check-ins', async () => {
    const listOwnCheckInAssignments = vi
      .fn()
      .mockReturnValueOnce(page(1, item('due', '2026-09-27')))
      .mockReturnValueOnce(page(0));
    const { selectedTenantId, read, settle } = await render({ listOwnCheckInAssignments });

    expect(read()).toContain('Start check-in');
    selectedTenantId.set('tenant-2');
    await settle();

    expect(listOwnCheckInAssignments).toHaveBeenCalledTimes(2);
    expect(read()).not.toContain('Start check-in');
    expect(read()).toContain("You're all caught up");
  });
});
