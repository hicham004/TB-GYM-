import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachClientDetails, TeamMember } from '../../core/api/api.models';
import type { ClientCoachAssignmentView } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { installDialogSupport } from '../../../testing/dialog';
import { fill, press, settle, text } from '../../../testing/dom';
import { TeamApi } from '../team/team-api';
import { ClientCoach } from './client-coach';

let uninstallDialog: () => void = () => undefined;

const owner: TeamMember = {
  userId: 'owner-1',
  displayName: 'Olivia Owner',
  email: 'owner@example.test',
  role: 'Owner',
  assignedClientCount: 1,
  joinedAtUtc: '2026-08-20T09:00:00Z',
  version: 1,
};

const coach: TeamMember = {
  ...owner,
  userId: 'coach-1',
  displayName: 'Cara Coach',
  email: 'cara@example.test',
  role: 'Coach',
  assignedClientCount: 0,
};

const client = {
  id: 'client-1',
  firstName: 'Sam',
  lastName: 'Client',
  version: 7,
  assignedCoachUserId: 'owner-1',
  assignedCoachName: 'Olivia Owner',
} as CoachClientDetails;

@Component({
  imports: [ClientCoach],
  template: `<app-client-coach [client]="client()" (profileChanged)="changed.push($event)" />`,
})
class Host {
  readonly client = signal(client);
  readonly changed: CoachClientDetails[] = [];
}

async function render(
  team: TeamMember[],
  signedIn = 'owner-1',
  history: () => unknown = () => of([]),
) {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      {
        provide: TeamApi,
        useValue: {
          getTeamMembers: vi.fn(() => of(team)),
          getCoachAssignments: vi.fn(history),
          reassignClientCoach: vi.fn(() =>
            of({
              ...client,
              version: 8,
              assignedCoachUserId: 'coach-1',
              assignedCoachName: 'Cara Coach',
            }),
          ),
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      { provide: AuthStore, useValue: { user: signal({ id: signedIn }) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(TeamApi) as unknown as Record<keyof TeamApi, ReturnType<typeof vi.fn>>,
  };
}

/** The dialog's sentence about what reassigning does, as one line of text. */
function dialogNote(host: HTMLElement): string {
  return (host.querySelector('dialog .tb-text-compact')?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('ClientCoach', () => {
  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    uninstallDialog();
  });

  it('tells the owner what reassigning their own client does to their chat (COACH-13)', async () => {
    const { host, fixture } = await render([owner, coach]);

    press(host, 'Reassign coach');
    await settle(fixture);

    expect(dialogNote(host)).toBe(
      'The new coach sees this client and all their history right away. You still see the client as the owner, but your chat with them stays readable to the client only.',
    );
  });

  it('says what the current coach loses when the client is a team member’s', async () => {
    const { host, fixture } = await render([owner, coach], 'someone-else');

    press(host, 'Reassign coach');
    await settle(fixture);

    expect(dialogNote(host)).toBe(
      'The new coach sees this client and all their history right away. The current coach loses access, and their chat with the client stays readable to the client only.',
    );
  });

  it('shows nothing to a solo owner, who has nobody to reassign a client to', async () => {
    const { host } = await render([owner]);

    expect(host.querySelector('.coach-line')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });

  it('reassigns the client with the version it was shown at and hands back the new profile', async () => {
    const { fixture, host, api } = await render([owner, coach]);

    expect(text(fixture)).toContain('Olivia Owner');
    press(host, 'Reassign coach');
    await settle(fixture);
    fill(host, 'New coach', 'coach-1');
    fill(host, 'Note (optional)', '  Evening schedule  ');
    await settle(fixture);
    press(host, 'Reassign');
    await settle(fixture);

    expect(api.reassignClientCoach).toHaveBeenCalledWith(
      'client-1',
      'coach-1',
      'Evening schedule',
      7,
    );
    const hostComponent = fixture.componentInstance;
    expect(hostComponent.changed.map((profile) => profile.assignedCoachUserId)).toEqual([
      'coach-1',
    ]);
    expect(text(fixture)).toContain('Sam now has Cara Coach as their coach.');
  });

  it('shows the coach history its note is kept in, newest first, with each change and note (COACH-16)', async () => {
    const assignment = (
      sequence: number,
      coachName: string,
      assignedAtUtc: string,
      reason: ClientCoachAssignmentView['reason'],
      fields: Partial<ClientCoachAssignmentView> = {},
    ): ClientCoachAssignmentView => ({
      id: `a-${sequence}`,
      sequence,
      coachUserId: `u-${sequence}`,
      coachName,
      previousCoachUserId: null,
      previousCoachName: null,
      reason,
      note: null,
      assignedAtUtc,
      assignedByUserId: 'owner-1',
      ...fields,
    });
    const { fixture, host, api } = await render([owner, coach], 'owner-1', () =>
      of([
        assignment(1, 'Olivia Owner', '2026-09-05T08:00:00Z', 'Invitation'),
        assignment(2, 'Cara Coach', '2026-09-20T08:00:00Z', 'Reassigned', {
          previousCoachName: 'Olivia Owner',
          note: 'Evening schedule suits Cara',
        }),
        assignment(3, 'Olivia Owner', '2026-10-01T08:00:00Z', 'CoachRemoved', {
          previousCoachName: 'Cara Coach',
        }),
      ]),
    );

    press(host, 'Reassign coach');
    await settle(fixture);

    expect(api.getCoachAssignments).toHaveBeenCalledWith('client-1');
    const history = host.querySelector<HTMLDetailsElement>('dialog [data-coach-history]')!;
    expect(history.open).toBe(false);
    expect(history.querySelector('summary')?.textContent?.trim()).toBe('Coach history (3)');
    const rows = Array.from(history.querySelectorAll('li')).map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toEqual([
      expect.stringMatching(
        /^Olivia Owner Since (Thu 1 Oct|1 Oct 2026) · Cara Coach was removed from the team$/,
      ),
      expect.stringMatching(
        /^Cara Coach (Sun 20 Sep|20 Sep 2026) to (Thu 1 Oct|1 Oct 2026) · moved from Olivia Owner Evening schedule suits Cara$/,
      ),
      expect.stringMatching(
        /^Olivia Owner (Sat 5 Sep|5 Sep 2026) to (Sun 20 Sep|20 Sep 2026) · joined$/,
      ),
    ]);
    expect(history.querySelector('li.current .history-coach')?.textContent?.trim()).toBe(
      'Olivia Owner',
    );
  });

  it('keeps the dialog usable when the coach history cannot be read', async () => {
    const { fixture, host } = await render([owner, coach], 'owner-1', () =>
      throwError(() => new Error('offline')),
    );

    press(host, 'Reassign coach');
    await settle(fixture);

    expect(text(fixture)).toContain('The coach history couldn’t be loaded.');
    expect(host.querySelector('dialog [data-coach-history]')).toBeNull();
    expect(host.querySelectorAll('option')).toHaveLength(1);
  });

  it('offers only the other members of the team as the new coach', async () => {
    const { fixture, host } = await render([owner, coach]);

    press(host, 'Reassign coach');
    await settle(fixture);

    const options = Array.from(host.querySelectorAll('option')).map((option) => option.value);
    expect(options).toEqual(['coach-1']);
  });
});
