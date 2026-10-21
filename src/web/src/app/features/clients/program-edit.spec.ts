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
  TrainingMesocycleView,
} from '../../core/api/generated';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { pastAndComingProgram } from '../../../testing/mesocycle-fixtures';
import { formSummary, press, settle } from '../../../testing/dom';
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
  read?: CoachClientProgramView;
  programApi?: Record<string, unknown>;
}

async function render(options: Options = {}) {
  const mesocycle = options.mesocycle ?? pastAndComingProgram();
  const api = {
    getTrainingMesocycle: vi.fn(() => of(mesocycle)),
    searchExercises: vi.fn(() => of({ items: [], total: 0 })),
    listSavedSessions: vi.fn(() => of([])),
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
    const { host, harness } = await render();

    expect(host.querySelector('app-program-library')).toBeNull();
    named(host, 'Exercises').click();
    await settle(harness.fixture);
    expect(host.querySelector('app-program-library')).not.toBeNull();
    expect(localStorage.getItem('tb.program-library')).toBe('open');
  });

  it('shows the sessions still to come beside the locked ones, with nothing to review yet', async () => {
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
    const sheet = await dialogNamed(harness.fixture, 'Edit session');
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
      'Week 2, Day 3: give the session a name.',
    );
    // The session that needs it is opened for the coach.
    expect(await dialogNamed(harness.fixture, 'Edit session')).toBeTruthy();
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
