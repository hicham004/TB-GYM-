import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { press, settle } from '../../../testing/dom';
import { UndeliveredNotices } from './undelivered-notices';
import { UndeliveredNoticesApi } from './undelivered-notices-api';
import type { UndeliveredNotice, UndeliveredNoticePage } from './undelivered-notices.models';

function notice(id: string, overrides: Partial<UndeliveredNotice> = {}): UndeliveredNotice {
  return {
    id,
    kind: 'PaymentRequired',
    channel: 'Email',
    scheduledAtUtc: '2026-10-12T06:00:00Z',
    attemptCount: 6,
    deadLetteredAtUtc: '2026-10-12T12:12:00Z',
    failureCode: 'notification-attempts-exhausted',
    ...overrides,
  };
}

const page = (items: UndeliveredNotice[], total = items.length): UndeliveredNoticePage => ({
  items,
  total,
});

async function render(getPage: (skip: number, take: number) => Observable<UndeliveredNoticePage>) {
  const api = { getPage: vi.fn(getPage) };
  await TestBed.configureTestingModule({
    imports: [UndeliveredNotices],
    providers: [
      provideRouter([]),
      { provide: UndeliveredNoticesApi, useValue: api },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantId: 'tenant-1', role: 'Owner' }),
        },
      },
      {
        provide: WorkspaceCalendar,
        useValue: {
          today: signal('2026-10-22'),
          timeZone: signal('Asia/Beirut'),
          resolveToday: () => Promise.resolve('2026-10-22'),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(UndeliveredNotices);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const rowParts = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.notice')).map((row) =>
    ['.about', 'app-status-pill', '.reason', '.facts', '.reference'].map((part) =>
      textOf(row.querySelector(part)),
    ),
  );

describe('Settings › Undelivered notices (audit INV-4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T09:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('lists each notice: what it was about, how, for whom, why it stopped, when and its reference', async () => {
    const { host, api } = await render(() =>
      of(
        page([
          notice('01a16213-e736-7ba5-be56-a3b8b5ef1d3e'),
          notice('01a16214-1024-7eae-8baa-3c2f0078a4d0', {
            kind: 'ClientWorkoutNote',
            channel: 'InApp',
            scheduledAtUtc: '2026-10-11T22:30:00Z',
            attemptCount: 1,
            deadLetteredAtUtc: '2026-10-11T22:30:05Z',
            failureCode: 'notification-payload-invalid',
          }),
        ]),
      ),
    );

    expect(api.getPage).toHaveBeenCalledExactlyOnceWith(0, 25);
    const heading = host.querySelector<HTMLElement>('h1')!;
    expect(textOf(heading)).toBe('Undelivered notices');
    expect(document.activeElement).toBe(heading);
    expect(textOf(host.querySelector('.lede'))).toBe(
      'Notices TB Gym gave up delivering in your coaching space. Who each one was for and what it said stay private, even from you.',
    );
    expect(textOf(host.querySelector('[data-summary]'))).toBe(
      '2 notices TB Gym gave up on, newest first.',
    );
    expect(rowParts(host)).toEqual([
      [
        'A plan waiting for payment',
        'Email',
        'Tried 6 times without getting through.',
        'For a client · Due Mon 12 Oct, 9:00 AM · Given up Mon 12 Oct, 3:12 PM',
        'Reference 01a16213-e736-7ba5-be56-a3b8b5ef1d3e',
      ],
      [
        'A client’s note on a workout',
        'In the app',
        'TB Gym couldn’t put this notice together.',
        // 22:30 UTC on Sunday is Monday in the workspace.
        'For you or a coach · Due Mon 12 Oct, 1:30 AM · Given up Mon 12 Oct, 1:30 AM',
        'Reference 01a16214-1024-7eae-8baa-3c2f0078a4d0',
      ],
    ]);
    // A list read, never a control: nothing to press but Show more when there is more.
    expect(host.querySelectorAll('.notices button')).toHaveLength(0);
    expect(host.querySelector('.more')).toBeNull();
  });

  it('says every notice got through while none was given up', async () => {
    const { host } = await render(() => of(page([])));

    expect(textOf(host.querySelector('[data-none] h2'))).toBe('Every notice got through');
    expect(textOf(host.querySelector('[data-none] p'))).toBe(
      'If TB Gym ever has to give up on one, it is listed here with what went wrong.',
    );
    expect(host.querySelector('.notices')).toBeNull();
  });

  it('says the list couldn’t be loaded and tries again when asked', async () => {
    let calls = 0;
    const { fixture, host, api } = await render(() =>
      calls++ === 0 ? throwError(() => new Error('offline')) : of(page([notice('n-1')])),
    );

    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'Undelivered notices couldn’t be loaded.',
    );
    press(host, 'Try again');
    await settle(fixture);

    expect(api.getPage).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll('.notice')).toHaveLength(1);
  });

  it('pages by the rows the server sent, never shows a notice twice, and focuses the first the last page brought', async () => {
    const first = Array.from({ length: 25 }, (_, index) => notice(`n-${index + 1}`));
    let reads = 0;
    const { fixture, host, api } = await render((skip, take) => {
      reads++;
      if (reads === 1) return of(page(first, 27));
      // n-0, given up between the two reads, moved every row down one, so n-25 comes again; it is
      // then read from the top.
      return skip === 25
        ? of(page([notice('n-25'), notice('n-26'), notice('n-27')], 28))
        : of(page([notice('n-0')].slice(0, take), 28));
    });
    expect(host.querySelectorAll('.notice')).toHaveLength(25);

    press(host, 'Show more notices');
    await settle(fixture);

    expect(api.getPage.mock.calls).toEqual([
      [0, 25],
      [25, 25],
      [0, 1],
    ]);
    const ids = Array.from(host.querySelectorAll<HTMLElement>('.notice')).map(
      (row) => row.dataset['notice'],
    );
    expect(ids).toHaveLength(28);
    expect(new Set(ids).size).toBe(28);
    expect(ids[0]).toBe('n-0');
    expect(ids.slice(-2)).toEqual(['n-26', 'n-27']);
    // Every row the server has is read, so Show more is gone and focus is on the first new notice.
    expect(host.querySelector('.more')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-notice="n-26"]'));
    expect(textOf(host.querySelector('[data-summary]'))).toBe(
      '28 notices TB Gym gave up on, newest first.',
    );
  });

  it('keeps Show more and says so when the next page cannot be read', async () => {
    const first = Array.from({ length: 25 }, (_, index) => notice(`n-${index + 1}`));
    const { fixture, host } = await render((skip) =>
      skip === 0 ? of(page(first, 30)) : throwError(() => new Error('offline')),
    );

    press(host, 'Show more notices');
    await settle(fixture);

    expect(textOf(host.querySelector('.more [role="alert"]'))).toBe(
      'More notices couldn’t be loaded.',
    );
    expect(host.querySelectorAll('.notice')).toHaveLength(25);
    expect(textOf(host.querySelector('.more button'))).toBe('Show more notices');
  });
});
