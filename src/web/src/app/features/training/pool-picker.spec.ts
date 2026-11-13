import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ExercisePoolPage } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { LIBRARY_SEARCH_PAUSE } from '../../ui/paged-search';
import { button, field, fill, press, query, settle } from '../../../testing/dom';
import { access } from '../../../testing/exercise-fixtures';
import {
  POOL_BENCH_PRESS,
  POOL_GOBLET_SQUAT,
  POOL_PLANK,
  poolPage,
} from '../../../testing/own-workout-fixtures';
import { PoolPicker } from './pool-picker';
import { ExercisePoolApi } from './exercise-pool-api';

const WHOLE_POOL = [POOL_BENCH_PRESS, POOL_GOBLET_SQUAT, POOL_PLANK];

interface Options {
  readonly search?: ExercisePoolApi['search'];
  readonly inWorkout?: ReadonlySet<string>;
  /** How many times each exercise was added since the picker opened. */
  readonly added?: ReadonlyMap<string, number>;
}

async function render(options: Options = {}) {
  const pool = {
    search: vi.fn<ExercisePoolApi['search']>(options.search ?? (() => of(poolPage(WHOLE_POOL)))),
  };
  const grant = vi.fn((id: string) => of(access({ assetId: id, kind: 'Video' })));
  TestBed.configureTestingModule({
    imports: [PoolPicker],
    providers: [
      { provide: ExercisePoolApi, useValue: pool },
      // The demo button asks the server for its grant (MED-017) through the app's client.
      { provide: ApiClient, useValue: { createMediaAccess: grant } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: LIBRARY_SEARCH_PAUSE, useValue: 0 },
    ],
  });
  const fixture = TestBed.createComponent(PoolPicker);
  if (options.inWorkout) fixture.componentRef.setInput('inWorkout', options.inWorkout);
  if (options.added) fixture.componentRef.setInput('added', options.added);
  const chosen = vi.fn();
  const done = vi.fn();
  fixture.componentInstance.chosen.subscribe(chosen);
  fixture.componentInstance.done.subscribe(done);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, pool, grant, chosen, done };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The exercises listed, each as its name and the line under it. */
function listed(host: HTMLElement): string[][] {
  return Array.from(host.querySelectorAll('li.row')).map((row) => [
    textOf(row.querySelector('.name')),
    textOf(row.querySelector('.detail')),
  ]);
}

/** The row's button, found by the name a screen reader hears ("Add Plank"). */
function pick(host: ParentNode, label: string): HTMLButtonElement {
  return query<HTMLButtonElement>(host, `button.pick[aria-label="${label}"]`);
}

describe('PoolPicker, TB Gym’s pool for a workout of one’s own (notes plan N9b3)', () => {
  afterEach(() => {
    document.body.replaceChildren();
    TestBed.resetTestingModule();
  });

  it('lists the pool’s first page in the order the server gives, each with its equipment and main muscle', async () => {
    const { host, pool } = await render();

    expect(pool.search).toHaveBeenCalledExactlyOnceWith({ query: '', skip: 0, take: 50 });
    expect(listed(host)).toEqual([
      ['Bench press', 'Barbell · Chest'],
      ['Goblet squat', 'Kettlebell · Quadriceps'],
      ['Plank', 'Abdominals'],
    ]);
    expect(
      Array.from(host.querySelectorAll('button.pick')).map((row) => row.getAttribute('aria-label')),
    ).toEqual(['Add Bench press', 'Add Goblet squat', 'Add Plank']);
    expect(host.querySelector('.problem')).toBeNull();
    expect(host.querySelector('app-skeleton')).toBeNull();
  });

  it('shows the skeleton while the first page is on its way', async () => {
    const { host } = await render({ search: () => new Subject<ExercisePoolPage>() });

    expect(textOf(query(host, 'app-skeleton'))).toBe('Loading the exercises…');
    expect(host.querySelector('li.row')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('searches the pool as typed and lists its answer', async () => {
    const { fixture, host, pool } = await render({
      search: (asked) => of(poolPage(asked?.query ? [POOL_GOBLET_SQUAT] : WHOLE_POOL)),
    });

    fill(host, 'Search exercises', 'squat');
    await settle(fixture);

    expect(pool.search).toHaveBeenLastCalledWith({ query: 'squat', skip: 0, take: 50 });
    expect(listed(host)).toEqual([['Goblet squat', 'Kettlebell · Quadriceps']]);
  });

  it('says when nothing matches, and Show all exercises goes back to the whole pool', async () => {
    const { fixture, host, pool } = await render({
      search: (asked) => of(poolPage(asked?.query ? [] : WHOLE_POOL)),
    });

    fill(host, 'Search exercises', 'zercher');
    await settle(fixture);
    expect(textOf(query(host, '.note [role="status"]'))).toBe('No exercise matches “zercher”.');
    expect(host.querySelector('li.row')).toBeNull();

    press(host, 'Show all exercises');
    await settle(fixture);

    expect(listed(host).map(([name]) => name)).toEqual(['Bench press', 'Goblet squat', 'Plank']);
    const search = field(host, 'Search exercises');
    expect(search.value).toBe('');
    expect(document.activeElement).toBe(search);
    // The first page is the one read on opening, not read again.
    expect(pool.search).toHaveBeenCalledTimes(2);
  });

  it('says when the pool holds nothing yet', async () => {
    const { host } = await render({ search: () => of(poolPage([], 0)) });

    expect(textOf(query(host, '.note [role="status"]'))).toBe(
      'No exercises are in the pool yet. TB Gym adds them, so check back soon.',
    );
    expect(host.querySelector('li.row')).toBeNull();
    expect(host.textContent).not.toContain('No exercise matches');
  });

  // Someone training in TB Gym's own space has no coach to contact: the house says why.
  it.each([
    ['MembershipInactive', 'You no longer train with TB Gym, so training is closed.'],
    ['RelationshipBlocked', 'TB Gym has paused your access.'],
    ['PlatformBlocked', 'Your account is blocked. Contact support.'],
    ['Expired', 'Training isn’t open for you right now.'],
  ])(
    'lists nothing while Training is closed (%s), saying why in TB Gym’s words',
    async (reason, why) => {
      const { host } = await render({
        search: () => of({ isAllowed: false, accessReason: reason, total: 0, items: [] }),
      });

      expect(textOf(query(host, '.note [role="alert"]'))).toBe('No exercise can be added now.');
      expect(Array.from(host.querySelectorAll('.note p')).map(textOf)).toEqual([
        'No exercise can be added now.',
        why,
      ]);
      expect(host.textContent).not.toMatch(/coach/i);
      expect(host.querySelector('li.row')).toBeNull();
      expect(host.textContent).not.toContain('No exercises are in the pool yet.');
    },
  );

  it('offers Try again when the first page could not be read', async () => {
    const search = vi
      .fn<ExercisePoolApi['search']>()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(poolPage(WHOLE_POOL)));
    const { fixture, host } = await render({ search });

    expect(textOf(query(host, '.note [role="alert"]'))).toBe('The exercises couldn’t be loaded.');
    expect(host.querySelector('li.row')).toBeNull();

    press(host, 'Try again');
    await settle(fixture);

    expect(search).toHaveBeenCalledTimes(2);
    expect(listed(host)).toHaveLength(3);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('offers Try again when a search could not be read, and sends it again', async () => {
    const search = vi
      .fn<ExercisePoolApi['search']>()
      .mockReturnValueOnce(of(poolPage(WHOLE_POOL)))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
      .mockReturnValue(of(poolPage([POOL_PLANK])));
    const { fixture, host } = await render({ search });

    fill(host, 'Search exercises', 'plank');
    await settle(fixture);
    expect(textOf(query(host, '.note [role="alert"]'))).toBe('The exercises couldn’t be loaded.');

    press(host, 'Try again');
    await settle(fixture);

    expect(search).toHaveBeenLastCalledWith({ query: 'plank', skip: 0, take: 50 });
    expect(listed(host)).toEqual([['Plank', 'Abdominals']]);
  });

  it('adds the next page under the first with Show more exercises, focus on its first row', async () => {
    const { fixture, host, pool } = await render({
      search: (asked) =>
        of(
          asked?.skip
            ? poolPage([POOL_PLANK], 3)
            : poolPage([POOL_BENCH_PRESS, POOL_GOBLET_SQUAT], 3),
        ),
    });
    expect(listed(host)).toHaveLength(2);

    press(host, 'Show more exercises');
    await settle(fixture);

    expect(pool.search).toHaveBeenLastCalledWith({ query: '', skip: 2, take: 50 });
    expect(listed(host).map(([name]) => name)).toEqual(['Bench press', 'Goblet squat', 'Plank']);
    expect(host.textContent).not.toContain('Show more exercises');
    expect(document.activeElement).toBe(pick(host, 'Add Plank'));
  });

  it('says beside Show more exercises when the next page could not be read, and the button tries again', async () => {
    const search = vi
      .fn<ExercisePoolApi['search']>()
      .mockReturnValueOnce(of(poolPage([POOL_BENCH_PRESS, POOL_GOBLET_SQUAT], 3)))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
      .mockReturnValue(of(poolPage([POOL_PLANK], 3)));
    const { fixture, host } = await render({ search });
    // A keyboard press: focus is on the button.
    const more = button(host, 'Show more exercises');
    more.focus();

    more.click();
    await settle(fixture);

    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith({ query: '', skip: 2, take: 50 });
    // The page's own line is under the sheet: the picker says it, beside the button.
    const failed = query<HTMLElement>(host, '.more p[role="alert"]');
    expect(textOf(failed)).toBe('More exercises couldn’t be loaded. Try again.');
    expect(listed(host).map(([name]) => name)).toEqual(['Bench press', 'Goblet squat']);
    // The button stays, and keeps focus, to try again.
    expect(button(host, 'Show more exercises')).toBe(more);
    expect(more.getAttribute('aria-disabled')).toBeNull();
    expect(failed.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(more);

    press(host, 'Show more exercises');
    await settle(fixture);

    expect(search).toHaveBeenCalledTimes(3);
    expect(search).toHaveBeenLastCalledWith({ query: '', skip: 2, take: 50 });
    expect(listed(host).map(([name]) => name)).toEqual(['Bench press', 'Goblet squat', 'Plank']);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain('Show more exercises');
    expect(document.activeElement).toBe(pick(host, 'Add Plank'));
  });

  it('hands the exercise pressed to the player, and stays open for the next', async () => {
    const { fixture, host, chosen, done } = await render();

    pick(host, 'Add Goblet squat').click();
    await settle(fixture);

    expect(chosen).toHaveBeenCalledExactlyOnceWith(POOL_GOBLET_SQUAT);
    expect(done).not.toHaveBeenCalled();
    expect(listed(host)).toHaveLength(3);
  });

  it('marks what was added and what is in the workout already, which is offered again', async () => {
    const { host } = await render({
      inWorkout: new Set([POOL_BENCH_PRESS.id, POOL_GOBLET_SQUAT.id]),
      added: new Map([[POOL_BENCH_PRESS.id, 1]]),
    });

    const bench = pick(host, 'Add Bench press again');
    expect(textOf(bench.querySelector('.mark.added'))).toBe('Added');
    // The row's name says what a press does; the mark is for the eye.
    expect(bench.querySelector('.mark.added')?.getAttribute('aria-hidden')).toBe('true');
    const goblet = pick(host, 'Add Goblet squat again');
    expect(textOf(goblet.querySelector('.mark'))).toBe('In this workout');
    expect(goblet.querySelector('.mark.added')).toBeNull();
    const plank = pick(host, 'Add Plank');
    expect(plank.querySelector('.mark')).toBeNull();
    expect(plank.querySelector('.add app-icon')).not.toBeNull();
    // A second one is still offered: none of the rows is closed.
    expect([bench, goblet, plank].every((row) => !row.disabled)).toBe(true);
  });

  it('counts a second add of the same exercise on its row, so it is seen as well as heard', async () => {
    const { fixture, host } = await render({
      inWorkout: new Set([POOL_BENCH_PRESS.id]),
      added: new Map([[POOL_BENCH_PRESS.id, 1]]),
    });
    expect(textOf(pick(host, 'Add Bench press again').querySelector('.mark.added'))).toBe('Added');

    fixture.componentRef.setInput('added', new Map([[POOL_BENCH_PRESS.id, 2]]));
    await settle(fixture);
    expect(textOf(pick(host, 'Add Bench press again').querySelector('.mark.added'))).toBe(
      'Added ×2',
    );

    fixture.componentRef.setInput(
      'added',
      new Map([
        [POOL_BENCH_PRESS.id, 3],
        [POOL_PLANK.id, 1],
      ]),
    );
    fixture.componentRef.setInput('inWorkout', new Set([POOL_BENCH_PRESS.id, POOL_PLANK.id]));
    await settle(fixture);
    expect(textOf(pick(host, 'Add Bench press again').querySelector('.mark.added'))).toBe(
      'Added ×3',
    );
    expect(textOf(pick(host, 'Add Plank again').querySelector('.mark.added'))).toBe('Added');
    expect(pick(host, 'Add Goblet squat').querySelector('.mark')).toBeNull();
    // Nothing added since the picker opened: the marks go, and the workout's own mark is back.
    fixture.componentRef.setInput('added', new Map());
    await settle(fixture);
    expect(textOf(pick(host, 'Add Bench press again').querySelector('.mark'))).toBe(
      'In this workout',
    );
    expect(host.querySelector('.mark.added')).toBeNull();
  });

  it('gives an exercise with a demo its demo button at a thumb’s size, which opens without adding', async () => {
    const { fixture, host, grant, chosen } = await render();
    const rows = Array.from(host.querySelectorAll<HTMLElement>('li.row'));

    // Bench press and Plank have no demo: their rows show none.
    expect(rows[0].querySelector('app-exercise-demo button')).toBeNull();
    expect(rows[2].querySelector('app-exercise-demo button')).toBeNull();
    const demo = query<HTMLButtonElement>(rows[1], 'app-exercise-demo button');
    expect(demo.getAttribute('aria-label')).toBe('Watch the Goblet squat demo');
    expect(demo.classList.contains('compact')).toBe(true);
    expect(demo.classList.contains('touch')).toBe(true);
    // Beside the row's button, never inside it.
    expect(demo.closest('button.pick')).toBeNull();

    demo.click();
    await settle(fixture);

    expect(grant).toHaveBeenCalledExactlyOnceWith('m-goblet-video');
    expect(textOf(document.querySelector('[role="dialog"] h2'))).toBe('Goblet squat');
    expect(chosen).not.toHaveBeenCalled();
  });

  it('says what the last press did, and the same words again when they are said again', async () => {
    const { fixture, host } = await render();
    const status = query<HTMLElement>(host, 'p.tb-visually-hidden[role="status"]');
    expect(textOf(status)).toBe('');

    fixture.componentRef.setInput('announcement', { text: 'Goblet squat added.', version: 1 });
    await settle(fixture);
    expect(textOf(status)).toBe('Goblet squat added.');
    const first = query<HTMLElement>(status, 'span');

    // Drawn once per count: the same sentence read again changes nothing a screen reader hears.
    fixture.componentRef.setInput('announcement', { text: 'Goblet squat added.', version: 1 });
    await settle(fixture);
    expect(query(status, 'span')).toBe(first);

    // Said again, counted anew: written into the live region afresh, so it is heard a second time.
    fixture.componentRef.setInput('announcement', { text: 'Goblet squat added.', version: 2 });
    await settle(fixture);
    expect(textOf(status)).toBe('Goblet squat added.');
    expect(status.querySelectorAll('span')).toHaveLength(1);
    expect(query(status, 'span')).not.toBe(first);
    expect(first.isConnected).toBe(false);

    fixture.componentRef.setInput('announcement', null);
    await settle(fixture);
    expect(textOf(status)).toBe('');
    expect(status.querySelector('span')).toBeNull();
  });

  it('says why a press added nothing at the top, under the search, where it stays in view', async () => {
    const { fixture, host } = await render();
    expect(host.querySelector('.problem')).toBeNull();

    fixture.componentRef.setInput('problem', 'A workout holds at most 40 exercises.');
    await settle(fixture);

    // The sheet's first block, which holds the search and stays put while the list scrolls under it.
    const top = query<HTMLElement>(host, '.top');
    expect(host.firstElementChild).toBe(top);
    const search = query<HTMLInputElement>(top, '.search input[type="search"]');
    const problem = query<HTMLElement>(top, 'p.problem[role="alert"]');
    expect(textOf(problem)).toBe('A workout holds at most 40 exercises.');
    expect(search.compareDocumentPosition(problem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelectorAll('.problem')).toHaveLength(1);
    // Above the rows, never among them.
    expect(
      problem.compareDocumentPosition(query(host, 'ul.items')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fixture.componentRef.setInput('problem', null);
    await settle(fixture);
    expect(host.querySelector('.problem')).toBeNull();
    expect(query(host, '.top .search input')).toBe(search);
  });

  it('closes with Done, drawn where it is written outside a sheet', async () => {
    const { fixture, host, done, chosen } = await render();

    press(host, 'Done');
    await settle(fixture);

    expect(done).toHaveBeenCalledTimes(1);
    expect(chosen).not.toHaveBeenCalled();
  });
});
