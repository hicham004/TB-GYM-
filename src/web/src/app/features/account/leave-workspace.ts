import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { LeaveWorkspaceApi } from './leave-workspace-api';

/**
 * A coach or a client leaving the selected workspace themselves (ADR 0027). The owner cannot: a
 * workspace always has one.
 *
 * Confirmed in a dialog that says what happens for that role. After leaving, the workspace list is
 * reloaded, which selects another workspace or none, and the page returns home. The API is the
 * authority on who may leave and what it closes.
 */
@Component({
  selector: 'app-leave-workspace',
  imports: [ReactiveFormsModule, Button, Control, Field],
  templateUrl: './leave-workspace.html',
  styleUrl: './leave-workspace.scss',
})
export class LeaveWorkspace {
  private readonly api = inject(ApiClient);
  private readonly leaveApi = inject(LeaveWorkspaceApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('leaveDialog');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('leaveTrigger');

  protected readonly membership = this.tenants.selectedMembership;
  protected readonly canLeave = computed(() => {
    const role = this.membership()?.role;
    return role === 'Coach' || role === 'Client';
  });
  protected readonly isClient = computed(() => this.membership()?.role === 'Client');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    reason: ['', Validators.maxLength(500)],
  });

  protected open(): void {
    this.form.reset({ reason: '' });
    this.error.set(null);
    const dialog = this.dialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
  }

  protected cancel(event?: Event): void {
    event?.preventDefault();
    if (this.saving()) return;
    this.closeDialog();
    this.trigger()?.nativeElement.focus();
  }

  protected async leave(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      if (this.isClient()) {
        const profile = await firstValueFrom(this.api.getSelfProfile());
        const reason = this.form.getRawValue().reason.trim();
        await firstValueFrom(this.leaveApi.leaveAsClient(reason || null, profile.version));
      } else {
        await firstValueFrom(this.leaveApi.resignFromTeam());
      }

      this.closeDialog();
      // The left workspace is no longer a membership; reloading selects another one, or none.
      await this.tenants.load();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`You could not leave. Reload the page and try again.`),
      );
    } finally {
      this.saving.set(false);
    }
  }

  private closeDialog(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
  }
}
