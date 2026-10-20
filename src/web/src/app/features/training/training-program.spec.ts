import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, press, settle } from '../../../testing/dom';
import { programSummary } from '../../../testing/share-card-fixtures';
import { fakeShareCardMaker } from '../../../testing/share-card-maker-fake';
import { fakeClientAccess } from '../../../testing/today-fixtures';
import { historyItem, historyPage, programView } from '../../../testing/training-program-fixtures';
import { ShareCardMaker } from '../share-cards/share-card-maker';
import { TrainingProgram } from './training-program';

async function render(
  api: Partial<Record<keyof ApiClient, unknown>> = {},
  access = fakeClientAccess(),
  url = '/',
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
      { provide: ShareCardMaker, useValue: fakeShareCardMaker() },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
    ],
  }).compileComponents();
  // A notice's link arrives in the address (`?week=2`), read when the page is created.
  await TestBed.inject(Router).navigateByUrl(url);
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

// jsdom has no scrolling; the link tests stub it and put back what was there.
const originalScrollIntoView = Element.prototype.scrollIntoView;

/** The newest open dialog, which the kit renders outside the component. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

describe('TrainingProgram', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('does not focus a week number reused by a different program', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    await render({}, fakeClientAccess(), '/?week=2&program=another-program');
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('does not focus an unshared week after a notification was delivered', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    await render({}, fakeClientAccess(), '/?week=4');
    expect(scrolled).not.toHaveBeenCalled();
  });

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

  it('labels the program’s week with its number and days, apart from Today’s calendar week', async () => {
    const { host, textOf } = await render();

    const week = host.querySelector('section[aria-labelledby="focus-heading"]')!;
    expect(textOf(week.querySelector('.block-dates'))).toBe('Week 3 · Mon 28 Sep – Sun 4 Oct');
  });

  it('starts a missed session late after asking, and opens the player on it', async () => {
    const startMyWorkout = vi.fn(() => of({ id: 'w-s4' }));
    const { host, settle, textOf } = await render({ startMyWorkout });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    // Week 2 holds the missed Upper B of Thu 24 Sep.
    host.querySelector<HTMLButtonElement>('#week-row-2 .week-row')!.click();
    await settle();
    const missed = host.querySelector('#week-2 .session.is-Missed')!;
    const doNow = missed.querySelector<HTMLButtonElement>('button.do-now')!;
    expect(textOf(doNow)).toBe('Do it now: Upper B, Thu 24 Sep');
    expect(host.querySelectorAll('button.do-now')).toHaveLength(1);

    doNow.click();
    await settle();
    expect(textOf(dialog())).toContain('Do Upper B now?');
    expect(textOf(dialog())).toContain(
      'It was planned for Thu 24 Sep. Done now, it counts as done late, and your coach sees that.',
    );
    press(dialog()!.querySelector('app-confirm')!, 'Start workout');
    await settle();
    await settle();

    expect(startMyWorkout).toHaveBeenCalledWith('s4');
    expect(navigate).toHaveBeenCalledWith(['/training/today'], {
      queryParams: { sessionId: 's4' },
    });
  });

  it('starts nothing when the client answers Not now', async () => {
    const startMyWorkout = vi.fn(() => of({ id: 'w-s4' }));
    const { host, settle } = await render({ startMyWorkout });

    host.querySelector<HTMLButtonElement>('#week-row-2 .week-row')!.click();
    await settle();
    host.querySelector<HTMLButtonElement>('button.do-now')!.click();
    await settle();
    press(dialog()!.querySelector('app-confirm')!, 'Not now');
    await settle();
    await settle();

    expect(startMyWorkout).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('says under the session why it can no longer be done', async () => {
    const refused = new HttpErrorResponse({
      status: 409,
      error: { code: 'program_ended', message: 'This program has ended.' },
    });
    const { host, settle, textOf } = await render({
      startMyWorkout: vi.fn(() => throwError(() => refused)),
    });

    host.querySelector<HTMLButtonElement>('#week-row-2 .week-row')!.click();
    await settle();
    host.querySelector<HTMLButtonElement>('button.do-now')!.click();
    await settle();
    press(dialog()!.querySelector('app-confirm')!, 'Start workout');
    await settle();
    await settle();

    const problem = host.querySelector('#week-2 .do-now-problem');
    expect(problem?.getAttribute('role')).toBe('alert');
    expect(textOf(problem)).toBe('This program has ended, so its sessions can no longer be done.');
  });

  it('shows a session done late with the day it was done (TRN-020 v2)', async () => {
    const view = programView();
    view.program!.weeks[1] = {
      ...view.program!.weeks[1],
      sessions: [
        view.program!.weeks[1].sessions[0],
        {
          ...view.program!.weeks[1].sessions[1],
          state: 'Completed',
          workoutExecutionId: 'w-s4',
          startedOn: '2026-09-26',
          isLate: true,
        },
      ],
    };
    const { host, settle, spoken } = await render({
      getMyTrainingProgram: vi.fn(() => of(view)),
    });

    host.querySelector<HTMLButtonElement>('#week-row-2 .week-row')!.click();
    await settle();
    const late = host.querySelectorAll('#week-2 .session')[1];
    expect(spoken(late)).toBe(
      'Thu 24 Sep, Upper B, 4 exercises · 12 sets, Done Sat 26 Sep, Done late',
    );
    expect(host.querySelector('button.do-now')).toBeNull();
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

  it('opens the week a notice names and brings it into view', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const { host } = await render({}, fakeClientAccess(), '/?week=2');

    const rows = [...host.querySelectorAll<HTMLElement>('.weeks .week-row')];
    expect(rows[1].getAttribute('aria-expanded')).toBe('true');
    expect(rows[0].getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('#week-2')).not.toBeNull();
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect((scrolled.mock.contexts[0] as HTMLElement).id).toBe('week-row-2');
  });

  it('shows the finished workout a coach’s note is on, beyond the first few', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const page = Array.from({ length: 5 }, (_, index) =>
      historyItem({ workoutExecutionId: `w${index}`, name: `Workout ${index}` }),
    );
    const { host } = await render(
      { getMyWorkoutHistory: vi.fn(() => of(historyPage(page))) },
      fakeClientAccess(),
      '/?workout=w4',
    );

    const items = [...host.querySelectorAll('.history-item')];
    expect(items).toHaveLength(5);
    expect(
      items.filter((item) => item.classList.contains('is-linked')).map((item) => item.id),
    ).toEqual(['workout-w4']);
    expect((scrolled.mock.contexts[0] as HTMLElement).id).toBe('workout-w4');
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

  it('shows the notes on a finished workout, the coach’s named as theirs', async () => {
    const note = (id: string, authorRole: 'Coach' | 'Client', text: string) => ({
      id,
      exercisePerformanceId: null,
      authorUserId: `${authorRole}-user`,
      authorRole,
      text,
      createdAtUtc: '2026-09-28T18:00:00Z',
    });
    const { host, textOf } = await render({
      getMyWorkoutHistory: vi.fn(() =>
        of(
          historyPage([
            historyItem({
              notes: [
                note('n1', 'Client', 'Shoulder felt tight.'),
                note('n2', 'Coach', 'Great depth. Warm the shoulder up longer next time.'),
              ],
            }),
          ]),
        ),
      ),
    });

    const notes = [...host.querySelectorAll('.history-notes li')];
    expect(notes.map((item) => textOf(item.querySelector('.note-from')))).toEqual([
      'You',
      'Your coach',
    ]);
    expect(textOf(notes[1].querySelector('.note-text'))).toBe(
      'Great depth. Warm the shoulder up longer next time.',
    );
    expect(notes[1].classList.contains('coach')).toBe(true);
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

  it('shares a finished program as a card, reading its facts only when asked', async () => {
    const finished = programView();
    finished.program!.phase = 'Finished';
    finished.program!.currentWeekNumber = null;
    finished.program!.weeks[2].sessions[1].state = 'Completed';
    const getMyProgramSummary = vi.fn(() =>
      of({ isAllowed: true, accessReason: 'Granted', program: programSummary() }),
    );
    const { host, settle } = await render({
      getMyTrainingProgram: vi.fn(() => of(finished)),
      getMyProgramSummary,
    });
    expect(getMyProgramSummary).not.toHaveBeenCalled();

    button(host, 'Share your program').click();
    await settle();
    await settle();
    expect(getMyProgramSummary).toHaveBeenCalledWith('block-1');
    const pane = document.querySelector<HTMLElement>('.tb-modal-pane--sheet')!;
    expect(pane.querySelector('h2')?.textContent?.trim()).toBe('Share your program');
    // Training follows the person's own light or dark, and so does its sheet.
    expect(pane.dataset['mode']).toBeUndefined();
    expect(pane.querySelector('.preview img')?.getAttribute('alt')).toContain(
      'Strength Foundations, 8 weeks. 30 workouts, 7 personal records.',
    );
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  it('offers no card for a program still running, or finished with nothing done', async () => {
    const running = await render();
    expect(() => button(running.host, 'Share your program')).toThrow();

    TestBed.resetTestingModule();
    const untouched = programView();
    untouched.program!.phase = 'Finished';
    untouched.program!.currentWeekNumber = null;
    untouched.program!.completedCount = 0;
    const idle = await render({ getMyTrainingProgram: vi.fn(() => of(untouched)) });
    expect(() => button(idle.host, 'Share your program')).toThrow();
  });

  it('says why a finished program’s card cannot be made, and lets the client try again', async () => {
    const finished = programView();
    finished.program!.phase = 'Finished';
    finished.program!.currentWeekNumber = null;
    let answer: 'closed' | 'broken' = 'closed';
    const getMyProgramSummary = vi.fn(() =>
      answer === 'closed'
        ? of({ isAllowed: false, accessReason: 'Expired', program: null })
        : throwError(() => new HttpErrorResponse({ status: 500 })),
    );
    const { host, settle, textOf } = await render({
      getMyTrainingProgram: vi.fn(() => of(finished)),
      getMyProgramSummary,
    });

    button(host, 'Share your program').click();
    await settle();
    expect(textOf(host.querySelector('.hero-problem[role="alert"]'))).toBe(
      'Your coaching plan has ended. Contact your coach.',
    );
    answer = 'broken';
    button(host, 'Share your program').click();
    await settle();
    expect(textOf(host.querySelector('.hero-problem'))).toBe(
      'Your program’s card couldn’t be made. Try again.',
    );
    expect(document.querySelector('.tb-modal-pane--sheet')).toBeNull();
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
