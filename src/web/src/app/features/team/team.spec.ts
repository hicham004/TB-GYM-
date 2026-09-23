import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientInvitation, TeamMember } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { installDialogSupport } from '../../../testing/dialog';
import { button, fill, press, settle, text } from '../../../testing/dom';
import { Team } from './team';
import { TeamApi } from './team-api';

let uninstallDialog: () => void = () => undefined;

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    userId: 'owner-1',
    displayName: 'Olivia Owner',
    email: 'owner@example.test',
    role: 'Owner',
    assignedClientCount: 3,
    joinedAtUtc: '2026-08-20T09:00:00Z',
    version: 11,
    ...overrides,
  };
}

function invitation(overrides: Partial<ClientInvitation> = {}): ClientInvitation {
  return {
    id: 'invite-1',
    email: 'new.coach@example.test',
    firstName: 'Nora',
    lastName: 'Coach',
    status: 'Pending',
    expiresAtUtc: '2026-09-30T09:00:00Z',
    sendCount: 1,
    logicalSendGeneration: 1,
    createdAtUtc: '2026-09-23T09:00:00Z',
    version: 4,
    developmentActionUrl: null,
    kind: 'Coach',
    ...overrides,
  };
}

async function render(api: Partial<TeamApi> = {}) {
  await TestBed.configureTestingModule({
    imports: [Team],
    providers: [
      provideRouter([]),
      {
        provide: TeamApi,
        useValue: {
          getTeamMembers: vi.fn(() =>
            of([
              member(),
              member({
                userId: 'coach-1',
                displayName: 'Cara Coach',
                email: 'cara@example.test',
                role: 'Coach',
                assignedClientCount: 2,
                version: 21,
              }),
            ]),
          ),
          getCoachInvitations: vi.fn(() => of([invitation()])),
          createCoachInvitation: vi.fn(() =>
            of(invitation({ id: 'invite-2', email: 'rami@example.test', firstName: 'Rami' })),
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
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Team);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(TeamApi) as unknown as Record<keyof TeamApi, ReturnType<typeof vi.fn>>,
  };
}

describe('Team', () => {
  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    uninstallDialog();
  });

  it('lists the owner and the coaches with how many clients each has', async () => {
    const { fixture, host } = await render();

    const rows = Array.from(host.querySelectorAll('[data-member]'));
    expect(rows.map((row) => row.getAttribute('data-member'))).toEqual(['owner-1', 'coach-1']);
    expect(rows[1].textContent).toContain('Cara Coach');
    expect(rows[1].textContent).toContain('2');
    // Only a coach can be removed; the owner row offers nothing.
    expect(rows[0].querySelector('button')).toBeNull();
    expect(button(host, 'Remove Cara Coach')).toBeTruthy();
    expect(text(fixture)).toContain('Pending coach invitations');
  });

  it('refuses an incomplete invitation without calling the API', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Send invitation');
    await settle(fixture);

    expect(api.createCoachInvitation).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Enter the coach’s email address.');
    expect(text(fixture)).toContain('Enter the coach’s first name.');
  });

  it('sends a coach invitation with trimmed values and lists it as pending', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Email', '  rami@example.test ');
    fill(host, 'First name', ' Rami ');
    fill(host, 'Last name', 'Coach');
    await settle(fixture);
    press(host, 'Send invitation');
    await settle(fixture);

    expect(api.createCoachInvitation).toHaveBeenCalledWith({
      email: 'rami@example.test',
      firstName: 'Rami',
      lastName: 'Coach',
    });
    expect(host.querySelector('[data-invitation="invite-2"]')).not.toBeNull();
    expect(text(fixture)).toContain('Invitation sent to rami@example.test.');
  });

  it('asks before removing a coach and sends the version the page was loaded at', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Remove Cara Coach');
    await settle(fixture);
    expect(api.removeTeamCoach).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Remove Cara Coach?');

    press(host, 'Remove coach');
    await settle(fixture);

    expect(api.removeTeamCoach).toHaveBeenCalledWith('coach-1', 21);
    expect(text(fixture)).toContain('Clients moved to you: 2.');
    // The team is re-read so the counts and the list reflect the removal.
    expect(api.getTeamMembers).toHaveBeenCalledTimes(2);
  });

  it('cancels a removal without sending anything', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Remove Cara Coach');
    await settle(fixture);
    press(host, 'Cancel');
    await settle(fixture);

    expect(api.removeTeamCoach).not.toHaveBeenCalled();
    expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('resends and revokes a pending coach invitation with its version', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Resend new.coach@example.test');
    await settle(fixture);
    expect(api.resendCoachInvitation).toHaveBeenCalledWith('invite-1', expect.any(String), 4);

    press(host, 'Revoke new.coach@example.test');
    await settle(fixture);
    expect(api.revokeCoachInvitation).toHaveBeenCalledWith('invite-1', 5);
    // A revoked invitation is no longer pending, so it leaves the list.
    expect(host.querySelector('[data-invitation="invite-1"]')).toBeNull();
  });
});
