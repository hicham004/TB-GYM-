import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CheckInAssignmentView,
  CheckInQuestionView,
  CheckInResponseDetail,
  CheckInResponseView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { announced, focusedId, leaveAt, press, query, settle, type } from '../../../testing/dom';
import { MyCheckIns } from './my-checkins';

const TEXT_KEY = 'a'.repeat(32);
const SCALE_KEY = 'b'.repeat(32);

const TEXT_QUESTION: CheckInQuestionView = {
  id: 'question-1',
  questionKey: TEXT_KEY,
  order: 1,
  questionType: 'ShortText',
  prompt: 'How is your body feeling?',
  helpText: null,
  isRequired: true,
  scaleMinimum: null,
  scaleMaximum: null,
  scaleStep: null,
  options: [],
};

const SCALE_QUESTION: CheckInQuestionView = {
  ...TEXT_QUESTION,
  id: 'question-2',
  questionKey: SCALE_KEY,
  order: 2,
  questionType: 'NumericScale',
  prompt: 'Sleep quality',
  scaleMinimum: 1,
  scaleMaximum: 10,
  scaleStep: 1,
};

const ASSIGNMENT: CheckInAssignmentView = {
  id: 'assignment-1',
  formId: 'form-1',
  formTitle: 'Weekly check-in',
  formVersionId: 'version-1',
  formVersionNumber: 1,
  clientProfileId: 'client-1',
  dueDate: '2026-08-27',
  assignedAtUtc: '2026-08-22T09:00:00Z',
  assignedByUserId: 'coach-1',
};

function detail(response: CheckInResponseView | null): CheckInResponseDetail {
  return {
    assignment: ASSIGNMENT,
    version: {
      id: 'version-1',
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formDescription: null,
      versionNumber: 1,
      status: 'Published',
      derivedFromVersionId: null,
      publishedAtUtc: '2026-08-22T09:00:00Z',
      publishedByUserId: 'coach-1',
      questions: [TEXT_QUESTION, SCALE_QUESTION],
      version: 4,
    },
    response,
  };
}

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
    version: 9,
    ...overrides,
  };
}

interface Harness {
  open(assignmentId: string): Promise<void>;
  setText(questionId: string, value: string): void;
  setNumber(questionId: string, value: string): void;
  submit(): Promise<void>;
  guard(): { canSubmit: boolean };
  questionIssues(questionKey: string): string[];
}

async function render(api: Partial<ApiClient>) {
  await TestBed.configureTestingModule({
    imports: [MyCheckIns],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          listOwnCheckInAssignments: vi.fn(() =>
            of({ clientProfileId: 'client-1', assignments: [ASSIGNMENT] }),
          ),
          ...api,
        },
      },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MyCheckIns);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance as unknown as Harness,
  };
}

describe('MyCheckIns', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('lists assigned check-ins and shows nothing started until one is opened', async () => {
    const { host } = await render({});

    expect(host.textContent).toContain('Weekly check-in');
    expect(host.textContent).toContain('Choose a check-in to answer it.');
  });

  /**
   * The client's list used to show the title alone while the coach's showed the version too. Two
   * check-ins can share a title and ask different questions, so the version belongs on both.
   */
  it('names the form version in the client’s own list, as the coach’s list does', async () => {
    const { host } = await render({});

    expect(host.querySelector('.assignments button')?.textContent).toContain(
      'Weekly check-in (v1)',
    );
  });

  /**
   * The status badge and the submitted date are separate elements in one paragraph, and Angular
   * removes the newline between them, so they used to render as "Submitted26 Aug 2026".
   */
  it('keeps the status badge and the submitted date apart', async () => {
    const submitted = response({
      status: 'Submitted',
      submittedAtUtc: '2026-08-26T10:00:00Z',
      submittedDate: '2026-08-26',
    });
    const { fixture, host, component } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(submitted))),
    });

    await component.open('assignment-1');
    await settle(fixture);

    const summary = host.querySelector('.badge-row');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).not.toContain('SubmittedSubmitted');
  });

  it('blocks submission until every required question is answered', async () => {
    const { fixture, host, component } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(null))),
    });

    await component.open('assignment-1');
    await settle(fixture);

    expect(component.guard().canSubmit).toBe(false);
    // The button stays operable while the check-in is incomplete: a disabled one cannot be pressed,
    // reached by Enter, or focused, so it could not tell anyone why it was refusing.
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
    // The draft reassurance is guidance, not an accusation, so it is here from the start and does
    // not restate what the summary names once a send is actually refused.
    expect(host.textContent).toContain('Saving a draft keeps what you have written');
    expect(host.textContent).not.toContain('Answer every required question before submitting');

    component.setText('question-1', 'Shoulders are tight.');
    component.setNumber('question-2', '8');
    await settle(fixture);

    expect(component.guard().canSubmit).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it('reports an off-step answer against its own question before the round trip', async () => {
    const { fixture, component } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(null))),
    });

    await component.open('assignment-1');
    component.setText('question-1', 'Fine.');
    component.setNumber('question-2', '7.5');
    await settle(fixture);

    expect(component.guard().canSubmit).toBe(false);
    expect(component.questionIssues(SCALE_KEY)[0]).toContain('steps of');
    // The valid text answer is not implicated by the invalid scale one.
    expect(component.questionIssues(TEXT_KEY)).toEqual([]);
  });

  it('resumes a partial draft with its saved answers intact', async () => {
    const saved = response({
      answers: [
        {
          questionId: 'question-1',
          questionKey: TEXT_KEY,
          questionType: 'ShortText',
          textValue: 'Shoulders are tight.',
          numericValue: null,
          choices: [],
        },
      ],
    });
    const { fixture, host, component } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(saved))),
    });

    await component.open('assignment-1');
    await settle(fixture);

    const inputs = host.querySelectorAll<HTMLInputElement>('input[type="text"]');
    expect(inputs[0].value).toBe('Shoulders are tight.');
    // The unanswered scale question still blocks submission.
    expect(component.guard().canSubmit).toBe(false);
  });

  it('renders a submitted check-in as read-only with no submit control', async () => {
    const submitted = response({
      status: 'Submitted',
      submittedAtUtc: '2026-08-26T10:00:00Z',
      submittedDate: '2026-08-26',
    });
    const { fixture, host, component } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(submitted))),
    });

    await component.open('assignment-1');
    await settle(fixture);

    expect(host.textContent).toContain('can no longer be changed');
    expect(host.querySelector('button[type="submit"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[type="text"]')?.disabled).toBe(true);
  });

  it('marks a check-in submitted after the due date as late, as a fact and nothing more', async () => {
    const late = response({
      status: 'Submitted',
      submittedAtUtc: '2026-08-29T10:00:00Z',
      submittedDate: '2026-08-29',
      isLate: true,
    });
    const { fixture, host, component } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(late))),
    });

    await component.open('assignment-1');
    await settle(fixture);

    expect(host.textContent).toContain('After the due date');
    // No score, rating or judgement accompanies it.
    expect(host.textContent).not.toContain('compliance');
  });

  it('surfaces every server refusal against its own question', async () => {
    const draft = response();
    const failure = new HttpErrorResponse({
      status: 400,
      error: {
        failures: [
          {
            questionKey: TEXT_KEY,
            code: 'RequiredAnswerMissing',
            message: 'This question has to be answered.',
          },
          {
            questionKey: SCALE_KEY,
            code: 'NumericOutOfRange',
            message: 'Answer between 1 and 10.',
          },
        ],
      },
    });
    const { fixture, component } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(draft))),
      saveOwnCheckInDraftResponse: vi.fn(() => of(detail(draft))),
      submitOwnCheckInResponse: vi.fn(() => throwError(() => failure)),
    });

    await component.open('assignment-1');
    component.setText('question-1', 'Fine.');
    component.setNumber('question-2', '8');
    await component.submit();
    await settle(fixture);

    expect(component.questionIssues(TEXT_KEY)).toContain('This question has to be answered.');
    expect(component.questionIssues(SCALE_KEY)).toContain('Answer between 1 and 10.');
  });

  it('reports a load failure instead of rendering a blank form', async () => {
    const { fixture, host, component } = await render({
      getOwnCheckInResponse: vi.fn(() => throwError(() => new Error('offline'))),
    });

    await component.open('assignment-1');
    await settle(fixture);

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain('Choose a check-in to answer it.');
  });

  /**
   * A lapsed entitlement closes the client's own past submissions. The refusal carries the
   * deciding reason, and the screen has to use it: showing "you have no check-ins right now" to
   * someone who has two of them is a wrong statement, not a neutral empty state.
   */
  it('explains a lapsed entitlement using the reason the server sent', async () => {
    const denied = new HttpErrorResponse({
      status: 403,
      error: {
        title: 'Check-ins are not available for this client.',
        accessReason: 'Cancelled',
      },
    });
    const { host } = await render({
      listOwnCheckInAssignments: vi.fn(() => throwError(() => denied)),
    });

    expect(host.textContent).toContain('Your enrollment was cancelled');
    expect(host.textContent).toContain('including the ones you already sent');
    // Never the flat contradiction, and never the coach's phrasing about "this client".
    expect(host.textContent).not.toContain('You have no check-ins right now.');
    expect(host.textContent).not.toContain('not available for this client');
    expect(host.textContent).not.toContain('403');
  });

  it('distinguishes each denial reason rather than collapsing them', async () => {
    const denied = (accessReason: string) =>
      new HttpErrorResponse({ status: 403, error: { accessReason } });
    const expired = await render({
      listOwnCheckInAssignments: vi.fn(() => throwError(() => denied('Expired'))),
    });
    expect(expired.host.textContent).toContain('Your enrollment has ended');
    TestBed.resetTestingModule();

    const blocked = await render({
      listOwnCheckInAssignments: vi.fn(() => throwError(() => denied('RelationshipBlocked'))),
    });
    expect(blocked.host.textContent).toContain('Your coach has paused your access');
  });

  it('still reports a plain transport failure as an error, not as a denial', async () => {
    const { host } = await render({
      listOwnCheckInAssignments: vi.fn(() => throwError(() => new Error('offline'))),
    });

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain('Your check-ins could not be loaded.');
  });
});

/** The reason rendered against one question, found by the id that question's control points at. */
function reasonFor(host: HTMLElement, questionId: string): string {
  return (host.querySelector(`#q-${questionId}-reason`)?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The client's answer sheet under the ratified validation convention. Every question here is
 * required, so a freshly opened check-in has two outstanding reasons — and must show neither until
 * the client has either left that question or tried to send the whole thing.
 */
describe('MyCheckIns validation display', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function opened() {
    const rendered = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(null))),
    });
    await rendered.component.open('assignment-1');
    await settle(rendered.fixture);
    return rendered;
  }

  it('announces nothing and shows no reason on a freshly opened check-in', async () => {
    const { host } = await opened();

    expect(announced(host)).toBe('');
    expect(host.textContent).not.toContain('This question has to be answered.');
  });

  it('reveals a question’s reason when it is left, and only that question’s', async () => {
    const { fixture, host } = await opened();

    leaveAt(host, '#q-question-1');
    await settle(fixture);

    expect(reasonFor(host, 'question-1')).toContain('This question has to be answered.');
    expect(reasonFor(host, 'question-2')).toBe('');
    expect(announced(host)).toBe('');
  });

  it('names every outstanding reason at once when a blocked submit is attempted', async () => {
    const { fixture, host } = await opened();

    press(host, 'Submit check-in');
    await settle(fixture);

    const summary = announced(host);
    // The summary names the questions, not just the rule, because "answer it" alone does not say
    // which one is outstanding when two are.
    expect(summary).toContain('How is your body feeling?');
    expect(summary).toContain('Sleep quality');
    expect(reasonFor(host, 'question-1')).toContain('This question has to be answered.');
    expect(reasonFor(host, 'question-2')).toContain('This question has to be answered.');
  });

  it('clears a corrected question’s reason and leaves the other standing', async () => {
    const { fixture, host } = await opened();

    press(host, 'Submit check-in');
    await settle(fixture);

    type(host, '#q-question-1', 'Shoulders are tight.');
    await settle(fixture);

    expect(reasonFor(host, 'question-1')).toBe('');
    expect(reasonFor(host, 'question-2')).toContain('This question has to be answered.');
  });

  it('carries aria-invalid and aria-describedby exactly while the reason is showing', async () => {
    const { fixture, host } = await opened();
    const control = () => query<HTMLInputElement>(host, '#q-question-1');

    expect(control().getAttribute('aria-invalid')).toBeNull();
    expect(control().getAttribute('aria-describedby')).toBeNull();

    leaveAt(host, '#q-question-1');
    await settle(fixture);

    expect(control().getAttribute('aria-invalid')).toBe('true');
    expect(control().getAttribute('aria-describedby')).toBe('q-question-1-reason');

    type(host, '#q-question-1', 'Shoulders are tight.');
    await settle(fixture);

    expect(control().getAttribute('aria-invalid')).toBeNull();
    expect(control().getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps the submit control operable while the check-in is incomplete', async () => {
    const { host } = await opened();
    const submit = query<HTMLButtonElement>(host, 'button[type="submit"]');

    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute('aria-describedby')).toBe('answer-summary');
  });

  it('moves focus to the summary when a send is refused', async () => {
    const { fixture, host } = await opened();

    press(host, 'Submit check-in');
    await settle(fixture);

    expect(focusedId()).toBe('answer-summary');
  });

  it('does not reach the API when a refused send is attempted', async () => {
    const save = vi.fn(() => of(detail(null)));
    const submitResponse = vi.fn(() => of(detail(null)));
    const { fixture, host, component } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(null))),
      saveOwnCheckInDraftResponse: save as never,
      submitOwnCheckInResponse: submitResponse as never,
    });
    await component.open('assignment-1');
    await settle(fixture);

    press(host, 'Submit check-in');
    await settle(fixture);

    // A refused send saves nothing and submits nothing: the draft is untouched either way.
    expect(save).not.toHaveBeenCalled();
    expect(submitResponse).not.toHaveBeenCalled();
    expect(announced(host)).toContain('How is your body feeling?');
  });
});
