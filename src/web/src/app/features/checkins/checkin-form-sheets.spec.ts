import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CheckInFormDetails, CheckInFormVersionView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, formSummary, leave, press, settle } from '../../../testing/dom';
import { CheckInFormName, CheckInFormVersions } from './checkin-form-sheets';
import type { FormClock } from './checkin-forms.models';

const CLOCK: FormClock = { locale: 'en-US', timeZone: 'Asia/Beirut', today: '2026-10-22' };

function details(overrides: Partial<CheckInFormDetails['form']> = {}): CheckInFormDetails {
  return {
    form: {
      id: 'form-1',
      title: 'Weekly check-in',
      description: 'Takes two minutes.',
      status: 'Published',
      isArchived: false,
      currentVersionNumber: 2,
      draftVersionId: null,
      latestPublishedVersionId: 'version-2',
      latestPublishedVersionNumber: 2,
      questionCount: 2,
      latestPublishedAtUtc: '2026-10-21T22:30:00Z',
      version: 5,
      ...overrides,
    },
    versions: [
      {
        id: 'version-1',
        versionNumber: 1,
        status: 'Published',
        derivedFromVersionId: null,
        publishedAtUtc: '2026-10-01T09:00:00Z',
        publishedByUserId: 'coach-1',
        questionCount: 1,
        version: 1,
      },
      {
        id: 'version-2',
        versionNumber: 2,
        status: 'Published',
        derivedFromVersionId: 'version-1',
        publishedAtUtc: '2026-10-21T22:30:00Z',
        publishedByUserId: 'coach-1',
        questionCount: 2,
        version: 1,
      },
    ],
  };
}

const VERSION_ONE: CheckInFormVersionView = {
  id: 'version-1',
  formId: 'form-1',
  formTitle: 'Weekly check-in',
  formDescription: null,
  versionNumber: 1,
  status: 'Published',
  derivedFromVersionId: null,
  publishedAtUtc: '2026-10-01T09:00:00Z',
  publishedByUserId: 'coach-1',
  version: 1,
  questions: [
    {
      id: 'question-1',
      questionKey: 'a'.repeat(32),
      order: 1,
      questionType: 'SingleChoice',
      prompt: 'How closely did you follow your plan?',
      helpText: 'Be honest.',
      isRequired: false,
      scaleMinimum: null,
      scaleMaximum: null,
      scaleStep: null,
      options: [
        { id: 'option-2', order: 2, label: 'Most of it' },
        { id: 'option-1', order: 1, label: 'All of it' },
      ],
    },
  ],
};

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function renderName(api: Record<string, unknown>) {
  await TestBed.configureTestingModule({
    imports: [CheckInFormName],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CheckInFormName);
  fixture.componentRef.setInput('details', details());
  const closed: unknown[] = [];
  const dirty: boolean[] = [];
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, closed, dirty };
}

describe('the name and description sheet (audit A14b)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts from the form’s own words, and says when something was changed', async () => {
    const { fixture, host, dirty } = await renderName({ renameCheckInForm: vi.fn() });

    expect(host.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe(
      'Weekly check-in',
    );
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Takes two minutes.');
    expect(dirty.at(-1)).toBe(false);
    fill(host, 'Name', 'Monday check-in');
    await settle(fixture);
    expect(dirty.at(-1)).toBe(true);
  });

  it('saves the name and description on the form’s own token, an empty description as none', async () => {
    const renamed = details({ title: 'Monday check-in', description: null, version: 6 });
    const renameCheckInForm = vi.fn(() => of(renamed));
    const { fixture, host, closed } = await renderName({ renameCheckInForm });

    fill(host, 'Name', '  Monday check-in ');
    fill(host, 'Description (optional)', '   ');
    await settle(fixture);
    press(host, 'Save name');
    await settle(fixture);

    expect(renameCheckInForm).toHaveBeenCalledWith('form-1', {
      title: 'Monday check-in',
      description: null,
      version: 5,
    });
    expect(closed).toEqual([renamed]);
  });

  it('keeps what was typed when the page reads the form again with the same words', async () => {
    const { fixture, host, dirty } = await renderName({ renameCheckInForm: vi.fn() });

    fill(host, 'Name', 'Monday check-in');
    await settle(fixture);
    // A write on the page reads the form again: a new object, the same stored words.
    fixture.componentRef.setInput('details', details({ version: 6 }));
    await settle(fixture);

    expect(host.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe(
      'Monday check-in',
    );
    expect(dirty.at(-1)).toBe(true);
  });

  it('asks the page to read a form changed elsewhere, and says to save again', async () => {
    const renameCheckInForm = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              code: 'concurrency_conflict',
              title: 'The check-in form was changed by another request.',
            },
          }),
      ),
    );
    const { fixture, host, closed } = await renderName({ renameCheckInForm });
    const stale: unknown[] = [];
    fixture.componentInstance.stale.subscribe(() => stale.push(true));

    fill(host, 'Name', 'Monday check-in');
    await settle(fixture);
    press(host, 'Save name');
    await settle(fixture);

    expect(stale).toEqual([true]);
    expect(textOf(formSummary(host))).toBe(
      'This form was changed somewhere else since you opened it. Its newest version is read again: save again to keep this name.',
    );
    expect(closed).toEqual([]);
  });

  it('refuses an empty name under its box, and says the server’s words when it refuses', async () => {
    const renameCheckInForm = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { title: 'This name cannot be used.' },
          }),
      ),
    );
    const { fixture, host, closed } = await renderName({ renameCheckInForm });

    fill(host, 'Name', '  ');
    leave(host, 'Name');
    await settle(fixture);
    press(host, 'Save name');
    await settle(fixture);
    expect(renameCheckInForm).not.toHaveBeenCalled();
    expect(textOf(host)).toContain('Give the form a name.');
    expect(document.activeElement).toBe(host.querySelector('input[name="title"]'));

    fill(host, 'Name', 'Monday check-in');
    await settle(fixture);
    press(host, 'Save name');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe('This name cannot be used.');
    expect(closed).toEqual([]);
  });
});

async function renderVersions(api: Record<string, unknown>) {
  await TestBed.configureTestingModule({
    imports: [CheckInFormVersions],
    providers: [{ provide: ApiClient, useValue: api }],
  }).compileComponents();
  const fixture = TestBed.createComponent(CheckInFormVersions);
  fixture.componentRef.setInput('details', details());
  fixture.componentRef.setInput('clock', CLOCK);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('the versions sheet (audit A14b)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists every version newest first and marks the one clients are assigned now', async () => {
    const { host } = await renderVersions({ getCheckInFormVersion: vi.fn() });

    expect(
      Array.from(host.querySelectorAll('.version')).map((row) => [
        textOf(row.querySelector('.version-title')),
        textOf(row.querySelector('.version-copy .muted')),
        textOf(row.querySelector('app-status-pill')),
        textOf(row.querySelector('.current')),
      ]),
    ).toEqual([
      [
        'Version 2',
        'Thu 22 Oct · 2 questions',
        'Published',
        'The version clients are assigned now.',
      ],
      ['Version 1', 'Thu 1 Oct · 1 question', 'Published', ''],
    ]);
  });

  it('reads one version’s questions as a client was sent them, and hides them again', async () => {
    const getCheckInFormVersion = vi.fn(() => of(VERSION_ONE));
    const { fixture, host } = await renderVersions({ getCheckInFormVersion });
    const read = host.querySelector<HTMLButtonElement>('#toggle-version-1')!;
    // Named by its visible word and the version, open or closed (WCAG 2.5.3, label in name).
    expect(textOf(read)).toBe('Read Version 1');
    expect(read.hasAttribute('aria-label')).toBe(false);

    read.click();
    await settle(fixture);

    expect(getCheckInFormVersion).toHaveBeenCalledWith('form-1', 'version-1');
    expect(read.getAttribute('aria-expanded')).toBe('true');
    expect(textOf(read)).toBe('Hide Version 1');
    const body = host.querySelector(`#${read.getAttribute('aria-controls')}`)!;
    expect(Array.from(body.querySelectorAll('p')).map((line) => textOf(line))).toEqual([
      '1. How closely did you follow your plan?',
      'Choose one · Optional',
      'Be honest.',
      'All of it · Most of it',
    ]);

    read.click();
    await settle(fixture);
    expect(read.getAttribute('aria-expanded')).toBe('false');
    expect(body.querySelectorAll('p').length).toBe(0);
  });

  it('says a version could not be loaded, and reads it again on Try again', async () => {
    let reads = 0;
    const getCheckInFormVersion = vi.fn(() =>
      ++reads === 1 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(VERSION_ONE),
    );
    const { fixture, host } = await renderVersions({ getCheckInFormVersion });

    const toggle = host.querySelector<HTMLButtonElement>('#toggle-version-1')!;
    toggle.click();
    await settle(fixture);
    expect(textOf(host.querySelector('[role="alert"]'))).toContain(
      'This version could not be loaded.',
    );
    press(host, 'Try again');
    // Try again takes itself away: focus waits on the row's own button, which stays.
    expect(document.activeElement).toBe(toggle);
    await settle(fixture);

    expect(getCheckInFormVersion).toHaveBeenCalledTimes(2);
    expect(textOf(host)).toContain('How closely did you follow your plan?');
  });
});
