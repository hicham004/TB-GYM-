import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
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
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { deviceToday } from '../../ui/calendar';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { EmptyState } from '../../ui/empty-state';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import { InviteClient, type InvitePrefill } from './invite-client';
import { splitInvitations, type InvitationRow } from './invitations.models';

/**
 * Invitations (R5.3a): who is still to join, with a new link or a cancellation one press away, and
 * everyone invited before behind a closed disclosure. Inviting is a sheet. A new link replaces every
 * earlier link, so "Send again" is a deliberate press that carries the version it was shown: a stale
 * list conflicts instead of cancelling a link the coach did not know existed.
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
export class Invitations {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly inviteSheet = viewChild.required<TemplateRef<unknown>>('inviteSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private loadedTenantId: string | null = null;
  private openSheet: { close: () => void } | null = null;
  private sheetDirty = false;

  protected readonly closeLabel = $localize`Close`;
  protected readonly loadingLabel = $localize`Loading invitations…`;
  protected readonly today = deviceToday();

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly invitations = signal<ClientInvitation[]>([]);
  protected readonly acting = signal<string | null>(null);
  protected readonly prefill = signal<InvitePrefill | null>(null);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );

  protected readonly sections = computed(() => splitInvitations(this.invitations(), this.locale));
  protected readonly waiting = computed(() => this.sections().waiting);
  protected readonly earlier = computed(() => this.sections().earlier);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.openSheet?.close());
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.openSheet?.close();
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
        this.invitations.set(await owner.wait(firstValueFrom(this.api.getInvitations())));
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        this.state.set('error');
      }
    });
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
    this.sheetDirty = false;
    this.openSheet?.close();
    const sheet = this.sheets.open<ClientInvitation | null>(this.inviteSheet(), {
      title: again ? $localize`Invite ${again.name}:name: again` : $localize`Invite a client`,
      closeLabel: this.closeLabel,
      canClose: () => this.canCloseInvite(),
    });
    this.openSheet = sheet;
    sheet.closed.subscribe((created) => {
      if (this.openSheet === sheet) this.openSheet = null;
      if (!created) return;
      // An older invitation for the same email is replaced by this one on the server: read the list again.
      this.toast.show(
        $localize`Invitation created. We will email ${created.email}:email: shortly.`,
        { tone: 'success' },
      );
      void this.load();
    });
  }

  protected setDirty(dirty: boolean): void {
    this.sheetDirty = dirty;
  }

  /** The close button, Escape, the backdrop and Not now all ask the same question. */
  private canCloseInvite(): boolean | Promise<boolean> {
    return (
      !this.sheetDirty ||
      this.ask(
        $localize`Close without sending? What you typed will be lost.`,
        $localize`Close`,
        $localize`Keep editing`,
        $localize`Discard what you typed?`,
      )
    );
  }

  /** The sheet's own buttons: a sent invitation closes it for good, Not now asks first when needed. */
  protected async closeInvite(
    created: ClientInvitation | null,
    sheet: { close(result: ClientInvitation | null): void },
  ): Promise<void> {
    if (created || (await this.canCloseInvite())) sheet.close(created);
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
        $localize`A new link was sent to ${row.email}:email:. The earlier link no longer works.`,
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

  private async ask(
    message: string,
    confirm: string,
    cancel: string,
    title: string,
  ): Promise<boolean> {
    this.asking.set({ message, confirm, cancel });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title,
      closeLabel: this.closeLabel,
    });
    const answer = await firstValueFrom(dialog.closed);
    this.asking.set(null);
    return answer === true;
  }
}
