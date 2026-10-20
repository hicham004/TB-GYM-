import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { FormerClientsApi } from './former-clients-api';
import { apiErrorMessage } from '../../core/api/api-error';
import { CoachClientDetails } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { EmailDelivery } from '../../core/system/email-delivery';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';

/**
 * The owner's action to release a client from the workspace (ADR 0027).
 *
 * Confirmed in a dialog that says exactly what happens, with a required reason: a press without one
 * says so under the box and puts the cursor there (audit COACH-15). Nothing is sent until "End coaching
 * permanently" is pressed, and the API is the authority: it refuses anyone but the owner, a stale
 * client version, or a client already released.
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
  private readonly reasonBox = viewChild<ElementRef<HTMLTextAreaElement>>('reasonBox');
  private readonly injector = inject(Injector);

  readonly client = input.required<CoachClientDetails>();
  readonly released = output<CoachClientDetails>();

  /** This server sends no email (audit LOST-1), so the dialog must not promise the goodbye email. */
  protected readonly emailOff = inject(EmailDelivery).off;
  protected readonly reasonHelp = computed(() =>
    this.emailOff()
      ? $localize`Only your team sees this. Up to 500 characters.`
      : $localize`Only your team sees this. It is not included in the email. Up to 500 characters.`,
  );
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Shown under the reason after a press that cannot be sent, and gone as soon as it is typed. */
  protected readonly reasonErrors = signal<readonly string[] | null>(null);
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
    this.reasonErrors.set(null);
    const dialog = this.dialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
  }

  protected reasonTyped(): void {
    if (this.reasonErrors()) this.reasonErrors.set(this.reasonProblem());
  }

  /** What stops the reason being sent, in the words the box shows; null when it can go. */
  private reasonProblem(): readonly string[] | null {
    const reason = this.form.getRawValue().reason.trim();
    if (!reason) return [$localize`Write why coaching ends. Only your team sees it.`];
    if (reason.length > 500) return [$localize`Keep it to 500 characters.`];
    return null;
  }

  protected cancel(event?: Event): void {
    event?.preventDefault();
    if (this.saving()) return;
    this.closeDialog();
    this.trigger()?.nativeElement.focus();
  }

  protected async release(): Promise<void> {
    if (this.saving()) return;
    const reason = this.form.getRawValue().reason.trim();
    const problem = this.reasonProblem();
    if (problem) {
      this.form.markAllAsTouched();
      this.reasonErrors.set(problem);
      afterNextRender(() => this.reasonBox()?.nativeElement.focus(), { injector: this.injector });
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
            $localize`Coaching could not be ended. Reload the page and try again.`,
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
