import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientInvitation, TeamMember } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { UiToast } from '../../ui/toast';
import { fill, focusedId, press, settle } from '../../../testing/dom';
import { provideEmailDelivery } from '../../../testing/email-delivery';
import { Team } from './team';
import { TeamApi } from './team-api';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    userId: 'owner-1',
    displayName: 'Olivia Haddad',
    email: 'owner@example.test',
    role: 'Owner',
    assignedClientCount: 3,
    joinedAtUtc: '2026-08-20T09:00:00Z',
    version: 11,
    ...overrides,
  };
}

const CARA = member({
  userId: 'coach-1',
  displayName: 'Cara Nassar',
  email: 'cara@example.test',
  role: 'Coach',
  assignedClientCount: 2,
  version: 21,
});

function invitation(overrides: Partial<ClientInvitation> = {}): ClientInvitation {
  return {
    id: 'invite-1',
    email: 'nora@example.test',
    firstName: 'Nora',
    lastName: 'Khoury',
    status: 'Pending',
    expiresAtUtc: inDays(5),
    sendCount: 1,
    logicalSendGeneration: 1,
    createdAtUtc: inDays(-2),
    version: 4,
    developmentActionUrl: null,
    kind: 'Coach',
    ...overrides,
  };
}

async function render(api: Partial<Record<keyof TeamApi, unknown>> = {}, emailOff = false) {
  const toast = { show: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [Team],
    providers: [
      provideRouter([]),
      {
        provide: TeamApi,
        useValue: {
          getTeamMembers: vi.fn(() => of([CARA, member()])),
          getCoachInvitations: vi.fn(() => of([invitation()])),
          createCoachInvitation: vi.fn(() =>
            of(
              invitation({
                id: 'invite-2',
                email: 'rami@example.test',
                firstName: 'Rami',
                lastName: 'Saad',
                createdAtUtc: new Date().toISOString(),
              }),
            ),
          ),
          resendCoachInvitation: vi.fn(() => of(invitation({ version: 5 }))),
          revokeCoachInvitation: vi.fn(() => of(invitation({ status: 'Revoked', version: 5 }))),
          removeTeamCoach: vi.fn(() =>
            of({ reassignedClientCount: 2, reassignedInvitationCount: 0 }),
          ),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: UiToast, useValue: toast },
      { provide: AuthStore, useValue: { user: signal({ id: 'owner-1' }) } },
      // The workspace's clock dates each row (COACH-6).
      {
        provide: WorkspaceCalendar,
        useValue: {
          resolveToday: vi.fn(() => Promise.resolve('2026-10-18')),
          timeZone: signal('Asia/Beirut'),
        },
      },
      provideEmailDelivery(emailOff),
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantId: 'tenant-1', role: 'Owner' }),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Team);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(TeamApi) as unknown as Record<keyof TeamApi, ReturnType<typeof vi.fn>>,
    toast,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The sheet or dialog on top, which the CDK draws outside the page. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

/** Chooses `item` from the menu named `label`. */
async function choose(
  fixture: { detectChanges(): void },
  host: HTMLElement,
  label: string,
  item: string,
) {
  const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`No menu is named "${label}".`);
  trigger.click();
  await settle(fixture as never);
  const choice = Array.from(host.querySelectorAll<HTMLButtonElement>('.panel .item')).find(
    (candidate) => textOf(candidate.querySelector('.item-title')) === item,
  );
  if (!choice) throw new Error(`The menu "${label}" has no "${item}".`);
  choice.click();
  await settle(fixture as never);
}

describe('Settings › Team', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('shows the owner first, then each coach with a face, their clients and when they joined', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('[data-summary]'))).toBe(
      'You and 1 coach, 5 clients between you. Each client has one coach, and a coach sees only their own; you see every client.',
    );
    const rows = Array.from(host.querySelectorAll('[data-member]'));
    expect(rows.map((row) => row.getAttribute('data-member'))).toEqual(['owner-1', 'coach-1']);
    const [owner, cara] = rows;
    expect(textOf(owner.querySelector('app-avatar'))).toBe('OH');
    expect(textOf(owner.querySelector('.name'))).toBe('Olivia Haddad (you)');
    expect(textOf(owner.querySelector('.role'))).toBe('Owner');
    expect(textOf(cara.querySelector('app-avatar'))).toBe('CN');
    expect(textOf(cara.querySelector('.role'))).toBe('Coach');
    expect(textOf(cara.querySelector('.clients'))).toBe('2 clients');
    // The workspace's day in the house style (COACH-6); another year names its year instead.
    expect(textOf(cara.querySelector('.joined'))).toMatch(/^Joined (Thu 20 Aug|20 Aug 2026)$/);
    // Only a coach can be removed; the owner row offers nothing.
    expect(owner.querySelector('app-menu')).toBeNull();
    expect(cara.querySelector('button[aria-label="More for Cara Nassar"]')).not.toBeNull();
  });

  it('lists who is still to accept, with how long the link works', async () => {
    const { host } = await render({
      getCoachInvitations: vi.fn(() =>
        of([
          invitation(),
          invitation({ id: 'invite-old', email: 'ziad@example.test', expiresAtUtc: inDays(-1) }),
          invitation({ id: 'invite-done', status: 'Accepted' }),
        ]),
      ),
    });

    const waiting = Array.from(host.querySelectorAll('[data-invitation]'));
    expect(waiting.map((row) => row.getAttribute('data-invitation'))).toEqual([
      'invite-1',
      'invite-old',
    ]);
    expect(textOf(waiting[0].querySelector('.role'))).toBe('Invited');
    // The pill says Invited, so the line says when it was sent, never "Invited · Invited" (COACH-6).
    expect(textOf(waiting[0].querySelector('.joined'))).toMatch(
      /^Sent (\w{3} \d+ \w{3}|\d+ \w{3} \d{4}) · the link works until (\w{3} \d+ \w{3}|\d+ \w{3} \d{4})$/,
    );
    expect(textOf(waiting[1].querySelector('.role'))).toBe('Link ran out');
    expect(textOf(waiting[1].querySelector('.joined'))).toContain('the link ran out');
  });

  it('invites a coach in a sheet, refusing an incomplete one before calling the API', async () => {
    const { fixture, host, api, toast } = await render();

    press(host, 'Invite a coach');
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Invite a coach');

    press(dialog()!, 'Send invitation');
    await settle(fixture);
    await new Promise((resolve) => setTimeout(resolve));
    expect(api.createCoachInvitation).not.toHaveBeenCalled();
    expect(textOf(dialog())).toContain('Type the coach’s email address.');
    expect(textOf(dialog())).toContain('Type the coach’s first name.');
    expect(focusedId()).toBe('invite-email');

    fill(dialog()!, 'Email', '  rami@example.test ');
    fill(dialog()!, 'First name', ' Rami ');
    fill(dialog()!, 'Last name', 'Saad');
    await settle(fixture);
    press(dialog()!, 'Send invitation');
    await settle(fixture);

    expect(api.createCoachInvitation).toHaveBeenCalledWith({
      email: 'rami@example.test',
      firstName: 'Rami',
      lastName: 'Saad',
    });
    expect(dialog()).toBeNull();
    expect(host.querySelector('[data-invitation="invite-2"]')).not.toBeNull();
    expect(toast.show).toHaveBeenCalledWith('Invitation sent to rami@example.test.', {
      tone: 'success',
    });
  });

  it('says that the invitation reaches nobody while this server sends no email', async () => {
    const { fixture, host, toast } = await render({}, true);

    press(host, 'Invite a coach');
    await settle(fixture);
    // Audit LOST-1: the sheet does not promise an email the server cannot send.
    expect(textOf(dialog()?.querySelector('[data-email-off]'))).toContain(
      'Email is off on this server, so they won’t get the link yet; once email is on, send it again.',
    );
    expect(textOf(dialog())).not.toContain('They get an email with a link.');

    fill(dialog()!, 'Email', 'rami@example.test');
    fill(dialog()!, 'First name', 'Rami');
    fill(dialog()!, 'Last name', 'Saad');
    await settle(fixture);
    press(dialog()!, 'Send invitation');
    await settle(fixture);
    expect(toast.show).toHaveBeenCalledWith(
      'Invitation saved. Email is off on this server, so rami@example.test doesn’t get it yet.',
      { tone: 'success' },
    );

    await choose(fixture, host, 'More for the invitation to Nora Khoury', 'Send a new link');
    expect(toast.show).toHaveBeenCalledWith(
      'A new link was made for nora@example.test, but email is off on this server, so it wasn’t sent. The one sent before no longer works.',
      { tone: 'success' },
    );
  });

  it('keeps the sheet open with the server’s reason when an invitation is refused', async () => {
    const { fixture, host } = await render({
      createCoachInvitation: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { message: 'This person is already on your team.' },
            }),
        ),
      ),
    });

    press(host, 'Invite a coach');
    await settle(fixture);
    fill(dialog()!, 'Email', 'cara@example.test');
    fill(dialog()!, 'First name', 'Cara');
    fill(dialog()!, 'Last name', 'Nassar');
    await settle(fixture);
    press(dialog()!, 'Send invitation');
    await settle(fixture);

    expect(textOf(dialog()!.querySelector('[role="alert"]'))).toBe(
      'This person is already on your team.',
    );
    expect((dialog()!.querySelector('#invite-email') as HTMLInputElement).value).toBe(
      'cara@example.test',
    );
  });

  it('asks before a half-typed invitation is closed', async () => {
    const { fixture, host } = await render();

    press(host, 'Invite a coach');
    await settle(fixture);
    fill(dialog()!, 'Email', 'rami@');
    await settle(fixture);
    press(dialog()!, 'Not now');
    await settle(fixture);

    expect(textOf(dialog()?.querySelector('h2'))).toBe('Close without sending?');
    press(dialog()!, 'Keep editing');
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Invite a coach');
  });

  it('asks before removing a coach, then sends the version the page was loaded at', async () => {
    const { fixture, host, api, toast } = await render();

    await choose(fixture, host, 'More for Cara Nassar', 'Remove from the team');
    expect(api.removeTeamCoach).not.toHaveBeenCalled();
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Remove Cara Nassar?');
    expect(textOf(dialog())).toContain('Their 2 clients move to you with all their history');

    press(dialog()!, 'Remove coach');
    await settle(fixture);

    expect(api.removeTeamCoach).toHaveBeenCalledWith('coach-1', 21);
    // The team is read again so the counts and the list follow the removal.
    expect(api.getTeamMembers).toHaveBeenCalledTimes(2);
    expect(toast.show).toHaveBeenCalledWith('Cara Nassar left the team. 2 clients moved to you.', {
      tone: 'success',
    });
  });

  it('says one client in the singular when a coach with one client is removed', async () => {
    const { fixture, host, toast } = await render({
      getTeamMembers: vi.fn(() => of([{ ...CARA, assignedClientCount: 1 }, member()])),
      removeTeamCoach: vi.fn(() => of({ reassignedClientCount: 1, reassignedInvitationCount: 0 })),
    });

    await choose(fixture, host, 'More for Cara Nassar', 'Remove from the team');
    // Never "Their 1 clients move to you" (COACH-18).
    expect(textOf(dialog())).toContain('Their client moves to you with all their history');
    expect(textOf(dialog())).not.toContain('1 clients');
    press(dialog()!, 'Remove coach');
    await settle(fixture);
    expect(toast.show).toHaveBeenCalledWith(
      'Cara Nassar left the team. Their client moved to you.',
      { tone: 'success' },
    );
  });

  it('asks before Browser Back, a workspace switch or sign-out drops a half-typed invitation', async () => {
    const { fixture, host, api } = await render();
    press(host, 'Invite a coach');
    await settle(fixture);
    const sheet = dialog()!;

    // Nothing typed: leaving asks nothing (audit COACH-1).
    expect(await TestBed.inject(UnsavedWork).confirmLeave()).toBe(true);
    expect(dialog()).toBe(sheet);

    fill(sheet, 'Email', 'rami@example.test');
    await settle(fixture);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    // The question the route guard and the session both ask; staying keeps the sheet and its text.
    const staying = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Close without sending?');
    press(dialog()!, 'Keep editing');
    expect(await staying).toBe(false);
    await settle(fixture);
    expect(dialog()).toBe(sheet);
    expect(sheet.querySelector<HTMLInputElement>('input[name="email"]')!.value).toBe(
      'rami@example.test',
    );

    const leaving = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(fixture);
    press(dialog()!, 'Close without sending');
    expect(await leaving).toBe(true);
    expect(api.createCoachInvitation).not.toHaveBeenCalled();
  });

  it('sends nothing when a removal is not confirmed', async () => {
    const { fixture, host, api } = await render();

    await choose(fixture, host, 'More for Cara Nassar', 'Remove from the team');
    press(dialog()!, 'Keep them');
    await settle(fixture);

    expect(api.removeTeamCoach).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('sends a new link and cancels an invitation with its version', async () => {
    const { fixture, host, api, toast } = await render();

    await choose(fixture, host, 'More for the invitation to Nora Khoury', 'Send a new link');
    expect(api.resendCoachInvitation).toHaveBeenCalledWith('invite-1', expect.any(String), 4);
    expect(toast.show).toHaveBeenCalledWith(
      'A new link went to nora@example.test. The one sent before no longer works.',
      { tone: 'success' },
    );

    await choose(fixture, host, 'More for the invitation to Nora Khoury', 'Cancel the invitation');
    // Cancelling kills the link, so it is asked first.
    expect(api.revokeCoachInvitation).not.toHaveBeenCalled();
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Cancel the invitation to Nora Khoury?');
    press(dialog()!, 'Cancel the invitation');
    await settle(fixture);
    expect(api.revokeCoachInvitation).toHaveBeenCalledWith('invite-1', 5);
    // A cancelled invitation is no longer waiting, so it leaves the list.
    expect(host.querySelector('[data-invitation="invite-1"]')).toBeNull();
    expect(host.querySelector('[data-waiting]')).toBeNull();
  });

  it('invites the owner of a one-person space to coach with a team', async () => {
    const { host } = await render({
      getTeamMembers: vi.fn(() => of([member()])),
      getCoachInvitations: vi.fn(() => of([])),
    });

    expect(textOf(host.querySelector('[data-summary]'))).toBe(
      'Just you so far. Invite a coach and give them their own clients: a coach sees only the clients you give them.',
    );
    expect(textOf(host.querySelector('app-empty-state h2'))).toBe('Coach with a team');
  });

  it('offers another try when the team cannot be read', async () => {
    const getTeamMembers = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of([member()]));
    const { fixture, host } = await render({ getTeamMembers });

    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Your team couldn’t be loaded.');
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelectorAll('[data-member]').length).toBe(1);
  });
});
