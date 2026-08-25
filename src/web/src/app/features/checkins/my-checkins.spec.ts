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

/**
 * ngModel writes its value to the DOM through the forms pipeline rather than synchronously, so a
 * single change-detection pass is not enough to observe a rendered value or a disabled control.
 */
async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
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

  it('blocks submission until every required question is answered', async () => {
    const { fixture, host, component } = await render({
      getOwnCheckInResponse: vi.fn(() => of(detail(null))),
    });

    await component.open('assignment-1');
    await settle(fixture);

    expect(component.guard().canSubmit).toBe(false);
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(true);
    expect(host.textContent).toContain('Answer every required question before submitting');

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
});
