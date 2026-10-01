import { Component, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CheckInQuestionView,
  CheckInResponseDetail,
  CheckInResponseView,
  SaveCheckInResponseRequest,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { announced, button, focusedId, press, query, settle, type } from '../../../testing/dom';
import type { ProgressPhotos } from '../progress/progress.models';
import { CheckInFlow } from './checkin-flow';
import { saveBeforeLeaving } from './checkins.routes';

@Component({ template: '<p>Somewhere else</p>' })
class Elsewhere {}

const ENERGY: CheckInQuestionView = {
  id: 'q-energy',
  questionKey: 'a'.repeat(32),
  order: 1,
  questionType: 'NumericScale',
  prompt: 'How was your energy this week?',
  helpText: '1 is exhausted, 10 is unstoppable.',
  isRequired: true,
  scaleMinimum: 1,
  scaleMaximum: 10,
  scaleStep: 1,
  options: [],
};
const PLAN: CheckInQuestionView = {
  ...ENERGY,
  id: 'q-plan',
  questionKey: 'b'.repeat(32),
  order: 2,
  questionType: 'SingleChoice',
  prompt: 'How closely did you follow your plan?',
  helpText: null,
  scaleMinimum: null,
  scaleMaximum: null,
  scaleStep: null,
  options: [
    { id: 'all', order: 1, label: 'All of it' },
    { id: 'most', order: 2, label: 'Most of it' },
  ],
};
const WIN: CheckInQuestionView = {
  ...PLAN,
  id: 'q-win',
  questionKey: 'c'.repeat(32),
  order: 3,
  questionType: 'LongText',
  prompt: 'What was your biggest win?',
  isRequired: false,
  options: [],
};

function response(overrides: Partial<CheckInResponseView> = {}): CheckInResponseView {
  return {
    id: 'response-1',
    assignmentId: 'assignment-1',
    clientProfileId: 'client-1',
    status: 'Draft',
    submittedAtUtc: null,
    submittedDate: null,
    isLate: false,
    reviewedAtUtc: null,
    reviewedByUserId: null,
    answers: [],
    version: 1,
    ...overrides,
  };
}

function detail(saved: CheckInResponseView | null): CheckInResponseDetail {
  return {
    assignment: {
      id: 'assignment-1',
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formVersionId: 'version-1',
      formVersionNumber: 1,
      clientProfileId: 'client-1',
      dueDate: '2026-09-27',
      assignedAtUtc: '2026-09-21T09:00:00Z',
      assignedByUserId: 'coach-1',
    },
    version: {
      id: 'version-1',
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formDescription: 'Takes two minutes.',
      versionNumber: 1,
      status: 'Published',
      derivedFromVersionId: null,
      publishedAtUtc: '2026-09-01T09:00:00Z',
      publishedByUserId: 'coach-1',
      questions: [ENERGY, PLAN, WIN],
      version: 4,
    },
    response: saved,
  };
}

/** Everything answered, so the flow resumes on the review. */
const ANSWERED = response({
  version: 5,
  answers: [
    {
      questionId: 'q-energy',
      questionKey: ENERGY.questionKey,
      questionType: 'NumericScale',
      textValue: null,
      numericValue: 8,
      choices: [],
    },
    {
      questionId: 'q-plan',
      questionKey: PLAN.questionKey,
      questionType: 'SingleChoice',
      textValue: null,
      numericValue: null,
      choices: [{ questionOptionId: 'most', label: 'Most of it', order: 2 }],
    },
    {
      questionId: 'q-win',
      questionKey: WIN.questionKey,
      questionType: 'LongText',
      textValue: 'Deadlifts flew.',
      numericValue: null,
      choices: [],
    },
  ],
});

function photos(poses: ('Front' | 'Side' | 'Back')[] = []): ProgressPhotos {
  return {
    clientProfileId: 'client-1',
    from: '2026-07-06',
    toExclusive: '2026-09-28',
    photos: poses.map((pose, index) => ({
      id: `photo-${index}`,
      photoDate: '2026-09-27',
      pose,
      mediaAssetId: `media-${index}`,
      status: 'Active',
      source: 'Client',
      version: 1,
    })),
  } as ProgressPhotos;
}

async function render(api: Partial<Record<keyof ApiClient, unknown>> = {}) {
  let version = 10;
  const selectedTenantId = signal<string | null>('tenant-1');
  const client = {
    getOwnCheckInResponse: vi.fn(() => of(detail(null))),
    getMyProgressPhotos: vi.fn(() => of(photos())),
    getOwnCoach: vi.fn(() => of({ name: 'Lea Haddad' })),
    saveOwnCheckInDraftResponse: vi.fn((_: string, request: SaveCheckInResponseRequest) => {
      expect(request.answers.length).toBe(3);
      return of(detail(response({ version: ++version })));
    }),
    submitOwnCheckInResponse: vi.fn(() =>
      of(
        detail(
          response({
            ...ANSWERED,
            status: 'Submitted',
            submittedDate: '2026-09-27',
            submittedAtUtc: '2026-09-27T18:00:00Z',
          }),
        ),
      ),
    ),
    recordMyProgressPhoto: vi.fn(() => of({})),
    ...api,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'checkins/me/:assignmentId',
          component: CheckInFlow,
          canDeactivate: [saveBeforeLeaving],
        },
        { path: '**', component: Elsewhere },
      ]),
      { provide: ApiClient, useValue: client },
      { provide: TenantStore, useValue: { selectedTenantId } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/checkins/me/assignment-1');
  await settle(harness.fixture);
  const host = harness.fixture.nativeElement as HTMLElement;
  return {
    host,
    client,
    selectedTenantId,
    router: TestBed.inject(Router),
    settle: () => settle(harness.fixture),
    read: () => (host.textContent ?? '').replace(/\s+/g, ' '),
  };
}

function pick(host: HTMLElement, selector: string): void {
  query<HTMLInputElement>(host, selector).click();
}

describe('CheckInFlow', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('asks one question per screen, starting at the first, with nothing announced yet', async () => {
    const { host, read } = await render();

    expect(read()).toContain('Question 1 of 3');
    expect(query(host, '#step-heading').textContent?.trim()).toBe(ENERGY.prompt);
    expect(host.querySelectorAll('.scale-chip')).toHaveLength(10);
    expect(announced(host)).toBe('');
    expect(focusedId()).toBe('step-heading');
  });

  it('holds a required question until it is answered, then saves and moves on', async () => {
    const { host, client, read, settle } = await render();

    press(host, 'Next');
    await settle();
    expect(read()).toContain('This question has to be answered.');
    expect(query(host, '.scale').getAttribute('aria-invalid')).toBe('true');
    expect(client.saveOwnCheckInDraftResponse).not.toHaveBeenCalled();

    pick(host, '.scale input[value="7"]');
    await settle();
    expect(read()).not.toContain('This question has to be answered.');
    press(host, 'Next');
    await settle();

    expect(read()).toContain('Question 2 of 3');
    expect(query(host, '#step-heading').textContent?.trim()).toBe(PLAN.prompt);
    expect(client.saveOwnCheckInDraftResponse).toHaveBeenCalledWith(
      'assignment-1',
      expect.objectContaining({
        version: null,
        answers: expect.arrayContaining([
          expect.objectContaining({ questionId: 'q-energy', numericValue: 7 }),
        ]),
      }),
    );
    expect(read()).toContain('Saved');
  });

  it('sends each save with the version the previous one returned, one at a time', async () => {
    const first = new Subject<CheckInResponseDetail>();
    const saveOwnCheckInDraftResponse = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValue(of(detail(response({ version: 12 }))));
    const { host, settle } = await render({ saveOwnCheckInDraftResponse });

    pick(host, '.scale input[value="7"]');
    press(host, 'Next');
    await settle();
    pick(host, '.option input[value="most"]');
    press(host, 'Next');
    await settle();
    expect(saveOwnCheckInDraftResponse).toHaveBeenCalledTimes(1);

    first.next(detail(response({ version: 11 })));
    first.complete();
    await settle();
    expect(saveOwnCheckInDraftResponse).toHaveBeenCalledTimes(2);
    expect(saveOwnCheckInDraftResponse.mock.calls[1][1]).toMatchObject({ version: 11 });
  });

  it('resumes a started check-in at its first unanswered question, answers intact', async () => {
    const partial = response({ answers: [ANSWERED.answers[0]] });
    const { host, read, settle } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(partial))),
    });

    expect(read()).toContain('Question 2 of 3');
    press(host, 'Back');
    await settle();
    expect(query<HTMLInputElement>(host, '.scale input[value="8"]').checked).toBe(true);
  });

  it('offers Skip on an optional question and clears an answer on request', async () => {
    const { host, settle, read } = await render({
      getOwnCheckInResponse: vi.fn(() =>
        of(detail(response({ answers: ANSWERED.answers.slice(0, 2) }))),
      ),
      getMyProgressPhotos: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(read()).toContain('Optional');
    expect(button(host, 'Skip')).toBeTruthy();
    type(host, 'textarea', 'Slept better');
    await settle();
    expect(button(host, 'Next')).toBeTruthy();
    press(host, 'Clear answer');
    await settle();
    expect(query<HTMLTextAreaElement>(host, 'textarea').value).toBe('');
    press(host, 'Skip');
    await settle();
    // No photo step when the client's own photos could not be read: straight to the review.
    expect(query(host, '#step-heading').textContent?.trim()).toBe('Check your answers');
  });

  it('reviews every answer, edits one and comes straight back', async () => {
    const { host, read, settle } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(ANSWERED))),
    });

    expect(query(host, '#step-heading').textContent?.trim()).toBe('Check your answers');
    expect(read()).toContain('8 out of 10');
    expect(read()).toContain('Most of it');
    expect(read()).toContain('Deadlifts flew.');
    expect(read()).toContain('None added today');

    press(host, `Edit: ${PLAN.prompt}`);
    await settle();
    expect(query(host, '#step-heading').textContent?.trim()).toBe(PLAN.prompt);
    pick(host, '.option input[value="all"]');
    press(host, 'Back to review');
    await settle();
    expect(read()).toContain('All of it');
  });

  it('pins Back and Send on the review with a count of answers, and gives Edit a touch target', async () => {
    const withoutOptional = response({ ...ANSWERED, answers: ANSWERED.answers.slice(0, 2) });
    const { host, read, settle } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(withoutOptional))),
    });
    press(host, 'Skip');
    await settle();
    press(host, 'Skip photos');
    await settle();
    expect(query(host, '#step-heading').textContent?.trim()).toBe('Check your answers');

    const bar = query(host, '.step-actions');
    expect(bar.classList.contains('pinned')).toBe(true);
    expect(bar.contains(button(host, 'Send check-in'))).toBe(true);
    expect(bar.contains(button(host, 'Back'))).toBe(true);
    // The optional question was skipped, so the count is honest rather than "3 of 3".
    expect(read()).toContain('2 of 3 answered');
    expect(read()).toContain("Answers can't be changed once sent.");
    const edits = Array.from(host.querySelectorAll<HTMLElement>('.answer-row button'));
    // Three questions and the photos row.
    expect(edits).toHaveLength(4);
    for (const edit of edits) expect(edit.classList.contains('tb-button--touch')).toBe(true);

    // A question step is short: its actions stay in the card.
    press(host, `Edit: ${PLAN.prompt}`);
    await settle();
    expect(query(host, '.step-actions').classList.contains('pinned')).toBe(false);
  });

  it('saves, sends, and confirms by the coach’s name', async () => {
    const { host, client, read, settle } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(ANSWERED))),
    });

    press(host, 'Send check-in');
    await settle();

    expect(client.saveOwnCheckInDraftResponse).toHaveBeenCalledTimes(1);
    expect(client.submitOwnCheckInResponse).toHaveBeenCalledWith('assignment-1', 11);
    expect(read()).toContain('Sent to Lea Haddad');
    expect(focusedId()).toBe('sent-heading');

    press(host, 'See your answers');
    await settle();
    expect(read()).toContain('Waiting for your coach');
    expect(host.querySelector('form')).toBeNull();
  });

  it('places every server refusal on its own question and takes focus to the summary', async () => {
    const { host, read, settle } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(ANSWERED))),
      submitOwnCheckInResponse: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: {
                failures: [
                  {
                    questionKey: ENERGY.questionKey,
                    code: 'Range',
                    message: 'Answer between 1 and 5.',
                  },
                ],
              },
            }),
        ),
      ),
    });

    press(host, 'Send check-in');
    await settle();

    expect(announced(host)).toBe('Some answers still need you before this can be sent.');
    expect(query(host, '.answer-row.has-issue').textContent).toContain('Answer between 1 and 5.');
    expect(focusedId()).toBe('send-summary');
    expect(read()).not.toContain('Sent to');
  });

  it('shows a sent check-in read-only, with lateness as a plain fact', async () => {
    const sent = response({
      ...ANSWERED,
      status: 'Reviewed',
      submittedDate: '2026-09-28',
      isLate: true,
    });
    const { host, read } = await render({ getOwnCheckInResponse: vi.fn(() => of(detail(sent))) });

    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('input, textarea')).toBeNull();
    expect(read()).toContain('Reviewed by your coach');
    expect(read()).toContain('After the due date');
    expect(read()).toContain('Sent Mon 28 Sep 2026');
    expect(focusedId()).toBe('checkin-heading');
  });

  it('says why check-ins are closed, in the server’s own reason', async () => {
    const { read } = await render({
      getOwnCheckInResponse: vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 403, error: { accessReason: 'Paused' } })),
      ),
    });

    expect(read()).toContain('Check-ins are closed');
    expect(read()).toContain('Your plan is paused, so check-ins are closed for now.');
  });

  it('adds photos as progress photos dated by the server, and knows the ones already added', async () => {
    const { host, client, read, settle } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(ANSWERED))),
      getMyProgressPhotos: vi.fn(() => of(photos(['Front']))),
      recordMyProgressPhoto: vi
        .fn()
        .mockReturnValueOnce(of({}))
        .mockReturnValueOnce(
          throwError(
            () =>
              new HttpErrorResponse({ status: 409, error: { code: 'ProgressPhotoAlreadyExists' } }),
          ),
        ),
    });

    press(host, 'Edit: progress photos');
    await settle();
    const [front, side, back] = Array.from(host.querySelectorAll<HTMLInputElement>('.pose-input'));
    expect(front.disabled).toBe(true);
    expect(read()).toContain('Added today');

    const file = new File(['x'], 'side.jpg', { type: 'image/jpeg' });
    for (const input of [side, back]) {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await settle();
    }

    expect(client.recordMyProgressPhoto).toHaveBeenCalledWith('Side', null, file);
    expect(client.recordMyProgressPhoto).toHaveBeenCalledWith('Back', null, file);
    expect(read()).toContain('You already added a Back photo today.');
    press(host, 'Back to review');
    await settle();
    expect(read()).toContain('3 photos added today');
  });

  it('saves what was typed before leaving, and holds the client when that save fails', async () => {
    const saveOwnCheckInDraftResponse = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(detail(response({ version: 20 }))));
    const { host, router, read, settle } = await render({ saveOwnCheckInDraftResponse });

    pick(host, '.scale input[value="6"]');
    await settle();
    expect(await router.navigateByUrl('/checkins/me')).toBe(false);
    await settle();
    expect(read()).toContain("Your last answer isn't saved yet");
    expect(read()).toContain('Not saved yet');

    press(host, 'Save and leave');
    await settle();
    expect(saveOwnCheckInDraftResponse).toHaveBeenCalledTimes(2);
    expect(router.url).toBe('/checkins/me');
  });

  it('lets the client leave without saving when they choose to', async () => {
    const { host, router, settle } = await render({
      saveOwnCheckInDraftResponse: vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 500 })),
      ),
    });

    pick(host, '.scale input[value="6"]');
    await settle();
    await router.navigateByUrl('/');
    await settle();
    press(host, 'Leave without saving');
    await settle();
    expect(router.url).toBe('/');
  });

  it('never writes to the workspace the client left', async () => {
    const { host, client, selectedTenantId, router, settle } = await render();

    pick(host, '.scale input[value="6"]');
    await settle();
    selectedTenantId.set('tenant-2');
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    await router.navigateByUrl('/checkins/me');
    await settle();

    expect(client.saveOwnCheckInDraftResponse).not.toHaveBeenCalled();
  });
});
