import type { ClientInvitation, TeamMember } from '../../core/api/api.models';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';
import type { UiMenuItem } from '../../ui/menu';
import { initialsOf } from '../../shell/initials';

/**
 * Settings › Team (C9, R5.2a): who coaches in this coaching space, with a face each (§2 rule 3), and
 * who is still to accept. Pure helpers, so the page and its tests share them.
 */

export interface MemberRow {
  readonly member: TeamMember;
  readonly initials: string;
  readonly isOwner: boolean;
  readonly isYou: boolean;
  readonly role: string;
  readonly clients: string;
  readonly joined: string;
  readonly menu: readonly UiMenuItem[];
}

export interface InvitationRow {
  readonly invitation: ClientInvitation;
  readonly name: string;
  readonly initials: string;
  /** "Sent Sat 3 Oct · the link works until Sat 10 Oct", or that it ran out; the pill says Invited. */
  readonly detail: string;
  readonly expired: boolean;
  readonly menu: readonly UiMenuItem[];
}

/** The owner first, then coaches by name. */
export function memberRows(
  members: readonly TeamMember[],
  me: string | null,
  locale: string,
  timeZone: string | null = null,
): readonly MemberRow[] {
  return [...members]
    .sort(
      (a, b) =>
        Number(b.role === 'Owner') - Number(a.role === 'Owner') ||
        a.displayName.localeCompare(b.displayName, locale),
    )
    .map((member) => {
      const isOwner = member.role === 'Owner';
      return {
        member,
        initials: initialsOf(member.displayName, member.email),
        isOwner,
        isYou: member.userId === me,
        role: isOwner ? $localize`Owner` : $localize`Coach`,
        clients: clientCount(member.assignedClientCount),
        joined: $localize`Joined ${workspaceDay(member.joinedAtUtc, locale, timeZone)}:date:`,
        menu: isOwner
          ? []
          : [
              {
                label: $localize`Remove from the team`,
                hint: $localize`Their clients move to you`,
                action: 'remove',
                danger: true,
              },
            ],
      };
    });
}

/** Invitations still waiting for an answer, newest first. */
export function invitationRows(
  invitations: readonly ClientInvitation[],
  now: Date,
  locale: string,
  timeZone: string | null = null,
): readonly InvitationRow[] {
  return invitations
    .filter((invitation) => invitation.status === 'Pending')
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))
    .map((invitation) => {
      const name = `${invitation.firstName} ${invitation.lastName}`.trim();
      const expired = new Date(invitation.expiresAtUtc).getTime() <= now.getTime();
      const sent = workspaceDay(invitation.createdAtUtc, locale, timeZone, now);
      const until = workspaceDay(invitation.expiresAtUtc, locale, timeZone, now);
      return {
        invitation,
        name,
        initials: initialsOf(name, invitation.email),
        expired,
        // The pill already says Invited, so the line says when it was sent (audit COACH-6).
        detail: expired
          ? $localize`Sent ${sent}:sent: · the link ran out ${until}:until:`
          : $localize`Sent ${sent}:sent: · the link works until ${until}:until:`,
        menu: expired
          ? [
              {
                label: $localize`Cancel the invitation`,
                action: 'revoke',
                danger: true,
              },
            ]
          : [
              {
                label: $localize`Send a new link`,
                hint: $localize`The link sent before stops working`,
                action: 'resend',
              },
              {
                label: $localize`Cancel the invitation`,
                hint: $localize`The link stops working`,
                action: 'revoke',
                danger: true,
              },
            ],
      };
    });
}

/** "You and 2 coaches, 31 clients between you." The line under the heading. */
export function teamSummary(members: readonly TeamMember[]): string {
  const coaches = members.filter((member) => member.role === 'Coach').length;
  const clients = members.reduce((sum, member) => sum + member.assignedClientCount, 0);
  if (coaches === 0) {
    return $localize`Just you so far. Invite a coach and give them their own clients: a coach sees only the clients you give them.`;
  }
  const team =
    coaches === 1 ? $localize`You and 1 coach` : $localize`You and ${coaches}:count: coaches`;
  return $localize`${team}:team:, ${clientCount(clients)}:clients: between you. Each client has one coach, and a coach sees only their own; you see every client.`;
}

function clientCount(count: number): string {
  return count === 1 ? $localize`1 client` : $localize`${count}:count: clients`;
}

/**
 * "Sat 3 Oct", or "3 Oct 2025" in another year: the day an instant falls on in the workspace, as every
 * coach page writes a day (audit COACH-6), never the device's day or UTC's.
 */
function workspaceDay(
  iso: string,
  locale: string,
  timeZone: string | null,
  now = new Date(),
): string {
  return houseDay(dayInZone(iso, timeZone), locale, dayInZone(now, timeZone));
}
