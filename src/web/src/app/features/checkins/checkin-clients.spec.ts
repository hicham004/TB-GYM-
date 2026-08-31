import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  CheckInAssignmentListItem,
  CheckInAssignmentListView,
  CheckInAssignmentView,
  CheckInComparisonView,
  CheckInResponseDetail,
  CheckInResponseStatus,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  announced,
  choose,
  focusedId,
  leave,
  leaveAt,
  press,
  query,
  settle,
  type,
} from '../../../testing/dom';
import { CheckInClients } from './checkin-clients';

const SHARED_KEY = 'a'.repeat(32);
const ADDED_KEY = 'd'.repeat(32);
/** Distinctive enough that finding it anywhere on the coach's screen is unambiguous. */
const DRAFT_TEXT = 'UNSUBMITTED-DRAFT-CONFESSION-9174';

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

/**
 * One list row as the server now sends it: the assignment plus the state of its response. The
 * status travels with the list, so nothing has to be fetched per assignment to draw a badge.
 */
function listItem(
  item: CheckInAssignmentView,
  status: CheckInResponseStatus | null,
): CheckInAssignmentListItem {
  return {
    assignment: item,
    response:
      status === null
        ? null
        : {
            responseId: `response-${item.id}`,
            status,
            submittedDate: status === 'Draft' ? null : '2026-08-26',
            submittedAtUtc: status === 'Draft' ? null : '2026-08-26T10:00:00Z',
            reviewedAtUtc: status === 'Reviewed' ? '2026-08-27T08:00:00Z' : null,
            isLate: false,
          },
  };
}

function list(...items: CheckInAssignmentListItem[]): CheckInAssignmentListView {
  return { clientProfileId: 'client-1', total: items.length, items };
}

/**
 * @param answersWithheld what the coach route sends for an unsubmitted draft: the response is
 * present and says Draft, and its answers are absent because they are still the client's own.
 */
function detail(
  item: CheckInAssignmentView,
  status: CheckInResponseStatus | null,
  answersWithheld = false,
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
            answersWithheld,
            answers: answersWithheld
              ? []
              : [
                  {
                    questionId: 'question-1',
                    questionKey: SHARED_KEY,
                    questionType: 'ShortText',
                    textValue: status === 'Draft' ? DRAFT_TEXT : 'Shoulders are tight.',
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
  review(): Promise<void>;
  loadMoreAssignments(): Promise<void>;
  assign(): Promise<void>;
  setAssignmentVersion(formVersionId: string): void;
  setAssignmentDueDate(dueDate: string): void;
}

/**
 * Two clients, so a test can select one and then the other while the first read is still in flight.
 */
function client(id: string, firstName: string, lastName: string) {
  return {
    id,
    firstName,
    lastName,
    email: `${id}@example.test`,
    phoneNumber: null,
    onboardingStatus: 'Completed',
    isCoachBlocked: false,
    version: 1,
  };
}

/**
 * The workspace's own current date. The assign form reads today from here rather than from the
 * browser, because the workspace calendar is what the server judges a due date against.
 */
const WORKSPACE = {
  id: 'tenant-1',
  name: 'Workspace',
  slug: 'workspace',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: '2026-08-22',
  version: 1,
} as const;

async function render(
  api: Partial<ApiClient> = {},
  options: {
    selectedTenantId?: WritableSignal<string | null>;
    csrfRefresh?: () => Promise<void>;
  } = {},
) {
  const selectedTenantId = options.selectedTenantId ?? signal<string | null>('tenant-1');
  await TestBed.configureTestingModule({
    imports: [CheckInClients],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getClients: vi.fn(() =>
            of([client('client-1', 'Rana', 'Haddad'), client('client-2', 'Karim', 'Nassar')]),
          ),
          getWorkspace: vi.fn(() => of(WORKSPACE)),
          listCheckInForms: vi.fn(() => of({ total: 0, items: [] })),
          listClientCheckInAssignments: vi.fn(() => of(list())),
          ...api,
        },
      },
      { provide: TenantStore, useValue: { selectedTenantId } },
      {
        provide: CsrfService,
        useValue: { refresh: vi.fn(options.csrfRefresh ?? (() => Promise.resolve())) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CheckInClients);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance as unknown as Harness,
    selectedTenantId,
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

  /**
   * The statuses come from the list itself. Before this the screen listed the assignments and then
   * fetched every response in full to work out which badge to draw — one request per assignment,
   * growing with the client's history, and reading draft content on the way.
   */
  it('shows each assignment with its real state without reading any response', async () => {
    const one = assignment('a1', '2026-08-20');
    const two = assignment('a2', '2026-08-27');
    const getClientCheckInResponse = vi.fn(() => of(detail(one, 'Submitted')));
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() =>
        of(list(listItem(one, 'Submitted'), listItem(two, null))),
      ),
      getClientCheckInResponse: getClientCheckInResponse as never,
    });

    await component.selectClient('client-1');
    await settle(fixture);

    expect(host.textContent).toContain('Submitted');
    expect(host.textContent).toContain('Not started');
    expect(getClientCheckInResponse).not.toHaveBeenCalled();
  });

  it('offers review only for a submitted check-in, never for a draft', async () => {
    const one = assignment('a1', '2026-08-20');
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() => of(list(listItem(one, 'Draft')))),
      getClientCheckInResponse: vi.fn(() => of(detail(one, 'Draft', true))),
    });

    await component.selectClient('client-1');
    await component.openResponse('a1');
    await settle(fixture);

    expect(host.textContent).toContain('has not submitted it');
    expect(host.textContent).not.toContain('Mark as reviewed');
  });

  /**
   * The privacy rule as the coach's screen sees it. The server withholds a draft's answers, and the
   * screen must not render the question list either: "No answer" beside every prompt states
   * something about the client's unsubmitted draft that nobody has been told.
   */
  it('renders no draft answer content for the coach', async () => {
    const one = assignment('a1', '2026-08-20');
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() => of(list(listItem(one, 'Draft')))),
      getClientCheckInResponse: vi.fn(() => of(detail(one, 'Draft', true))),
    });

    await component.selectClient('client-1');
    await component.openResponse('a1');
    await settle(fixture);

    const text = host.textContent ?? '';
    expect(text).not.toContain(DRAFT_TEXT);
    expect(text).not.toContain('No answer');
    expect(host.querySelectorAll('.answer')).toHaveLength(0);
    expect(text).toContain('stays theirs until they do');
  });

  it('still renders answers once the check-in has been submitted', async () => {
    const one = assignment('a1', '2026-08-20');
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() => of(list(listItem(one, 'Submitted')))),
      getClientCheckInResponse: vi.fn(() => of(detail(one, 'Submitted'))),
    });

    await component.selectClient('client-1');
    await component.openResponse('a1');
    await settle(fixture);

    expect(host.textContent).toContain('Shoulders are tight.');
    expect(host.textContent).toContain('Mark as reviewed');
  });

  it('does not offer a draft as something that can be compared', async () => {
    const one = assignment('a1', '2026-08-20');
    const two = assignment('a2', '2026-08-27');
    const { component } = await render({
      listClientCheckInAssignments: vi.fn(() =>
        of(list(listItem(one, 'Submitted'), listItem(two, 'Draft'))),
      ),
    });

    await component.selectClient('client-1');

    // Only the submitted one is comparable, so the server is never asked to refuse the draft.
    expect(component.comparable()).toHaveLength(1);
  });

  /**
   * Selecting A then B leaves A's read in flight. Resolving it afterwards must change nothing: the
   * coach is looking at B, and A's assignments appearing under B's name is the worst kind of wrong
   * — it reads as B's history.
   */
  it('discards a stale client read that resolves after a newer selection', async () => {
    const first = new Subject<CheckInAssignmentListView>();
    const second = new Subject<CheckInAssignmentListView>();
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn((clientId: string) =>
        clientId === 'client-1' ? first : second,
      ) as never,
    });

    const pendingFirst = component.selectClient('client-1');
    const pendingSecond = component.selectClient('client-2');

    // B answers first, then A's older request finally resolves.
    second.next(list(listItem(assignment('b1', '2026-08-27'), 'Reviewed')));
    second.complete();
    first.next(list(listItem(assignment('a1', '2026-08-20'), 'Submitted')));
    first.complete();
    await Promise.all([pendingFirst, pendingSecond]);
    await settle(fixture);

    expect(host.textContent).toContain('Reviewed');
    expect(host.textContent).not.toContain('Submitted');
  });

  it('keeps response B when response A for the same client resolves last', async () => {
    const first = new Subject<CheckInResponseDetail>();
    const second = new Subject<CheckInResponseDetail>();
    const one = assignment('a1', '2026-08-20');
    const two = assignment('a2', '2026-08-27');
    const firstDetail = detail(one, 'Submitted');
    firstDetail.response!.answers[0].textValue = 'Older response A';
    const secondDetail = detail(two, 'Submitted');
    secondDetail.response!.answers[0].textValue = 'Current response B';
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() =>
        of(list(listItem(one, 'Submitted'), listItem(two, 'Submitted'))),
      ),
      getClientCheckInResponse: vi.fn((_clientId: string, assignmentId: string) =>
        assignmentId === one.id ? first : second,
      ) as never,
    });
    await component.selectClient('client-1');

    const pendingFirst = component.openResponse(one.id);
    const pendingSecond = component.openResponse(two.id);
    second.next(secondDetail);
    second.complete();
    first.next(firstDetail);
    first.complete();
    await Promise.all([pendingFirst, pendingSecond]);
    await settle(fixture);

    expect(host.textContent).toContain('Current response B');
    expect(host.textContent).not.toContain('Older response A');
    expect(host.textContent).not.toContain('Loading check-in data');
  });

  it('does not let a stale refusal replace the client now selected', async () => {
    const first = new Subject<CheckInAssignmentListView>();
    const second = new Subject<CheckInAssignmentListView>();
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn((clientId: string) =>
        clientId === 'client-1' ? first : second,
      ) as never,
    });

    const pendingFirst = component.selectClient('client-1');
    const pendingSecond = component.selectClient('client-2');

    second.next(list(listItem(assignment('b1', '2026-08-27'), 'Reviewed')));
    second.complete();
    first.error(
      new HttpErrorResponse({ status: 403, error: { accessReason: 'RelationshipBlocked' } }),
    );
    await Promise.all([pendingFirst, pendingSecond]);
    await settle(fixture);

    expect(host.textContent).not.toContain('You have blocked this client');
    expect(host.textContent).toContain('Reviewed');
  });

  it('discards an open response when the selected client changes', async () => {
    const staleDetail = new Subject<CheckInResponseDetail>();
    const one = assignment('a1', '2026-08-20');
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: vi.fn(() => of(list(listItem(one, 'Submitted')))),
      getClientCheckInResponse: vi.fn(() => staleDetail),
    });

    await component.selectClient('client-1');
    const pending = component.openResponse(one.id);
    await component.selectClient('client-2');
    staleDetail.next(detail(one, 'Submitted'));
    staleDetail.complete();
    await pending;
    await settle(fixture);

    expect(host.textContent).toContain('Karim Nassar');
    expect(host.textContent).not.toContain('Shoulders are tight.');
    expect(host.textContent).not.toContain('Loading check-in data');
  });

  it('invalidates an assignment list when the workspace changes', async () => {
    const selectedTenantId = signal<string | null>('tenant-1');
    const staleList = new Subject<CheckInAssignmentListView>();
    const one = assignment('a1', '2026-08-20');
    const { fixture, host, component } = await render(
      { listClientCheckInAssignments: vi.fn(() => staleList) },
      { selectedTenantId },
    );

    const pending = component.selectClient('client-1');
    selectedTenantId.set('tenant-2');
    await settle(fixture);
    staleList.next(list(listItem(one, 'Submitted')));
    staleList.complete();
    await pending;
    await settle(fixture);

    expect(host.textContent).not.toContain('Submitted');
    expect(host.textContent).toContain('Select a client to assign and review their check-ins.');
  });

  it('does not assign to a client selected while CSRF refresh was in flight', async () => {
    let releaseCsrf!: () => void;
    const csrf = new Promise<void>((resolve) => {
      releaseCsrf = resolve;
    });
    const assignCheckIn = vi.fn(() => of({}));
    const { fixture, component } = await render(
      {
        listCheckInForms: vi.fn(() => of({ total: 1, items: [PUBLISHED_FORM] })),
        assignCheckIn: assignCheckIn as never,
      },
      { csrfRefresh: () => csrf },
    );
    await component.selectClient('client-1');
    component.setAssignmentVersion('version-1');
    component.setAssignmentDueDate('2026-08-24');

    const pending = component.assign();
    await component.selectClient('client-2');
    releaseCsrf();
    await pending;
    await settle(fixture);

    expect(assignCheckIn).not.toHaveBeenCalled();
  });

  it('does not apply a review after the selected client changes', async () => {
    let releaseCsrf!: () => void;
    const csrf = new Promise<void>((resolve) => {
      releaseCsrf = resolve;
    });
    const one = assignment('a1', '2026-08-20');
    const reviewCheckInResponse = vi.fn(() => of(detail(one, 'Reviewed')));
    const { fixture, host, component } = await render(
      {
        listClientCheckInAssignments: vi.fn(() => of(list(listItem(one, 'Submitted')))),
        getClientCheckInResponse: vi.fn(() => of(detail(one, 'Submitted'))),
        reviewCheckInResponse: reviewCheckInResponse as never,
      },
      { csrfRefresh: () => csrf },
    );
    await component.selectClient('client-1');
    await component.openResponse(one.id);

    const pending = component.review();
    await component.selectClient('client-2');
    releaseCsrf();
    await pending;
    await settle(fixture);

    expect(reviewCheckInResponse).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Marked as reviewed.');
  });

  it('does not apply a comparison after the selected client changes', async () => {
    const comparison = new Subject<CheckInComparisonView>();
    const { fixture, host, component } = await render({
      compareCheckInResponses: vi.fn(() => comparison),
    });
    await component.selectClient('client-1');
    component.firstResponseId = 'response-a1';
    component.secondResponseId = 'response-a2';

    const pending = component.compare();
    await component.selectClient('client-2');
    comparison.next(COMPARISON);
    comparison.complete();
    await pending;
    await settle(fixture);

    expect(host.textContent).not.toContain('Nothing here is scored, rated or compared for you.');
    expect(host.textContent).not.toContain('Loading check-in data');
  });

  it('loads all assignment pages, appends without duplicates, and clears them for another client', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => {
      const item = assignment(
        `page-${index}`,
        `2026-10-${String(20 - (index % 20)).padStart(2, '0')}`,
      );
      item.formTitle = `Paged check-in ${index}`;
      return listItem(item, index % 2 === 0 ? 'Submitted' : null);
    });
    const other = assignment('other-1', '2026-08-23');
    other.formTitle = 'Other client check-in';
    const listAssignments = vi.fn((clientId: string, skip: number, take: number) =>
      of(
        clientId === 'client-1'
          ? { clientProfileId: clientId, total: 51, items: rows.slice(skip, skip + take) }
          : { clientProfileId: clientId, total: 1, items: [listItem(other, null)] },
      ),
    );
    const { fixture, host, component } = await render({
      listClientCheckInAssignments: listAssignments as never,
    });

    await component.selectClient('client-1');
    await settle(fixture);
    expect(host.textContent).toContain('Showing 50 of 51 check-ins, newest first.');
    press(host, 'Load more check-ins');
    await settle(fixture);
    expect(host.textContent).toContain('Showing 51 of 51 check-ins, newest first.');
    expect(host.querySelectorAll('ul.assignments > li')).toHaveLength(51);
    expect(new Set(rows.map((row) => row.assignment.id)).size).toBe(51);

    await component.selectClient('client-2');
    await settle(fixture);
    expect(host.querySelectorAll('ul.assignments > li')).toHaveLength(1);
    expect(host.textContent).toContain('Other client check-in');
    expect(host.textContent).not.toContain('Paged check-in 0');
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
   * the form could never become valid however it was completed: it validated correctly and the
   * screen was still dead. Validity is now read from what the screen says is outstanding, since the
   * submit button no longer reports it — a disabled button could not be reached to say anything.
   */
  it('tracks validity as the assign form is filled in', async () => {
    const { fixture, host, component } = await render({
      listCheckInForms: vi.fn(() => of({ total: 1, items: [PUBLISHED_FORM] })),
    });

    await component.selectClient('client-1');
    await settle(fixture);

    choose(host, 'select[name="formVersionId"]', 'version-1');
    await settle(fixture);
    // One field alone is not enough. The due date's reason waits for the due date to be left,
    // rather than accusing the user of missing a field they have not reached yet.
    expect(host.textContent).not.toContain('Choose a due date.');

    leave(host, 'Due date');
    await settle(fixture);
    expect(host.textContent).toContain('Choose a due date.');

    type(host, 'input[name="dueDate"]', '2026-08-24');
    await settle(fixture);

    expect(host.textContent).not.toContain('Choose a due date.');
  });

  it('refuses a due date that has already passed', async () => {
    const assignCheckIn = vi.fn(() => of({}));
    const { fixture, host, component } = await render({
      listCheckInForms: vi.fn(() => of({ total: 1, items: [PUBLISHED_FORM] })),
      assignCheckIn: assignCheckIn as never,
    });

    await component.selectClient('client-1');
    await settle(fixture);

    choose(host, 'select[name="formVersionId"]', 'version-1');
    type(host, 'input[name="dueDate"]', '2026-08-21');
    leave(host, 'Due date');
    await settle(fixture);

    press(host, 'Assign');
    await settle(fixture);

    expect(assignCheckIn).not.toHaveBeenCalled();
    expect(host.textContent).toContain('The due date cannot be in the past.');
  });

  /**
   * The workspace is a day ahead of UTC. `new Date().toISOString()` would say it is still the 22nd
   * and refuse the 23rd as past, while the server — which decides in the workspace time zone —
   * accepts it. The form now reads the workspace's own current date, so the two agree.
   */
  it('judges the due date against the workspace calendar, not the browser clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 21:30 UTC on the 22nd is already the 23rd in Asia/Beirut.
    vi.setSystemTime(new Date('2026-08-22T21:30:00Z'));
    try {
      const assignCheckIn = vi.fn(() => of({}));
      const { fixture, host, component } = await render({
        listCheckInForms: vi.fn(() => of({ total: 1, items: [PUBLISHED_FORM] })),
        getWorkspace: vi.fn(() => of({ ...WORKSPACE, currentDate: '2026-08-23' })),
        assignCheckIn: assignCheckIn as never,
      });

      await component.selectClient('client-1');
      await settle(fixture);

      choose(host, 'select[name="formVersionId"]', 'version-1');
      // Workspace-today. Accepted, because the boundary is the workspace's own date.
      type(host, 'input[name="dueDate"]', '2026-08-23');
      leave(host, 'Due date');
      await settle(fixture);
      expect(host.textContent).not.toContain('The due date cannot be in the past.');

      press(host, 'Assign');
      await settle(fixture);
      expect(assignCheckIn).toHaveBeenCalledOnce();

      // The day before workspace-today is genuinely past and is still refused.
      type(host, 'input[name="dueDate"]', '2026-08-22');
      leave(host, 'Due date');
      await settle(fixture);
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

/** The reason rendered against one field, found by the id the field's control points at. */
function reasonFor(host: HTMLElement, field: string): string {
  return (host.querySelector(`#assign-${field}-reason`)?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The assign form under the ratified validation convention: a derived reason waits for its own field
 * to be left or for a submit to be refused, renders as plain text, and is announced only by the one
 * summary region — which speaks only because the user just tried something and it did not happen.
 */
describe('CheckInClients validation display', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function assignForm() {
    const rendered = await render({
      listCheckInForms: vi.fn(() => of({ total: 1, items: [PUBLISHED_FORM] })),
    });
    await rendered.component.selectClient('client-1');
    await settle(rendered.fixture);
    return rendered;
  }

  it('announces nothing and shows no reason on a form nobody has touched', async () => {
    const { host } = await assignForm();

    expect(announced(host)).toBe('');
    expect(host.textContent).not.toContain('Choose a due date.');
    expect(host.textContent).not.toContain('Choose a published version to assign.');
  });

  it('reveals a field’s reason when that field is left, and only that field’s', async () => {
    const { fixture, host } = await assignForm();

    leave(host, 'Due date');
    await settle(fixture);

    expect(reasonFor(host, 'due-date')).toContain('Choose a due date.');
    expect(reasonFor(host, 'version')).toBe('');
    // Plain text, not an announcement: it was already on screen the moment it appeared.
    expect(announced(host)).toBe('');
  });

  it('names every outstanding reason at once when a blocked submit is attempted', async () => {
    const { fixture, host } = await assignForm();

    press(host, 'Assign');
    await settle(fixture);

    const summary = announced(host);
    expect(summary).toContain('Choose a published version to assign.');
    expect(summary).toContain('Choose a due date.');
    // And each reason also takes its place against its own field.
    expect(reasonFor(host, 'version')).toContain('Choose a published version to assign.');
    expect(reasonFor(host, 'due-date')).toContain('Choose a due date.');
  });

  it('clears a corrected field’s reason and leaves the other standing', async () => {
    const { fixture, host } = await assignForm();

    press(host, 'Assign');
    await settle(fixture);

    choose(host, 'select[name="formVersionId"]', 'version-1');
    await settle(fixture);

    expect(reasonFor(host, 'version')).toBe('');
    expect(reasonFor(host, 'due-date')).toContain('Choose a due date.');
  });

  it('carries aria-invalid and aria-describedby exactly while the reason is showing', async () => {
    const { fixture, host } = await assignForm();
    const control = () => query<HTMLInputElement>(host, 'input[name="dueDate"]');

    expect(control().getAttribute('aria-invalid')).toBeNull();
    expect(control().getAttribute('aria-describedby')).toBeNull();

    leaveAt(host, 'input[name="dueDate"]');
    await settle(fixture);

    expect(control().getAttribute('aria-invalid')).toBe('true');
    expect(control().getAttribute('aria-describedby')).toBe('assign-due-date-reason');
    expect(query(host, '#assign-due-date-reason').textContent).toContain('Choose a due date.');

    type(host, 'input[name="dueDate"]', '2026-08-24');
    await settle(fixture);

    expect(control().getAttribute('aria-invalid')).toBeNull();
    expect(control().getAttribute('aria-describedby')).toBeNull();
  });

  /**
   * A disabled submit cannot be clicked, is not reachable by Enter, and in Chrome cannot even take
   * focus — so it can neither be acted on nor explain itself, and the summary it pointed at could
   * never be reached. The control stays operable and the attempt is refused out loud instead.
   */
  it('keeps the submit control operable while the form is invalid', async () => {
    const { host } = await assignForm();
    const submit = query<HTMLButtonElement>(host, 'form.builder-form button[type="submit"]');

    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute('aria-describedby')).toBe('assign-summary');
  });

  it('moves focus to the summary when a submit is refused, so the refusal is where the user is', async () => {
    const { fixture, host } = await assignForm();

    press(host, 'Assign');
    await settle(fixture);

    expect(focusedId()).toBe('assign-summary');
  });

  it('does not reach the API when a refused submit is attempted', async () => {
    const assignCheckIn = vi.fn(() => of({}));
    const { fixture, host, component } = await render({
      listCheckInForms: vi.fn(() => of({ total: 1, items: [PUBLISHED_FORM] })),
      assignCheckIn: assignCheckIn as never,
    });
    await component.selectClient('client-1');
    await settle(fixture);

    press(host, 'Assign');
    await settle(fixture);

    expect(assignCheckIn).not.toHaveBeenCalled();
    expect(announced(host)).toContain('Choose a due date.');
  });

  it('assigns for real once the form is complete, and clears the summary', async () => {
    const assignCheckIn = vi.fn(() => of({}));
    const { fixture, host, component } = await render({
      listCheckInForms: vi.fn(() => of({ total: 1, items: [PUBLISHED_FORM] })),
      assignCheckIn: assignCheckIn as never,
    });
    await component.selectClient('client-1');
    await settle(fixture);

    choose(host, 'select[name="formVersionId"]', 'version-1');
    type(host, 'input[name="dueDate"]', '2026-08-24');
    await settle(fixture);

    press(host, 'Assign');
    await settle(fixture);

    expect(assignCheckIn).toHaveBeenCalledOnce();
    expect(announced(host)).toBe('');
  });
});
