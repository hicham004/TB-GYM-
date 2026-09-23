import { DatePipe } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TeamApi } from './team-api';
import { apiErrorMessage } from '../../core/api/api-error';
import { ClientInvitation, TeamMember } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { SectionNav } from '../../ui/section-nav';
import { StatusLabel } from '../../ui/status-label';
import { SETTINGS_SECTIONS } from '../workspace/settings-sections';

type InviteField = 'email' | 'firstName' | 'lastName';

/**
 * The owner's team (ADR 0026): who coaches in this workspace, inviting a coach, and removing one.
 *
 * Presentation only. The API refuses every call here to anyone but the owner, and removal moves the
 * coach's clients to the owner in the same transaction — this page just says so before asking.
 */
@Component({
  selector: 'app-team',
  imports: [DatePipe, ReactiveFormsModule, Button, Control, Field, SectionNav, StatusLabel],
  templateUrl: './team.html',
  styleUrl: './team.scss',
})
export class Team {
  private readonly api = inject(TeamApi);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly removeDialog = viewChild<ElementRef<HTMLDialogElement>>('removeDialog');
  private readonly removeCancel = viewChild<ElementRef<HTMLButtonElement>>('removeCancel');
  private removeTrigger: HTMLElement | null = null;
  private loadedTenant: string | null = null;

  protected readonly sections = SETTINGS_SECTIONS;
  protected readonly members = signal<TeamMember[]>([]);
  protected readonly invitations = signal<ClientInvitation[]>([]);
  protected readonly loading = signal(false);
  protected readonly inviting = signal(false);
  protected readonly removing = signal(false);
  protected readonly pendingRow = signal<string | null>(null);
  protected readonly pendingRemoval = signal<TeamMember | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly lastLink = signal<string | null>(null);
  protected readonly pendingInvitations = computed(() =>
    this.invitations().filter((invitation) => invitation.status === 'Pending'),
  );
  protected readonly attempt = new FormAttempt();
  protected readonly inviteForm = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(320)]],
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
  });

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenant) {
        this.loadedTenant = tenantId;
        void this.load();
      }
    });
  }

  protected errorsFor(field: InviteField): readonly string[] {
    const control = this.inviteForm.controls[field];
    if (control.hasError('required')) {
      return field === 'email'
        ? [$localize`Enter the coach’s email address.`]
        : field === 'firstName'
          ? [$localize`Enter the coach’s first name.`]
          : [$localize`Enter the coach’s last name.`];
    }
    if (control.hasError('email')) {
      return [$localize`Enter an email address like name@example.com.`];
    }
    if (control.hasError('maxlength')) {
      return [$localize`This is too long.`];
    }
    return [];
  }

  protected shownErrors(field: InviteField): readonly string[] | null {
    const errors = this.errorsFor(field);
    return this.attempt.shows(field, errors) ? errors : null;
  }

  protected roleLabel(member: TeamMember): string {
    return member.role === 'Owner' ? $localize`Owner` : $localize`Coach`;
  }

  protected async invite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.attempt.attempt();
      return;
    }

    return this.scope.run('invite', async (owner) => {
      this.inviting.set(true);
      this.clearMessages();
      try {
        await owner.wait(this.csrf.refresh());
        const value = this.inviteForm.getRawValue();
        const invitation = await owner.wait(
          firstValueFrom(
            this.api.createCoachInvitation({
              email: value.email.trim(),
              firstName: value.firstName.trim(),
              lastName: value.lastName.trim(),
            }),
          ),
        );
        this.invitations.update((items) => [invitation, ...items]);
        this.lastLink.set(invitation.developmentActionUrl);
        this.notice.set($localize`Invitation sent to ${invitation.email}:email:.`);
        this.inviteForm.reset();
        this.attempt.reset();
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The invitation could not be sent.`));
      } finally {
        if (owner.current) this.inviting.set(false);
      }
    });
  }

  protected async resend(invitation: ClientInvitation): Promise<void> {
    return this.runInvitationAction(
      invitation,
      () => this.api.resendCoachInvitation(invitation.id, crypto.randomUUID(), invitation.version),
      $localize`A new invitation link was sent. Any earlier link no longer works.`,
    );
  }

  protected async revoke(invitation: ClientInvitation): Promise<void> {
    return this.runInvitationAction(
      invitation,
      () => this.api.revokeCoachInvitation(invitation.id, invitation.version),
      $localize`Invitation revoked.`,
    );
  }

  /** Removal asks first. Only the dialog's own Remove coach button calls the API. */
  protected requestRemoval(member: TeamMember, event: Event): void {
    if (this.removing() || member.role !== 'Coach') return;
    this.removeTrigger = event.currentTarget as HTMLElement | null;
    this.pendingRemoval.set(member);
    this.clearMessages();
    const dialog = this.removeDialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
    // The least destructive action holds focus once the dialog's content has rendered.
    setTimeout(() => this.removeCancel()?.nativeElement.focus());
  }

  /** Cancel and Escape both land here: nothing is sent, and focus returns to Remove. */
  protected cancelRemoval(event?: Event): void {
    event?.preventDefault();
    if (this.removing()) return;
    this.closeRemoveDialog(true);
  }

  protected async confirmRemoval(): Promise<void> {
    const member = this.pendingRemoval();
    if (member === null || this.removing()) return;

    return this.scope.run('remove', async (owner) => {
      this.removing.set(true);
      this.clearMessages();
      try {
        await owner.wait(this.csrf.refresh());
        const outcome = await owner.wait(
          firstValueFrom(this.api.removeTeamCoach(member.userId, member.version)),
        );
        this.notice.set(
          $localize`${member.displayName}:name: was removed from the team. Clients moved to you: ${outcome.reassignedClientCount}:count:.`,
        );
        await owner.wait(this.load());
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The coach could not be removed.`));
      } finally {
        if (owner.current) {
          this.removing.set(false);
          this.closeRemoveDialog(false);
        }
      }
    });
  }

  private async runInvitationAction(
    invitation: ClientInvitation,
    request: () => ReturnType<TeamApi['revokeCoachInvitation']>,
    successMessage: string,
  ): Promise<void> {
    return this.scope.run('invitation', async (owner) => {
      this.pendingRow.set(invitation.id);
      this.clearMessages();
      try {
        await owner.wait(this.csrf.refresh());
        const updated = await owner.wait(firstValueFrom(request()));
        this.invitations.update((items) =>
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
        this.lastLink.set(updated.status === 'Pending' ? updated.developmentActionUrl : null);
        this.notice.set(successMessage);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The invitation could not be updated.`));
      } finally {
        if (owner.current) this.pendingRow.set(null);
      }
    });
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      try {
        const [members, invitations] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getTeamMembers()),
            firstValueFrom(this.api.getCoachInvitations()),
          ]),
        );
        this.members.set(members);
        this.invitations.set(invitations);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The team could not be loaded.`));
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  private closeRemoveDialog(returnFocus: boolean): void {
    const dialog = this.removeDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.pendingRemoval.set(null);
    if (returnFocus) this.removeTrigger?.focus();
    this.removeTrigger = null;
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  private resetTenantState(): void {
    this.loadedTenant = null;
    this.members.set([]);
    this.invitations.set([]);
    this.loading.set(false);
    this.inviting.set(false);
    this.removing.set(false);
    this.pendingRow.set(null);
    this.lastLink.set(null);
    this.closeRemoveDialog(false);
    this.clearMessages();
    this.inviteForm.reset();
    this.attempt.reset();
  }
}
