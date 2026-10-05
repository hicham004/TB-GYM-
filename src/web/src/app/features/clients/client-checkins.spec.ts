import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  CoachClientDetails,
  WorkspaceDetails,
} from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  CURRENT_ID,
  EARLIER_ID,
  OLDEST_ID,
  reviewList,
  REVIEW_CLIENT_ID,
} from '../../../testing/checkin-review-fixtures';
import { LEA_ID } from '../../../testing/coach-today-fixtures';
import { press, settle } from '../../../testing/dom';
import { ClientCheckIns } from './client-checkins';
import { ClientWorkspaceContext } from './client-workspace.context';

const PROFILE = {
  id: REVIEW_CLIENT_ID,
  firstName: 'Maya',
  lastName: 'Fakhoury',
  release: null,
  version: 3,
} as unknown as CoachClientDetails;

async function render(
  options: {
    api?: Record<string, unknown>;
    checkIns?: { isAllowed: boolean; reason: string };
    profile?: CoachClientDetails;
  } = {},
) {
  const api = {
    listClientCheckInAssignments: vi.fn(() => of(reviewList())),
    ...options.api,
  };
  TestBed.configureTestingModule({
    imports: [ClientCheckIns],
    providers: [
      provideRouter([]),
      ClientWorkspaceContext,
      { provide: ApiClient, useValue: api },
      { provide: AuthStore, useValue: { user: signal({ id: LEA_ID }) } },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: signal('tenant-1'), isOwner: signal(false) },
      },
    ],
  });
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set(REVIEW_CLIENT_ID);
  context.profile.set(options.profile ?? PROFILE);
  context.plans.set({
    clientProfileId: REVIEW_CLIENT_ID,
    isRelationshipBlocked: false,
    featureAccess: options.checkIns ? [{ feature: 'CheckIns', ...options.checkIns }] : [],
    enrollments: [],
  } as unknown as ClientCommercialOverview);
  context.workspace.set({
    currentDate: '2026-10-01',
    timeZoneId: 'Asia/Beirut',
  } as WorkspaceDetails);
  const fixture = TestBed.createComponent(ClientCheckIns);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api };
}

const all = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(selector));
const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('a client’s check-ins', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('puts the one to review first and links each sent check-in to its review', async () => {
    const { host, api } = await render();

    expect(api.listClientCheckInAssignments).toHaveBeenCalledWith(REVIEW_CLIENT_ID, 0, 50);
    expect(all(host, '.panel-head h3').map(textOf)).toEqual([
      'To review 1',
      'Not sent yet',
      'Reviewed',
    ]);
    expect(all(host, '.row-line').map(textOf)).toEqual([
      'Sent Thu 1 Oct · 1 day late',
      'Due Wed 7 Oct',
      'Sent Wed 23 Sep · reviewed Thu 24 Sep',
      'Sent Wed 16 Sep · reviewed Thu 17 Sep',
    ]);
    // Each group's heading says the state, so no row repeats it.
    expect(all(host, 'app-status-pill')).toHaveLength(0);
    expect(all(host, 'a.row-link').map((link) => link.getAttribute('href'))).toEqual([
      `/clients/${REVIEW_CLIENT_ID}/checkins/${CURRENT_ID}`,
      `/clients/${REVIEW_CLIENT_ID}/checkins/${EARLIER_ID}`,
      `/clients/${REVIEW_CLIENT_ID}/checkins/${OLDEST_ID}`,
    ]);
    // Each link says which check-in it opens, since every one shares the form's name.
    expect(textOf(host.querySelector('a.row-link'))).toBe(
      'Weekly check-in, Sent Thu 1 Oct · 1 day late',
    );
  });

  it('offers assigning a check-in on the check-in screen, opened on this client', async () => {
    const { host } = await render();

    const assign = all(host, 'a').find((link) => textOf(link) === 'Assign a check-in');
    expect(assign?.getAttribute('href')).toBe(`/checkins/clients?clientId=${REVIEW_CLIENT_ID}`);
  });

  it('says why check-ins are closed instead of showing an empty list', async () => {
    const refused = new HttpErrorResponse({
      status: 403,
      error: { accessReason: 'NoEntitlement' },
    });
    const { host } = await render({
      api: { listClientCheckInAssignments: vi.fn(() => throwError(() => refused)) },
    });

    expect(textOf(host.querySelector('.prose p'))).toBe('Check-ins aren’t part of Maya’s plan.');
    expect(host.textContent).not.toContain('No check-ins yet');
  });

  it('does not ask when the plan already says check-ins are closed', async () => {
    const { host, api } = await render({ checkIns: { isAllowed: false, reason: 'Expired' } });

    expect(api.listClientCheckInAssignments).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('.prose p'))).toBe(
      'Maya’s plan has ended, so their check-ins aren’t shown.',
    );
  });

  it('invites the first check-in when there is none', async () => {
    const { host } = await render({
      api: {
        listClientCheckInAssignments: vi.fn(() =>
          of({ clientProfileId: REVIEW_CLIENT_ID, total: 0, items: [] }),
        ),
      },
    });

    expect(textOf(host.querySelector('app-empty-state h2'))).toBe('No check-ins yet');
    expect(textOf(host.querySelector('app-empty-state p'))).toBe(
      'Assign one and Maya’s answers come in here, ready to read beside the last.',
    );
  });

  it('loads older check-ins a page at a time', async () => {
    const first = reviewList();
    const older = reviewList().items.map((item) => ({
      ...item,
      assignment: { ...item.assignment, id: `older-${item.assignment.id}` },
    }));
    const list = vi
      .fn()
      .mockReturnValueOnce(of({ ...first, total: 8 }))
      .mockReturnValueOnce(of({ ...first, total: 8, items: older }));
    const { host, fixture } = await render({ api: { listClientCheckInAssignments: list } });

    expect(textOf(host.querySelector('.more p'))).toBe('Showing the latest 4 of 8.');
    press(host, 'Show older check-ins');
    await settle(fixture);

    expect(list).toHaveBeenLastCalledWith(REVIEW_CLIENT_ID, 4, 50);
    expect(all(host, '.row').length).toBe(8);
    expect(host.querySelector('.more')).toBeNull();
  });

  it('shows nothing of a former client’s check-ins', async () => {
    const { host, api } = await render({
      profile: { ...PROFILE, release: { reason: 'Moved' } } as unknown as CoachClientDetails,
    });

    expect(api.listClientCheckInAssignments).not.toHaveBeenCalled();
    expect(host.textContent).toContain('This is a former client.');
  });
});
