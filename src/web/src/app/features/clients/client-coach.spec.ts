import { HttpErrorResponse } from '@angular/common/http';
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
import {
  chooseOption,
  fill,
  formSummary,
  press,
  selectField,
  selectOptionsOf,
  selectShows,
  settle,
  text,
  toggleFold,
} from '../../../testing/dom';
import { TeamApi } from '../team/team-api';
import { ClientCoach } from './client-coach';
import { coachChangeSentence } from './client-coach.models';

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

const adam: TeamMember = {
  ...coach,
  userId: 'coach-2',
  displayName: 'Adam Sabbagh',
  email: 'adam@example.test',
};

const NAMES: Record<string, string> = {
  'owner-1': 'Olivia Owner',
  'coach-1': 'Cara Coach',
  'coach-2': 'Adam Sabbagh',
};

const client = {
  id: 'client-1',
  firstName: 'Sam',
  lastName: 'Client',
  version: 7,
  assignedCoachUserId: 'owner-1',
  assignedCoachName: 'Olivia Owner',
  mayCoach: true,
} as CoachClientDetails;

/** Sam waiting for a coach (N9d1b): nobody is named, and the server says the name is empty. */
const waiting = {
  ...client,
  assignedCoachUserId: null,
  assignedCoachName: '',
  mayCoach: false,
} as CoachClientDetails;

/** Sam coached by Cara, the owner looking on (N9d1a). */
const carasClient = {
  ...client,
  assignedCoachUserId: 'coach-1',
  assignedCoachName: 'Cara Coach',
  mayCoach: false,
} as CoachClientDetails;

@Component({
  imports: [ClientCoach],
  template: `<app-client-coach
    [client]="client()"
    [(openRequested)]="asked"
    (profileChanged)="changed.push($event); client.set($event)"
  />`,
})
/** Writes the saved profile back into the panel's input, as Service & access does through the record. */
class Host {
  readonly client = signal(client);
  readonly asked = signal(false);
  readonly changed: CoachClientDetails[] = [];
}

async function render(
  team: TeamMember[] | Error,
  signedIn = 'owner-1',
  history: () => unknown = () => of([]),
  options: { client?: CoachClientDetails; asked?: boolean } = {},
) {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      {
        provide: TeamApi,
        useValue: {
          getTeamMembers: vi.fn(() => (team instanceof Error ? throwError(() => team) : of(team))),
          getCoachAssignments: vi.fn(history),
          // The server answers with the coach chosen and whether the caller may coach the client now.
          reassignClientCoach: vi.fn((_id: string, coachUserId: string) =>
            of({
              ...(options.client ?? client),
              version: 8,
              assignedCoachUserId: coachUserId,
              assignedCoachName: NAMES[coachUserId],
              mayCoach: coachUserId === signedIn,
            }),
          ),
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      {
        provide: AuthStore,
        useValue: { user: signal({ id: signedIn, displayName: NAMES[signedIn] ?? 'Someone' }) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  if (options.client) fixture.componentInstance.client.set(options.client);
  if (options.asked) fixture.componentInstance.asked.set(true);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(TeamApi) as unknown as Record<keyof TeamApi, ReturnType<typeof vi.fn>>,
  };
}

/** The dialog's sentence about what the change does, as one line of text. */
function dialogNote(host: HTMLElement): string {
  return (host.querySelector('dialog .tb-text-compact')?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const squash = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/**
 * The owner took Sam with nobody else on the team to move them to: the coach line and its notice stay,
 * with no way left to change the coach, and focus rests on the notice rather than falling to the page.
 */
function expectTakenWithNothingLeftToChange(host: HTMLElement): void {
  expect(host.querySelector('dialog')?.open).toBe(false);
  expect(squash(host.querySelector('.coach-name')?.textContent)).toBe('Olivia Owner');
  const notice = host.querySelector<HTMLElement>('.coach-notice')!;
  expect(squash(notice.textContent)).toBe('You now coach Sam.');
  expect(notice.getAttribute('role')).toBe('status');
  expect(host.querySelectorAll('.coach-line button')).toHaveLength(0);
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).toBe(notice);
}

describe('ClientCoach', () => {
  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    uninstallDialog();
  });

  it('tells the owner what moving their own client keeps and closes to them (COACH-13, N9d1a)', async () => {
    const { host, fixture } = await render([owner, coach]);

    press(host, 'Reassign coach');
    await settle(fixture);

    expect(squash(host.querySelector('dialog h2')?.textContent)).toBe('Reassign Sam');
    expect(dialogNote(host)).toBe(
      'Cara Coach sees Sam and all their history right away. You keep Sam’s plan and payments as the owner; their training and progress close to you, and your chat with Sam stays readable to Sam only. Sam is told of the change.',
    );
  });

  it('says what the current coach loses, following the choice', async () => {
    const { host, fixture } = await render([owner, coach, adam], 'owner-1', () => of([]), {
      client: carasClient,
    });

    expect(squash(host.querySelector('.coach-name')?.textContent)).toBe('Cara Coach');
    press(host, 'Reassign coach');
    await settle(fixture);

    // The other coaches by name, the owner as You and last; the first is chosen already.
    expect(await selectOptionsOf(fixture, host, 'New coach')).toEqual(['Adam Sabbagh', 'You']);
    expect(selectShows(host, 'New coach')).toBe('Adam Sabbagh');
    expect(dialogNote(host)).toBe(
      'Adam Sabbagh sees Sam and all their history right away. Cara Coach loses access, and their chat with Sam stays readable to Sam only. Sam is told of the change.',
    );
    await chooseOption(fixture, host, 'New coach', 'You');
    expect(dialogNote(host)).toBe(
      'You become Sam’s coach and see their training, nutrition, check-ins and progress right away. Cara Coach loses access, and their chat with Sam stays readable to Sam only. Sam is told of the change.',
    );
  });

  it('shows nothing to a solo owner whose client has a coach: there is nobody to move them to', async () => {
    const { host } = await render([owner]);

    expect(host.querySelector('.coach-line')).toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });

  it('reassigns the client with the version it was shown at and hands back the new profile', async () => {
    const { fixture, host, api } = await render([owner, coach]);

    expect(text(fixture)).toContain('Olivia Owner');
    press(host, 'Reassign coach');
    await settle(fixture);
    await chooseOption(fixture, host, 'New coach', 'Cara Coach');
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

  it('says a refused reassignment in the dialog’s summary, which takes focus, and stays open', async () => {
    const { fixture, host, api } = await render([owner, coach]);
    api.reassignClientCoach.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { title: 'The client was changed by someone else.' },
          }),
      ),
    );

    press(host, 'Reassign coach');
    await settle(fixture);
    expect(formSummary(host).textContent?.trim()).toBe('');
    await chooseOption(fixture, host, 'New coach', 'Cara Coach');
    await settle(fixture);
    press(host, 'Reassign');
    await settle(fixture);

    expect(host.querySelector('dialog')?.open).toBe(true);
    expect(formSummary(host).textContent?.trim()).toBe('The client was changed by someone else.');
    expect(document.activeElement).toBe(formSummary(host));
  });

  describe('a client waiting for a coach (N9d1b, C8)', () => {
    it('says the client waits, and lets the owner choose with nobody chosen for them', async () => {
      const { host, fixture } = await render([owner, coach, adam], 'owner-1', () => of([]), {
        client: waiting,
      });

      expect(squash(host.querySelector('.coach-name')?.textContent)).toBe('Waiting for a coach');
      press(host, 'Choose a coach');
      await settle(fixture);

      expect(squash(host.querySelector('dialog h2')?.textContent)).toBe('Choose a coach for Sam');
      // Every member, the owner as You and last; nothing chosen: the owner never gets a client by default.
      expect(await selectOptionsOf(fixture, host, 'New coach')).toEqual([
        'Adam Sabbagh',
        'Cara Coach',
        'You',
      ]);
      expect(selectShows(host, 'New coach')).toBe('Choose…');
      expect(dialogNote(host)).toBe(
        'The coach you choose sees Sam and all their history right away. Sam is told of the change.',
      );
      await chooseOption(fixture, host, 'New coach', 'Cara Coach');
      expect(dialogNote(host)).toBe(
        'Cara Coach sees Sam and all their history right away. Sam is told of the change.',
      );
      await chooseOption(fixture, host, 'New coach', 'You');
      expect(dialogNote(host)).toBe(
        'You become Sam’s coach and see their training, nutrition, check-ins and progress right away. Sam is told of the change.',
      );
    });

    it('asks for a choice before it saves anything', async () => {
      const { host, fixture, api } = await render([owner, coach], 'owner-1', () => of([]), {
        client: waiting,
      });

      press(host, 'Choose a coach');
      await settle(fixture);
      press(host, 'Choose');
      await settle(fixture);

      expect(api.reassignClientCoach).not.toHaveBeenCalled();
      expect(host.querySelector('dialog')?.open).toBe(true);
      const select = selectField(host, 'New coach');
      expect(squash(select.querySelector('.tb-field__support')?.textContent)).toBe(
        'Choose a coach.',
      );
      // Focus goes to what is missing, so the message is heard.
      expect(document.activeElement).toBe(select.querySelector('button.trigger'));
    });

    it('gives the client the coach chosen and says who coaches them now', async () => {
      const { host, fixture, api } = await render([owner, coach], 'owner-1', () => of([]), {
        client: waiting,
      });

      press(host, 'Choose a coach');
      await settle(fixture);
      await chooseOption(fixture, host, 'New coach', 'Cara Coach');
      press(host, 'Choose');
      await settle(fixture);

      expect(api.reassignClientCoach).toHaveBeenCalledWith('client-1', 'coach-1', null, 7);
      expect(fixture.componentInstance.changed.map((profile) => profile.mayCoach)).toEqual([false]);
      expect(host.querySelector('dialog')?.open).toBe(false);
      expect(text(fixture)).toContain('Sam now has Cara Coach as their coach.');
      // The client has a coach now, so the trigger moves them on, and focus is back on it.
      expect(squash(host.querySelector('.coach-name')?.textContent)).toBe('Cara Coach');
      const trigger = host.querySelector<HTMLButtonElement>('.coach-line button')!;
      expect(squash(trigger.textContent)).toBe('Reassign coach');
      expect(document.activeElement).toBe(trigger);
    });

    it('lets a solo owner take the client, and says they coach them now', async () => {
      const { host, fixture, api } = await render([owner], 'owner-1', () => of([]), {
        client: waiting,
      });

      expect(host.querySelector('.coach-line')).not.toBeNull();
      press(host, 'Choose a coach');
      await settle(fixture);
      expect(await selectOptionsOf(fixture, host, 'New coach')).toEqual(['You']);
      expect(selectShows(host, 'New coach')).toBe('Choose…');
      await chooseOption(fixture, host, 'New coach', 'You');
      press(host, 'Choose');
      await settle(fixture);

      expect(api.reassignClientCoach).toHaveBeenCalledWith('client-1', 'owner-1', null, 7);
      expect(fixture.componentInstance.changed.map((profile) => profile.mayCoach)).toEqual([true]);
      expectTakenWithNothingLeftToChange(host);
    });

    it('still offers the owner themselves when the team cannot be read, and says they took them', async () => {
      const { host, fixture, api } = await render(new Error('down'), 'owner-1', () => of([]), {
        client: waiting,
      });

      press(host, 'Choose a coach');
      await settle(fixture);
      expect(await selectOptionsOf(fixture, host, 'New coach')).toEqual(['You']);
      await chooseOption(fixture, host, 'New coach', 'You');
      press(host, 'Choose');
      await settle(fixture);

      expect(api.reassignClientCoach).toHaveBeenCalledWith('client-1', 'owner-1', null, 7);
      expectTakenWithNothingLeftToChange(host);
    });
  });

  describe('arriving with ?action=coach (N9d2)', () => {
    it('opens the dialog once the team is read, and says it is done', async () => {
      const { host, fixture } = await render([owner, coach], 'owner-1', () => of([]), {
        client: waiting,
        asked: true,
      });

      expect(host.querySelector('dialog')?.open).toBe(true);
      expect(squash(host.querySelector('dialog h2')?.textContent)).toBe('Choose a coach for Sam');
      expect(fixture.componentInstance.asked()).toBe(false);
    });

    it('opens nothing where the panel is not shown, and says it is done', async () => {
      const { host, fixture } = await render([owner], 'owner-1', () => of([]), { asked: true });

      expect(host.querySelector('dialog')).toBeNull();
      expect(fixture.componentInstance.asked()).toBe(false);
    });
  });

  it('shows the coach history its note is kept in, newest first, with each change and note (COACH-16)', async () => {
    const assignment = (
      sequence: number,
      coachName: string | null,
      assignedAtUtc: string,
      reason: ClientCoachAssignmentView['reason'],
      fields: Partial<ClientCoachAssignmentView> = {},
    ): ClientCoachAssignmentView => ({
      id: `a-${sequence}`,
      sequence,
      coachUserId: coachName === null ? null : `u-${sequence}`,
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
          previousCoachUserId: 'u-1',
          previousCoachName: 'Olivia Owner',
          note: 'Evening schedule suits Cara',
        }),
        // Cara left; Sam waited for a coach until the owner took them (N9d1b).
        assignment(3, null, '2026-10-01T08:00:00Z', 'CoachRemoved', {
          previousCoachUserId: 'u-2',
          previousCoachName: 'Cara Coach',
        }),
        assignment(4, 'Olivia Owner', '2026-10-03T08:00:00Z', 'Reassigned'),
      ]),
    );

    press(host, 'Reassign coach');
    await settle(fixture);

    expect(api.getCoachAssignments).toHaveBeenCalledWith('client-1');
    const dialog = host.querySelector<HTMLElement>('dialog')!;
    const history = host.querySelector<HTMLElement>('dialog [data-coach-history]')!;
    expect(history.querySelector('details')?.open).toBe(false);
    expect(history.querySelector('summary')?.textContent?.trim()).toBe('Coach history (4)');
    await toggleFold(fixture, dialog, 'Coach history (4)');
    const rows = Array.from(history.querySelectorAll('li')).map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toEqual([
      expect.stringMatching(
        /^Olivia Owner Since (Sat 3 Oct|3 Oct 2026) · after waiting for a coach$/,
      ),
      expect.stringMatching(
        /^Waiting for a coach (Thu 1 Oct|1 Oct 2026) to (Sat 3 Oct|3 Oct 2026) · Cara Coach was removed from the team$/,
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

  /** Notes plan N9a1: a trainee of TB Gym's own space signed up with no invitation, and the history says so. */
  it('says a trainee who signed up signed up, where an invited client joined', async () => {
    const signedUp: ClientCoachAssignmentView = {
      id: 'a-1',
      sequence: 1,
      coachUserId: 'u-1',
      coachName: 'Olivia Owner',
      previousCoachUserId: null,
      previousCoachName: null,
      reason: 'SignUp',
      note: null,
      assignedAtUtc: '2026-11-12T08:00:00Z',
      assignedByUserId: null,
    };
    const { fixture, host } = await render([owner, coach], 'owner-1', () => of([signedUp]));

    press(host, 'Reassign coach');
    await settle(fixture);

    const dialog = host.querySelector<HTMLElement>('dialog')!;
    await toggleFold(fixture, dialog, 'Coach history (1)');
    const row = (
      host.querySelector<HTMLElement>('dialog [data-coach-history] li')?.textContent ?? ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    expect(row).toMatch(/^Olivia Owner Since (Thu 12 Nov|12 Nov 2026) · signed up$/);
  });

  it('keeps the dialog usable when the coach history cannot be read', async () => {
    const { fixture, host } = await render([owner, coach], 'owner-1', () =>
      throwError(() => new Error('offline')),
    );

    press(host, 'Reassign coach');
    await settle(fixture);

    expect(text(fixture)).toContain('The coach history couldn’t be loaded.');
    expect(host.querySelector('dialog [data-coach-history]')).toBeNull();
    expect(await selectOptionsOf(fixture, host, 'New coach')).toHaveLength(1);
  });

  it('offers only the other members of the team as the new coach', async () => {
    const { fixture, host } = await render([owner, coach]);

    press(host, 'Reassign coach');
    await settle(fixture);

    expect(await selectOptionsOf(fixture, host, 'New coach')).toEqual(['Cara Coach']);
    // The only one is chosen already.
    expect(selectShows(host, 'New coach')).toBe('Cara Coach');
  });
});

describe('what a change of coach does, in words (C8)', () => {
  it('names the client and never gives them a pronoun', () => {
    expect(
      coachChangeSentence('Maya', { kind: 'waiting' }, { kind: 'other', name: 'Lea Khoury' }),
    ).toBe('Lea Khoury sees Maya and all their history right away. Maya is told of the change.');
    expect(
      coachChangeSentence(
        'Maya',
        { kind: 'other', name: 'Lea Khoury' },
        { kind: 'other', name: 'Omar Saleh' },
      ),
    ).toBe(
      'Omar Saleh sees Maya and all their history right away. Lea Khoury loses access, and their chat with Maya stays readable to Maya only. Maya is told of the change.',
    );
    expect(
      coachChangeSentence('Maya', { kind: 'you' }, { kind: 'other', name: 'Lea Khoury' }),
    ).toBe(
      'Lea Khoury sees Maya and all their history right away. You keep Maya’s plan and payments as the owner; their training and progress close to you, and your chat with Maya stays readable to Maya only. Maya is told of the change.',
    );
    expect(coachChangeSentence('Maya', { kind: 'waiting' }, { kind: 'you' })).toBe(
      'You become Maya’s coach and see their training, nutrition, check-ins and progress right away. Maya is told of the change.',
    );
  });
});
