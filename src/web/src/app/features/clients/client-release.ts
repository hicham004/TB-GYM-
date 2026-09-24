import { Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { FormerClientsApi } from './former-clients-api';
import { apiErrorMessage } from '../../core/api/api-error';
import { CoachClientDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';

/**
 * The owner's action to release a client from the workspace (ADR 0027).
 *
 * Confirmed in a dialog that says exactly what happens, with a required reason. Nothing is sent
 * until "Release permanently" is pressed, and the API is the authority: it refuses anyone but the owner,
 * a stale client version, or a client already released.
 */
@Component({
  selector: 'app-client-release',
  imports: [ReactiveFormsModule, Button, Control, Field],
  templateUrl: './client-release.html',
  styleUrl: './client-release.scss',
})
export class ClientRelease {
  private readonly api = inject(FormerClientsApi);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('releaseDialog');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('releaseTrigger');

  readonly client = input.required<CoachClientDetails>();
  readonly released = output<CoachClientDetails>();

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    reason: ['', [Validators.required, Validators.maxLength(500)]],
  });

  constructor() {
    this.scope.onReset(() => {
      this.saving.set(false);
      this.error.set(null);
      this.closeDialog();
    });
  }

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

  protected async release(): Promise<void> {
    const reason = this.form.getRawValue().reason.trim();
    if (this.form.invalid || !reason || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    return this.scope.run('release', async (owner) => {
      this.saving.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const updated = await owner.wait(
          firstValueFrom(this.api.releaseClient(this.client().id, reason, this.client().version)),
        );
        this.closeDialog();
        this.released.emit(updated);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          apiErrorMessage(
            error,
            $localize`The client could not be released. Reload the page and try again.`,
          ),
        );
      } finally {
        if (owner.current) this.saving.set(false);
      }
    });
  }

  private closeDialog(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
  }
}
