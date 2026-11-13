import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { OwnWorkoutView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, press, settle } from '../../../testing/dom';
import { finishedProfile } from '../../../testing/intake-fixtures';
import { ownWorkout } from '../../../testing/own-workout-day-fixtures';
import { programSummary } from '../../../testing/share-card-fixtures';
import { fakeShareCardMaker } from '../../../testing/share-card-maker-fake';
import { fakeClientAccess } from '../../../testing/today-fixtures';
import {
  historyItem,
  historyPage,
  nextProgramView,
  programView,
} from '../../../testing/training-program-fixtures';
import { ShareCardMaker } from '../share-cards/share-card-maker';
import { OwnWorkoutApi } from './own-workout-api';
import { TrainingProgram } from './training-program';

async function render(
  api: Partial<Record<keyof ApiClient, unknown>> = {},
  access = fakeClientAccess(),
  url = '/',
  /** Overrides any `OwnWorkoutApi` method: a workout of one's own (notes plan N9b3). */
  own: Record<string, unknown> = {},
) {
  const selectedTenantId = signal<string | null>('tenant-1');
  const client = {
    getMyTrainingProgram: vi.fn(() => of(programView())),
    getMyWorkoutHistory: vi.fn(() => of(historyPage())),
    ...api,
  };
  const ownApi = {
    // A new workout of one's own, as the server starts it (TRN-033).
    start: vi.fn((fromWorkoutId?: string | null) =>
      of(ownWorkout({ workoutExecutionId: fromWorkoutId ? 'own-copy' : 'own-new', version: 1 })),
    ),
    ...own,
  };
  await TestBed.configureTestingModule({
    imports: [TrainingProgram],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: client },
      { provide: OwnWorkoutApi, useValue: ownApi },
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
    ownApi,
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

  describe('a next program shown early (critique B18)', () => {
    const beside = programView({ nextProgram: nextProgramView() });

    it('lists it under the weeks, week by week, with nothing to start', async () => {
      const {
        host,
        settle: redraw,
        textOf,
      } = await render({
        getMyTrainingProgram: vi.fn(() => of(beside)),
      });

      const section = host.querySelector('section[aria-labelledby="next-program-heading"]')!;
      expect(textOf(section.querySelector('h2'))).toBe('Next program');
      expect(textOf(section.querySelector('.block-dates'))).toBe(
        'Summer Strength · Starts Mon 12 Oct',
      );
      const rows = [...section.querySelectorAll<HTMLButtonElement>('button.week-row')];
      expect(rows.map(textOf)).toEqual(['Week 1, 2 sessions', 'Week 2, 1 session']);
      expect(rows[0].getAttribute('aria-controls')).toBe('next-week-1');

      rows[0].click();
      await redraw();
      const sessions = [...section.querySelectorAll('.session')];
      expect(sessions.map((session) => session.tagName)).toEqual(['DIV', 'DIV']);
      expect(textOf(sessions[0])).toContain('Squat day');
      expect(section.querySelector('.do-now, a')).toBeNull();
      // The running program's own week 2 stays closed: the two programs' weeks are apart.
      expect(host.querySelector('#week-2')).toBeNull();
    });

    it('follows a notice to the week of the next program', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const { host, settle: redraw } = await render(
        { getMyTrainingProgram: vi.fn(() => of(beside)) },
        fakeClientAccess(),
        '/?week=2&program=block-2',
      );
      await redraw();

      expect(host.querySelector('#next-week-2')).not.toBeNull();
      expect(host.querySelector('#week-2')).toBeNull();
    });

    it('reads as the program itself while training is closed, without the closed card', async () => {
      const closed = programView({
        isAllowed: false,
        accessReason: 'NotStarted',
        nextProgramStartDate: '2026-10-12',
        program: nextProgramView(),
      });
      const { host, textOf } = await render({ getMyTrainingProgram: vi.fn(() => of(closed)) });

      expect(host.querySelector('.state-card')).toBeNull();
      const hero = host.querySelector('.hero')!;
      expect(textOf(hero.querySelector('.hero-eyebrow'))).toBe('Starts Mon 12 Oct');
      expect([...hero.querySelectorAll('.hero-chips li')].map(textOf)).toEqual([
        '3 sessions',
        'Ends Sun 25 Oct',
      ]);
      expect(textOf(hero.querySelector('.hero-today'))).toBe('Next: Mon 12 Oct · Squat day');
      expect(hero.querySelector('a.hero-action')).toBeNull();
      const week = host.querySelector('section[aria-labelledby="focus-heading"]')!;
      expect(week.querySelector('.block-meta')).toBeNull();
      expect(host.querySelector('#history-heading')).toBeNull();
    });

    it('still says why when training is closed and nothing is shown', async () => {
      const closed = programView({ isAllowed: false, accessReason: 'NotStarted', program: null });
      const { host, textOf } = await render({ getMyTrainingProgram: vi.fn(() => of(closed)) });

      expect(textOf(host.querySelector('.state-card h2'))).toBe('Training is not available');
    });
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
    press(dialog()!, 'Start workout');
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
    press(dialog()!, 'Not now');
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
    press(dialog()!, 'Start workout');
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

  it('keeps a client’s finished workouts when the coach keeps their finished programs back', async () => {
    // The server sends no program (TRN-031), so the page says nothing about what it left out.
    const { host, read } = await render({
      getMyTrainingProgram: vi.fn(() => of(programView({ program: null }))),
      // A coach's client: with no program, the page asks who reads it (notes plan N9b3).
      getSelfProfile: vi.fn(() => of(finishedProfile())),
    });

    expect(read()).toContain('Nothing assigned yet');
    expect(read()).not.toContain('Program finished');
    expect(host.querySelector('.hero')).toBeNull();
    const history = host.querySelector('section[aria-labelledby="history-heading"]');
    expect(history).not.toBeNull();
    expect(history!.querySelectorAll('.history-item').length).toBeGreaterThan(0);
    // A coach's client starts no workout of their own, from here or from a finished one.
    expect(host.querySelector('[data-start-own]')).toBeNull();
    expect(host.querySelector('[data-start-from]')).toBeNull();
  });

  it('invites a client with nothing assigned to message their coach, when they can', async () => {
    const view = await render({
      getMyTrainingProgram: vi.fn(() => of(programView({ program: null }))),
      getSelfProfile: vi.fn(() => of(finishedProfile())),
    });
    expect(view.read()).toContain('Nothing assigned yet');
    expect(view.host.querySelector('app-empty-state a[href="/messages"]')).not.toBeNull();

    TestBed.resetTestingModule();
    const noChat = await render(
      {
        getMyTrainingProgram: vi.fn(() => of(programView({ program: null }))),
        getSelfProfile: vi.fn(() => of(finishedProfile())),
      },
      fakeClientAccess({ Messaging: 'NoEntitlement' }),
    );
    expect(noChat.read()).toContain('Nothing assigned yet');
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

  describe('a trainee of TB Gym’s own space trains on their own (notes plan N9b3, TRN-033)', () => {
    const noProgram = () => vi.fn(() => of(programView({ program: null })));
    const trainee = () => vi.fn(() => of(finishedProfile({ selfDirected: true })));
    /** A finished workout of one's own: no program holds it, and the server names it "Workout". */
    const ownItem = (overrides: Parameters<typeof historyItem>[0] = {}) =>
      historyItem({
        workoutExecutionId: 'own-0',
        name: 'Workout',
        programName: '',
        isOwnWorkout: true,
        date: '2026-09-29',
        ...overrides,
      });
    /** The trainee's history: their own workout of Tue 29 Sep, then a program's of Mon 28 Sep. */
    const traineeHistory = () => vi.fn(() => of(historyPage([ownItem(), historyItem()])));
    const navigation = () => vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const refusal = (code: string, message: string) =>
      new HttpErrorResponse({ status: 409, error: { code, message } });

    it('offers a trainee with no program a workout of their own, and opens the player on it', async () => {
      const getSelfProfile = trainee();
      const { host, ownApi, settle, textOf, read } = await render({
        getMyTrainingProgram: noProgram(),
        getSelfProfile,
      });
      const navigate = navigation();
      const refresh = vi.mocked(TestBed.inject(CsrfService).refresh);

      const empty = host.querySelector('app-empty-state')!;
      expect(textOf(empty.querySelector('h2'))).toBe('Train on your own');
      expect(textOf(empty.querySelector('p'))).toBe(
        'Start a workout, pick exercises from TB Gym’s pool and log each set. Your finished workouts are below.',
      );
      const start = empty.querySelector<HTMLButtonElement>('button[data-start-own]')!;
      expect(textOf(start)).toBe('Start a workout');
      expect(start.disabled).toBe(false);
      expect(read()).not.toContain('Nothing assigned yet');
      expect(read()).not.toContain('Your coach will put your program here.');
      // Messaging is open in this plan, and still nothing offers to write to a coach.
      expect(host.querySelector('a[href="/messages"]')).toBeNull();
      expect(getSelfProfile).toHaveBeenCalledTimes(1);
      refresh.mockClear();

      press(host, 'Start a workout');
      await settle();

      expect(ownApi.start).toHaveBeenCalledTimes(1);
      expect(ownApi.start).toHaveBeenCalledWith(null);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
        ownApi.start.mock.invocationCallOrder[0],
      );
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(['/training/today'], {
        queryParams: { sessionId: 'own-new' },
      });
      expect(host.querySelector('.own-problem')).toBeNull();
      expect(getSelfProfile).toHaveBeenCalledTimes(1);
    });

    it('offers to start from each finished workout, their own and a program’s alike', async () => {
      const { host, ownApi, settle, textOf } = await render({
        getMyTrainingProgram: noProgram(),
        getSelfProfile: trainee(),
        getMyWorkoutHistory: traineeHistory(),
      });
      const navigate = navigation();

      const items = [...host.querySelectorAll('.history-item')];
      const starts = items.map((item) =>
        item.querySelector<HTMLButtonElement>('button[data-start-from]')!,
      );
      // Each one names its workout for a screen reader; a sighted person reads it beside it.
      expect(starts.map(textOf)).toEqual([
        'Start from this workout: Workout, Tue 29 Sep',
        'Start from this workout: Upper A, Mon 28 Sep',
      ]);
      expect(starts.map((start) => textOf(start.querySelector('.tb-visually-hidden')))).toEqual([
        ': Workout, Tue 29 Sep',
        ': Upper A, Mon 28 Sep',
      ]);
      expect(starts[0].querySelector('.tb-visually-hidden bdi')?.textContent).toBe('Workout');
      expect(starts[0].classList).toContain('tb-button--outlined');

      starts[1].click();
      await settle();

      expect(ownApi.start).toHaveBeenCalledTimes(1);
      expect(ownApi.start).toHaveBeenCalledWith('w-s5');
      expect(navigate).toHaveBeenCalledWith(['/training/today'], {
        queryParams: { sessionId: 'own-copy' },
      });
    });

    it('starts one at a time: the others wait while one is starting', async () => {
      const answer = new Subject<OwnWorkoutView>();
      const { host, ownApi, settle } = await render(
        {
          getMyTrainingProgram: noProgram(),
          getSelfProfile: trainee(),
          getMyWorkoutHistory: traineeHistory(),
        },
        fakeClientAccess(),
        '/',
        { start: vi.fn(() => answer) },
      );
      const navigate = navigation();
      const starts = () => [...host.querySelectorAll<HTMLButtonElement>('button[data-start-from]')];
      const startNew = () => host.querySelector<HTMLButtonElement>('button[data-start-own]')!;

      starts()[0].click();
      await settle();

      expect(starts()[0].getAttribute('aria-disabled')).toBe('true');
      expect(starts()[0].classList).toContain('tb-button--loading');
      expect(starts()[1].disabled).toBe(true);
      expect(startNew().disabled).toBe(true);
      expect(ownApi.start).toHaveBeenCalledWith('own-0');

      answer.next(ownWorkout({ workoutExecutionId: 'own-copy' }));
      answer.complete();
      await settle();

      expect(ownApi.start).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(['/training/today'], {
        queryParams: { sessionId: 'own-copy' },
      });
      expect(starts()[0].getAttribute('aria-disabled')).toBeNull();
      expect(starts()[1].disabled).toBe(false);
      expect(startNew().disabled).toBe(false);
    });

    it('starts one workout when two starts are pressed before the page redraws', async () => {
      const { host, ownApi, settle } = await render({
        getMyTrainingProgram: noProgram(),
        getSelfProfile: trainee(),
        getMyWorkoutHistory: traineeHistory(),
      });
      const navigate = navigation();

      host.querySelector<HTMLButtonElement>('button[data-start-from]')!.click();
      host.querySelector<HTMLButtonElement>('button[data-start-own]')!.click();
      await settle();

      // The second press neither starts another nor stops the first.
      expect(ownApi.start).toHaveBeenCalledExactlyOnceWith('own-0');
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(['/training/today'], {
        queryParams: { sessionId: 'own-copy' },
      });
      expect(host.querySelector('.own-problem')).toBeNull();
    });

    it('says under the workout why it could not start from it, with Carry on when one is already going', async () => {
      let refused = refusal(
        'own_workout_in_progress',
        'You have a workout you have not finished. Carry on with it, or finish it first.',
      );
      const { host, settle, textOf } = await render(
        {
          getMyTrainingProgram: noProgram(),
          getSelfProfile: trainee(),
          getMyWorkoutHistory: traineeHistory(),
        },
        fakeClientAccess(),
        '/',
        { start: vi.fn(() => throwError(() => refused)) },
      );
      const navigate = navigation();
      const items = [...host.querySelectorAll('.history-item')];

      items[1].querySelector<HTMLButtonElement>('button[data-start-from]')!.click();
      await settle();

      const problem = items[1].querySelector('.own-problem');
      expect(problem?.querySelector('[role="alert"]')).not.toBeNull();
      expect(textOf(problem?.querySelector('[role="alert"]'))).toBe(
        'You have a workout you haven’t finished. Carry on with it, or finish it first.',
      );
      const carryOn = problem?.querySelector('a');
      expect(textOf(carryOn)).toBe('Carry on');
      expect(carryOn?.getAttribute('href')).toBe('/training/today');
      expect(host.querySelectorAll('.own-problem')).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
      expect(
        items[1].querySelector('button[data-start-from]')?.getAttribute('aria-disabled'),
      ).toBeNull();

      // Another reason, in the server's own words and with nothing to carry on, under its workout.
      refused = refusal(
        'own_workout_nothing_to_copy',
        'None of that workout’s exercises is in the exercise pool now.',
      );
      items[0].querySelector<HTMLButtonElement>('button[data-start-from]')!.click();
      await settle();

      expect(items[1].querySelector('.own-problem')).toBeNull();
      expect(textOf(items[0].querySelector('.own-problem [role="alert"]'))).toBe(
        'None of that workout’s exercises is in the exercise pool now.',
      );
      expect(items[0].querySelector('.own-problem a')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('says under Start a workout why it could not start', async () => {
      const { host, settle, textOf } = await render(
        { getMyTrainingProgram: noProgram(), getSelfProfile: trainee() },
        fakeClientAccess(),
        '/',
        {
          start: vi.fn(() =>
            throwError(() =>
              refusal(
                'own_workout_daily_limit',
                'You have started 10 workouts today, the most one day holds. Start the next one tomorrow.',
              ),
            ),
          ),
        },
      );
      const navigate = navigation();

      press(host, 'Start a workout');
      await settle();

      const problem = host.querySelector('app-empty-state + .own-problem');
      expect(textOf(problem?.querySelector('[role="alert"]'))).toBe(
        'You’ve started 10 workouts today, the most one day holds. Start the next one tomorrow.',
      );
      expect(problem?.querySelector('a')).toBeNull();
      expect(host.querySelectorAll('.own-problem')).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('names a workout of one’s own as such, never an empty program, with or without a program running', async () => {
      const running = await render({
        getMyWorkoutHistory: vi.fn(() => of(historyPage([ownItem()]))),
      });
      const meta = running.host.querySelector('.history-meta')!;
      expect(running.spoken(meta)).toBe('12 of 12 sets, 4,250 kg lifted, 52 min, Your own workout');
      expect(meta.querySelector('bdi')).toBeNull();
      // One separator before each part after the first: none left dangling at the end.
      expect(meta.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
      expect(meta.querySelectorAll('.tb-visually-hidden')).toHaveLength(3);
      expect(running.textOf(running.host.querySelector('.history-top strong'))).toBe('Workout');
      TestBed.resetTestingModule();

      const alone = await render({
        getMyTrainingProgram: noProgram(),
        getSelfProfile: trainee(),
        getMyWorkoutHistory: vi.fn(() => of(historyPage([ownItem({ durationSeconds: 0 })]))),
      });
      const own = alone.host.querySelector('.history-meta')!;
      expect(alone.spoken(own)).toBe('12 of 12 sets, 4,250 kg lifted, Your own workout');
      expect(own.querySelector('bdi')).toBeNull();
      expect(own.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    });

    it('leaves no separator for a program’s workout whose program has no name', async () => {
      const { host, spoken } = await render({
        getMyTrainingProgram: noProgram(),
        getSelfProfile: trainee(),
        getMyWorkoutHistory: vi.fn(() => of(historyPage([historyItem({ programName: '' })]))),
      });

      const meta = host.querySelector('.history-meta')!;
      expect(spoken(meta)).toBe('12 of 12 sets, 4,250 kg lifted, 52 min');
      expect(meta.querySelector('bdi')).toBeNull();
      expect(meta.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    });

    it('offers nothing of the kind beside a program, and never asks who reads the page', async () => {
      const getSelfProfile = trainee();
      const { host } = await render({ getSelfProfile });

      expect(host.querySelector('.hero')).not.toBeNull();
      expect(host.querySelectorAll('.history-item')).toHaveLength(2);
      expect(host.querySelector('[data-start-own]')).toBeNull();
      expect(host.querySelector('[data-start-from]')).toBeNull();
      expect(getSelfProfile).not.toHaveBeenCalled();
    });

    it('says only No workouts yet when the profile cannot be read, with nothing to start', async () => {
      const { host, read, textOf } = await render({
        getMyTrainingProgram: noProgram(),
        getSelfProfile: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503 }))),
      });

      const empty = host.querySelector('app-empty-state')!;
      expect(textOf(empty.querySelector('h2'))).toBe('No workouts yet');
      expect(textOf(empty.querySelector('p'))).toBe('Your workouts will start here.');
      expect(host.querySelector('[data-start-own]')).toBeNull();
      expect(host.querySelector('[data-start-from]')).toBeNull();
      expect(read()).not.toContain('Nothing assigned yet');
      expect(read()).not.toContain('Your coach will put your program here.');
      // Messaging is open in this plan, and still nothing offers to write to a coach.
      expect(host.querySelector('a[href="/messages"]')).toBeNull();
      // The finished workouts stand.
      expect(host.querySelectorAll('.history-item')).toHaveLength(2);
    });

    it('asks again in another workspace, where a coach’s client finds nothing to start', async () => {
      let selfDirected = true;
      const getSelfProfile = vi.fn(() => of(finishedProfile({ selfDirected })));
      const { host, read, settle, selectedTenantId } = await render({
        getMyTrainingProgram: noProgram(),
        getSelfProfile,
      });
      expect(host.querySelector('[data-start-own]')).not.toBeNull();
      expect(host.querySelectorAll('[data-start-from]')).toHaveLength(2);

      selfDirected = false;
      selectedTenantId.set('tenant-2');
      await settle();

      expect(getSelfProfile).toHaveBeenCalledTimes(2);
      expect(read()).toContain('Nothing assigned yet');
      expect(host.querySelector('[data-start-own]')).toBeNull();
      expect(host.querySelector('[data-start-from]')).toBeNull();
    });
  });
});
