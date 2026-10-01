import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle } from '../../../testing/dom';
import { fakeClientAccess } from '../../../testing/today-fixtures';
import { historyItem, historyPage, programView } from '../../../testing/training-program-fixtures';
import { TrainingProgram } from './training-program';

async function render(
  api: Partial<Record<keyof ApiClient, unknown>> = {},
  access = fakeClientAccess(),
) {
  const selectedTenantId = signal<string | null>('tenant-1');
  const client = {
    getMyTrainingProgram: vi.fn(() => of(programView())),
    getMyWorkoutHistory: vi.fn(() => of(historyPage())),
    ...api,
  };
  await TestBed.configureTestingModule({
    imports: [TrainingProgram],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: client },
      { provide: TenantStore, useValue: { selectedTenantId } },
      { provide: ClientAccessStore, useValue: access },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(TrainingProgram);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  const textOf = (element: Element | null | undefined) =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** What a screen reader hears: decoration marked aria-hidden is left out. */
  const spoken = (element: Element | null | undefined) => {
    const copy = element?.cloneNode(true) as Element | undefined;
    copy?.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return textOf(copy);
  };
  return {
    host,
    client,
    selectedTenantId,
    settle: () => settle(fixture),
    textOf,
    spoken,
    read: () => textOf(host),
  };
}

describe('TrainingProgram', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('leads with the program, its week, what is done and missed, and today’s workout', async () => {
    const { host, read, textOf } = await render();

    expect(document.activeElement?.tagName).toBe('H1');
    const hero = host.querySelector('.hero')!;
    expect(textOf(hero.querySelector('.hero-eyebrow'))).toBe('Week 3 of 4');
    expect(textOf(hero.querySelector('h2'))).toBe('Strength Foundations');
    expect([...hero.querySelectorAll('.hero-chips li')].map(textOf)).toEqual([
      '4 of 6 sessions done',
      '1 missed',
      'Ends Sun 11 Oct',
    ]);
    expect(hero.querySelectorAll('.hero-weeks li')).toHaveLength(4);
    expect(textOf(hero.querySelector('.hero-today'))).toBe('Today: Lower A');
    const start = hero.querySelector('a.hero-action')!;
    expect(textOf(start)).toBe('Start workout');
    expect(start.getAttribute('href')).toBe('/training/today?sessionId=s6');
    // The engine's words stay in the engine (§6).
    expect(read()).not.toMatch(/mesocycle|snapshot|WorkoutThenScheduledDate/i);
  });

  it('lists this week with each session’s state and links only what the player can open', async () => {
    const { host, textOf, spoken } = await render();

    const week = host.querySelector('section[aria-labelledby="focus-heading"]')!;
    expect(textOf(week.querySelector('h2'))).toBe('This week');
    expect(textOf(week.querySelector('.block-meta'))).toBe('1 of 2 done');
    const sessions = [...week.querySelectorAll('.session')];
    expect(sessions.map(spoken)).toEqual([
      'Mon 28 Sep, Upper A, 4 exercises · 12 sets, Done',
      'Wed 30 Sep, Lower A, 4 exercises · 12 sets, Today',
    ]);
    expect(sessions.map((session) => session.tagName)).toEqual(['DIV', 'A']);
    expect(sessions[1].getAttribute('href')).toBe('/training/today?sessionId=s6');
  });

  it('keeps other weeks closed until asked, and says when a hidden week opens', async () => {
    const { host, settle, textOf, spoken } = await render();

    const rows = [...host.querySelectorAll('.weeks .week-row')];
    expect(rows.map(spoken)).toEqual([
      'Week 1, 2 of 2 done',
      'Week 2, 1 of 2 done · 1 missed',
      'Week 4, Opens Mon 5 Oct',
    ]);
    expect(rows.map((row) => row.tagName)).toEqual(['BUTTON', 'BUTTON', 'DIV']);
    expect(host.querySelector('#week-2')).toBeNull();

    const second = rows[1] as HTMLButtonElement;
    second.click();
    await settle();
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(second.getAttribute('aria-controls')).toBe('week-2');
    const body = host.querySelector('#week-2')!;
    expect([...body.querySelectorAll('.session-tag')].map(textOf)).toEqual(['Done', 'Missed']);

    second.click();
    await settle();
    expect(host.querySelector('#week-2')).toBeNull();
  });

  it('shows finished workouts with their records, a few at a time', async () => {
    const page = Array.from({ length: 5 }, (_, index) =>
      historyItem({ workoutExecutionId: `w${index}`, name: `Workout ${index}` }),
    );
    const getMyWorkoutHistory = vi.fn((skip: number) =>
      skip === 0
        ? of(historyPage(page, 10))
        : of(historyPage([historyItem({ workoutExecutionId: 'w-older', name: 'Older' })])),
    );
    const { host, settle, textOf, spoken } = await render({ getMyWorkoutHistory });

    const items = () => [...host.querySelectorAll('.history-item')];
    expect(items()).toHaveLength(4);
    expect(spoken(items()[0].querySelector('.history-meta'))).toBe(
      '12 of 12 sets, 4,250 kg lifted, 52 min',
    );
    expect(spoken(items()[0].querySelector('.records li'))).toBe(
      'Personal record: Bench press 62.5 kg × 6',
    );
    expect(textOf(items()[0].querySelector('.pr-badge'))).toBe('PR');

    const more = () => host.querySelector<HTMLButtonElement>('.history-more');
    more()!.click();
    await settle();
    expect(items()).toHaveLength(5);
    expect(getMyWorkoutHistory).toHaveBeenCalledTimes(1);

    more()!.click();
    await settle();
    expect(getMyWorkoutHistory).toHaveBeenLastCalledWith(10);
    expect(textOf(items()[5].querySelector('strong'))).toBe('Older');
    expect(more()).toBeNull();
  });

  it('names the program only on a workout from another one, and invites the first workout', async () => {
    const { host, spoken } = await render({
      getMyWorkoutHistory: vi.fn(() =>
        of(historyPage([historyItem({ programName: 'Base Block', durationSeconds: 0 })])),
      ),
    });
    expect(spoken(host.querySelector('.history-meta'))).toBe(
      '12 of 12 sets, 4,250 kg lifted, Base Block',
    );

    TestBed.resetTestingModule();
    const empty = await render({ getMyWorkoutHistory: vi.fn(() => of(historyPage([]))) });
    expect(
      empty.textOf(empty.host.querySelector('section[aria-labelledby="history-heading"]')),
    ).toBe(
      'Finished workouts Workouts you finish will appear here, with any personal records you set.',
    );
  });

  it('explains closed training and sends nothing else', async () => {
    const { host, read } = await render({
      getMyTrainingProgram: vi.fn(() =>
        of(programView({ isAllowed: false, accessReason: 'Expired', program: null })),
      ),
    });
    expect(read()).toContain('Training is not available');
    expect(read()).toContain('Your coaching plan has ended. Contact your coach.');
    expect(host.querySelector('.hero')).toBeNull();
    expect(host.querySelector('section[aria-labelledby="history-heading"]')).toBeNull();
    expect(host.querySelector('a[href="/messages"]')).not.toBeNull();
  });

  it('invites a client with nothing assigned to message their coach, when they can', async () => {
    const view = await render({
      getMyTrainingProgram: vi.fn(() => of(programView({ program: null }))),
    });
    expect(view.read()).toContain('Nothing assigned yet');
    expect(view.host.querySelector('app-empty-state a[href="/messages"]')).not.toBeNull();

    TestBed.resetTestingModule();
    const noChat = await render(
      { getMyTrainingProgram: vi.fn(() => of(programView({ program: null }))) },
      fakeClientAccess({ Messaging: 'NoEntitlement' }),
    );
    expect(noChat.host.querySelector('a[href="/messages"]')).toBeNull();
  });

  it('describes a finished program and the start of the next one', async () => {
    const finished = programView();
    finished.program!.phase = 'Finished';
    finished.program!.currentWeekNumber = null;
    finished.program!.weeks[2].sessions[1].state = 'Completed';
    const { host, textOf } = await render({ getMyTrainingProgram: vi.fn(() => of(finished)) });
    expect(textOf(host.querySelector('.hero-eyebrow'))).toBe('Program finished');
    expect(textOf(host.querySelector('.hero-chips li:last-child'))).toBe('Ended Sun 11 Oct');
    expect(host.querySelector('a.hero-action')).toBeNull();
    expect(textOf(host.querySelector('#weeks-heading'))).toBe('All weeks');

    TestBed.resetTestingModule();
    const upcoming = programView();
    upcoming.program!.phase = 'Upcoming';
    upcoming.program!.currentWeekNumber = null;
    upcoming.program!.startDate = '2026-10-05';
    upcoming.program!.weeks = [
      { weekNumber: 1, startDate: '2026-10-05', isVisible: false, isShared: false, sessions: [] },
    ];
    const next = await render({ getMyTrainingProgram: vi.fn(() => of(upcoming)) });
    expect(next.textOf(next.host.querySelector('.hero-eyebrow'))).toBe('Starts Mon 5 Oct');
    expect(next.read()).toContain('Your coach hasn’t shared this week yet');
  });

  it('retries a failed program read, and starts over in another workspace', async () => {
    let fail = true;
    const getMyTrainingProgram = vi.fn(() =>
      fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(programView()),
    );
    const { host, read, settle, selectedTenantId, client } = await render({ getMyTrainingProgram });
    expect(read()).toContain('We couldn’t load your program');

    fail = false;
    host.querySelector<HTMLButtonElement>('.state-card button')!.click();
    await settle();
    expect(host.querySelector('.hero h2')?.textContent?.trim()).toBe('Strength Foundations');

    selectedTenantId.set('tenant-2');
    await settle();
    expect(getMyTrainingProgram).toHaveBeenCalledTimes(3);
    expect(client.getMyWorkoutHistory).toHaveBeenCalledTimes(2);
  });
});
