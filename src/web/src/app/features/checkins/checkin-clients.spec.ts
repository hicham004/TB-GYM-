import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CheckInAssignmentView,
  CheckInComparisonView,
  CheckInResponseDetail,
  CheckInResponseStatus,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { choose, settle, type } from '../../../testing/dom';
import { CheckInClients } from './checkin-clients';

const SHARED_KEY = 'a'.repeat(32);
const ADDED_KEY = 'd'.repeat(32);

function assignment(id: string, dueDate: string, versionNumber = 1): CheckInAssignmentView {
  return {
    id,
    formId: 'form-1',
    formTitle: 'Weekly check-in',
    formVersionId: `version-${versionNumber}`,
    formVersionNumber: versionNumber,
    clientProfileId: 'client-1',
    dueDate,
    assignedAtUtc: '2026-08-22T09:00:00Z',
    assignedByUserId: 'coach-1',
  };
}

function detail(
  item: CheckInAssignmentView,
  status: CheckInResponseStatus | null,
): CheckInResponseDetail {
  return {
    assignment: item,
    version: {
      id: item.formVersionId,
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formDescription: null,
      versionNumber: item.formVersionNumber,
      status: 'Published',
      derivedFromVersionId: null,
      publishedAtUtc: '2026-08-22T09:00:00Z',
      publishedByUserId: 'coach-1',
      version: 4,
      questions: [
        {
          id: 'question-1',
          questionKey: SHARED_KEY,
          order: 1,
          questionType: 'ShortText',
          prompt: 'How is your body feeling?',
          helpText: null,
          isRequired: true,
          scaleMinimum: null,
          scaleMaximum: null,
          scaleStep: null,
          options: [],
        },
      ],
    },
    response:
      status === null
        ? null
        : {
            id: `response-${item.id}`,
            assignmentId: item.id,
            clientProfileId: 'client-1',
            status,
            submittedAtUtc: status === 'Draft' ? null : '2026-08-26T10:00:00Z',
            submittedDate: status === 'Draft' ? null : '2026-08-26',
            isLate: false,
            reviewedAtUtc: status === 'Reviewed' ? '2026-08-27T08:00:00Z' : null,
            reviewedByUserId: status === 'Reviewed' ? 'coach-1' : null,
            version: 9,
            answers: [
              {
                questionId: 'question-1',
                questionKey: SHARED_KEY,
                questionType: 'ShortText',
                textValue: status === 'Draft' ? 'Still writing' : 'Shoulders are tight.',
                numericValue: null,
                choices: [],
              },
            ],
          },
  };
}

const COMPARISON: CheckInComparisonView = {
  clientProfileId: 'client-1',
  formId: 'form-1',
  formTitle: 'Weekly check-in',
  first: {
    responseId: 'response-a1',
    assignmentId: 'a1',
    formVersionId: 'version-1',
    formVersionNumber: 1,
    status: 'Reviewed',
    dueDate: '2026-08-20',
    submittedDate: '2026-08-20',
    submittedAtUtc: '2026-08-20T09:00:00Z',
    isLate: false,
  },
  second: {
    responseId: 'response-a2',
    assignmentId: 'a2',
    formVersionId: 'version-2',
    formVersionNumber: 2,
    status: 'Submitted',
    dueDate: '2026-08-27',
    submittedDate: '2026-08-27',
    submittedAtUtc: '2026-08-27T09:00:00Z',
    isLate: false,
  },
  rows: [
    {
      questionKey: SHARED_KEY,
      presence: 'InBoth',
      first: {
        questionId: 'question-1',
        order: 1,
        questionType: 'ShortText',
        prompt: 'How is your body feeling?',
        isRequired: true,
        answer: {
          questionId: 'question-1',
          questionKey: SHARED_KEY,
          questionType: 'ShortText',
          textValue: 'Shoulders are tight.',
          numericValue: null,
          choices: [],
        },
      },
      second: {
        questionId: 'question-9',
        order: 1,
        questionType: 'ShortText',
        prompt: 'How does your body feel today?',
        isRequired: true,
        answer: {
          questionId: 'question-9',
          questionKey: SHARED_KEY,
          questionType: 'ShortText',
          textValue: 'Much better.',
          numericValue: null,
          choices: [],
        },
      },
    },
    {
      questionKey: ADDED_KEY,
      presence: 'OnlyInSecond',
      first: null,
      second: {
        questionId: 'question-10',
        order: 2,
        questionType: 'LongText',
        prompt: 'Anything else?',
        isRequired: false,
        answer: null,
      },
    },
  ],
};

/** A lineage with one published version, so the assignment select has something to offer. */
const PUBLISHED_FORM = {
  id: 'form-1',
  title: 'Weekly check-in',
  description: null,
  status: 'Published',
  isArchived: false,
  currentVersionNumber: 1,
  draftVersionId: null,
  latestPublishedVersionId: 'version-1',
  latestPublishedVersionNumber: 1,
  version: 2,
} as const;

interface Harness {
  selectClient(clientId: string): Promise<void>;
  openResponse(assignmentId: string): Promise<void>;
  compare(): Promise<void>;
  comparable(): unknown[];
  firstResponseId: string;
  secondResponseId: string;
}

async function render(api: Partial<ApiClient> = {}) {
  await TestBed.configureTestingModule({
    imports: [CheckInClients],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getClients: vi.fn(() =>
            of([
              {
                id: 'client-1',
                firstName: 'Rana',
                lastName: 'Haddad',
                email: 'rana@example.test',
                phoneNumber: null,
                onboardingStatus: 'Completed',
                isCoachBlocked: false,
                version: 1,
              },
            ]),
          ),
          listCheckInForms: vi.fn(() => of({ total: 0, items: [] })),
          listClientCheckInAssignments: vi.fn(() =>
            of({ clientProfileId: 'client-1', assignments: [] }),
          ),
          ...api,
        },
      },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CheckInClients);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance as unknown as Harness,
  };
}

describe('CheckInClients', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows a client list and asks for a selection first', async () => {
    const { host } = await render();

    expect(host.textContent).toContain('Rana Haddad');
    expect(host.textContent).toContain('Select a client to assign and review their check-ins.');
  });

  it('shows each assignment with its real state, including not started', async () => {
    const one = assignment('a1', '2026-08-20');
    const two = assignment('a2', '2026-08-27');
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() =>
        of({ clientProfileId: 'client-1', assignments: [one, two] }),
      ),
      getClientCheckInResponse: vi.fn((_client: string, assignmentId: string) =>
        of(detail(assignmentId === 'a1' ? one : two, assignmentId === 'a1' ? 'Submitted' : null)),
      ),
    });

    await component.selectClient('client-1');
    await settle(fixture);

    expect(host.textContent).toContain('Submitted');
    expect(host.textContent).toContain('Not started');
  });

  it('offers review only for a submitted check-in, never for a draft', async () => {
    const one = assignment('a1', '2026-08-20');
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() =>
        of({ clientProfileId: 'client-1', assignments: [one] }),
      ),
      getClientCheckInResponse: vi.fn(() => of(detail(one, 'Draft'))),
    });

    await component.selectClient('client-1');
    await component.openResponse('a1');
    await settle(fixture);

    expect(host.textContent).toContain('has not submitted it');
    expect(host.textContent).not.toContain('Mark as reviewed');
  });

  it('does not offer a draft as something that can be compared', async () => {
    const one = assignment('a1', '2026-08-20');
    const two = assignment('a2', '2026-08-27');
    const { component } = await render({
      listClientCheckInAssignments: vi.fn(() =>
        of({ clientProfileId: 'client-1', assignments: [one, two] }),
      ),
      getClientCheckInResponse: vi.fn((_client: string, assignmentId: string) =>
        of(
          detail(assignmentId === 'a1' ? one : two, assignmentId === 'a1' ? 'Submitted' : 'Draft'),
        ),
      ),
    });

    await component.selectClient('client-1');

    // Only the submitted one is comparable, so the server is never asked to refuse the draft.
    expect(component.comparable()).toHaveLength(1);
  });

  it('renders a one-sided comparison row as not asked rather than as an empty answer', async () => {
    const { fixture, host, component } = await render({
      compareCheckInResponses: vi.fn(() => of(COMPARISON)),
    });

    await component.selectClient('client-1');
    component.firstResponseId = 'response-a1';
    component.secondResponseId = 'response-a2';
    await component.compare();
    fixture.detectChanges();

    const text = host.textContent ?? '';
    expect(text).toContain('Shoulders are tight.');
    expect(text).toContain('Much better.');
    // A question only the later version asked says so on the side that never asked it.
    expect(host.querySelectorAll('.not-asked')).toHaveLength(1);
    expect(text).toContain('Not asked in this version');
    // Both wordings survive, so a re-worded question is not represented by one of them.
    expect(text).toContain('How is your body feeling?');
    expect(text).toContain('How does your body feel today?');
    // And nothing is derived from the two answers.
    expect(text).toContain('Nothing here is scored, rated or compared for you.');
  });

  /**
   * Drives the real controls rather than the component fields. The assignment draft used to be a
   * plain object read by a computed, so filling the form left the computed on its cached value and
   * Assign stayed disabled forever: the form validated correctly and the screen was still dead.
   */
  it('enables Assign once a published version and a due date are chosen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-22T09:00:00Z'));
    try {
      const { fixture, host, component } = await render({
        listCheckInForms: vi.fn(() => of({ total: 1, items: [PUBLISHED_FORM] })),
      });

      await component.selectClient('client-1');
      await settle(fixture);

      const submit = host.querySelector<HTMLButtonElement>(
        'form.builder-form button[type="submit"]',
      );
      expect(submit).not.toBeNull();
      expect(submit!.disabled).toBe(true);

      choose(host, 'select[name="formVersionId"]', 'version-1');
      await settle(fixture);
      // One field alone is not enough, and the outstanding reason is still on screen.
      expect(submit!.disabled).toBe(true);
      expect(host.textContent).toContain('Choose a due date.');

      type(host, 'input[name="dueDate"]', '2026-08-24');
      await settle(fixture);

      expect(submit!.disabled).toBe(false);
      expect(host.textContent).not.toContain('Choose a due date.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Assign disabled for a due date that has already passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-22T09:00:00Z'));
    try {
      const { fixture, host, component } = await render({
        listCheckInForms: vi.fn(() => of({ total: 1, items: [PUBLISHED_FORM] })),
      });

      await component.selectClient('client-1');
      await settle(fixture);

      const submit = host.querySelector<HTMLButtonElement>(
        'form.builder-form button[type="submit"]',
      );
      choose(host, 'select[name="formVersionId"]', 'version-1');
      type(host, 'input[name="dueDate"]', '2026-08-21');
      await settle(fixture);

      expect(submit!.disabled).toBe(true);
      expect(host.textContent).toContain('The due date cannot be in the past.');
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * A blocked relationship refuses the coach's read. The screen used to say "Nothing assigned to
   * this client yet" over two real assignments, which is a false statement about the client's
   * history rather than a description of the refusal.
   */
  it('explains a refused client instead of claiming nothing is assigned', async () => {
    const denied = new HttpErrorResponse({
      status: 403,
      error: { accessReason: 'RelationshipBlocked' },
    });
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() => throwError(() => denied)),
    });

    await component.selectClient('client-1');
    await settle(fixture);

    expect(host.textContent).toContain('You have blocked this client');
    expect(host.textContent).not.toContain('Nothing assigned to this client yet.');
    // And no assign form is offered for a client the server will refuse.
    expect(host.querySelector('select[name="formVersionId"]')).toBeNull();
  });

  it('still reports a plain transport failure as an error, not as a denial', async () => {
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() => throwError(() => new Error('offline'))),
    });

    await component.selectClient('client-1');
    await settle(fixture);

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain("This client's check-ins could not be loaded.");
  });
});
