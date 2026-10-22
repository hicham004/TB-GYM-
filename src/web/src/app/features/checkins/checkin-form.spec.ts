import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CheckInFormDetails,
  CheckInFormVersionStatus,
  CheckInFormVersionView,
  CheckInQuestionView,
  CreateCheckInFormRequest,
  SaveCheckInDraftRequest,
} from '../../core/api/generated';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { UiToast } from '../../ui/toast';
import { chooseOption, selectShows, settle } from '../../../testing/dom';
import { CheckInForm } from './checkin-form';

@Component({ template: '' })
class Stub {}

const ENERGY_KEY = 'e'.repeat(32);
const SLEEP_KEY = 's'.repeat(32);

function question(overrides: Partial<CheckInQuestionView> = {}): CheckInQuestionView {
  return {
    id: 'question-1',
    questionKey: ENERGY_KEY,
    order: 1,
    questionType: 'NumericScale',
    prompt: 'How was your energy this week?',
    helpText: '1 is exhausted, 10 is unstoppable.',
    isRequired: true,
    scaleMinimum: 1,
    scaleMaximum: 10,
    scaleStep: 1,
    options: [],
    ...overrides,
  };
}

const PLAN_QUESTION = question({
  id: 'question-2',
  questionKey: SLEEP_KEY,
  order: 2,
  questionType: 'SingleChoice',
  prompt: 'How closely did you follow your plan?',
  helpText: null,
  scaleMinimum: null,
  scaleMaximum: null,
  scaleStep: null,
  options: [
    { id: 'option-1', order: 1, label: 'All of it' },
    { id: 'option-2', order: 2, label: 'Most of it' },
  ],
});

function version(
  id: string,
  versionNumber: number,
  status: CheckInFormVersionStatus,
  questions: CheckInQuestionView[] = [question(), PLAN_QUESTION],
): CheckInFormVersionView {
  return {
    id,
    formId: 'form-1',
    formTitle: 'Weekly check-in',
    formDescription: 'Takes two minutes.',
    versionNumber,
    status,
    derivedFromVersionId: null,
    publishedAtUtc: status === 'Published' ? '2026-10-21T22:30:00Z' : null,
    publishedByUserId: status === 'Published' ? 'coach-1' : null,
    version: 7,
    questions,
  };
}

function details(
  versions: CheckInFormVersionView[],
  options: { archived?: boolean } = {},
): CheckInFormDetails {
  const published = versions.filter((item) => item.status === 'Published');
  const latest = published.at(-1) ?? null;
  const draft = versions.find((item) => item.status === 'Draft') ?? null;
  return {
    form: {
      id: 'form-1',
      title: 'Weekly check-in',
      description: 'Takes two minutes.',
      status: latest ? 'Published' : 'Draft',
      isArchived: options.archived ?? false,
      currentVersionNumber: versions.length,
      draftVersionId: draft?.id ?? null,
      latestPublishedVersionId: latest?.id ?? null,
      latestPublishedVersionNumber: latest?.versionNumber ?? null,
      questionCount: (latest ?? draft)?.questions.length ?? 0,
      latestPublishedAtUtc: latest?.publishedAtUtc ?? null,
      version: 3,
    },
    versions: versions.map((item) => ({
      id: item.id,
      versionNumber: item.versionNumber,
      status: item.status,
      derivedFromVersionId: item.derivedFromVersionId,
      publishedAtUtc: item.publishedAtUtc,
      publishedByUserId: item.publishedByUserId,
      questionCount: item.questions.length,
      version: item.version,
    })),
  };
}

/** The server's form, held so a test can move it on as the page writes. */
function server(initial: CheckInFormVersionView[], archived = false) {
  const state = { versions: initial, archived };
  const find = (id: string) => state.versions.find((item) => item.id === id)!;
  return {
    state,
    api: {
      getCheckInForm: vi.fn((): Observable<CheckInFormDetails> =>
        of(details(state.versions, { archived: state.archived })),
      ),
      getCheckInFormVersion: vi.fn((_form: string, id: string) => of(find(id))),
      createCheckInForm: vi.fn((request: CreateCheckInFormRequest) => {
        state.versions = [
          {
            ...version('version-1', 1, 'Draft'),
            formTitle: request.title,
            questions: request.questions.map((item, index) =>
              question({
                id: `new-${index}`,
                questionKey: String(index).repeat(32),
                order: index + 1,
                questionType: item.questionType,
                prompt: item.prompt,
                helpText: item.helpText ?? null,
                scaleMinimum: item.scaleMinimum ?? null,
                scaleMaximum: item.scaleMaximum ?? null,
                scaleStep: item.scaleStep ?? null,
                options: (item.options ?? []).map((label, order) => ({
                  id: `o-${index}-${order}`,
                  order: order + 1,
                  label,
                })),
              }),
            ),
          },
        ];
        return of(details(state.versions));
      }),
      saveCheckInDraft: vi.fn((_form: string, id: string, request: SaveCheckInDraftRequest) => {
        const saved = {
          ...find(id),
          version: Number(request.version) + 1,
          questions: request.questions.map((item, index) =>
            question({
              id: `saved-${index}`,
              questionKey: item.questionKey ?? String(index + 5).repeat(32),
              order: index + 1,
              questionType: item.questionType,
              prompt: item.prompt,
              helpText: item.helpText ?? null,
              scaleMinimum: item.scaleMinimum ?? null,
              scaleMaximum: item.scaleMaximum ?? null,
              scaleStep: item.scaleStep ?? null,
              options: [],
            }),
          ),
        };
        state.versions = state.versions.map((item) => (item.id === id ? saved : item));
        return of(saved);
      }),
      publishCheckInVersion: vi.fn(
        (_form: string, id: string): Observable<CheckInFormVersionView> => {
          const published = {
            ...find(id),
            status: 'Published' as const,
            publishedAtUtc: '2026-10-22T08:00:00Z',
          };
          state.versions = state.versions.map((item) => (item.id === id ? published : item));
          return of(published);
        },
      ),
      deriveCheckInDraft: vi.fn(() => {
        const latest = state.versions.at(-1)!;
        const draft = {
          ...version(`version-${state.versions.length + 1}`, state.versions.length + 1, 'Draft'),
          questions: latest.questions,
        };
        state.versions = [...state.versions, draft];
        return of(draft);
      }),
      archiveCheckInForm: vi.fn(() => {
        state.archived = true;
        return of(details(state.versions, { archived: true }));
      }),
      restoreCheckInForm: vi.fn(() => {
        state.archived = false;
        return of(details(state.versions));
      }),
      renameCheckInForm: vi.fn(),
      listCheckInForms: vi.fn(),
    },
  };
}

async function render(url: string, api: Record<string, unknown>) {
  const toast = { show: vi.fn(() => ({ dismiss: vi.fn() })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'checkins/forms', component: Stub },
        {
          path: 'checkins/forms/:formId',
          component: CheckInForm,
          canDeactivate: [confirmBeforeLeaving],
        },
        { path: 'clients', component: Stub },
      ]),
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: UiToast, useValue: toast },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      {
        provide: WorkspaceCalendar,
        useValue: {
          today: signal('2026-10-22'),
          timeZone: signal('Asia/Beirut'),
          resolveToday: () => Promise.resolve('2026-10-22'),
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, CheckInForm);
  await settle(harness.fixture);
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    toast,
    router: TestBed.inject(Router),
    page: harness.routeDebugElement!.componentInstance as CheckInForm,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const all = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(selector));

function named(host: ParentNode, name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
    (candidate) => (candidate.getAttribute('aria-label') ?? textOf(candidate)) === name,
  );
  if (found.length !== 1) throw new Error(`${found.length} buttons are named "${name}".`);
  return found[0];
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function leaveBox(input: HTMLElement): void {
  input.dispatchEvent(new Event('blur'));
}

/** The box labelled `label` inside `scope`, failing when there is not exactly one. */
function box(scope: ParentNode, label: string): HTMLInputElement {
  const matches = all(scope, 'app-field').filter(
    (field) => textOf(field.querySelector('label')) === label,
  );
  if (matches.length !== 1) throw new Error(`${matches.length} boxes are labelled "${label}".`);
  return matches[0].querySelector<HTMLInputElement>('input, textarea')!;
}

async function until(fixture: { detectChanges(): void }, check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    fixture.detectChanges();
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The page never got there.');
}

/** Chooses an item of the menu named `menu`, as a person does. */
async function fromMenu(
  harness: RouterTestingHarness,
  host: ParentNode,
  menu: string,
  item: string,
): Promise<void> {
  named(host, menu).click();
  await settle(harness.fixture);
  const choice = all(host, 'app-menu button.item').filter(
    (candidate) => textOf(candidate.querySelector('.item-title')) === item,
  );
  if (choice.length !== 1) throw new Error(`${choice.length} menu items are named "${item}".`);
  choice[0].click();
  await settle(harness.fixture);
  await settle(harness.fixture);
}

describe('a check-in form’s page (audit A14b)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  it('reads a published form as its questions, with Change the questions as the action', async () => {
    const { api } = server([version('version-1', 1, 'Published')]);
    const { host } = await render('/checkins/forms/form-1', api);

    expect(textOf(host.querySelector('h1'))).toBe('Weekly check-in');
    expect(textOf(host.querySelector('.description'))).toBe('Takes two minutes.');
    expect(textOf(host.querySelector('.standing'))).toBe(
      'Ready to assign Published Thu 22 Oct. Assign it from a client’s Check-ins tab.',
    );
    expect(
      all(host, '.question.read').map((card) => all(card, 'p, li').map((part) => textOf(part))),
    ).toEqual([
      [
        '1. How was your energy this week?',
        'Number scale, 1 to 10 · Required',
        '1 is exhausted, 10 is unstoppable.',
      ],
      [
        '2. How closely did you follow your plan?',
        'Choose one · Required',
        'All of it',
        'Most of it',
      ],
    ]);
    // Nothing on the page can be typed into, and there is nothing to save.
    expect(host.querySelectorAll('input, textarea').length).toBe(0);
    expect(host.querySelector('.foot')).toBeNull();
    expect(named(host, 'Change the questions')).toBeTruthy();
  });

  it('opens the next version for writing from the one clients are sent', async () => {
    const { api } = server([version('version-1', 1, 'Published')]);
    const { host, harness } = await render('/checkins/forms/form-1', api);

    named(host, 'Change the questions').click();
    await until(harness.fixture, () => host.querySelector('.foot') !== null);
    await settle(harness.fixture);

    expect(api.deriveCheckInDraft).toHaveBeenCalledWith('form-1', {
      sourceVersionId: 'version-1',
      formVersion: 3,
    });
    const first = host.querySelector<HTMLInputElement>('.question input[id^="q-"]')!;
    expect(first.value).toBe('How was your energy this week?');
    expect(document.activeElement).toBe(first);
    expect(textOf(host.querySelector('.foot'))).toContain('Publish changes');
    expect(textOf(host.querySelector('.standing'))).toContain('Your changes are not published yet');
  });

  it('opens the draft another coach started when Change the questions is refused for it', async () => {
    const { api, state } = server([version('version-1', 1, 'Published')]);
    api.deriveCheckInDraft.mockImplementation(() => {
      state.versions = [...state.versions, version('version-2', 2, 'Draft')];
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'draft_exists', title: 'This form already has a draft.' },
          }),
      );
    });
    const { host, harness } = await render('/checkins/forms/form-1', api);

    named(host, 'Change the questions').click();
    await until(harness.fixture, () => host.querySelector('.foot') !== null);

    expect(textOf(host.querySelector('.problem'))).toBe('This form already has a draft.');
    expect(api.getCheckInFormVersion).toHaveBeenLastCalledWith('form-1', 'version-2');
  });

  it('starts a weekly check-in to change, which leaving untouched asks nothing about', async () => {
    const { api } = server([]);
    const { host, page } = await render('/checkins/forms/new?start=weekly', api);

    expect(textOf(host.querySelector('h1'))).toBe('New check-in form');
    expect(box(host, 'Name').value).toBe('Weekly check-in');
    expect(all(host, '.question').length).toBe(6);
    expect(selectShows(host.querySelector('.question')!, 'Kind of answer')).toBe('Number scale');
    expect(textOf(host.querySelector('.standing'))).toBe(
      'New Clients aren’t sent it until you publish it.',
    );
    expect(await page.canLeave()).toBe(true);
    expect(api.getCheckInForm).not.toHaveBeenCalled();
  });

  it('refuses to publish an empty form, says why under each box and focuses the first', async () => {
    const { api } = server([]);
    const { host, harness } = await render('/checkins/forms/new', api);

    // Nothing is said on a form nobody has touched.
    expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(textOf(host.querySelector('app-form-summary'))).toBe('');

    named(host, 'Publish').click();
    await settle(harness.fixture);

    expect(api.createCheckInForm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box(host, 'Name'));
    expect(textOf(box(host, 'Name').closest('app-field'))).toContain('Give the form a name.');
    expect(textOf(host.querySelector('.question app-field'))).toContain('Write the question.');
    expect(textOf(host.querySelector('app-form-summary'))).toBe('Check what is marked above.');
  });

  it('says a box’s reason once it is left, and only that box’s', async () => {
    const { api } = server([]);
    const { host, harness } = await render('/checkins/forms/new', api);
    named(host, 'Add a question').click();
    await settle(harness.fixture);

    leaveBox(box(host, 'Name'));
    await settle(harness.fixture);
    expect(all(host, '[aria-invalid="true"]')).toEqual([box(host, 'Name')]);

    const [first, second] = all(host, '.question');
    leaveBox(box(first, 'Question'));
    await settle(harness.fixture);
    expect(box(first, 'Question').getAttribute('aria-invalid')).toBe('true');
    expect(box(second, 'Question').getAttribute('aria-invalid')).toBeNull();

    typeInto(box(first, 'Question'), 'How did training feel?');
    await settle(harness.fixture);
    expect(box(first, 'Question').getAttribute('aria-invalid')).toBeNull();
  });

  it('says what is wrong under the one choice that is wrong', async () => {
    const { api } = server([]);
    const { host, harness } = await render('/checkins/forms/new', api);
    const card = host.querySelector<HTMLElement>('.question')!;
    await chooseOption(harness.fixture, card, 'Kind of answer', 'Choose one');

    const choices = all(card, '.choice input');
    expect(choices.length).toBe(2);
    typeInto(choices[0] as HTMLInputElement, 'Yes');
    typeInto(choices[1] as HTMLInputElement, 'yes');
    leaveBox(choices[1]);
    await settle(harness.fixture);

    expect(choices.map((choice) => choice.getAttribute('aria-invalid'))).toEqual([null, 'true']);
    expect(textOf(choices[1].closest('app-field'))).toContain('An earlier choice says the same.');
  });

  it('changes the kind of answer through the kit’s select, a scale with its three numbers', async () => {
    const { api } = server([]);
    const { host, harness } = await render('/checkins/forms/new', api);
    const card = host.querySelector<HTMLElement>('.question')!;

    expect(host.querySelector('select')).toBeNull();
    await chooseOption(harness.fixture, card, 'Kind of answer', 'Number scale');

    expect(['Lowest', 'Highest', 'In steps of'].map((label) => box(card, label).value)).toEqual([
      '1',
      '10',
      '1',
    ]);
    expect(textOf(box(card, 'Hint for your client (optional)').closest('app-field'))).toContain(
      'Shown under the question, such as what 1 and 10 mean.',
    );
    typeInto(box(card, 'In steps of'), '4');
    leaveBox(box(card, 'In steps of'));
    await settle(harness.fixture);
    expect(textOf(box(card, 'In steps of').closest('app-field'))).toContain(
      'Counting from 1 in steps of 4 never lands on 10.',
    );
  });

  it('moves and removes a question from its menu, focus following it', async () => {
    const { api } = server([version('version-1', 1, 'Draft')]);
    const { host, harness } = await render('/checkins/forms/form-1', api);
    const prompts = () =>
      all(host, '.question input[id^="q-"]').map((input) => (input as HTMLInputElement).value);

    expect(prompts()).toEqual([
      'How was your energy this week?',
      'How closely did you follow your plan?',
    ]);
    await fromMenu(harness, host, 'More for question 1', 'Move down');
    expect(prompts()).toEqual([
      'How closely did you follow your plan?',
      'How was your energy this week?',
    ]);
    // The moved question's menu keeps focus where it moved to.
    expect(document.activeElement?.closest('app-menu')).toBe(
      all(host, '.question')[1].querySelector('app-menu'),
    );

    await fromMenu(harness, host, 'More for question 1', 'Remove question');
    expect(prompts()).toEqual(['How was your energy this week?']);
    expect(document.activeElement).toBe(host.querySelector('.question input[id^="q-"]'));
  });

  it('creates a new form, moves to its own address, then publishes it', async () => {
    const { api } = server([]);
    const { host, harness, router, toast } = await render('/checkins/forms/new?start=weekly', api);

    named(host, 'Publish').click();
    await until(
      harness.fixture,
      () => router.url === '/checkins/forms/form-1' && host.querySelector('.foot') === null,
    );
    await settle(harness.fixture);

    const created = api.createCheckInForm.mock.calls[0][0];
    expect(created.title).toBe('Weekly check-in');
    expect(created.questions.length).toBe(6);
    expect(created.questions.every((item) => item.questionKey === null)).toBe(true);
    expect(api.publishCheckInVersion).toHaveBeenCalledWith('form-1', 'version-1', 7);
    expect(toast.show).toHaveBeenCalledWith('Published. Assign it from a client’s Check-ins tab.', {
      tone: 'success',
    });
    expect(named(host, 'Change the questions')).toBeTruthy();
  });

  it('saves a changed draft with its keys before publishing it, each on its own token', async () => {
    const { api } = server([
      version('version-1', 1, 'Published'),
      version('version-2', 2, 'Draft'),
    ]);
    const { host, harness, toast } = await render('/checkins/forms/form-1', api);

    typeInto(box(host.querySelector('.question')!, 'Question'), 'How was your energy?');
    await settle(harness.fixture);
    named(host, 'Publish changes').click();
    await until(harness.fixture, () => host.querySelector('.foot') === null);

    const [formId, versionId, request] = api.saveCheckInDraft.mock.calls[0];
    expect([formId, versionId, request.version]).toEqual(['form-1', 'version-2', 7]);
    expect(request.questions.map((item) => [item.questionKey, item.prompt])).toEqual([
      [ENERGY_KEY, 'How was your energy?'],
      [SLEEP_KEY, 'How closely did you follow your plan?'],
    ]);
    // The saved draft's own token, not the one the page opened with.
    expect(api.publishCheckInVersion).toHaveBeenCalledWith('form-1', 'version-2', 8);
    expect(toast.show).toHaveBeenCalledOnce();
  });

  it('keeps what was typed and says the server’s words when publishing is refused', async () => {
    const { api } = server([version('version-1', 1, 'Draft')]);
    api.publishCheckInVersion.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { title: 'A check-in form version needs at least one question.' },
          }),
      ),
    );
    const { host, harness } = await render('/checkins/forms/form-1', api);
    typeInto(box(host.querySelector('.question')!, 'Question'), 'Energy');
    await settle(harness.fixture);

    named(host, 'Publish').click();
    await until(harness.fixture, () => textOf(host.querySelector('app-form-summary')) !== '');
    await settle(harness.fixture);

    expect(textOf(host.querySelector('app-form-summary'))).toBe(
      'A check-in form version needs at least one question.',
    );
    expect(document.activeElement?.tagName).toBe('APP-FORM-SUMMARY');
    expect(box(host.querySelector('.question')!, 'Question').value).toBe('Energy');
    expect(host.querySelector('.stale')).toBeNull();
  });

  it('offers to reload a form changed elsewhere, since every retry on its old token would be refused', async () => {
    const { api, state } = server([version('version-1', 1, 'Draft')]);
    api.saveCheckInDraft.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              code: 'concurrency_conflict',
              title: 'The check-in draft was changed by another request.',
            },
          }),
      ),
    );
    const { host, harness } = await render('/checkins/forms/form-1', api);
    typeInto(box(host.querySelector('.question')!, 'Question'), 'Energy');
    await settle(harness.fixture);

    named(host, 'Publish').click();
    await until(harness.fixture, () => host.querySelector('.stale') !== null);

    expect(textOf(host.querySelector('app-form-summary'))).toBe(
      'This form was changed somewhere else since you opened it, so this was not saved. Reload the form to carry on from its newest version; what you typed here since is not kept.',
    );
    expect(api.publishCheckInVersion).not.toHaveBeenCalled();
    // Someone else's save is what the reload brings.
    state.versions = [
      { ...version('version-1', 1, 'Draft'), questions: [question({ prompt: 'Their question?' })] },
    ];
    named(host, 'Reload the form').click();
    await until(harness.fixture, () => {
      const card = host.querySelector('.question');
      return card !== null && box(card, 'Question').value === 'Their question?';
    });
    expect(host.querySelector('.stale')).toBeNull();
  });

  it('archives a form, which then offers only Restore form, and restores it', async () => {
    const { api } = server([version('version-1', 1, 'Published')]);
    const { host, harness, toast } = await render('/checkins/forms/form-1', api);

    await fromMenu(harness, host, 'More for this form', 'Archive form');
    await until(harness.fixture, () => textOf(host).includes('Restore form'));

    expect(api.archiveCheckInForm).toHaveBeenCalledWith('form-1', 3);
    expect(textOf(host.querySelector('.standing'))).toContain('Archived');
    expect(host.querySelector('.actions')!.textContent).not.toContain('Change the questions');
    named(host, 'More for this form').click();
    await settle(harness.fixture);
    expect(all(host, 'app-menu .item-title').map((item) => textOf(item))).toEqual(['Versions']);
    named(host, 'More for this form').click();
    await settle(harness.fixture);

    named(host, 'Restore form').click();
    await until(harness.fixture, () => textOf(host).includes('Change the questions'));
    expect(api.restoreCheckInForm).toHaveBeenCalledWith('form-1', 3);
    expect(toast.show).toHaveBeenLastCalledWith('Restored. You can assign it again.', {
      tone: 'success',
    });
  });

  it('asks before leaving with changes, and leaves an untouched draft freely', async () => {
    const { api } = server([version('version-1', 1, 'Draft')]);
    const { host, harness, page } = await render('/checkins/forms/form-1', api);

    expect(await page.canLeave()).toBe(true);
    typeInto(box(host.querySelector('.question')!, 'Question'), 'Energy');
    await settle(harness.fixture);

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    const leaving = page.canLeave();
    await until(harness.fixture, () => document.querySelector('[role="dialog"]') !== null);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(textOf(dialog)).toContain('Your changes to this check-in form aren’t saved.');
    named(dialog, 'Stay').click();
    expect(await leaving).toBe(false);

    // A workspace switch or a sign-out asks the same question, and goes on when the coach says so.
    const switching = TestBed.inject(UnsavedWork).confirmLeave();
    await until(harness.fixture, () => document.querySelector('[role="dialog"]') !== null);
    named(document.querySelector<HTMLElement>('[role="dialog"]')!, 'Leave without saving').click();
    expect(await switching).toBe(true);
  });

  it('says a form that is not here is not here', async () => {
    const { api } = server([]);
    api.getCheckInForm.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const { host } = await render('/checkins/forms/form-9', api);

    expect(textOf(host.querySelector('h1'))).toBe('This check-in form isn’t here');
    // Focus moves to what the page now says, rather than falling to the page.
    expect(document.activeElement).toBe(host.querySelector('h1'));
    const back = Array.from(host.querySelectorAll<HTMLAnchorElement>('.stack a'));
    expect(back.map((link) => [textOf(link), link.getAttribute('href')])).toEqual([
      ['Back to your check-in forms', '/checkins/forms'],
    ]);
  });

  it('opens a draft written but never published, saved as it is when nothing changed', async () => {
    const { api } = server([version('version-1', 1, 'Draft')]);
    const { host, harness } = await render('/checkins/forms/form-1', api);

    expect(textOf(host.querySelector('.standing'))).toBe(
      'Draft Publish it to assign it to clients.',
    );
    named(host, 'Publish').click();
    await until(harness.fixture, () => host.querySelector('.foot') === null);

    expect(api.saveCheckInDraft).not.toHaveBeenCalled();
    expect(api.publishCheckInVersion).toHaveBeenCalledWith('form-1', 'version-1', 7);
  });
  it('keeps the editor on screen while a new form is created and its address moves', async () => {
    const { api } = server([]);
    const { host, harness, router } = await render('/checkins/forms/new?start=weekly', api);
    const save = named(host, 'Save as draft');
    save.focus();

    save.click();
    await until(harness.fixture, () => router.url === '/checkins/forms/form-1');
    await settle(harness.fixture);

    expect(api.createCheckInForm).toHaveBeenCalledTimes(1);
    // The draft's questions were read back for their keys; the editor never gave way.
    expect(api.getCheckInFormVersion).toHaveBeenCalledWith('form-1', 'version-1');
    expect(host.querySelector('.foot')).not.toBeNull();
    expect(document.activeElement).toBe(named(host, 'Save as draft'));
    expect(textOf(host.querySelector('h1'))).toBe('Weekly check-in');
  });

  it('opens a new form afresh at its address when its questions cannot be read back, never creating it twice', async () => {
    const { api } = server([]);
    let reads = 0;
    const real = api.getCheckInFormVersion.getMockImplementation()!;
    api.getCheckInFormVersion.mockImplementation((form: string, id: string) =>
      ++reads === 1 ? throwError(() => new HttpErrorResponse({ status: 0 })) : real(form, id),
    );
    const { host, harness, router } = await render('/checkins/forms/new?start=weekly', api);

    named(host, 'Publish').click();
    await until(harness.fixture, () => router.url === '/checkins/forms/form-1');
    await until(harness.fixture, () => host.querySelector('.foot') !== null);

    expect(api.createCheckInForm).toHaveBeenCalledTimes(1);
    expect(api.publishCheckInVersion).not.toHaveBeenCalled();
    expect(all(host, '.question').length).toBe(6);
  });

  it('says a write was made when only reading the form back failed, never that the write failed', async () => {
    const { api } = server([version('version-1', 1, 'Draft')]);
    const { host, harness, toast } = await render('/checkins/forms/form-1', api);
    api.getCheckInForm.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    named(host, 'Publish').click();
    await until(harness.fixture, () => host.querySelector('.problem') !== null);

    expect(api.publishCheckInVersion).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith('Published. Assign it from a client’s Check-ins tab.', {
      tone: 'success',
    });
    expect(textOf(host.querySelector('.problem'))).toBe(
      'Done, but this page could not catch up with the form. Reload it before you change anything else.',
    );
    // The page shows the published questions it was answered with.
    expect(named(host, 'Change the questions')).toBeTruthy();
  });

  it('closes the More menu while a change is saved, so no sheet opens over a page about to change', async () => {
    const { api } = server([version('version-1', 1, 'Draft')]);
    const pending = new Subject<CheckInFormVersionView>();
    api.publishCheckInVersion.mockReturnValue(pending);
    const { host, harness } = await render('/checkins/forms/form-1', api);

    named(host, 'Publish').click();
    await settle(harness.fixture);

    expect(named(host, 'More for this form').disabled).toBe(true);
    pending.next({ ...version('version-1', 1, 'Published') });
    pending.complete();
    await until(harness.fixture, () => !named(host, 'More for this form').disabled);
  });

  it('asks before archiving typed changes away, in words about archiving', async () => {
    const { api } = server([version('version-1', 1, 'Draft')]);
    const { host, harness } = await render('/checkins/forms/form-1', api);
    typeInto(box(host.querySelector('.question')!, 'Question'), 'Energy');
    await settle(harness.fixture);

    await fromMenu(harness, host, 'More for this form', 'Archive form');
    await until(harness.fixture, () => document.querySelector('[role="dialog"]') !== null);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(textOf(dialog)).toContain('If you archive it now, they are lost.');
    named(dialog, 'Keep editing').click();
    await settle(harness.fixture);

    expect(api.archiveCheckInForm).not.toHaveBeenCalled();
    expect(box(host.querySelector('.question')!, 'Question').value).toBe('Energy');
  });

  it('says a choice’s reason under that choice only when that choice is left', async () => {
    const { api } = server([]);
    const { host, harness } = await render('/checkins/forms/new', api);
    const card = host.querySelector<HTMLElement>('.question')!;
    await chooseOption(harness.fixture, card, 'Kind of answer', 'Choose one');
    const choices = all(card, '.choice input');

    typeInto(choices[0] as HTMLInputElement, 'Yes');
    leaveBox(choices[0]);
    await settle(harness.fixture);

    expect(choices.map((choice) => choice.getAttribute('aria-invalid'))).toEqual([null, null]);
  });

  it('names a question’s number of choices in the summary, where no box can say it', async () => {
    const { api } = server([]);
    const { host, harness } = await render('/checkins/forms/new', api);
    typeInto(box(host, 'Name'), 'Weekly');
    const card = host.querySelector<HTMLElement>('.question')!;
    typeInto(box(card, 'Question'), 'Did you train?');
    await chooseOption(harness.fixture, card, 'Kind of answer', 'Choose one');
    const [first] = all(card, '.choice input');
    typeInto(first as HTMLInputElement, 'Yes');
    await settle(harness.fixture);
    named(card, 'Remove choice 2 of question 1').click();
    await settle(harness.fixture);

    named(host, 'Publish').click();
    await settle(harness.fixture);

    expect(api.createCheckInForm).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('app-form-summary'))).toBe(
      'Question 1: Give at least two choices.',
    );
    expect(document.activeElement?.tagName).toBe('APP-FORM-SUMMARY');
  });

  it('sends nothing for Save as draft when the draft has not changed', async () => {
    const { api } = server([version('version-1', 1, 'Draft')]);
    const { host, harness, toast } = await render('/checkins/forms/form-1', api);

    named(host, 'Save as draft').click();
    await settle(harness.fixture);

    expect(api.saveCheckInDraft).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith(
      'Saved as a draft. Clients aren’t sent it until you publish it.',
      { tone: 'success' },
    );
  });

  it('keeps a focused box clear of the editor’s bar, and lets the page go back to its own padding', async () => {
    const { api } = server([version('version-1', 1, 'Draft')]);
    const { harness } = await render('/checkins/forms/form-1', api);

    expect(document.documentElement.style.scrollPaddingBlockEnd).toBe('5.5rem');
    harness.fixture.destroy();
    expect(document.documentElement.style.scrollPaddingBlockEnd).toBe('');
  });
});
