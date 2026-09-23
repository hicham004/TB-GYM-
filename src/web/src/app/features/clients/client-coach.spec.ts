import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachClientDetails, TeamMember } from '../../core/api/api.models';
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

async function render(team: TeamMember[]) {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      {
        provide: TeamApi,
        useValue: {
          getTeamMembers: vi.fn(() => of(team)),
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

describe('ClientCoach', () => {
  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    uninstallDialog();
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

  it('offers only the other members of the team as the new coach', async () => {
    const { fixture, host } = await render([owner, coach]);

    press(host, 'Reassign coach');
    await settle(fixture);

    const options = Array.from(host.querySelectorAll('option')).map((option) => option.value);
    expect(options).toEqual(['coach-1']);
  });
});
