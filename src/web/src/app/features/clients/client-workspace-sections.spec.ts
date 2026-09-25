import { NO_ERRORS_SCHEMA, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CoachClientDetails, WorkspaceDetails } from '../../core/api/api.models';
import type { CheckInAssignmentListItem, CheckInResponseStatus } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settle } from '../../../testing/dom';
import {
  ClientCheckInsSection,
  ClientIntakeSection,
  ClientServiceSection,
  ClientTrainingSection,
} from './client-workspace-sections';
import { ClientWorkspaceContext } from './client-workspace.context';

const PROFILE = {
  id: 'client-1',
  firstName: 'Maya',
  lastName: 'Rahman',
  email: 'maya@example.test',
  onboardingStatus: 'Completed',
  coachNotes: null,
  version: 3,
  release: null,
} as unknown as CoachClientDetails;

const FORMER = {
  ...PROFILE,
  release: {
    releasedAtUtc: '2026-09-20T10:00:00Z',
    reason: 'Moved',
    releasedByName: 'Olivia Owner',
    departureKind: 'ReleasedByOwner',
  },
} as CoachClientDetails;

function item(
  id: string,
  dueDate: string,
  status: CheckInResponseStatus | null,
): CheckInAssignmentListItem {
  return {
    assignment: {
      id,
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formVersionId: 'v1',
      formVersionNumber: 1,
      clientProfileId: 'client-1',
      dueDate,
      assignedAtUtc: '2026-09-01T09:00:00Z',
      assignedByUserId: 'coach-1',
    },
    response:
      status === null
        ? null
        : {
            responseId: `r-${id}`,
            status,
            submittedDate: status === 'Draft' ? null : dueDate,
            submittedAtUtc: status === 'Draft' ? null : `${dueDate}T06:00:00Z`,
            reviewedAtUtc: status === 'Reviewed' ? `${dueDate}T12:00:00Z` : null,
            isLate: false,
          },
  };
}

async function render<T>(
  component: Type<T>,
  options: {
    profile?: CoachClientDetails;
    isOwner?: boolean;
    api?: Record<string, unknown>;
    query?: Record<string, string>;
    stubChildren?: boolean;
  } = {},
) {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideRouter([]),
      ClientWorkspaceContext,
      { provide: ApiClient, useValue: options.api ?? {} },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          isOwner: signal(options.isOwner ?? true),
        },
      },
      ...(options.query
        ? [
            {
              provide: ActivatedRoute,
              useValue: {
                snapshot: { queryParamMap: new Map(Object.entries(options.query)) },
              },
            },
          ]
        : []),
    ],
  });
  if (options.stubChildren ?? true) {
    TestBed.overrideComponent(component, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
  }
  await TestBed.compileComponents();
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set('client-1');
  context.profile.set(options.profile ?? PROFILE);
  context.workspace.set({ currentDate: '2026-09-20' } as WorkspaceDetails);
  const fixture = TestBed.createComponent(component);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, context };
}

describe('client record sections', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('gives the owner the coach and release actions for a current client, and a coach neither', async () => {
    const owner = await render(ClientServiceSection);
    expect(owner.host.querySelector('app-client-coach')).not.toBeNull();
    expect(owner.host.querySelector('app-client-release')).not.toBeNull();
    expect(owner.host.querySelector('app-client-commercial')).not.toBeNull();

    TestBed.resetTestingModule();
    const coach = await render(ClientServiceSection, { isOwner: false });
    expect(coach.host.querySelector('app-client-coach')).toBeNull();
    expect(coach.host.querySelector('app-client-release')).toBeNull();
    expect(coach.host.querySelector('app-client-commercial')).not.toBeNull();
  });

  it('shows a former client’s plans read-only and offers nothing that changes them', async () => {
    const { host } = await render(ClientServiceSection, { profile: FORMER });

    expect(host.querySelector('app-client-coach')).toBeNull();
    expect(host.querySelector('app-client-release')).toBeNull();
    expect(host.querySelector('app-client-commercial')).not.toBeNull();
  });

  it('hands the Overview’s renewal request to the plans section', async () => {
    const { fixture } = await render(ClientServiceSection, { query: { renew: 'enrollment-1' } });

    const component = fixture.componentInstance as unknown as { renewEnrollmentId: string | null };
    expect(component.renewEnrollmentId).toBe('enrollment-1');
  });

  it('disables the whole intake for a former client', async () => {
    const current = await render(ClientIntakeSection);
    expect(current.host.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(false);

    TestBed.resetTestingModule();
    const former = await render(ClientIntakeSection, { profile: FORMER });
    expect(former.host.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
  });

  it('does not show a former client’s training', async () => {
    const { host } = await render(ClientTrainingSection, { profile: FORMER });

    expect(host.querySelector('app-client-training')).toBeNull();
    expect(host.textContent).toContain('This is a former client.');
  });

  it('lists the check-ins with their workflow state and links each submission to its review', async () => {
    const list = vi.fn(() =>
      of({
        clientProfileId: 'client-1',
        total: 4,
        items: [
          item('due', '2026-09-27', null),
          item('waiting', '2026-09-20', 'Submitted'),
          item('overdue', '2026-09-18', 'Draft'),
          item('done', '2026-09-13', 'Reviewed'),
        ],
      }),
    );
    const { host } = await render(ClientCheckInsSection, {
      api: { listClientCheckInAssignments: list },
      stubChildren: false,
    });

    expect(list).toHaveBeenCalledWith('client-1', 0, 50);
    const rows = Array.from(host.querySelectorAll('tbody tr')).map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Not started');
    expect(rows[1]).toContain('Needs review');
    expect(rows[2]).toContain('Overdue');
    expect(rows[3]).toContain('Reviewed');

    const links = Array.from(host.querySelectorAll('tbody a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/checkins/clients?clientId=client-1&assignmentId=waiting',
      '/checkins/clients?clientId=client-1&assignmentId=done',
    ]);
    expect(host.querySelector('tbody a')?.textContent).toContain('Review');
  });

  it('says why check-ins are closed instead of showing an empty list', async () => {
    const refused = new HttpErrorResponse({
      status: 403,
      error: { accessReason: 'NoEntitlement' },
    });
    const { host } = await render(ClientCheckInsSection, {
      api: { listClientCheckInAssignments: vi.fn(() => throwError(() => refused)) },
      stubChildren: false,
    });

    expect(host.textContent).toContain("Check-ins are not part of this client's current plan");
    expect(host.textContent).not.toContain('No check-ins assigned yet.');
  });
});
