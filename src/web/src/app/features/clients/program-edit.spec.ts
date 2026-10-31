import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CoachClientDetails } from '../../core/api/api.models';
import type {
  CoachClientProgramView,
  PreviewProgramEditRequest,
  ProgramEditPreviewView,
  SavedSessionView,
  TrainingMesocycleView,
} from '../../core/api/generated';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { LIBRARY_SEARCH_PAUSE } from '../../ui/paged-search';
import { UiToast } from '../../ui/toast';
import {
  chartSet,
  datedSession,
  leanProgram,
  pastAndComingProgram,
  setView,
  weekView,
} from '../../../testing/mesocycle-fixtures';
import {
  exercise,
  prescription,
  searchLibrary,
  sessionView,
} from '../../../testing/program-builder-fixtures';
import { field, fill, formSummary, press, query, settle } from '../../../testing/dom';
import { ClientProgramApi } from './client-program-api';
import { ClientWorkspaceContext } from './client-workspace.context';
import { ProgramEditPage } from './program-edit';

const EDIT_URL = '/clients/client-1/training/block-lean/edit';

const READ: CoachClientProgramView = {
  isAllowed: true,
  accessReason: 'Granted',
  localDate: '2026-10-07',
  blocks: [],
  sessionStateRuleKey: 'ClientSessionState',
  sessionStateRuleVersion: 1,
};

function preview(overrides: Partial<ProgramEditPreviewView> = {}): ProgramEditPreviewView {
  return {
    previewHash: 'b'.repeat(64),
    ruleKey: 'GridEdit',
    ruleVersion: '1.0',
    today: '2026-10-07',
    frozenWeekCount: 2,
    resultingWeekCount: 3,
    currentEndDateExclusive: '2026-10-19',
    resultingEndDateExclusive: '2026-10-19',
    isInsideTrainingCoverage: true,
    problems: [],
    weeksAdded: 0,
    weeksMoved: 0,
    weeksRemoved: 0,
    sessionsAdded: 0,
    sessionsEdited: 0,
    sessionsMoved: 0,
    sessionsRemoved: 0,
    weekChanges: [
      { kind: 'Edited', weekNumber: 3, previousWeekNumber: 3, label: 'Deload', isShared: true },
    ],
    sessionChanges: [],
    ...overrides,
  };
}

interface Options {
  mesocycle?: TrainingMesocycleView;
  /** The exercise library the server holds; empty unless given. */
  library?: Parameters<typeof searchLibrary>[0];
  read?: CoachClientProgramView;
  programApi?: Record<string, unknown>;
  saved?: SavedSessionView[];
}

async function render(options: Options = {}) {
  const mesocycle = options.mesocycle ?? pastAndComingProgram();
  const api = {
    getTrainingMesocycle: vi.fn(() => of(mesocycle)),
    searchExercises: vi.fn(searchLibrary(options.library ?? [])),
    listSavedSessions: vi.fn(() => of(options.saved ?? [])),
    createMediaAccessBatch: vi.fn(() => of({ items: [] })),
  };
  const programApi = {
    getProgram: vi.fn(() => of(options.read ?? READ)),
    previewProgramEdit: vi.fn<
      (id: string, request: PreviewProgramEditRequest) => Observable<ProgramEditPreviewView>
    >(() => of(preview())),
    applyProgramEdit: vi.fn<(id: string, request: unknown) => Observable<TrainingMesocycleView>>(
      () => of({ ...mesocycle, version: 5 }),
    ),
    ...options.programApi,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'clients/:clientId/training', children: [] },
        {
          path: 'clients/:clientId/training/:mesocycleId/edit',
          component: ProgramEditPage,
          canDeactivate: [confirmBeforeLeaving],
        },
      ]),
      ClientWorkspaceContext,
      { provide: ApiClient, useValue: api },
      { provide: ClientProgramApi, useValue: programApi },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: signal('tenant-1'), isOwner: signal(true) },
      },
      { provide: LIBRARY_SEARCH_PAUSE, useValue: 0 },
    ],
  });
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set('client-1');
  context.profile.set({ id: 'client-1', firstName: 'Maya' } as unknown as CoachClientDetails);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(EDIT_URL, ProgramEditPage);
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    api,
    programApi,
    context,
    router: TestBed.inject(Router),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

async function dialogNamed(fixture: { detectChanges(): void }, title: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    const open = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
      (item) => textOf(item.querySelector('h2')) === title,
    );
    if (open) return open;
    await new Promise((resolve) => setTimeout(resolve));
  }
  throw new Error(`No dialog titled "${title}" opened.`);
}

function named(host: ParentNode, name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (candidate) => textOf(candidate) === name,
  );
  if (found.length !== 1) throw new Error(`${found.length} buttons are named "${name}".`);
  return found[0];
}

/** Renames week 3, as the coach types in its name field. */
function renameWeek3(host: HTMLElement, name = 'Deload'): void {
  const label = host.querySelector<HTMLInputElement>('input[aria-label="Name of week 3"]')!;
  label.value = name;
  label.dispatchEvent(new Event('input'));
}

describe('editing a client’s weeks', () => {
  afterEach(() => {
    document.body
      .querySelectorAll('.cdk-overlay-container')
      .forEach((node) => node.replaceChildren());
    localStorage.clear();
  });

  it('keeps the library as a rail until the coach opens it, as in the builder', async () => {
    const { host, harness } = await render({ library: [exercise('row', 'Seated row')] });

    expect(host.querySelector('app-program-library')).toBeNull();
    host.querySelector<HTMLButtonElement>('.library-rail')!.click();
    await settle(harness.fixture);
    expect(host.querySelector('app-program-library')).not.toBeNull();
    expect(localStorage.getItem('tb.program-library')).toBe('open');
    await settle(harness.fixture);
    expect(host.querySelector('app-program-library .lib-item')).not.toBeNull();
  });

  describe('adding without dragging, as in the builder (critique B16)', () => {
    const LIBRARY = [exercise('row', 'Seated row'), exercise('curl', 'Hammer curl')];
    const library = (host: HTMLElement) => host.querySelector<HTMLElement>('app-program-library')!;
    const called = (host: ParentNode, name: string) => {
      const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
      if (!found) throw new Error(`No button is called "${name}".`);
      return found;
    };
    const addHeres = (host: HTMLElement) =>
      Array.from(host.querySelectorAll('.add-here')).map((button) =>
        button.getAttribute('aria-label'),
      );
    const showToast = () => vi.spyOn(TestBed.inject(UiToast), 'show');

    async function open(options: Options = {}) {
      localStorage.setItem('tb.program-library', 'open');
      const page = await render({ library: LIBRARY, ...options });
      await settle(page.harness.fixture);
      return page;
    }

    it('has the same + and tip beside the grid, with the tip’s words to match', async () => {
      const { host } = await open();
      expect(textOf(library(host).querySelector('.help'))).toBe(
        'Drag an exercise into a workout, or press + to add it.',
      );
      const how = library(host).querySelector<HTMLDetailsElement>('.how details')!;
      expect(how.open).toBe(true);
      // Passed days take nothing here, which the builder's days never say.
      expect(textOf(how.querySelector('.tip p'))).toBe(
        'Drop an exercise in a workout or on a rest day, and a saved workout on any day, from today on. Without dragging, press + on a row, then Add here.',
      );
      expect(called(library(host), 'Add Seated row').getAttribute('aria-pressed')).toBe('false');
    });

    it('offers Add here wherever a drop could land, and on no day already gone', async () => {
      const { host, harness } = await open();
      const plus = called(library(host), 'Add Seated row');

      plus.click();
      await settle(harness.fixture);
      expect(plus.getAttribute('aria-pressed')).toBe('true');
      expect(textOf(host.querySelector('app-adding-bar .text'))).toBe(
        'Adding Seated row: press Add here where it goes.',
      );
      // Week 1 has gone by, and so have the Monday and Tuesday of week 2: today is Wed 7 Oct. Every
      // workout takes it, and every rest day still to come starts a workout with it.
      expect(addHeres(host)).toEqual([
        'Add here: Upper, week 2, Wednesday 7 October',
        'Add here: a new workout on week 2, Thursday 8 October',
        'Add here: Lower B, week 2, Friday 9 October',
        'Add here: a new workout on week 2, Saturday 10 October',
        'Add here: a new workout on week 2, Sunday 11 October',
        'Add here: Lower A, week 3, Monday 12 October',
        'Add here: a new workout on week 3, Tuesday 13 October',
        'Add here: Upper, week 3, Wednesday 14 October',
        'Add here: a new workout on week 3, Thursday 15 October',
        'Add here: Lower B, week 3, Friday 16 October',
        'Add here: a new workout on week 3, Saturday 17 October',
        'Add here: a new workout on week 3, Sunday 18 October',
      ]);
      expect(host.querySelectorAll('.add-exercise')).toHaveLength(0);
      // A day gone keeps saying what it said.
      const tuesday = host.querySelectorAll('section.week')[1].querySelectorAll('.day')[1];
      expect(textOf(tuesday.querySelector('.rest-word'))).toBe('Rest');
    });

    it('adds to a workout or starts one, says where, and sends it for review', async () => {
      const { host, harness, programApi } = await open();
      const toast = showToast();

      called(library(host), 'Add Seated row').click();
      await settle(harness.fixture);
      called(host, 'Add here: Upper, week 2, Wednesday 7 October').click();
      await settle(harness.fixture);
      expect(toast).toHaveBeenLastCalledWith('Seated row added to Upper.', { tone: 'success' });
      const upper = host
        .querySelectorAll('section.week')[1]
        .querySelectorAll<HTMLElement>('.session-card')[0];
      expect(Array.from(upper.querySelectorAll('.exercise-name')).map(textOf)).toEqual([
        'Back squat',
        'Seated row',
      ]);
      // That was the choice: the grid goes back, and the tip folds for good.
      expect(addHeres(host)).toEqual([]);
      expect(host.querySelector('app-adding-bar')).toBeNull();
      expect(called(library(host), 'Add Seated row').getAttribute('aria-pressed')).toBe('false');
      expect(library(host).querySelector<HTMLDetailsElement>('.how details')!.open).toBe(false);
      expect(localStorage.getItem('tb.adding-tip:program')).toBe('closed');
      expect(textOf(host.querySelector('.status'))).toBe('Changes not applied yet');

      called(library(host), 'Add Hammer curl').click();
      await settle(harness.fixture);
      called(host, 'Add here: a new workout on week 3, Tuesday 13 October').click();
      await settle(harness.fixture);
      expect(toast).toHaveBeenLastCalledWith(
        'Hammer curl added: a new workout on week 3, Tuesday 13 October.',
        { tone: 'success' },
      );

      press(host, 'Review changes');
      await settle(harness.fixture);
      const weeks = programApi.previewProgramEdit.mock.calls[0][1].weeks;
      expect(weeks[2].sessions.map(({ session }) => [session.dayOffset, session.name])).toEqual([
        [0, 'Lower A'],
        [1, 'Training day'],
        [2, 'Upper'],
        [4, 'Lower B'],
      ]);
      expect(weeks[2].sessions[1].sessionId).toBeNull();
    });

    it('copies a saved workout onto any day still to come, after what is there', async () => {
      const saved: SavedSessionView = {
        id: 'saved-1',
        name: 'Full body',
        sourceTemplateVersionId: 'version-1',
        sourceTemplateSessionId: 'session-1',
        session: sessionView('session-1', 'Full body', 0, [prescription('row', 'Seated row')]),
      };
      const { host, harness } = await open({ saved: [saved] });
      const toast = showToast();
      host
        .querySelector<HTMLInputElement>('app-program-library input[type="radio"][value="saved"]')!
        .click();
      await settle(harness.fixture);
      expect(textOf(library(host).querySelector('.help'))).toBe(
        'Drag a saved workout onto a day, or press + to add it.',
      );

      called(library(host), 'Add Full body').click();
      await settle(harness.fixture);
      expect(addHeres(host).slice(0, 2)).toEqual([
        'Add here: week 2, Wednesday 7 October',
        'Add here: week 2, Thursday 8 October',
      ]);
      expect(addHeres(host)).toHaveLength(12);
      // A workout takes exercises only, so its own + Exercise stays.
      expect(host.querySelectorAll('.add-exercise')).toHaveLength(5);

      called(host, 'Add here: week 2, Wednesday 7 October').click();
      await settle(harness.fixture);
      expect(toast).toHaveBeenLastCalledWith('Full body added on week 2, Wednesday 7 October.', {
        tone: 'success',
      });
      const wednesday = host.querySelectorAll('section.week')[1].querySelectorAll('.day')[2];
      expect(Array.from(wednesday.querySelectorAll('.session-name')).map(textOf)).toEqual([
        'Upper',
        'Full body',
      ]);
    });

    it('offers today beside a workout already started, as a drop lands there', async () => {
      const mesocycle = leanProgram({
        startDate: '2026-10-05',
        endDateExclusive: '2026-10-12',
        weeks: [
          weekView('w1', 1, [
            datedSession('w1-wed', 'Lower A', 2, '2026-10-07', { hasStarted: true }),
          ]),
        ],
      });
      const { host, harness } = await open({ mesocycle });

      called(library(host), 'Add Seated row').click();
      await settle(harness.fixture);
      const wednesday = host.querySelectorAll('.day')[2];
      expect(wednesday.querySelector('.locked-card')).not.toBeNull();
      expect(wednesday.querySelector('.add-here')?.getAttribute('aria-label')).toBe(
        'Add here: a new workout on week 1, Wednesday 7 October',
      );
    });

    it('lets the chosen row go on a second press, Escape or Cancel', async () => {
      const { host, harness } = await open();
      const plus = called(library(host), 'Add Hammer curl');
      const status = () => textOf(host.querySelector('.save [role="status"]'));

      plus.click();
      await settle(harness.fixture);
      expect(status()).toBe(
        'Hammer curl chosen. Press Add here on a workout, or on a rest day to start one.',
      );
      plus.click();
      await settle(harness.fixture);
      expect(addHeres(host)).toEqual([]);
      expect(status()).toBe('Hammer curl not added.');

      plus.click();
      await settle(harness.fixture);
      const here = called(host, 'Add here: Upper, week 2, Wednesday 7 October');
      here.focus();
      here.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await settle(harness.fixture);
      expect(addHeres(host)).toEqual([]);
      expect(document.activeElement).toBe(plus);

      plus.click();
      await settle(harness.fixture);
      named(host.querySelector('app-adding-bar')!, 'Cancel').click();
      await settle(harness.fixture);
      expect(host.querySelector('app-adding-bar')).toBeNull();
      expect(document.activeElement).toBe(plus);
      expect(textOf(host.querySelector('.status'))).toBe(
        'Workouts that started, finished or passed stay as they are',
      );
    });

    it('ends the choice when the row is dragged in instead', async () => {
      const { host, harness } = await open();
      called(library(host), 'Add Seated row').click();
      await settle(harness.fixture);

      const page = harness.routeDebugElement!.componentInstance as ProgramEditPage;
      const target = page['grid']()[2].days[1].target;
      page['dropped']({
        previousContainer: {},
        container: { data: target },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: page['adding'].chosen() },
      } as never);
      await settle(harness.fixture);
      expect(addHeres(host)).toEqual([]);
      expect(host.querySelector('app-adding-bar')).toBeNull();
      expect(textOf(host.querySelector('.status'))).toBe('Changes not applied yet');
    });

    it('chooses in a sheet where the library has no room beside the grid, as on a phone', async () => {
      const { host, harness } = await render({ library: LIBRARY });
      await settle(harness.fixture);

      host.querySelector<HTMLButtonElement>('.library-sheet')!.click();
      const chooser = await dialogNamed(harness.fixture, 'Exercises');
      expect(textOf(chooser.querySelector('.sheet-help'))).toBe(
        'Choose an exercise or a saved workout, then press Add here where it goes.',
      );
      called(chooser, 'Add Seated row').click();
      await settle(harness.fixture);
      await settle(harness.fixture);
      expect(textOf(host.querySelector('app-adding-bar .text'))).toBe(
        'Adding Seated row: press Add here where it goes.',
      );
      called(host, 'Add here: Lower B, week 3, Friday 16 October').click();
      await settle(harness.fixture);
      const friday = host.querySelectorAll('section.week')[2].querySelectorAll('.day')[4];
      expect(Array.from(friday.querySelectorAll('.exercise-name')).map(textOf)).toEqual([
        'Back squat',
        'Seated row',
      ]);
    });
  });

  it('reads the program’s own lifts by id, so a row offers its demo without the whole library (WEA-14)', async () => {
    const accessories = Array.from({ length: 48 }, (_, index) =>
      exercise(`accessory-${index + 1}`, `Accessory ${String(index + 1).padStart(2, '0')}`),
    );
    const { host, harness, api } = await render({
      library: [
        ...accessories,
        exercise('w3-mon-squat-exercise', 'Back squat', { mediaAssetIds: ['media-squat'] }),
      ],
    });
    // The library is read once the program is, and the program's own lifts once the library is.
    await settle(harness.fixture);

    expect(api.searchExercises.mock.calls.map(([query]) => query)).toEqual([
      { take: 48, patterns: true },
      {
        ids: [
          'w2-wed-squat-exercise',
          'w2-fri-squat-exercise',
          'w3-mon-squat-exercise',
          'w3-wed-squat-exercise',
          'w3-fri-squat-exercise',
        ],
        take: 100,
      },
    ]);
    expect(host.querySelectorAll('button[aria-label="Watch the Back squat demo"]')).toHaveLength(1);
  });

  it('shows the workouts still to come beside the locked ones, with nothing to review yet', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('#edit-title'))).toBe('Edit weeks');
    expect(textOf(host.querySelector('.edit-runs'))).toBe('3 weeks · Mon 28 Sep – Sun 18 Oct 2026');
    const weeks = Array.from(host.querySelectorAll('section.week'));
    expect(weeks.map((week) => week.querySelectorAll('.locked-card').length)).toEqual([3, 1, 0]);
    expect(weeks.map((week) => week.querySelectorAll('.session-card').length)).toEqual([0, 2, 3]);
    const done = weeks[0].querySelector('.locked-card');
    expect(textOf(done?.querySelector('.locked-name'))).toBe('Lower A');
    expect(textOf(done?.querySelector('app-status-pill'))).toBe('Done');
    // Monday and Tuesday of week 2 are gone: no new session goes there.
    const week2Days = Array.from(weeks[1].querySelectorAll('.day'));
    expect(week2Days.map((day) => day.classList.contains('gone'))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(week2Days[1].querySelector('.add-day')).toBeNull();
    expect(week2Days[3].querySelector('.add-day')).not.toBeNull();
    expect(named(host, 'Review changes').disabled).toBe(true);
  });

  it('shows each set’s saved weight on the grid and in the sheet until it changes (critique B15)', async () => {
    const { harness, host } = await render();
    const week3 = host.querySelectorAll('section.week')[2];
    // Week 3's Monday is the fixture's chart squat: 5 reps at RPE 7, saved at 77.5 kg.
    const onGrid = () => textOf(week3.querySelector('app-set-lines'));
    expect(onGrid()).toBe('1 × 5 · 77.5 kg · RPE 7');

    named(week3, 'Lower A').click();
    await settle(harness.fixture);
    const sheet = await dialogNamed(harness.fixture, 'Edit workout');
    const inSheet = () => textOf(sheet.querySelector('.exercise-line'));
    expect(inSheet()).toBe('1 × 5 · 77.5 kg · RPE 7');
    // The set editor keeps the share: a weight there would go stale as the coach types.
    expect(textOf(sheet.querySelector('.set-summary'))).toContain(
      '5 · RPE 7 · 79% of training max',
    );

    fill(sheet, 'RPE target', '9');
    await settle(harness.fixture);
    expect(inSheet()).toBe('1 × 5 · RPE 9 · 84% of training max');
    expect(onGrid()).toBe('1 × 5 · RPE 9 · 84% of training max');
    expect(textOf(host.querySelector('.status'))).toBe('Changes not applied yet');

    fill(sheet, 'RPE target', '7');
    await settle(harness.fixture);
    expect(onGrid()).toBe('1 × 5 · 77.5 kg · RPE 7');

    fill(sheet, 'RPE target', '9');
    await settle(harness.fixture);
    named(sheet, 'Done').click();
    await settle(harness.fixture);
    press(host, 'Discard changes');
    const asked = await dialogNamed(harness.fixture, 'Discard your changes?');
    named(asked, 'Discard changes').click();
    await settle(harness.fixture);
    expect(textOf(host.querySelectorAll('section.week')[2].querySelector('app-set-lines'))).toBe(
      '1 × 5 · 77.5 kg · RPE 7',
    );
  });

  it('reviews what the server says the edit does, then applies exactly that and goes back', async () => {
    const { harness, host, programApi, context, router } = await render();

    renameWeek3(host);
    await settle(harness.fixture);
    expect(textOf(host.querySelector('.status'))).toBe('Changes not applied yet');
    press(host, 'Review changes');
    await settle(harness.fixture);

    const [id, previewed] = programApi.previewProgramEdit.mock.calls[0];
    expect(id).toBe('block-lean');
    expect(previewed.mesocycleVersion).toBe(4);
    expect(previewed.weeks.map((week) => [week.weekId, week.label])).toEqual([
      ['w1', null],
      ['w2', null],
      ['w3', 'Deload'],
    ]);
    // Only the sessions still to come are sent, each with the row it is.
    expect(previewed.weeks.map((week) => week.sessions.map((item) => item.sessionId))).toEqual([
      [],
      ['w2-wed', 'w2-fri'],
      ['w3-mon', 'w3-wed', 'w3-fri'],
    ]);

    const sheet = await dialogNamed(harness.fixture, 'Review changes');
    expect(textOf(sheet)).toContain('1 week renamed or shared differently');
    expect(textOf(sheet.querySelector('.review-row app-status-pill'))).toBe('Renamed');
    expect(textOf(sheet.querySelector('.review-title'))).toBe('Week 3 · Deload');

    named(sheet, 'Apply changes').click();
    await settle(harness.fixture);

    expect(programApi.applyProgramEdit).toHaveBeenCalledWith('block-lean', {
      mesocycleVersion: 4,
      weeks: previewed.weeks,
      previewHash: 'b'.repeat(64),
    });
    // The edit is kept, so leaving asked nothing.
    expect(router.url).toBe('/clients/client-1/training');
    expect(context.notice()).toBe(
      'Lean & Strong is updated. Maya sees the changes in the weeks you share.',
    );
  });

  it('keeps Apply off while the server names a problem', async () => {
    const { harness, host } = await render({
      programApi: {
        previewProgramEdit: vi.fn(() =>
          of(
            preview({
              isInsideTrainingCoverage: false,
              problems: [
                'The program would run until Sun 25 Oct 2026, but the plan it belongs to ends Sun 18 Oct 2026. Remove a week, or renew the plan first.',
              ],
            }),
          ),
        ),
      },
    });
    renameWeek3(host);
    await settle(harness.fixture);
    press(host, 'Review changes');
    await settle(harness.fixture);

    const sheet = await dialogNamed(harness.fixture, 'Review changes');
    expect(textOf(sheet.querySelector('[role="alert"]'))).toContain('renew the plan first');
    expect(named(sheet, 'Apply changes').disabled).toBe(true);
  });

  it('names what stops the edit, opens it, and asks the server nothing', async () => {
    const { harness, host, programApi } = await render();

    // Week 2's Wednesday session loses its name in its sheet.
    named(host.querySelectorAll('section.week')[1], 'Upper').click();
    await settle(harness.fixture);
    const sheet = await dialogNamed(harness.fixture, 'Edit workout');
    const name = sheet.querySelector<HTMLInputElement>('.basics input')!;
    name.value = '';
    name.dispatchEvent(new Event('input'));
    await settle(harness.fixture);
    named(sheet, 'Done').click();
    await settle(harness.fixture);

    press(host, 'Review changes');
    await settle(harness.fixture);

    expect(programApi.previewProgramEdit).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('.alert[role="alert"] p'))).toBe(
      'Week 2, Day 3: give the workout a name.',
    );
    // The session that needs it is opened for the coach.
    expect(await dialogNamed(harness.fixture, 'Edit workout')).toBeTruthy();
  });

  it('opens the refused set and its Rest, tempo & notes for a refused rest, with focus on it (critique B2b)', async () => {
    const mesocycle = pastAndComingProgram();
    // Week 3's Monday squat gains a second set resting longer than the hour the server allows.
    mesocycle.weeks[2].sessions[0].exercises[0].sets.push(chartSet(2, { restSeconds: 4000 }));
    const { harness, host, programApi } = await render({ mesocycle });
    renameWeek3(host);
    await settle(harness.fixture);
    press(host, 'Review changes');
    await settle(harness.fixture);

    expect(textOf(host.querySelector('.alert[role="alert"] p'))).toBe(
      'Week 3, Lower A: rest must be between 0 and 3600 seconds.',
    );
    expect(programApi.previewProgramEdit).not.toHaveBeenCalled();
    press(host, 'Fix the set');
    await settle(harness.fixture);

    // Set 2 opens, not set 1, and its fold is made, so the refused box is there to focus.
    const refused = host.querySelectorAll('.inline-sets [data-set-key]')[1];
    expect(query(refused, '.set-toggle').getAttribute('aria-expanded')).toBe('true');
    const more = query<HTMLDetailsElement>(refused, '.more details');
    expect(more.open).toBe(true);
    expect(document.activeElement).toBe(field(more, 'Rest (seconds)'));
    expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
    expect(more.textContent).toContain('rest must be between 0 and 3600 seconds.');
  });

  it('opens Rest, tempo & notes for a fixed load of 0 under a percentage set, with focus on it (critique B2b)', async () => {
    const mesocycle = pastAndComingProgram();
    mesocycle.weeks[2].sessions[0].exercises[0].sets.push(
      setView({
        position: 2,
        loadStrategy: 'PercentageWorkingMax',
        loadUnit: 'Kilogram',
        percentageWorkingMax: 70,
        isManualLoadOverride: true,
        prescribedLoad: 0,
      }),
    );
    const { harness, host, programApi } = await render({ mesocycle });
    renameWeek3(host);
    await settle(harness.fixture);
    press(host, 'Review changes');
    await settle(harness.fixture);

    expect(textOf(host.querySelector('.alert[role="alert"] p'))).toBe(
      'Week 3, Lower A: a fixed load must be more than 0 and at most 2000, with a load unit.',
    );
    expect(programApi.previewProgramEdit).not.toHaveBeenCalled();
    press(host, 'Fix the set');
    await settle(harness.fixture);

    const refused = host.querySelectorAll('.inline-sets [data-set-key]')[1];
    expect(query(refused, '.set-toggle').getAttribute('aria-expanded')).toBe('true');
    const more = query<HTMLDetailsElement>(refused, '.more details');
    expect(more.open).toBe(true);
    expect(document.activeElement).toBe(field(more, 'Fixed load instead'));
    expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
    expect(more.textContent).toContain(
      'a fixed load must be more than 0 and at most 2000, with a load unit.',
    );
  });

  it('asks before leaving with changes not applied, and warns before a reload', async () => {
    const { harness, host, router } = await render();
    const unsaved = TestBed.inject(UnsavedWork);
    expect(await unsaved.confirmLeave()).toBe(true);

    renameWeek3(host);
    await settle(harness.fixture);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    const stay = router.navigateByUrl('/clients/client-1/training');
    const asked = await dialogNamed(harness.fixture, 'Leave without applying?');
    expect(textOf(asked)).toContain('Your changes to Maya’s weeks are not applied.');
    named(asked, 'Stay').click();
    expect(await stay).toBe(false);

    const leave = router.navigateByUrl('/clients/client-1/training');
    named(
      await dialogNamed(harness.fixture, 'Leave without applying?'),
      'Leave without applying',
    ).click();
    expect(await leave).toBe(true);
  });

  it('says a refused apply in the review sheet’s summary, which takes focus, and keeps the sheet', async () => {
    const changed = new HttpErrorResponse({
      status: 409,
      error: { code: 'program_edit_preview_changed', message: 'The preview no longer matches.' },
    });
    const { harness, host } = await render({
      programApi: { applyProgramEdit: vi.fn(() => throwError(() => changed)) },
    });
    renameWeek3(host);
    await settle(harness.fixture);
    press(host, 'Review changes');
    await settle(harness.fixture);

    const sheet = await dialogNamed(harness.fixture, 'Review changes');
    expect(textOf(formSummary(sheet))).toBe('');
    named(sheet, 'Apply changes').click();
    await settle(harness.fixture);

    expect(dialog()).toBe(sheet);
    expect(textOf(formSummary(sheet))).toBe(
      'The program changed since you reviewed these changes. Review them again before applying.',
    );
    expect(document.activeElement).toBe(formSummary(sheet));
  });

  it('says a stale program needs reloading', async () => {
    const stale = new HttpErrorResponse({
      status: 409,
      error: { code: 'program_edit_conflict', message: 'The program changed after you opened it.' },
    });
    const { harness, host } = await render({
      programApi: { previewProgramEdit: vi.fn(() => throwError(() => stale)) },
    });
    renameWeek3(host);
    await settle(harness.fixture);
    press(host, 'Review changes');
    await settle(harness.fixture);

    expect(dialog()).toBeNull();
    const alert = host.querySelector('.alert[role="alert"]');
    expect(textOf(alert)).toContain('This program was changed somewhere else since you opened it');
    expect(named(alert!, 'Reload')).toBeTruthy();
  });

  it('does not open a finished program for editing', async () => {
    const { host } = await render({
      mesocycle: { ...pastAndComingProgram(), status: 'Completed' },
    });

    expect(textOf(host.querySelector('h2.panel-title'))).toBe('These weeks can’t be edited');
    expect(host.querySelector('section.week')).toBeNull();
  });
});
