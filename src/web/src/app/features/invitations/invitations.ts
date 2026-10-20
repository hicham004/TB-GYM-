import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
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
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ClientInvitation } from '../../core/api/api.models';
import { GuardedSheets, type LeaveQuestion } from '../../core/forms/guarded-sheets';
import { CsrfService } from '../../core/security/csrf.service';
import { EmailDelivery } from '../../core/system/email-delivery';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { deviceToday } from '../../ui/calendar';
import { UiConfirm } from '../../ui/confirm';
import { EmptyState } from '../../ui/empty-state';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { InviteClient, type InvitePrefill } from './invite-client';
import { splitInvitations, type InvitationRow } from './invitations.models';

/**
 * Invitations (R5.3a): who is still to join, with a new link or a cancellation one press away, and
 * everyone invited before behind a closed disclosure. Inviting is a sheet, which asks before Browser
 * Back, a workspace switch, sign-out or a reload drops what was typed in it (audit COACH-1), as every
 * sheet host does. A new link replaces every earlier link, so "Send again" is a deliberate press that
 * carries the version it was shown: a stale list conflicts instead of cancelling a link the coach did
 * not know existed. Dates are the workspace's days (COACH-6).
 */
@Component({
  selector: 'app-invitations',
  imports: [
    Avatar,
    Button,
    EmptyState,
    InviteClient,
    NgTemplateOutlet,
    Skeleton,
    StatusPill,
    UiConfirm,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invitations.html',
  styleUrl: './invitations.scss',
})
export class Invitations extends GuardedSheets {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly inviteSheet = viewChild.required<TemplateRef<unknown>>('inviteSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private loadedTenantId: string | null = null;

  protected override readonly leaveQuestion: LeaveQuestion = {
    title: $localize`Discard what you typed?`,
    message: $localize`Close without sending? What you typed will be lost.`,
    confirm: $localize`Discard`,
    cancel: $localize`Keep editing`,
  };
  protected readonly loadingLabel = $localize`Loading invitations…`;
  protected readonly today = deviceToday();

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly invitations = signal<ClientInvitation[]>([]);
  protected readonly acting = signal<string | null>(null);
  protected readonly prefill = signal<InvitePrefill | null>(null);

  protected readonly sections = computed(() =>
    splitInvitations(this.invitations(), this.locale, this.calendar.timeZone()),
  );
  protected readonly waiting = computed(() => this.sections().waiting);
  protected readonly earlier = computed(() => this.sections().earlier);
  /** This server sends no email (audit LOST-1): no screen here may promise one. */
  protected readonly emailOff = inject(EmailDelivery).off;
  protected readonly emptyDescription = computed(() =>
    this.emailOff()
      ? $localize`Invite your first client. Email is off on this server, so they won’t get the link to set up their profile yet.`
      : $localize`Invite your first client. They get an email with a link to set up their profile.`,
  );

  constructor() {
    super();
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.closeSheets();
      this.invitations.set([]);
      this.state.set('loading');
      this.acting.set(null);
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        // The workspace's own clock dates each link; it is read once per workspace and shared.
        const [invitations] = await owner.wait(
          Promise.all([firstValueFrom(this.api.getInvitations()), this.calendar.resolveToday()]),
        );
        this.invitations.set(invitations);
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        this.state.set('error');
      }
    });
  }

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  protected openInvite(again: InvitationRow | null = null): void {
    this.prefill.set(
      again
        ? {
            firstName: again.invitation.firstName,
            lastName: again.invitation.lastName,
            email: again.email,
          }
        : null,
    );
    const sheet = this.show<ClientInvitation | null>(
      this.inviteSheet(),
      again ? $localize`Invite ${again.name}:name: again` : $localize`Invite a client`,
    );
    sheet.closed.subscribe((created) => {
      if (!created) return;
      // An older invitation for the same email is replaced by this one on the server: read the list again.
      this.toast.show(
        this.emailOff()
          ? $localize`Invitation saved. Email is off on this server, so ${created.email}:email: doesn’t get it yet.`
          : $localize`Invitation created. We will email ${created.email}:email: shortly.`,
        { tone: 'success' },
      );
      void this.load();
    });
  }

  protected setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  /** The sheet's own buttons: a sent invitation closes it for good, Not now asks first when needed. */
  protected async closeInvite(
    created: ClientInvitation | null,
    sheet: { close(result: ClientInvitation | null): void },
  ): Promise<void> {
    if (created) {
      this.dirty = false;
      sheet.close(created);
      return;
    }
    if (await this.canClose()) sheet.close(null);
  }

  /**
   * A deliberate resend, which is a different operation from the dispatcher's own transport retry:
   * it advances the invitation's logical-send generation and immediately kills every earlier link.
   *
   * The key is generated per press so two presses are two commands, while a retry of the *same*
   * press (a double tap, a flaky connection) converges on one generation instead of burning two.
   */
  protected async sendAgain(row: InvitationRow): Promise<void> {
    return this.scope.run('resend', (owner) =>
      this.runAction(
        owner,
        row,
        () =>
          this.api.resendInvitation(row.invitation.id, crypto.randomUUID(), row.invitation.version),
        this.emailOff()
          ? $localize`A new link was made for ${row.email}:email:, but email is off on this server, so it wasn’t sent. The earlier link no longer works.`
          : $localize`A new link was sent to ${row.email}:email:. The earlier link no longer works.`,
      ),
    );
  }

  protected async cancel(row: InvitationRow): Promise<void> {
    const yes = await this.ask(
      $localize`Cancel the invitation for ${row.name}:name:? Their link stops working. You can invite them again later.`,
      $localize`Cancel invitation`,
      $localize`Keep it`,
      $localize`Cancel this invitation?`,
    );
    if (!yes) return;
    return this.scope.run('revoke', (owner) =>
      this.runAction(
        owner,
        row,
        () => this.api.revokeInvitation(row.invitation.id, row.invitation.version),
        $localize`The invitation for ${row.name}:name: was cancelled.`,
      ),
    );
  }

  private async runAction(
    owner: TenantOperation,
    row: InvitationRow,
    request: () => ReturnType<ApiClient['resendInvitation']>,
    success: string,
  ): Promise<void> {
    this.acting.set(row.id);
    try {
      await owner.wait(this.csrf.refresh());
      const updated = await owner.wait(firstValueFrom(request()));
      this.invitations.update((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      this.toast.show(success, { tone: 'success' });
    } catch (error) {
      if (!owner.current) return;
      this.toast.show(
        apiErrorMessage(error, $localize`The invitation could not be updated. Try again.`),
        { tone: 'error' },
      );
      // A conflict means the list was stale: show what is true now.
      void this.load();
    } finally {
      if (owner.current) this.acting.set(null);
    }
  }
}
