import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CreateProgramDraftRequest,
  PreviewWeekProgressionRequest,
  ProgramDraftSaveView,
  ProgramDraftView,
  ProgramTemplateSummary,
  ProgramTemplateVersionView,
  WeekProgressionPreviewView,
} from '../../core/api/generated';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
import { fill, press, settle } from '../../../testing/dom';
import {
  draftSummary,
  draftView,
  LIBRARY,
  prescription,
  saveView,
  sessionView,
  setView,
  templateSummary,
  versionView,
} from '../../../testing/program-builder-fixtures';
import { type AutosaveTiming, PROGRAM_AUTOSAVE_TIMING } from './program-autosave';
import { ProgramBuilder } from './program-builder';
import { ProgramBuilderApi } from './program-builder-api';

@Component({ template: '' })
class ProgramsStub {}

/** Every change is sent at once, and a failed save waits longer than any test runs. */
const AT_ONCE: AutosaveTiming = { quietMs: 0, maxWaitMs: 0, retryMs: 600_000, retryMaxMs: 600_000 };
/** Changes wait to be sent, so a test can leave before they go. */
const HELD_BACK: AutosaveTiming = { ...AT_ONCE, quietMs: 600_000, maxWaitMs: 600_000 };

interface DraftCalls {
  getDraft: () => Observable<ProgramDraftView>;
  createDraft: () => Observable<ProgramDraftSaveView>;
  saveDraft: () => Observable<ProgramDraftSaveView>;
  discardDraft: () => Observable<void>;
  publishDraft: () => Observable<ProgramTemplateVersionView>;
}

/** The copies of a week the server would calculate: each a half RPE point on from the one before. */
function previewCopies(
  request: PreviewWeekProgressionRequest,
): Observable<WeekProgressionPreviewView> {
  return of({
    transformKey: 'WeekStep',
    transformVersion: '1.0',
    weeks: Array.from({ length: Number(request.copies) }, (_, index) => ({
      ...request.sourceWeek,
      sessions: request.sourceWeek.sessions.map((session) => ({
        ...session,
        exercises: session.exercises.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => ({
            ...set,
            targetRpe: set.targetRpe == null ? null : Number(set.targetRpe) + 0.5 * (index + 1),
          })),
        })),
      })),
    })),
  });
}

interface Options {
  url?: string;
  /** The program read; the second read (after a publish) can answer differently. */
  getProgram?: () => Observable<ProgramTemplateSummary>;
  versions?: Record<string, ProgramTemplateVersionView>;
  api?: Record<string, unknown>;
  drafts?: Partial<DraftCalls>;
  timing?: AutosaveTiming;
}

const offline = () => throwError(() => new HttpErrorResponse({ status: 0 }));
const refusal = (status: number, code: string) =>
  throwError(() => new HttpErrorResponse({ status, error: { code, message: code } }));

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
    saveTrainingSession: vi.fn(() => of({})),
    ...options.api,
  };
  const drafts = options.drafts ?? {};
  const programApi = {
    getProgram,
    getDraft: vi.fn(drafts.getDraft ?? (() => of(draftView()))),
    createDraft: vi.fn(drafts.createDraft ?? (() => of(saveView()))),
    saveDraft: vi.fn(drafts.saveDraft ?? (() => of(saveView('draft-1', 9)))),
    discardDraft: vi.fn(drafts.discardDraft ?? (() => of(undefined))),
    publishDraft: vi.fn(
      drafts.publishDraft ??
        (() => of(versionView({ id: 'version-3', versionNumber: 3, isPublished: true }))),
    ),
    listDrafts: vi.fn(() => of([])),
    previewWeekProgression: vi.fn(previewCopies),
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  const toast = { show: vi.fn(() => ({ dismiss: vi.fn() })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'training/programs', component: ProgramsStub },
        {
          path: 'training/programs/:templateId',
          component: ProgramBuilder,
          canDeactivate: [confirmBeforeLeaving],
        },
      ]),
      { provide: ApiClient, useValue: api },
      { provide: ProgramBuilderApi, useValue: programApi },
      { provide: CsrfService, useValue: csrf },
      { provide: UiToast, useValue: toast },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: PROGRAM_AUTOSAVE_TIMING, useValue: options.timing ?? AT_ONCE },
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
    programApi,
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

/** Waits, a macrotask at a time, for a dialog with this title to open. */
async function dialogNamed(
  fixture: { detectChanges(): void },
  title: string,
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    const open = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
      (dialog) => textOf(dialog.querySelector('h2')) === title,
    );
    if (open) return open;
    await new Promise((resolve) => setTimeout(resolve));
  }
  throw new Error(`No dialog titled "${title}" opened.`);
}

const sessionsOf = (week: HTMLElement) => all(week, '.session-name').map(textOf);
const dayOf = (week: HTMLElement, day: number) => all(week, '.day')[day];
const status = (host: HTMLElement) => textOf(host.querySelector('.status'));

async function publishReviewed(host: HTMLElement, fixture: ComponentFixture<unknown>) {
  press(host, 'Publish');
  await settle(fixture);
  press(sheet(), 'Publish program');
}
const alerts = (host: HTMLElement) => all(host, '[role="alert"]').map(textOf);

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
    expect(status(host)).toBe('Published: you can assign it');
    expect(textOf(host.querySelector('#weeks-title'))).toBe('2 weeks · 4 sessions');
    // Nothing changed and this version is published: nothing to publish, nothing to discard.
    expect(all(host, '.save-buttons button').map(textOf)).toEqual(['Versions', 'Publish']);
    expect((all(host, '.save-buttons button')[1] as HTMLButtonElement).disabled).toBe(true);
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

  it('keeps a change as the coach’s own draft, then saves later changes from the version it read', async () => {
    const { host, harness, programApi } = await render();

    named(all(host, 'section.week')[0], 'Lower A').click();
    await settle(harness.fixture);
    expect(textOf(sheet().querySelector('h2'))).toBe('Edit session');
    fill(sheet(), 'Session name', 'Lower body A');
    await settle(harness.fixture);

    expect(sessionsOf(all(host, 'section.week')[0])).toEqual(['Lower body A', 'Upper A']);
    expect(programApi.createDraft).toHaveBeenCalledTimes(1);
    const [start] = programApi.createDraft.mock.lastCall as unknown as [CreateProgramDraftRequest];
    expect([start.templateId, start.sourceVersionId, start.templateVersionNumber]).toEqual([
      'template-1',
      'version-2',
      2,
    ]);
    expect(start.content.weeks[0].sessions[0].name).toBe('Lower body A');
    expect(start.content.weeks).toHaveLength(2);
    expect(status(host)).toMatch(/^Saved at \d\d:\d\d, not published yet$/);
    expect(textOf(host.querySelector('.save [role="status"]'))).toBe('');
    expect(all(host, '.save-buttons button').map(textOf)).toEqual([
      'Discard changes',
      'Versions',
      'Publish',
    ]);

    fill(sheet(), 'Session name', 'Lower body');
    await settle(harness.fixture);
    expect(programApi.saveDraft).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ version: 8 }),
    );
    expect(programApi.createDraft).toHaveBeenCalledTimes(1);
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

  it('opens the coach’s own draft instead of the newest version, and says when one came out since', async () => {
    const { host, api, programApi } = await render({
      getProgram: () => of(templateSummary({ currentVersionNumber: 3, draft: draftSummary() })),
    });

    expect(programApi.getDraft).toHaveBeenCalledWith('draft-1');
    expect(api.getProgramTemplateVersion).not.toHaveBeenCalled();
    expect(all(host, 'section.week')).toHaveLength(1);
    expect(sessionsOf(all(host, 'section.week')[0])).toEqual(['Lower A, heavier']);
    expect(textOf(host.querySelector('.exercise-line'))).toBe('1 × 3 · 80% · RPE 8');
    expect(status(host)).toBe('Saved on Sun 4 Oct, not published yet');
    expect(textOf(host.querySelector('.older'))).toBe(
      'Version 3 was published after you started these changes. Publishing yours makes it the newest version; version 3 stays in Versions.',
    );
  });

  it('publishes the stored draft as the next version, then reopens the program', async () => {
    let reads = 0;
    const { host, harness, programApi, toast, getProgram } = await render({
      getProgram: () =>
        of(
          ++reads === 1
            ? templateSummary({ draft: draftSummary() })
            : templateSummary({ currentVersionNumber: 3 }),
        ),
    });

    await publishReviewed(host, harness.fixture);
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(programApi.createDraft).not.toHaveBeenCalled();
    expect(programApi.publishDraft).toHaveBeenCalledWith('draft-1', {
      version: 7,
      replaceNewer: false,
    });
    expect(getProgram).toHaveBeenCalledTimes(2);
    expect(toast.show).toHaveBeenCalledWith(
      'Published. Clients already on this program keep their own copy.',
      { tone: 'success' },
    );
    expect(status(host)).toBe('Published: you can assign it');
    expect(host.querySelector('.save-buttons button')?.textContent).not.toContain('Discard');
  });

  it('stores an untouched earlier version as a draft before publishing it as the newest', async () => {
    const { host, harness, programApi } = await render({
      url: '/training/programs/template-1?version=version-1',
    });

    expect(textOf(host.querySelector('.older'))).toMatch(
      /^You’re looking at an earlier version \(Version 1, Sun 20 Sep, \d\d:\d\d\)\. Publishing makes it the newest version\.$/,
    );
    await publishReviewed(host, harness.fixture);
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(programApi.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'template-1', sourceVersionId: 'version-1' }),
    );
    expect(programApi.publishDraft).toHaveBeenCalledWith('draft-1', {
      version: 8,
      replaceNewer: false,
    });
  });

  it('asks before publishing over a version published since, and does on request', async () => {
    let publishes = 0;
    let reads = 0;
    const { host, harness, programApi } = await render({
      getProgram: () =>
        of(
          ++reads === 1
            ? templateSummary({ draft: draftSummary() })
            : templateSummary({ currentVersionNumber: 3 }),
        ),
      drafts: {
        publishDraft: () =>
          ++publishes === 1
            ? refusal(409, 'newer_version_published')
            : of(versionView({ id: 'version-4', versionNumber: 4 })),
      },
    });

    await publishReviewed(host, harness.fixture);
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(alerts(host)[0]).toBe(
      'Version 3 of this program was published after you started these changes. Publish yours as the newest version? Version 3 stays in Versions. Publish mine as the newest Discard mine',
    );

    press(sheet(), 'Publish mine as the newest');
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(programApi.publishDraft).toHaveBeenLastCalledWith('draft-1', {
      version: 7,
      replaceNewer: true,
    });
    expect(alerts(host)).toEqual([]);
  });

  it('asks a new program for a name before publishing, keeps it as a draft, then opens it by its id', async () => {
    const { host, harness, programApi, toast, router } = await render({
      url: '/training/programs/new',
      getProgram: () => of(templateSummary({ id: 'template-new', name: 'Hypertrophy' })),
      drafts: {
        createDraft: () => of(saveView('draft-new', 3)),
        publishDraft: () =>
          of(versionView({ id: 'version-new', templateId: 'template-new', versionNumber: 1 })),
      },
    });

    expect(status(host)).toBe('Your changes save as you work');
    expect(sessionsOf(all(host, 'section.week')[0])).toEqual(['Training day']);
    press(host, 'Publish');
    await settle(harness.fixture);
    expect(alerts(host)).toEqual(['Give the program a name.']);
    expect(programApi.createDraft).not.toHaveBeenCalled();

    fill(host, 'Program name', 'Hypertrophy');
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(programApi.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: null, sourceVersionId: null }),
    );
    // In the address for a refresh, without a navigation that would scroll the page mid-edit.
    expect(TestBed.inject(Location).path()).toBe('/training/programs/new?draft=draft-new');
    expect(router.url).toBe('/training/programs/new');

    await publishReviewed(host, harness.fixture);
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(programApi.publishDraft).toHaveBeenCalledWith('draft-new', {
      version: 3,
      replaceNewer: false,
    });
    expect(router.url).toBe('/training/programs/template-new');
    expect(toast.show).toHaveBeenCalledWith('Published. You can assign it to clients now.', {
      tone: 'success',
    });
  });

  it('reopens a new program from its draft in the address', async () => {
    const { host, programApi, getProgram } = await render({
      url: '/training/programs/new?draft=draft-new',
      drafts: {
        getDraft: () => of(draftView({ id: 'draft-new', templateId: null, sourceVersionId: null })),
      },
    });

    expect(programApi.getDraft).toHaveBeenCalledWith('draft-new');
    expect(getProgram).not.toHaveBeenCalled();
    expect(sessionsOf(all(host, 'section.week')[0])).toEqual(['Lower A, heavier']);
    expect(all(host, '.save-buttons button').map(textOf)).toEqual(['Discard changes', 'Publish']);
  });

  it('names the invalid set, opens it on the grid and focuses its field', async () => {
    const broken = versionView();
    broken.weeks[1].sessions[1].exercises[0].sets[0].targetRpe = 11;
    const { host, harness, programApi } = await render({ versions: { 'version-2': broken } });

    fill(host, 'Program name', 'Strength base, edited');
    await settle(harness.fixture);
    press(host, 'Publish');
    await settle(harness.fixture);

    expect(textOf(host.querySelector('[role="alert"] p'))).toBe(
      'Week 2, Upper A: RPE must be between 5 and 10 in 0.5 steps.',
    );
    expect(programApi.publishDraft).not.toHaveBeenCalled();
    press(host, 'Fix the set');
    await settle(harness.fixture);
    expect(host.querySelector('.inline-sets')).not.toBeNull();
    expect((document.activeElement as HTMLInputElement).value).toBe('11');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('focuses the session name when a blank one prevents previewing', async () => {
    const broken = versionView();
    broken.weeks[0].sessions[0].name = '';
    const { host, harness, programApi } = await render({ versions: { 'version-2': broken } });
    fill(host, 'Program name', 'Edited program');
    await settle(harness.fixture);
    press(host, 'Publish');
    await settle(harness.fixture);
    expect(textOf(sheet().querySelector('h2'))).toBe('Edit session');
    expect(document.activeElement).toBe(sheet().querySelector('.basics input'));
    expect(programApi.publishDraft).not.toHaveBeenCalled();
  });

  it('previews without publishing and returns to the same draft when cancelled', async () => {
    const { host, harness, programApi } = await render({ timing: HELD_BACK });
    fill(host, 'Program name', 'Reviewed strength');
    await settle(harness.fixture);
    press(host, 'Publish');
    await settle(harness.fixture);
    expect(textOf(sheet().querySelector('h3'))).toBe('Reviewed strength');
    expect(programApi.publishDraft).not.toHaveBeenCalled();
    expect(programApi.createDraft).not.toHaveBeenCalled();
    press(sheet(), 'Back to editing');
    await settle(harness.fixture);
    expect(host.querySelector<HTMLInputElement>('.name-input')?.value).toBe('Reviewed strength');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes a private preview when the workspace changes', async () => {
    const { host, harness, programApi } = await render({ timing: HELD_BACK });
    fill(host, 'Program name', 'Private preview');
    await settle(harness.fixture);
    press(host, 'Publish');
    await settle(harness.fixture);
    expect(textOf(sheet().querySelector('h3'))).toBe('Private preview');
    (TestBed.inject(TenantStore).selectedTenantId as WritableSignal<string | null>).set('tenant-2');
    await settle(harness.fixture);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(programApi.publishDraft).not.toHaveBeenCalled();
  });

  it('autosaves the grid’s inline set changes without changing the other sets or opening a sheet', async () => {
    const { host, harness, programApi } = await render();
    host.querySelector<HTMLButtonElement>('.prescription-toggle')!.click();
    await settle(harness.fixture);
    const inline = host.querySelector<HTMLElement>('.inline-sets')!;
    fill(inline, 'Reps from', '3');
    fill(inline, 'Reps to', '6');
    fill(inline, '% of training max', '82.5');
    fill(inline, 'RPE target', '8');
    await settle(harness.fixture);
    await settle(harness.fixture);
    const call = (
      programApi.createDraft.mock.calls as unknown as [CreateProgramDraftRequest][]
    )[0][0];
    expect(call?.content.weeks[0].sessions[0].exercises[0].sets[0]).toMatchObject({
      repetitionsMinimum: 3,
      repetitionsMaximum: 6,
      percentageWorkingMax: 82.5,
      targetRpe: 8,
    });
    expect(call?.content.weeks[0].sessions[0].exercises[0].sets[1]).toMatchObject({
      repetitionsMinimum: 5,
      repetitionsMaximum: 5,
      percentageWorkingMax: 75,
      targetRpe: 7,
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(programApi.publishDraft).not.toHaveBeenCalled();
  });

  it('discards the coach’s changes after asking, and opens the program as published', async () => {
    let reads = 0;
    const { host, harness, programApi, toast } = await render({
      getProgram: () =>
        of(++reads === 1 ? templateSummary({ draft: draftSummary() }) : templateSummary()),
    });

    press(host, 'Discard changes');
    await settle(harness.fixture);
    expect(textOf(sheet().querySelector('h2'))).toBe('Discard your changes?');
    named(sheet(), 'Keep editing').click();
    await settle(harness.fixture);
    expect(programApi.discardDraft).not.toHaveBeenCalled();

    press(host, 'Discard changes');
    await settle(harness.fixture);
    named(sheet(), 'Discard changes').click();
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(programApi.discardDraft).toHaveBeenCalledWith('draft-1', 7);
    expect(sessionsOf(all(host, 'section.week')[0])).toEqual(['Lower A', 'Upper A']);
    expect(status(host)).toBe('Published: you can assign it');
    expect(toast.show).toHaveBeenCalledWith('Changes discarded.');
  });

  it('sends changes still waiting before the coach leaves, without asking', async () => {
    const { host, harness, programApi, router } = await render({ timing: HELD_BACK });

    fill(host, 'Program name', 'Strength base, heavier');
    await settle(harness.fixture);
    expect(status(host)).toBe('Saving…');
    expect(programApi.createDraft).not.toHaveBeenCalled();

    expect(await router.navigateByUrl('/training/programs')).toBe(true);
    expect(programApi.createDraft).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('asks before leaving changes that cannot be saved, and stays when asked to', async () => {
    const { host, harness, router } = await render({ drafts: { createDraft: offline } });

    fill(host, 'Program name', 'Strength base, heavier');
    await settle(harness.fixture);
    expect(status(host)).toBe('Not saved yet. Trying again…');
    // Saving is not announced at every pause; failing to is.
    expect(textOf(host.querySelector('.save [role="status"]'))).toBe(
      'Not saved yet. Trying again…',
    );

    // A navigation in progress keeps the page unstable, so the dialog is awaited, not `settle`.
    const stay = router.navigateByUrl('/training/programs');
    const asked = await dialogNamed(harness.fixture, 'Leave without saving?');
    expect(textOf(asked)).toContain('Your latest changes have not reached the server yet.');
    named(asked, 'Stay').click();
    expect(await stay).toBe(false);
    expect(router.url).toBe('/training/programs/template-1');

    const leave = router.navigateByUrl('/training/programs');
    named(
      await dialogNamed(harness.fixture, 'Leave without saving?'),
      'Leave without saving',
    ).click();
    expect(await leave).toBe(true);
    expect(router.url).toBe('/training/programs');
  });

  it('lets a workspace switch or a sign-out ask it first, and warns before a reload', async () => {
    const { host, harness } = await render({ drafts: { createDraft: offline } });
    const unsaved = TestBed.inject(UnsavedWork);
    expect(await unsaved.confirmLeave()).toBe(true);

    fill(host, 'Program name', 'Strength base, heavier');
    await settle(harness.fixture);
    const reload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);

    const asked = unsaved.confirmLeave();
    await settle(harness.fixture);
    named(sheet(), 'Stay').click();
    expect(await asked).toBe(false);
  });

  it('announces a failed save and the save that ends it, and nothing in between', async () => {
    let attempts = 0;
    const { host, harness } = await render({
      drafts: { createDraft: () => (++attempts === 1 ? offline() : of(saveView())) },
    });
    const live = () => textOf(host.querySelector('.save [role="status"]'));

    fill(host, 'Program name', 'Strength base, heavier');
    await settle(harness.fixture);
    expect(live()).toBe('Not saved yet. Trying again…');

    // Leaving sends again at once; this time it lands, so nothing needs asking.
    expect(await TestBed.inject(UnsavedWork).confirmLeave()).toBe(true);
    await settle(harness.fixture);
    expect(live()).toBe('Your changes are saved now.');
    expect(status(host)).toMatch(/^Saved at/);
  });

  it('says when another tab moved on, stops saving, and reloads on request', async () => {
    const { host, harness, programApi, getProgram } = await render({
      getProgram: () => of(templateSummary({ draft: draftSummary() })),
      drafts: { saveDraft: () => refusal(409, 'program_draft_stale') },
    });

    fill(host, 'Program name', 'Mine');
    await settle(harness.fixture);
    expect(alerts(host)).toEqual([
      'This program was changed in another tab or on another device. Reload to continue with the latest changes. Reload',
    ]);
    expect(status(host)).toBe('Not saved');
    fill(host, 'Program name', 'Mine again');
    await settle(harness.fixture);
    expect(programApi.saveDraft).toHaveBeenCalledTimes(1);

    press(host, 'Reload');
    await settle(harness.fixture);
    await settle(harness.fixture);
    expect(getProgram).toHaveBeenCalledTimes(2);
    expect(alerts(host)).toEqual([]);
  });

  it('says a read-only coaching space cannot keep changes', async () => {
    const { host, harness } = await render({
      drafts: { createDraft: () => refusal(403, 'workspace_read_only') },
    });

    fill(host, 'Program name', 'Mine');
    await settle(harness.fixture);

    expect(alerts(host)).toEqual([
      'Your coaching space is read-only until its TB Gym bill is paid. You can still view everything.',
    ]);
    expect(status(host)).toBe('Not saved');
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

  it('adds weeks from "Duplicate with progression" once the coach has read them, with one undo', async () => {
    const { host, harness, programApi, toast } = await render();

    named(host, 'More for week 1').click();
    await settle(harness.fixture);
    named(host, 'Duplicate with progression…').click();
    const open = await dialogNamed(harness.fixture, 'Duplicate with progression');
    fill(open, 'Copies', '2');
    await settle(harness.fixture);
    press(open, 'Show the new weeks');
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(programApi.previewWeekProgression).toHaveBeenCalledOnce();
    const [request] = programApi.previewWeekProgression.mock.calls[0] as unknown as [
      PreviewWeekProgressionRequest,
    ];
    expect([request.copies, request.weeksInProgram]).toEqual([2, 2]);
    expect(request.sourceWeek.sessions.map((session) => session.name)).toEqual([
      'Lower A',
      'Upper A',
    ]);
    // Reading the weeks adds nothing; the program still has its two.
    expect(all(host, 'section.week')).toHaveLength(2);

    press(open, 'Add 2 weeks');
    await settle(harness.fixture);

    expect(all(host, 'section.week')).toHaveLength(4);
    expect(all(host, '.week-label').map((input) => (input as HTMLInputElement).value)).toEqual([
      'Week 1',
      'Week 2',
      'Week 3',
      'Week 4',
    ]);
    // The fixture's back squat is 75% for 5 at RPE 7, so the first copy asks RPE 7.5.
    expect(textOf(all(all(host, 'section.week')[1], '.session-card')[0])).toContain('RPE 7.5');
    expect(textOf(all(all(host, 'section.week')[2], '.session-card')[0])).toContain('RPE 8');
    const [message, options] = toast.show.mock.lastCall as unknown as [
      string,
      { action: { label: string; run: () => void } },
    ];
    expect(message).toBe('2 weeks added after week 1.');
    options.action.run();
    await settle(harness.fixture);
    expect(all(host, 'section.week')).toHaveLength(2);
  });

  it('keeps the menu entry out of reach once the program holds 52 weeks', async () => {
    const full = versionView({
      weeks: Array.from({ length: 52 }, (_, index) => ({
        ...versionView().weeks[0],
        id: `week-${index + 1}`,
        weekNumber: index + 1,
        label: `Week ${index + 1}`,
      })),
    });
    const { host, harness } = await render({ versions: { 'version-2': full } });

    named(host, 'More for week 1').click();
    await settle(harness.fixture);

    const entry = all(host, 'button').find((candidate) =>
      textOf(candidate).startsWith('Duplicate with progression'),
    ) as HTMLButtonElement;
    // A disabled menu item stays listed and focusable, and says why.
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    expect(textOf(entry)).toContain('A program holds up to 52 weeks.');
  });

  it('moves every RPE-loaded set to the formula the coach picks and says what is outside the chart', async () => {
    const rpeWeek = {
      ...versionView().weeks[0],
      sessions: [
        sessionView('lower-1', 'Lower A', 0, [
          prescription('squat', 'Back squat', {
            isMainLift: true,
            sets: [
              setView({ loadStrategy: 'RpeChart', percentageWorkingMax: null, targetRpe: 7 }),
              setView({ loadStrategy: 'RpeChart', percentageWorkingMax: null, targetRpe: 6 }),
            ],
          }),
        ]),
      ],
    };
    const { host, harness, toast } = await render({
      versions: { 'version-2': versionView({ weeks: [rpeWeek] }) },
    });
    const lastToast = () =>
      toast.show.mock.lastCall as unknown as [string, { action: { run: () => void } }];
    const chooseFormula = async (formula: string) => {
      const trigger = all(host, 'button').find((candidate) =>
        textOf(candidate).startsWith('Weights from RPE:'),
      ) as HTMLButtonElement;
      trigger.click();
      await settle(harness.fixture);
      (
        all(host, 'ul.panel button').find((item) => textOf(item).startsWith(formula)) as HTMLElement
      ).click();
      await settle(harness.fixture);
    };

    named(host, 'Weights from RPE: RTS chart');
    await chooseFormula('Epley curve');
    expect(lastToast()[0]).toBe('2 sets now take their weight from the Epley curve.');
    named(host, 'Weights from RPE: Epley curve');

    // Back to the chart: the set at RPE 6 is outside it, and the coach is told.
    await chooseFormula('RTS chart');
    expect(lastToast()[0]).toBe(
      '2 sets now take their weight from the RTS chart. 1 of them is outside the chart: type a weight or use the Epley curve for it.',
    );
    lastToast()[1].action.run();
    await settle(harness.fixture);
    named(host, 'Weights from RPE: Epley curve');
  });

  it('says a program that is not there is not there', async () => {
    const { host } = await render({
      getProgram: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });

    expect(textOf(host.querySelector('h2'))).toBe('This program isn’t here');
    expect(host.querySelector('section.week')).toBeNull();
  });
});
