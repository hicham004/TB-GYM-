import type { DialogRef } from '@angular/cdk/dialog';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ClientInvitation, TeamMember } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { FormAttempt } from '../../core/forms/form-attempt';
import { GuardedSheets, type LeaveQuestion } from '../../core/forms/guarded-sheets';
import { CsrfService } from '../../core/security/csrf.service';
import { EmailDelivery } from '../../core/system/email-delivery';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { EmptyState } from '../../ui/empty-state';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { UiMenu } from '../../ui/menu';
import type { ModalSurface } from '../../ui/modal-surface';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { SettingsFrame } from '../settings/settings-frame';
import { TeamApi } from './team-api';
import {
  type InvitationRow,
  invitationRows,
  type MemberRow,
  memberRows,
  teamSummary,
} from './team.models';

type InviteField = 'email' | 'firstName' | 'lastName';

interface InviteDraft {
  email: string;
  firstName: string;
  lastName: string;
}

const EMPTY_INVITE: InviteDraft = { email: '', firstName: '', lastName: '' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Settings › Team (C9, R5.2a; ADR 0026): who coaches here, each with a face, their clients and when
 * they joined; inviting a coach in a sheet, which asks before Browser Back, a workspace switch, sign-out
 * or a reload drops what was typed (audit COACH-1); who is still to accept, with a new link or a cancel
 * in each row's menu; and removing a coach, asked first because their clients move to the owner. Days
 * are the workspace's (COACH-6).
 *
 * Presentation only. The API refuses every call here to anyone but the owner, and moves a removed
 * coach's clients in the same transaction.
 */
@Component({
  selector: 'app-team',
  imports: [
    Avatar,
    Button,
    Control,
    EmptyState,
    Field,
    Icon,
    SettingsFrame,
    Skeleton,
    StatusPill,
    UiConfirm,
    UiMenu,
  ],
  templateUrl: './team.html',
  styleUrl: './team.scss',
})
export class Team extends GuardedSheets {
  private readonly api = inject(TeamApi);
  private readonly auth = inject(AuthStore);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly inviteSheet = viewChild.required<TemplateRef<unknown>>('inviteSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private loadedTenant: string | null = null;
  private openInvite: DialogRef<unknown, ModalSurface> | null = null;

  protected override readonly leaveQuestion: LeaveQuestion = {
    title: $localize`Close without sending?`,
    message: $localize`What you typed isn’t sent. If you close it now, it is lost.`,
    confirm: $localize`Close without sending`,
    cancel: $localize`Keep editing`,
  };
  /** This server sends no email (audit LOST-1): the invite sheet and its notices must not promise one. */
  protected readonly emailOff = inject(EmailDelivery).off;
  protected readonly loadingLabel = $localize`Loading your team…`;
  protected readonly invitedLabel = $localize`Invited`;
  protected readonly expiredLabel = $localize`Link ran out`;

  protected readonly members = signal<readonly TeamMember[]>([]);
  protected readonly invitations = signal<readonly ClientInvitation[]>([]);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  /** The member or invitation a write is changing, so its menu waits. */
  protected readonly working = signal<string | null>(null);

  protected readonly invite = signal<InviteDraft>(EMPTY_INVITE);
  protected readonly inviting = signal(false);
  protected readonly inviteError = signal<string | null>(null);
  protected readonly attempt = new FormAttempt();
  /** The last invitation's link, shown only by a development server (it never emails). */
  protected readonly devLink = signal<string | null>(null);

  protected readonly rows = computed(() =>
    memberRows(this.members(), this.auth.user()?.id ?? null, this.locale, this.calendar.timeZone()),
  );
  protected readonly waiting = computed(() =>
    invitationRows(this.invitations(), new Date(), this.locale, this.calendar.timeZone()),
  );
  protected readonly summary = computed(() => teamSummary(this.members()));
  protected readonly coachCount = computed(
    () => this.members().filter((member) => member.role === 'Coach').length,
  );
  protected readonly inviteErrors = computed(() => inviteErrors(this.invite()));

  constructor() {
    super();
    this.scope.onReset(() => {
      this.loadedTenant = null;
      this.closeSheets();
      this.members.set([]);
      this.invitations.set([]);
      this.state.set('loading');
      this.working.set(null);
      this.devLink.set(null);
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenant) {
        this.loadedTenant = tenantId;
        void this.load();
      }
    });
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      if (this.members().length === 0) this.state.set('loading');
      try {
        // The workspace's clock dates each row; it is read once per workspace and shared.
        const [members, invitations] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getTeamMembers()),
            firstValueFrom(this.api.getCoachInvitations()),
            this.calendar.resolveToday(),
          ]),
        );
        this.members.set(members);
        this.invitations.set(invitations);
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        // A reload after a write keeps the rows on screen; only a first load shows the failure.
        if (this.members().length === 0) this.state.set('error');
      }
    });
  }

  // ---------- inviting ----------

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  protected openInviteSheet(): void {
    this.invite.set(EMPTY_INVITE);
    this.inviteError.set(null);
    this.attempt.reset();
    const sheet = this.show(this.inviteSheet(), $localize`Invite a coach`);
    this.openInvite = sheet;
    sheet.closed.subscribe(() => {
      if (this.openInvite === sheet) this.openInvite = null;
    });
  }

  protected setInvite(change: Partial<InviteDraft>): void {
    this.invite.update((draft) => ({ ...draft, ...change }));
    this.inviteError.set(null);
    // Anything typed is work the sheet asks about before it closes (plan §9).
    const draft = this.invite();
    this.dirty = !!(draft.email.trim() || draft.firstName.trim() || draft.lastName.trim());
  }

  protected shownInviteErrors(field: InviteField): readonly string[] | null {
    const errors = this.inviteErrors()[field];
    return this.attempt.shows(field, errors) ? errors : null;
  }

  protected async cancelInvite(): Promise<void> {
    if (await this.canClose()) this.openInvite?.close();
  }

  protected async sendInvite(): Promise<void> {
    if (this.inviting()) return;
    const errors = this.inviteErrors();
    const invalid = (['email', 'firstName', 'lastName'] as const).find(
      (field) => errors[field].length > 0,
    );
    if (invalid) {
      this.attempt.attempt();
      setTimeout(() => document.getElementById(`invite-${invalid}`)?.focus());
      return;
    }

    return this.scope.run('invite', async (owner) => {
      this.inviting.set(true);
      this.inviteError.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const draft = this.invite();
        const invitation = await owner.wait(
          firstValueFrom(
            this.api.createCoachInvitation({
              email: draft.email.trim(),
              firstName: draft.firstName.trim(),
              lastName: draft.lastName.trim(),
            }),
          ),
        );
        this.invitations.update((items) => [invitation, ...items]);
        this.devLink.set(invitation.developmentActionUrl);
        this.invite.set(EMPTY_INVITE);
        this.dirty = false;
        this.openInvite?.close();
        this.toast.show(
          this.emailOff()
            ? $localize`Invitation saved. Email is off on this server, so ${invitation.email}:email: doesn’t get it yet.`
            : $localize`Invitation sent to ${invitation.email}:email:.`,
          { tone: 'success' },
        );
      } catch (error) {
        if (!owner.current) return;
        this.inviteError.set(apiErrorMessage(error, $localize`The invitation couldn’t be sent.`));
      } finally {
        if (owner.current) this.inviting.set(false);
      }
    });
  }

  // ---------- rows ----------

  protected memberChosen(row: MemberRow, action: string): void {
    if (action === 'remove') void this.remove(row.member);
  }

  protected invitationChosen(row: InvitationRow, action: string): void {
    if (action === 'resend') void this.resend(row.invitation);
    if (action === 'revoke') void this.revoke(row.invitation);
  }

  private async remove(member: TeamMember): Promise<void> {
    if (this.working()) return;
    const clients = member.assignedClientCount;
    const yes = await this.ask(
      clients === 0
        ? $localize`${member.displayName}:name: loses access right away. Any client invitation they sent lands with you. Nothing is deleted.`
        : clients === 1
          ? $localize`${member.displayName}:name: loses access right away. Their client moves to you with all their history, and any client invitation they sent lands with you. Nothing is deleted, and you can give the client another coach afterwards.`
          : $localize`${member.displayName}:name: loses access right away. Their ${clients}:count: clients move to you with all their history, and any client invitation they sent lands with you. Nothing is deleted, and you can give each client another coach afterwards.`,
      $localize`Remove coach`,
      $localize`Keep them`,
      $localize`Remove ${member.displayName}:name:?`,
    );
    if (!yes) return;

    return this.scope.run('remove', async (owner) => {
      this.working.set(member.userId);
      try {
        await owner.wait(this.csrf.refresh());
        const outcome = await owner.wait(
          firstValueFrom(this.api.removeTeamCoach(member.userId, member.version)),
        );
        await owner.wait(this.load());
        const moved = outcome.reassignedClientCount;
        this.toast.show(
          moved === 0
            ? $localize`${member.displayName}:name: left the team.`
            : moved === 1
              ? $localize`${member.displayName}:name: left the team. Their client moved to you.`
              : $localize`${member.displayName}:name: left the team. ${moved}:count: clients moved to you.`,
          { tone: 'success' },
        );
      } catch (error) {
        if (!owner.current) return;
        this.toast.show(apiErrorMessage(error, $localize`The coach couldn’t be removed.`), {
          tone: 'error',
        });
      } finally {
        if (owner.current) this.working.set(null);
      }
    });
  }

  private async resend(invitation: ClientInvitation): Promise<void> {
    await this.invitationWrite(
      invitation,
      () => this.api.resendCoachInvitation(invitation.id, crypto.randomUUID(), invitation.version),
      this.emailOff()
        ? $localize`A new link was made for ${invitation.email}:email:, but email is off on this server, so it wasn’t sent. The one sent before no longer works.`
        : $localize`A new link went to ${invitation.email}:email:. The one sent before no longer works.`,
    );
  }

  private async revoke(invitation: ClientInvitation): Promise<void> {
    const name = `${invitation.firstName} ${invitation.lastName}`.trim();
    const yes = await this.ask(
      $localize`The link sent to ${invitation.email}:email: stops working. You can invite ${name}:name: again later.`,
      $localize`Cancel the invitation`,
      $localize`Keep it`,
      $localize`Cancel the invitation to ${name}:name:?`,
    );
    if (!yes) return;
    await this.invitationWrite(
      invitation,
      () => this.api.revokeCoachInvitation(invitation.id, invitation.version),
      $localize`The invitation to ${invitation.email}:email: is cancelled. Its link no longer works.`,
    );
  }

  private async invitationWrite(
    invitation: ClientInvitation,
    request: () => ReturnType<TeamApi['revokeCoachInvitation']>,
    done: string,
  ): Promise<void> {
    if (this.working()) return;
    return this.scope.run('invitation', async (owner) => {
      this.working.set(invitation.id);
      try {
        await owner.wait(this.csrf.refresh());
        const updated = await owner.wait(firstValueFrom(request()));
        this.invitations.update((items) =>
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
        this.devLink.set(updated.status === 'Pending' ? updated.developmentActionUrl : null);
        this.toast.show(done, { tone: 'success' });
      } catch (error) {
        if (!owner.current) return;
        this.toast.show(apiErrorMessage(error, $localize`The invitation couldn’t be changed.`), {
          tone: 'error',
        });
        await owner.wait(this.load());
      } finally {
        if (owner.current) this.working.set(null);
      }
    });
  }
}

function inviteErrors(draft: InviteDraft): Record<InviteField, readonly string[]> {
  const email = draft.email.trim();
  return {
    email:
      email.length === 0
        ? [$localize`Type the coach’s email address.`]
        : email.length > 320 || !EMAIL.test(email)
          ? [$localize`Type an email address like name@example.com.`]
          : [],
    firstName:
      draft.firstName.trim().length === 0
        ? [$localize`Type the coach’s first name.`]
        : draft.firstName.trim().length > 100
          ? [$localize`Keep it to 100 characters.`]
          : [],
    lastName:
      draft.lastName.trim().length === 0
        ? [$localize`Type the coach’s last name.`]
        : draft.lastName.trim().length > 100
          ? [$localize`Keep it to 100 characters.`]
          : [],
  };
}
