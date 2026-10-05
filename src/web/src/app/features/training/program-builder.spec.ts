import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ProgramTemplateSummary, ProgramTemplateVersionView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
import { fill, press, settle } from '../../../testing/dom';
import { LIBRARY, templateSummary, versionView } from '../../../testing/program-builder-fixtures';
import { ProgramBuilder } from './program-builder';
import { ProgramBuilderApi } from './program-builder-api';

@Component({ template: '' })
class ProgramsStub {}

interface Options {
  url?: string;
  /** The program read; the second read (after a save) can answer differently. */
  getProgram?: () => Observable<ProgramTemplateSummary>;
  versions?: Record<string, ProgramTemplateVersionView>;
  api?: Record<string, unknown>;
}

async function render(options: Options = {}) {
  const getProgram = vi.fn(options.getProgram ?? (() => of(templateSummary())));
  const api = {
    getProgramTemplateVersion: vi.fn((id: string) =>
      of(options.versions?.[id] ?? versionView({ id })),
    ),
    searchExercises: vi.fn(() => of({ items: LIBRARY, total: LIBRARY.length })),
    listSavedSessions: vi.fn(() => of([])),
    createMediaAccessBatch: vi.fn(() =>
      of({
        items: [
          {
            assetId: 'media-row',
            kind: 'Image',
            source: 'Upload',
            contentType: 'image/webp',
            url: '/media/row.webp',
            expiresAtUtc: '2026-10-05T12:00:00Z',
            downloadAllowed: false,
          },
        ],
      }),
    ),
    createProgramTemplate: vi.fn(() =>
      of(versionView({ id: 'version-new', templateId: 'template-new', versionNumber: 1 })),
    ),
    addProgramTemplateVersion: vi.fn(() =>
      of(versionView({ id: 'version-3', versionNumber: 3, isPublished: false })),
    ),
    saveTrainingSession: vi.fn(() => of({})),
    ...options.api,
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  const toast = { show: vi.fn(() => ({ dismiss: vi.fn() })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'training/programs', component: ProgramsStub },
        { path: 'training/programs/:templateId', component: ProgramBuilder },
      ]),
      { provide: ApiClient, useValue: api },
      { provide: ProgramBuilderApi, useValue: { getProgram } },
      { provide: CsrfService, useValue: csrf },
      { provide: UiToast, useValue: toast },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(options.url ?? '/training/programs/template-1', ProgramBuilder);
  await settle(harness.fixture);
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    api,
    csrf,
    toast,
    getProgram,
    router: TestBed.inject(Router),
  };
}

const all = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(selector));
const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** A button by the name it announces: its visible text, or the label of an icon-only one. */
function named(host: ParentNode, name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (candidate) =>
      (candidate.getAttribute('aria-label') ?? textOf(candidate)) === name && !candidate.disabled,
  );
  if (found.length !== 1) throw new Error(`${found.length} enabled buttons are named "${name}".`);
  return found[0];
}

function sheet(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  const last = dialogs[dialogs.length - 1];
  if (!last) throw new Error('No sheet is open.');
  return last;
}

const sessionsOf = (week: HTMLElement) => all(week, '.session-name').map(textOf);
const dayOf = (week: HTMLElement, day: number) => all(week, '.day')[day];

describe('the program builder', () => {
  afterEach(() => {
    document.body
      .querySelectorAll('.cdk-overlay-container')
      .forEach((node) => node.replaceChildren());
    TestBed.resetTestingModule();
  });

  it('draws each week as seven days with their sessions and one line per exercise', async () => {
    const { host, api } = await render();

    expect(api.getProgramTemplateVersion).toHaveBeenCalledWith('version-2');
    const weeks = all(host, 'section.week');
    expect(weeks).toHaveLength(2);
    expect(all(weeks[0], '.day-label').map(textOf)).toEqual([
      'Day 1',
      'Day 2',
      'Day 3',
      'Day 4',
      'Day 5',
      'Day 6',
      'Day 7',
    ]);
    expect(sessionsOf(weeks[0])).toEqual(['Lower A', 'Upper A']);
    expect(all(weeks[0], '.day.rest')).toHaveLength(5);
    const lower = all(weeks[0], '.session-card')[0];
    expect(
      all(lower, '.exercise-row').map((row) => [
        textOf(row.querySelector('.exercise-name')),
        textOf(row.querySelector('.exercise-line')),
      ]),
    ).toEqual([
      ['Back squat Main', '3 × 5 · 75% · RPE 7'],
      ['Romanian deadlift', '2 × 8–10 · RPE 8'],
    ]);
    expect(textOf(host.querySelector('.status'))).toBe('Published: you can assign it');
    expect(textOf(host.querySelector('#weeks-title'))).toBe('2 weeks · 4 sessions');
    // Nothing changed and this version is published: nothing to save.
    expect(named(host, 'Versions')).toBeTruthy();
    expect(
      all(host, '.save-buttons button')
        .filter((item) => (item as HTMLButtonElement).disabled)
        .map(textOf),
    ).toEqual(['Save draft', 'Publish']);
  });

  it('lists the library with pictures where granted, searches it and groups it by movement', async () => {
    const { host, harness, csrf, api } = await render();

    const library = host.querySelector<HTMLElement>('app-program-library')!;
    expect(csrf.refresh).toHaveBeenCalled();
    expect(api.createMediaAccessBatch).toHaveBeenCalledWith(['media-row']);
    const rows = all(library, '.lib-item');
    expect(rows.map((row) => textOf(row.querySelector('.name')))).toEqual([
      'Back squat',
      'Bench press',
      'Chest-supported row',
      'Goblet squat',
      'Romanian deadlift',
    ]);
    expect(rows[2].querySelector('img')?.getAttribute('src')).toBe('/media/row.webp');
    expect(textOf(rows[0].querySelector('.tile'))).toBe('BS');
    expect(all(library, '.chip').map(textOf)).toEqual(['All', 'Squat', 'Hinge', 'Push', 'Pull']);

    fill(library, 'Search exercises', 'GOBLET');
    await settle(harness.fixture);
    expect(all(library, '.lib-item .name').map(textOf)).toEqual(['Goblet squat']);

    fill(library, 'Search exercises', '');
    library.querySelector<HTMLInputElement>('.chip input[value="pull"]')!.click();
    await settle(harness.fixture);
    expect(all(library, '.lib-item .name').map(textOf)).toEqual(['Chest-supported row']);
  });

  it('renames a session in its sheet, follows it on the grid and marks the program unsaved', async () => {
    const { host, harness } = await render();

    named(all(host, 'section.week')[0], 'Lower A').click();
    await settle(harness.fixture);
    expect(textOf(sheet().querySelector('h2'))).toBe('Edit session');
    fill(sheet(), 'Session name', 'Lower body A');
    await settle(harness.fixture);

    expect(sessionsOf(all(host, 'section.week')[0])).toEqual(['Lower body A', 'Upper A']);
    expect(textOf(host.querySelector('.status'))).toBe('Unsaved changes');
    expect(named(host, 'Save draft')).toBeTruthy();
  });

  it('takes an exercise out in the session sheet and offers to put it back', async () => {
    const { host, harness, toast } = await render();
    const lower = () => all(all(host, 'section.week')[0], '.session-card')[0];

    named(all(host, 'section.week')[0], 'Lower A').click();
    await settle(harness.fixture);
    named(sheet(), 'Remove Romanian deadlift').click();
    await settle(harness.fixture);

    expect(all(lower(), '.exercise-name').map(textOf)).toEqual(['Back squat Main']);
    expect(all(sheet(), '.exercise h4').map(textOf)).toEqual(['1. Back squat']);
    const [message, options] = toast.show.mock.lastCall as unknown as [
      string,
      { action: { run: () => void } },
    ];
    expect(message).toBe('Romanian deadlift removed.');
    options.action.run();
    await settle(harness.fixture);
    expect(all(lower(), '.exercise-name').map(textOf)).toEqual([
      'Back squat Main',
      'Romanian deadlift',
    ]);
  });

  it('starts a session on a rest day from the add sheet and keeps adding to it', async () => {
    const { host, harness } = await render();

    named(host, 'Add to week 1, day 2').click();
    await settle(harness.fixture);
    expect(textOf(sheet().querySelector('h2'))).toBe('Add to week 1, day 2');
    named(sheet(), 'Add Goblet squat').click();
    await settle(harness.fixture);
    named(sheet(), 'Add Chest-supported row').click();
    await settle(harness.fixture);

    const day2 = dayOf(all(host, 'section.week')[0], 1);
    expect(all(day2, '.session-name').map(textOf)).toEqual(['Training day']);
    expect(all(day2, '.exercise-name').map(textOf)).toEqual([
      'Goblet squat',
      'Chest-supported row',
    ]);
    expect(all(sheet(), '.added').map(textOf)).toEqual(['Added', 'Added']);
    expect(textOf(sheet().querySelector('[role="status"]'))).toBe('Chest-supported row added.');
  });

  it('saves a draft as a new version that carries the program’s token, then reopens it', async () => {
    let reads = 0;
    const { host, harness, api, toast, getProgram } = await render({
      getProgram: () =>
        of(
          ++reads === 1
            ? templateSummary()
            : templateSummary({
                version: 42,
                currentVersionNumber: 3,
                versions: [
                  {
                    id: 'version-3',
                    versionNumber: 3,
                    name: 'Strength base 2',
                    isPublished: false,
                    weekCount: 2,
                    createdAtUtc: '2026-10-05T09:00:00Z',
                  },
                  ...templateSummary().versions,
                ],
              }),
        ),
      versions: {
        'version-3': versionView({ id: 'version-3', versionNumber: 3, isPublished: false }),
      },
    });

    fill(host, 'Program name', 'Strength base 2');
    await settle(harness.fixture);
    press(host, 'Save draft');
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(api.addProgramTemplateVersion).toHaveBeenCalledWith(
      'template-1',
      expect.objectContaining({ name: 'Strength base 2', publish: false, templateVersion: 41 }),
    );
    expect(getProgram).toHaveBeenCalledTimes(2);
    expect(api.getProgramTemplateVersion).toHaveBeenLastCalledWith('version-3');
    expect(toast.show).toHaveBeenCalledWith('Draft saved. Publish it when it is ready to assign.', {
      tone: 'success',
    });
    expect(textOf(host.querySelector('.status'))).toBe('Draft: not ready to assign');
  });

  it('says when someone else saved first, and opens the newest version on request', async () => {
    const { host, harness, getProgram } = await render({
      api: {
        addProgramTemplateVersion: vi.fn(() =>
          throwError(
            () => new HttpErrorResponse({ status: 409, error: { code: 'concurrency_conflict' } }),
          ),
        ),
      },
    });

    fill(host, 'Program name', 'Mine');
    await settle(harness.fixture);
    press(host, 'Publish');
    await settle(harness.fixture);

    expect(textOf(host.querySelector('[role="alert"]'))).toContain(
      'Someone saved this program while you were working on it',
    );
    expect(textOf(host.querySelector('.status'))).toBe('Unsaved changes');
    press(host, 'Open the newest version');
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(getProgram).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(textOf(host.querySelector('.status'))).toBe('Published: you can assign it');
  });

  it('asks a new program for a name before publishing it, then opens it by its id', async () => {
    const { host, harness, api, toast, router } = await render({
      url: '/training/programs/new',
      getProgram: () => of(templateSummary({ id: 'template-new', name: 'Hypertrophy' })),
    });

    expect(textOf(host.querySelector('.status'))).toBe('Not saved yet');
    expect(sessionsOf(all(host, 'section.week')[0])).toEqual(['Training day']);
    press(host, 'Publish');
    await settle(harness.fixture);
    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Give the program a name.');
    expect(api.createProgramTemplate).not.toHaveBeenCalled();

    fill(host, 'Program name', 'Hypertrophy');
    await settle(harness.fixture);
    press(host, 'Publish');
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(api.createProgramTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hypertrophy', publish: true, templateVersion: null }),
    );
    expect(router.url).toBe('/training/programs/template-new');
    expect(toast.show).toHaveBeenCalledWith('Published. You can assign it to clients now.', {
      tone: 'success',
    });
  });

  it('names the session that stops a save and opens it', async () => {
    const broken = versionView();
    broken.weeks[1].sessions[1].exercises[0].sets[0].targetRpe = 11;
    const { host, harness } = await render({ versions: { 'version-2': broken } });

    fill(host, 'Program name', 'Strength base, edited');
    await settle(harness.fixture);
    press(host, 'Save draft');
    await settle(harness.fixture);

    expect(textOf(host.querySelector('[role="alert"] p'))).toBe(
      'Week 2, Upper A: RPE must be between 5 and 10 in 0.5 steps.',
    );
    press(host, 'Open the session');
    await settle(harness.fixture);
    expect((sheet().querySelector('input') as HTMLInputElement).value).toBe('Upper A');
  });

  it('duplicates a week from its menu and deletes one with an undo', async () => {
    const { host, harness, toast } = await render();

    named(host, 'More for week 1').click();
    await settle(harness.fixture);
    named(host, 'Duplicate week').click();
    await settle(harness.fixture);
    expect(all(host, 'section.week')).toHaveLength(3);
    expect(all(host, '.week-label').map((input) => (input as HTMLInputElement).value)).toEqual([
      'Week 1',
      'Week 2',
      'Week 3',
    ]);

    named(host, 'More for week 2').click();
    await settle(harness.fixture);
    named(host, 'Delete week').click();
    await settle(harness.fixture);
    expect(all(host, 'section.week')).toHaveLength(2);
    const [message, options] = toast.show.mock.lastCall as unknown as [
      string,
      { action: { label: string; run: () => void } },
    ];
    expect(message).toBe('Week 2 deleted.');
    options.action.run();
    await settle(harness.fixture);
    expect(all(host, 'section.week')).toHaveLength(3);
  });

  it('says so when it opens an earlier version', async () => {
    const { host, api } = await render({
      url: '/training/programs/template-1?version=version-1',
    });

    expect(api.getProgramTemplateVersion).toHaveBeenCalledWith('version-1');
    // The time follows the browser's zone, so only the date is pinned.
    expect(textOf(host.querySelector('.older'))).toMatch(
      /^You’re looking at an earlier version \(Version 1, Sun 20 Sep, \d\d:\d\d\)\. Saving makes it the newest version\.$/,
    );
  });

  it('says a program that is not there is not there', async () => {
    const { host } = await render({
      getProgram: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });

    expect(textOf(host.querySelector('h2'))).toBe('This program isn’t here');
    expect(host.querySelector('section.week')).toBeNull();
  });
});
