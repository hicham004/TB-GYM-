import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { press, settle } from '../../../testing/dom';
import { TeamApi } from './team-api';
import { TeamRoster } from './team-roster';
import type { RosterMember } from './team.models';

const ROSTER: RosterMember[] = [
  {
    displayName: 'Olivia Haddad',
    role: 'Owner',
    joinedAtUtc: '2026-08-20T09:00:00Z',
    isYou: false,
  },
  { displayName: 'Cara Nassar', role: 'Coach', joinedAtUtc: '2026-09-02T09:00:00Z', isYou: true },
];

async function render(getRoster: ReturnType<typeof vi.fn> = vi.fn(() => of(ROSTER))) {
  await TestBed.configureTestingModule({
    imports: [TeamRoster],
    providers: [
      provideRouter([]),
      { provide: TeamApi, useValue: { getRoster } },
      // The workspace's clock dates each row (COACH-6).
      {
        provide: WorkspaceCalendar,
        useValue: {
          resolveToday: vi.fn(() => Promise.resolve('2026-10-18')),
          timeZone: signal('Asia/Beirut'),
        },
      },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantId: 'tenant-1', role: 'Coach' }),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TeamRoster);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, getRoster };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('A coach’s Team (critique B3a)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists who coaches here, the owner first, with their roles and when they joined, and nothing more', async () => {
    const { host, getRoster } = await render();

    expect(getRoster).toHaveBeenCalledTimes(1);
    const rows = Array.from(host.querySelectorAll('.person'));
    expect(rows.map((row) => textOf(row.querySelector('.name')))).toEqual([
      'Olivia Haddad',
      'Cara Nassar (you)',
    ]);
    expect(rows.map((row) => textOf(row.querySelector('.role')))).toEqual(['Owner', 'Coach']);
    expect(textOf(rows[0].querySelector('app-avatar'))).toBe('OH');
    expect(textOf(rows[1].querySelector('.joined'))).toMatch(/^Joined (Wed 2 Sep|2 Sep 2026)$/);
    // Read-only: no email, client count, invitation or menu; changing the team is the owner's.
    expect(textOf(host)).not.toContain('@');
    expect(host.querySelector('.clients, [data-invite], [data-waiting], app-menu')).toBeNull();
    expect(textOf(host.querySelector('.lede'))).toBe(
      'Who coaches in this coaching space, and since when. Only the owner adds or removes a coach.',
    );
  });

  it('sits in the coach’s Settings, after their own account pages', async () => {
    const { host } = await render();

    const nav = host.querySelector('nav[aria-label="Settings"]');
    expect(Array.from(nav?.querySelectorAll('a') ?? []).map(textOf)).toEqual([
      'Notifications',
      'Appearance',
      'Password and security',
      'Certificates',
      'Team',
    ]);
  });

  it('offers another try when the team cannot be read', async () => {
    const getRoster = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(ROSTER));
    const { fixture, host } = await render(getRoster);

    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Your team couldn’t be loaded.');
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelectorAll('.person').length).toBe(2);
  });
});
