import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ExerciseView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, choose, field, settle, tick } from '../../../testing/dom';
import { installDialogSupport } from '../../../testing/dialog';
import { ExerciseLibrary } from './exercise-library';

function exercise(name: string, overrides: Partial<ExerciseView> = {}): ExerciseView {
  return {
    id: `id-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    instructions: null,
    equipment: 'Barbell',
    movementPattern: 'Squat',
    classification: 'Strength',
    isArchived: false,
    muscles: [{ muscle: 'Quadriceps', role: 'Primary' }],
    tags: ['compound'],
    alternatives: [],
    mediaAssetIds: [],
    version: 7,
    ...overrides,
  };
}

const SQUAT = exercise('Barbell back squat');
const ARCHIVED = exercise('Banded pull-apart', {
  isArchived: true,
  tags: ['warm-up'],
  muscles: [{ muscle: 'FullBody', role: 'Primary' }],
});

let uninstallDialog: () => void;

type SearchResponse = Observable<{ items: ExerciseView[]; total: number }>;
type MediaResponse = Observable<{ items: never[]; total: number }>;

const refused = (status: number, body?: unknown) =>
  throwError(() => new HttpErrorResponse({ status, error: body }));

/**
 * Collects promise rejections nobody handled, on either side of the jsdom/Node boundary.
 *
 * A screen's action is called from a template handler, which has nowhere to put a rejection: it
 * becomes an unhandled rejection, which in the browser reaches Angular's global error listener and
 * the console. Asserting on the state alone would not notice that.
 */
interface RejectionEmitter {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

function watchUnhandledRejections(): { reasons: unknown[]; stop: () => void } {
  const reasons: unknown[] = [];
  const onNode = (reason: unknown) => reasons.push(reason);
  const onWindow = (event: Event) => reasons.push((event as PromiseRejectionEvent).reason);
  // Typed locally rather than through @types/node, which this project deliberately does not carry.
  const runtime = (globalThis as { process?: RejectionEmitter }).process;
  runtime?.on('unhandledRejection', onNode);
  window.addEventListener('unhandledrejection', onWindow);
  return {
    reasons,
    stop: () => {
      runtime?.off('unhandledRejection', onNode);
      window.removeEventListener('unhandledrejection', onWindow);
    },
  };
}

async function render(
  items: ExerciseView[] = [SQUAT, ARCHIVED],
  total = items.length,
  options: { mediaFails?: boolean } = {},
) {
  const api = {
    searchExercises: vi.fn((): SearchResponse => of({ items, total })),
    listMedia: vi.fn((): MediaResponse =>
      options.mediaFails ? refused(503) : of({ items: [] as never[], total: 0 }),
    ),
    setExerciseArchived: vi.fn((): Observable<ExerciseView> => of(items[0])),
    createExercise: vi.fn(() => of(items[0])),
    updateExercise: vi.fn(() => of(items[0])),
    getTenants: vi.fn(() => of([{ tenantId: 'A' }, { tenantId: 'B' }])),
  };
  const csrf = { refresh: vi.fn(async (): Promise<void> => undefined) };
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'training/programs', children: [] },
        { path: 'training/exercises', children: [] },
      ]),
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const tenants = TestBed.inject(TenantStore);
  await tenants.load('A');
  const fixture = TestBed.createComponent(ExerciseLibrary);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf, tenants };
}

/** The visible summary line; the table caption repeats it. */
function summary(host: HTMLElement): string {
  return (host.querySelector('.summary')?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function rowNames(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('tbody .exercise-name')).map((cell) =>
    (cell.textContent ?? '').trim(),
  );
}

function rowActions(host: HTMLElement, name: string): string[] {
  const row = Array.from(host.querySelectorAll('tbody tr')).find((candidate) =>
    candidate.querySelector('.exercise-name')?.textContent?.includes(name),
  );
  return Array.from(row?.querySelectorAll('button') ?? []).map((action) =>
    (action.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

describe('ExerciseLibrary', () => {
  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    uninstallDialog();
    localStorage.clear();
  });

  // ---------- list ----------

  it('lists the exercises the server returned, in the order it returned them', async () => {
    const { host } = await render();

    expect(rowNames(host)).toEqual(['Barbell back squat', 'Banded pull-apart']);
  });

  it('is a real table with a caption, column headers and a named Actions column', async () => {
    const { host } = await render();

    const table = host.querySelector('table')!;
    expect(table.querySelector('caption')?.textContent).toContain('Exercises');
    expect(
      Array.from(table.querySelectorAll('thead th')).map((header) => ({
        text: (header.textContent ?? '').trim(),
        scope: header.getAttribute('scope'),
      })),
    ).toEqual([
      { text: 'Exercise', scope: 'col' },
      { text: 'Movement pattern', scope: 'col' },
      { text: 'Primary muscle', scope: 'col' },
      { text: 'Equipment', scope: 'col' },
      { text: 'Classification', scope: 'col' },
      { text: 'Status', scope: 'col' },
      { text: 'Actions', scope: 'col' },
    ]);
    // The Actions header is there for assistive technology, not on screen.
    expect(table.querySelector('thead th:last-child span')?.className).toContain(
      'tb-visually-hidden',
    );
  });

  /** Raw enum names such as `FullBody` are transport values, never something a coach should read. */
  it('shows a localized muscle label instead of the enum name', async () => {
    const { host } = await render();

    const muscles = Array.from(
      host.querySelectorAll('tbody .col-muscle .cell-value, tbody .col-muscle'),
    ).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(muscles.join(' ')).toContain('Full body');
    expect(muscles.join(' ')).not.toContain('FullBody');
  });

  it('shows the existing labels for the other enum columns', async () => {
    const { host } = await render([
      exercise('Cable face pull', {
        equipment: 'SpecialtyBar',
        movementPattern: 'HorizontalPull',
        classification: 'Conditioning',
      }),
    ]);

    const row = (host.querySelector('tbody tr')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(row).toContain('Horizontal pull');
    expect(row).toContain('Specialty bar');
    expect(row).toContain('Conditioning');
  });

  it('carries the exercise status as text plus a marker, and an archived note', async () => {
    const { host } = await render();

    const statuses = Array.from(host.querySelectorAll('tbody .col-status')).map((cell) =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(statuses[0]).toContain('Active');
    expect(statuses[1]).toContain('Archived');
    expect(statuses[1]).toContain('Not in new programs');
  });

  it('keeps the full name in the title and in every action name', async () => {
    const long = exercise('Half-kneeling single-arm landmine press');
    const { host } = await render([long]);

    expect(host.querySelector('tbody .exercise-name')?.getAttribute('title')).toBe(
      'Half-kneeling single-arm landmine press',
    );
    expect(rowActions(host, 'Half-kneeling')).toEqual([
      'Edit Half-kneeling single-arm landmine press',
      'Archive Half-kneeling single-arm landmine press',
    ]);
  });

  // ---------- honest summary ----------

  it('says how many matches there are when every one of them is loaded', async () => {
    const { host } = await render([SQUAT, ARCHIVED], 2);

    expect(summary(host)).toBe('2 exercises · sorted by name');
  });

  it('uses the singular for one match', async () => {
    const { host } = await render([SQUAT], 1);

    expect(summary(host)).toBe('1 exercise · sorted by name');
  });

  /**
   * The server clamps `take` to 100 and the client asks for exactly that, so a workspace with more
   * matches than that is told so rather than being shown a count it cannot see.
   */
  it('says how many of how many are shown when the server capped the rows', async () => {
    const items = Array.from({ length: 100 }, (_, index) => exercise(`Exercise ${index}`));
    const { host, api } = await render(items, 134);

    expect(summary(host)).toBe('Showing the first 100 of 134. Refine the search.');
    expect(api.searchExercises).toHaveBeenCalledWith(expect.objectContaining({ query: '' }));
  });

  it('repeats the summary in the table caption', async () => {
    const { host } = await render([SQUAT], 1);

    expect((host.querySelector('caption')?.textContent ?? '').replace(/\s+/g, ' ')).toContain(
      '1 exercise · sorted by name',
    );
  });

  it('invents no archived count', async () => {
    const { host } = await render();

    expect(summary(host)).not.toContain('archived');
  });

  // ---------- filters ----------

  it('sends every filter to the server when Apply is pressed', async () => {
    const { fixture, host, api } = await render();
    api.searchExercises.mockClear();

    (field(host, 'Search exercises') as HTMLInputElement).value = 'squat';
    field(host, 'Search exercises').dispatchEvent(new Event('input'));
    choose(host, 'select[name="equipment"]', 'Dumbbell');
    choose(host, 'select[name="movementPattern"]', 'Hinge');
    choose(host, 'select[name="classification"]', 'Mobility');
    tick(host, 'Include archived');
    await settle(fixture);

    expect(api.searchExercises).not.toHaveBeenCalled();

    button(host, 'Apply').click();
    await settle(fixture);

    expect(api.searchExercises).toHaveBeenCalledTimes(1);
    expect(api.searchExercises).toHaveBeenCalledWith({
      query: 'squat',
      equipment: 'Dumbbell',
      movementPattern: 'Hinge',
      classification: 'Mobility',
      includeArchived: true,
    });
  });

  /**
   * jsdom does not implement a form's implicit submission, so Enter itself is proven in the browser
   * checks. What is proven here is the structure that makes it possible: the search field is in the
   * filter form, and that form's submit button is Apply.
   */
  it('keeps the search field inside the form Apply submits', async () => {
    const { host } = await render();

    const form = host.querySelector('form.filters')!;
    expect(form.contains(field(host, 'Search exercises'))).toBe(true);
    expect(button(host, 'Apply').getAttribute('type')).toBe('submit');
    expect(button(host, 'Apply').closest('form')).toBe(form);
  });

  it('reloads with the filters that were applied, not with unapplied changes', async () => {
    const { fixture, host, api } = await render();
    button(host, 'Apply').click();
    await settle(fixture);

    // Changed but deliberately not applied.
    choose(host, 'select[name="equipment"]', 'Kettlebell');
    await settle(fixture);
    api.searchExercises.mockClear();

    button(host, 'Restore Banded pull-apart').click();
    await settle(fixture);

    expect(api.searchExercises).toHaveBeenCalledWith(
      expect.objectContaining({ equipment: undefined }),
    );
  });

  // ---------- row actions ----------

  it('offers Restore alone on an archived row, never Edit', async () => {
    const { host } = await render();

    expect(rowActions(host, 'Banded pull-apart')).toEqual(['Restore Banded pull-apart']);
    expect(rowActions(host, 'Barbell back squat')).toEqual([
      'Edit Barbell back squat',
      'Archive Barbell back squat',
    ]);
  });

  it('restores without a confirmation and announces the outcome', async () => {
    const { fixture, host, api } = await render();

    button(host, 'Restore Banded pull-apart').click();
    await settle(fixture);

    expect(api.setExerciseArchived).toHaveBeenCalledTimes(1);
    expect(api.setExerciseArchived).toHaveBeenCalledWith('id-banded-pull-apart', {
      isArchived: false,
      version: 7,
    });
    expect(host.querySelector('.page-notice')?.textContent).toContain('Exercise restored.');
  });

  // ---------- archive confirmation ----------

  it('asks before archiving and sends nothing while it asks', async () => {
    const { fixture, host, api } = await render();

    button(host, 'Archive Barbell back squat').click();
    await settle(fixture);

    const dialog = host.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Archive Barbell back squat?');
    expect(dialog.textContent).toContain('Saved programs, assigned programs');
    expect(api.setExerciseArchived).not.toHaveBeenCalled();
  });

  it('sends nothing on Cancel and returns focus to the Archive button', async () => {
    const { fixture, host, api } = await render();
    const trigger = button(host, 'Archive Barbell back squat');
    trigger.click();
    await settle(fixture);

    button(host, 'Cancel').click();
    await settle(fixture);

    expect(api.setExerciseArchived).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('sends nothing on Escape and returns focus to the Archive button', async () => {
    const { fixture, host, api } = await render();
    const trigger = button(host, 'Archive Barbell back squat');
    trigger.click();
    await settle(fixture);

    const dialog = host.querySelector<HTMLDialogElement>('dialog')!;
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await settle(fixture);

    expect(api.setExerciseArchived).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('archives exactly once when the confirmation is confirmed', async () => {
    const { fixture, host, api } = await render();
    button(host, 'Archive Barbell back squat').click();
    await settle(fixture);

    button(host, 'Archive exercise').click();
    await settle(fixture);

    expect(api.setExerciseArchived).toHaveBeenCalledTimes(1);
    expect(api.setExerciseArchived).toHaveBeenCalledWith('id-barbell-back-squat', {
      isArchived: true,
      version: 7,
    });
    expect(host.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
    expect(host.querySelector('.page-notice')?.textContent).toContain('Exercise archived.');
  });

  it('reloads the current result after archiving', async () => {
    const { fixture, host, api } = await render();
    api.searchExercises.mockClear();
    button(host, 'Archive Barbell back squat').click();
    await settle(fixture);
    button(host, 'Archive exercise').click();
    await settle(fixture);

    expect(api.searchExercises).toHaveBeenCalledTimes(1);
  });

  /** A stale version means somebody else moved first. Nothing local is applied over their change. */
  it('reloads and says so when the exercise was changed somewhere else', async () => {
    const { fixture, host, api } = await render();
    api.setExerciseArchived.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'concurrency_conflict', message: 'The exercise was changed.' },
          }),
      ),
    );
    api.searchExercises.mockClear();

    button(host, 'Archive Barbell back squat').click();
    await settle(fixture);
    button(host, 'Archive exercise').click();
    await settle(fixture);

    expect(api.searchExercises).toHaveBeenCalledTimes(1);
    const notice = host.querySelector('.page-notice')?.textContent ?? '';
    expect(notice).toContain('changed somewhere else');
    expect(host.querySelector('.page-notice')?.getAttribute('role')).toBe('status');
    expect(host.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
  });

  it('leaves no dialog or busy state behind when the workspace changes', async () => {
    const { fixture, host, api, tenants } = await render();
    button(host, 'Archive Barbell back squat').click();
    await settle(fixture);
    expect(host.querySelector<HTMLDialogElement>('dialog')!.open).toBe(true);

    tenants.select('B');
    await settle(fixture);

    expect(host.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
    expect(api.setExerciseArchived).not.toHaveBeenCalled();
    // The filters and the rows belong to the workspace that was left.
    expect(fixture.componentInstance['query']()).toBe('');
  });

  it('leaves no dialog behind when the screen is destroyed', async () => {
    const { fixture, host } = await render();
    button(host, 'Archive Barbell back squat').click();
    await settle(fixture);
    const dialog = host.querySelector<HTMLDialogElement>('dialog')!;

    fixture.destroy();

    expect(dialog.open).toBe(false);
  });

  // ---------- states ----------

  it('explains an empty result rather than showing an empty table', async () => {
    const { host } = await render([], 0);

    expect(host.querySelector('table')).toBeNull();
    expect(host.textContent).toContain('No exercises found');
  });

  it('reports a failed load in an alert and offers to try again', async () => {
    type SearchResult = Observable<{ items: ExerciseView[]; total: number }>;
    const api = {
      searchExercises: vi.fn((): SearchResult =>
        throwError(() => new HttpErrorResponse({ status: 500 })),
      ),
      listMedia: vi.fn(() => of({ items: [], total: 0 })),
      setExerciseArchived: vi.fn(),
      getTenants: vi.fn(() => of([{ tenantId: 'A' }])),
    };
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        { provide: CsrfService, useValue: { refresh: vi.fn() } },
      ],
    });
    await TestBed.inject(TenantStore).load('A');
    const fixture = TestBed.createComponent(ExerciseLibrary);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.list-error')?.getAttribute('role')).toBe('alert');
    expect(host.textContent).toContain('The exercise library could not be loaded.');
    api.searchExercises.mockReturnValueOnce(of({ items: [SQUAT], total: 1 }));

    button(host, 'Try again').click();
    await settle(fixture);

    expect(rowNames(host)).toEqual(['Barbell back squat']);
  });

  // ---------- failures ----------

  /**
   * A refused Apply used to reject out of the template handler: nobody saw an error, the rows for
   * the previous filters stayed on screen as though they answered the new ones, and the rejection
   * escaped to the browser's global handler.
   */
  it('reports a refused search in the list, settles loading and lets nothing escape', async () => {
    const { fixture, host, api } = await render();
    const watcher = watchUnhandledRejections();
    api.searchExercises.mockReturnValueOnce(refused(500));

    choose(host, 'select[name="equipment"]', 'Kettlebell');
    await settle(fixture);
    button(host, 'Apply').click();
    await settle(fixture);
    watcher.stop();

    expect(watcher.reasons).toEqual([]);
    expect(host.querySelector('.list-error')?.textContent).toContain(
      'The exercise library could not be loaded.',
    );
    // The rows fetched for the previous filters are not an answer to these ones.
    expect(host.querySelector('table')).toBeNull();
    expect(rowNames(host)).toEqual([]);
    expect(fixture.componentInstance['loading']()).toBe(false);
    expect(button(host, 'Apply').getAttribute('aria-disabled')).toBeNull();
  });

  it('retries a refused search with the filters that failed, not with the drafts', async () => {
    const { fixture, host, api } = await render();
    api.searchExercises.mockReturnValueOnce(refused(500));
    choose(host, 'select[name="equipment"]', 'Kettlebell');
    await settle(fixture);
    button(host, 'Apply').click();
    await settle(fixture);
    api.searchExercises.mockClear();

    // A draft changed after the failure must not join the retry.
    choose(host, 'select[name="classification"]', 'Mobility');
    await settle(fixture);
    button(host, 'Try again').click();
    await settle(fixture);

    expect(api.searchExercises).toHaveBeenCalledTimes(1);
    expect(api.searchExercises).toHaveBeenCalledWith({
      query: '',
      equipment: 'Kettlebell',
      movementPattern: undefined,
      classification: undefined,
      includeArchived: false,
    });
    expect(host.querySelector('.list-error')).toBeNull();
    expect(rowNames(host)).toEqual(['Barbell back squat', 'Banded pull-apart']);
  });

  /** The list is this screen; media belongs to the editor beside it. One is not the other's health. */
  it('keeps a loaded list when the media read fails, and reports media with the media', async () => {
    const { fixture, host, api } = await render([SQUAT, ARCHIVED], 2, { mediaFails: true });

    expect(rowNames(host)).toEqual(['Barbell back squat', 'Banded pull-apart']);
    expect(host.querySelector('.list-error')).toBeNull();
    expect(host.querySelector('table')).not.toBeNull();
    expect(summary(host)).toBe('2 exercises · sorted by name');

    button(host, 'New exercise').click();
    await settle(fixture);

    expect(host.querySelector('.media-section .form-error')?.textContent).toContain(
      'The media library could not be loaded.',
    );
    // The media endpoints themselves are untouched: the editor still asked for the library.
    expect(api.listMedia).toHaveBeenCalled();
  });

  /**
   * A 409 whose reload also fails used to leave the promise escaping from `confirmArchive`, so
   * `archiving` stayed true: the dialog kept its busy button and refused Cancel and Escape.
   */
  it('does not strand the confirmation when the reload after a conflict also fails', async () => {
    const { fixture, host, api } = await render();
    const watcher = watchUnhandledRejections();
    api.setExerciseArchived.mockReturnValueOnce(refused(409, { code: 'concurrency_conflict' }));
    api.searchExercises.mockReturnValueOnce(refused(503));

    button(host, 'Archive Barbell back squat').click();
    await settle(fixture);
    button(host, 'Archive exercise').click();
    await settle(fixture);
    watcher.stop();

    const view = fixture.componentInstance;
    expect(watcher.reasons).toEqual([]);
    expect(host.querySelector<HTMLDialogElement>('dialog')!.open).toBe(false);
    expect(view['archiving']()).toBe(false);
    expect(view['pendingRow']()).toBeNull();
    // The confirmation carried the version the list was read with, so it is not left to be sent again.
    expect(view['pendingArchive']()).toBeNull();
    // Neither the archive nor the recovery may be announced: neither happened.
    expect(host.querySelector('.page-notice')?.textContent?.trim()).toBe('');
    expect(host.querySelector('.list-error')?.textContent).toContain(
      'The exercise library could not be loaded.',
    );
    expect(button(host, 'Try again')).toBeTruthy();
  });

  it('does not claim an exercise was archived when the reload that would show it failed', async () => {
    const { fixture, host, api } = await render();
    const watcher = watchUnhandledRejections();
    api.searchExercises.mockReturnValueOnce(refused(503));

    button(host, 'Archive Barbell back squat').click();
    await settle(fixture);
    button(host, 'Archive exercise').click();
    await settle(fixture);
    watcher.stop();

    expect(watcher.reasons).toEqual([]);
    expect(api.setExerciseArchived).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.page-notice')?.textContent?.trim()).toBe('');
    expect(host.querySelector('.list-error')?.textContent).toContain(
      'The exercise library could not be loaded.',
    );
    expect(fixture.componentInstance['archiving']()).toBe(false);
  });

  it('settles a restore whose reload failed, and offers the retry', async () => {
    const { fixture, host, api } = await render();
    const watcher = watchUnhandledRejections();
    api.searchExercises.mockReturnValueOnce(refused(503));

    button(host, 'Restore Banded pull-apart').click();
    await settle(fixture);
    watcher.stop();

    expect(watcher.reasons).toEqual([]);
    expect(fixture.componentInstance['pendingRow']()).toBeNull();
    expect(host.querySelector('.page-notice')?.textContent?.trim()).toBe('');
    expect(button(host, 'Try again')).toBeTruthy();
  });

  // ---------- the editor boundary ----------

  it('keeps New exercise as the one dominant action and opens the existing editor', async () => {
    const { fixture, host } = await render();

    const filled = Array.from(host.querySelectorAll('.tb-button--filled')).map((action) =>
      (action.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(filled).toEqual(['New exercise']);

    button(host, 'New exercise').click();
    await settle(fixture);

    expect(host.querySelector('.editor-section')).not.toBeNull();
    expect(host.querySelector('.media-section')).not.toBeNull();
    expect(field(host, 'Name')).toBeTruthy();
  });

  it('opens the same editor for Edit, prefilled from the row', async () => {
    const { fixture, host } = await render();

    button(host, 'Edit Barbell back squat').click();
    await settle(fixture);

    expect((field(host, 'Name') as HTMLInputElement).value).toBe('Barbell back squat');
  });
});
