import type { DialogRef } from '@angular/cdk/dialog';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import type { ModalSurface } from '../../ui/modal-surface';
import { LeaveWorkspaceApi } from './leave-workspace-api';

/**
 * A coach or a client leaving the selected workspace themselves (ADR 0027). The owner cannot: a
 * workspace always has one.
 *
 * Confirmed in a kit dialog that says what happens for that role; only its Leave permanently button
 * calls the API. After leaving, the workspace list is reloaded, which selects another workspace or
 * none, and the page returns home. The API is the authority on who may leave and what it closes.
 */
@Component({
  selector: 'app-leave-workspace',
  imports: [Button, Control, Field],
  templateUrl: './leave-workspace.html',
  styleUrl: './leave-workspace.scss',
})
export class LeaveWorkspace {
  private readonly api = inject(ApiClient);
  private readonly leaveApi = inject(LeaveWorkspaceApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly router = inject(Router);
  private readonly dialogs = inject(UiDialog);
  private readonly dialogTemplate = viewChild.required<TemplateRef<unknown>>('leaveDialog');
  private openDialog: DialogRef<unknown, ModalSurface> | null = null;

  protected readonly membership = this.tenants.selectedMembership;
  protected readonly canLeave = computed(() => {
    const role = this.membership()?.role;
    return role === 'Coach' || role === 'Client';
  });
  protected readonly isClient = computed(() => this.membership()?.role === 'Client');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly reason = signal('');
  protected readonly reasonTooLong = computed(() => this.reason().length > 500);
  protected readonly reasonTooLongMessage = $localize`Keep the reason to 500 characters.`;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.openDialog?.close());
  }

  protected open(): void {
    this.reason.set('');
    this.error.set(null);
    const name = this.membership()?.tenantName ?? '';
    const dialog = this.dialogs.open(this.dialogTemplate(), {
      title: $localize`Leave ${name}:workspace:?`,
      closeLabel: $localize`Close`,
      // While leaving is under way, the answer must arrive with the dialog still open.
      canClose: () => !this.saving(),
    });
    this.openDialog = dialog;
    dialog.closed.subscribe(() => {
      if (this.openDialog === dialog) this.openDialog = null;
    });
  }

  protected cancel(): void {
    if (this.saving()) return;
    this.openDialog?.close();
  }

  protected async leave(): Promise<void> {
    if (this.reasonTooLong() || this.saving()) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      if (this.isClient()) {
        const profile = await firstValueFrom(this.api.getSelfProfile());
        const reason = this.reason().trim();
        await firstValueFrom(this.leaveApi.leaveAsClient(reason || null, profile.version));
      } else {
        await firstValueFrom(this.leaveApi.resignFromTeam());
      }

      this.saving.set(false);
      this.openDialog?.close();
      // The left workspace is no longer a membership; reloading selects another one, or none.
      await this.tenants.load();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`You couldn’t leave. Reload the page and try again.`),
      );
    } finally {
      this.saving.set(false);
    }
  }
}
