import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CheckInFormPage, CheckInFormSummary } from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { press, settle } from '../../../testing/dom';
import { CheckInForms } from './checkin-forms';

function form(overrides: Partial<CheckInFormSummary> = {}): CheckInFormSummary {
  return {
    id: 'form-1',
    title: 'Weekly check-in',
    description: 'Takes two minutes.',
    status: 'Published',
    isArchived: false,
    currentVersionNumber: 1,
    draftVersionId: null,
    latestPublishedVersionId: 'version-1',
    latestPublishedVersionNumber: 1,
    questionCount: 6,
    latestPublishedAtUtc: '2026-10-21T22:30:00Z',
    version: 2,
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

const page = (items: CheckInFormSummary[], total = items.length): CheckInFormPage => ({
  items,
  total,
});

async function render(list: (skip: number) => Observable<CheckInFormPage>) {
  const api = { listCheckInForms: vi.fn((skip = 0) => list(skip)) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'checkins/forms', component: CheckInForms }]),
      { provide: ApiClient, useValue: api },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      {
        // Beirut's clock: 22:30 UTC on the 21st is the 22nd in the workspace.
        provide: WorkspaceCalendar,
        useValue: {
          today: signal('2026-10-22'),
          timeZone: signal('Asia/Beirut'),
          resolveToday: () => Promise.resolve('2026-10-22'),
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/checkins/forms', CheckInForms);
  await settle(harness.fixture);
  return { harness, host: harness.routeNativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const cardParts = (cards: ParentNode) =>
  Array.from(cards.querySelectorAll('.card')).map((card) =>
    [
      'app-status-pill',
      '.count',
      '.card-name',
      '.card-description',
      '.note',
      '.card-meta > span:last-child',
    ].map((part) => textOf(card.querySelector(part))),
  );

describe('Check-in forms (audit A14b)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows each form as a card that opens it, archived ones folded away', async () => {
    const { host } = await render(() =>
      of(
        page([
          form(),
          form({
            id: 'form-2',
            title: 'Monthly review',
            description: null,
            ...DRAFT,
            questionCount: 3,
          }),
          form({ id: 'form-3', title: 'Old intake', isArchived: true }),
          form({ id: 'form-4', title: 'Recovery', draftVersionId: 'version-5', questionCount: 4 }),
        ]),
      ),
    );

    expect(textOf(host.querySelector('h1'))).toBe('Check-in forms');
    expect(textOf(host.querySelector('.lede'))).toBe(
      '3 forms, 2 ready to assign. Write the questions once, then assign the form from a client’s Check-ins tab.',
    );
    expect(cardParts(host.querySelector('.forms > .cards')!)).toEqual([
      [
        'Ready to assign',
        '6 questions',
        'Weekly check-in',
        'Takes two minutes.',
        '',
        'Published Thu 22 Oct',
      ],
      ['Draft', '3 questions', 'Monthly review', '', '', 'Publish it to assign it to clients'],
      [
        'Ready to assign',
        '4 questions',
        'Recovery',
        'Takes two minutes.',
        'Changes not published yet',
        'Published Thu 22 Oct',
      ],
    ]);
    // The whole card is one link, named by the form, to the form's own page.
    expect(
      Array.from(host.querySelectorAll<HTMLAnchorElement>('.forms > .cards a.stretched')).map(
        (link) => [textOf(link), link.getAttribute('href')],
      ),
    ).toEqual([
      ['Weekly check-in', '/checkins/forms/form-1'],
      ['Monthly review', '/checkins/forms/form-2'],
      ['Recovery', '/checkins/forms/form-4'],
    ]);
    const archived = host.querySelector<HTMLDetailsElement>('details.archived')!;
    expect(archived.open).toBe(false);
    expect(textOf(archived.querySelector('summary'))).toBe('Archived (1)');
    expect(cardParts(archived)).toEqual([
      ['Archived', '6 questions', 'Old intake', 'Takes two minutes.', '', 'Published Thu 22 Oct'],
    ]);
    // New form is the page's one action.
    expect(host.querySelector('a[href="/checkins/forms/new"]')?.textContent).toContain('New form');
  });

  it('invites an empty library to start from a weekly check-in', async () => {
    const { host } = await render(() => of(page([])));

    expect(textOf(host.querySelector('app-empty-state h2'))).toBe('No check-in forms yet');
    expect(textOf(host.querySelector('app-empty-state p'))).toContain(
      'Start from a weekly check-in, change any word you like, then assign it from a client’s Check-ins tab.',
    );
    const start = host.querySelector<HTMLAnchorElement>('app-empty-state a')!;
    expect([textOf(start), start.getAttribute('href')]).toEqual([
      'Start with a weekly check-in',
      '/checkins/forms/new?start=weekly',
    ]);
    expect(textOf(host.querySelector('.lede'))).toBe(
      'Write the questions once, then assign the form from a client’s Check-ins tab.',
    );
  });

  it('says every form is archived rather than inviting a first one', async () => {
    const { host } = await render(() => of(page([form({ isArchived: true })])));

    expect(host.querySelector('app-empty-state')).toBeNull();
    expect(textOf(host.querySelector('.all-archived'))).toBe(
      'Every form is archived. Write a new one, or open an archived form below to restore it.',
    );
    expect(host.querySelector('details.archived')).not.toBeNull();
  });

  it('says the forms could not be loaded, and reads them again on Try again', async () => {
    let reads = 0;
    const { host, harness, api } = await render(() =>
      ++reads === 1 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(page([form()])),
    );

    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'Your check-in forms could not be loaded.',
    );
    press(host, 'Try again');
    await settle(harness.fixture);

    expect(api.listCheckInForms).toHaveBeenCalledTimes(2);
    expect(cardParts(host.querySelector('.forms > .cards')!).length).toBe(1);
  });

  it('shows more forms past the first page, never one twice', async () => {
    const first = Array.from({ length: 100 }, (_, index) =>
      form({ id: `form-${index}`, title: `Form ${String(index).padStart(3, '0')}` }),
    );
    const { host, harness, api } = await render((skip) =>
      skip === 0
        ? of(page(first, 102))
        : of(page([first[99], form({ id: 'form-100' }), form({ id: 'form-101' })], 102)),
    );

    // Part of a long library says no count yet: the server's total counts archived forms too.
    expect(textOf(host.querySelector('.lede'))).toBe(
      'Write the questions once, then assign the form from a client’s Check-ins tab.',
    );
    press(host, 'Show more forms');
    await settle(harness.fixture);

    expect(api.listCheckInForms).toHaveBeenLastCalledWith(100, 100);
    expect(host.querySelectorAll('.forms > .cards .card').length).toBe(102);
    expect(
      Array.from(host.querySelectorAll('button')).some((button) =>
        /Show more/.test(button.textContent ?? ''),
      ),
    ).toBe(false);
    // Show more went with the last page: focus moved to the first form it brought.
    expect(document.activeElement?.getAttribute('href')).toBe('/checkins/forms/form-100');
    expect(textOf(host.querySelector('.lede'))).toContain('102 forms, 102 ready to assign.');
  });

  it('pages by the rows the server sent, so a form renamed between reads never stalls Show more', async () => {
    const first = Array.from({ length: 100 }, (_, index) =>
      form({ id: `form-${index}`, title: `Form ${String(index).padStart(3, '0')}` }),
    );
    // A teammate created a form sorting first: the second page starts with a row already shown.
    const { host, harness, api } = await render((skip) =>
      skip === 0 ? of(page(first, 102)) : of(page([first[99], form({ id: 'form-101' })], 102)),
    );

    press(host, 'Show more forms');
    await settle(harness.fixture);

    expect(api.listCheckInForms).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('.forms > .cards .card').length).toBe(101);
    expect(
      Array.from(host.querySelectorAll('button')).some((button) =>
        /Show more/.test(button.textContent ?? ''),
      ),
    ).toBe(false);
  });

  it('says every form is archived only once every page is read', async () => {
    const archived = Array.from({ length: 100 }, (_, index) =>
      form({ id: `form-${index}`, title: `Archived ${index}`, isArchived: true }),
    );
    const { host, harness } = await render((skip) =>
      skip === 0 ? of(page(archived, 101)) : of(page([form({ id: 'form-active' })], 101)),
    );

    expect(host.querySelector('.all-archived')).toBeNull();
    press(host, 'Show more forms');
    await settle(harness.fixture);
    expect(host.querySelectorAll('.forms > .cards .card').length).toBe(1);
    expect(host.querySelector('.all-archived')).toBeNull();
  });
});
