import type { DialogRef } from '@angular/cdk/dialog';
import {
  booleanAttribute,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../core/auth/auth.store';
import { ACCOUNT_CLOSED_REASON } from '../../core/auth/session-expiry';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { ModalFooter, modalFormId } from '../../ui/modal-footer';
import type { ModalSurface } from '../../ui/modal-surface';
import { PasswordReveal } from '../../ui/password-reveal';
import { CloseAccountApi } from './close-account-api';
import { closeAccountRefusal, PASSWORD_NEEDED } from './close-account.models';

/**
 * Closing your own TB Gym account from Me (notes plan N9e, CLI-027). The last thing on the page, a
 * quiet text button under Sign out, so it is never the page's main action. Someone with no coaching
 * space left cannot open Me, so Password and security shows it to them too, `framed` as that page's
 * panels are.
 *
 * It opens a kit dialog that says what goes and what stays, then asks for the password: closing
 * cannot be undone, and the server checks the password again. Only "Close my account" calls the API.
 * The server leaves every coaching space, erases the person and ends every session; the page then
 * clears what it holds of the session and goes to sign-in, which says the account is closed.
 *
 * Shown only to someone who is a client wherever they are a member and not a platform admin: the
 * server closes no staff account, and refuses one that coached before, with its own words.
 */
@Component({
  selector: 'app-close-account',
  imports: [Button, Control, Field, ModalFooter, PasswordReveal],
  templateUrl: './close-account.html',
  styleUrl: './close-account.scss',
})
export class CloseAccount {
  private readonly api = inject(CloseAccountApi);
  private readonly csrf = inject(CsrfService);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly router = inject(Router);
  private readonly dialogs = inject(UiDialog);
  private readonly dialogTemplate = viewChild.required<TemplateRef<unknown>>('closeDialog');
  protected readonly formId = modalFormId('close-account');
  private openDialog: DialogRef<unknown, ModalSurface> | null = null;

  /** Drawn as a settings panel, for Password and security; Me's quiet block otherwise. */
  readonly framed = input(false, { transform: booleanAttribute });

  protected readonly canClose = computed(
    () =>
      this.tenants.memberships().every((membership) => membership.role === 'Client') &&
      !(this.auth.user()?.roles?.includes('PlatformAdmin') ?? false),
  );
  protected readonly password = signal('');
  protected readonly closing = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.openDialog?.close());
  }

  protected open(): void {
    this.password.set('');
    this.passwordError.set(null);
    this.error.set(null);
    const dialog = this.dialogs.open(this.dialogTemplate(), {
      title: $localize`Close your TB Gym account?`,
      closeLabel: $localize`Close`,
      // While closing is under way, its answer must arrive with the dialog still open.
      canClose: () => !this.closing(),
    });
    this.openDialog = dialog;
    dialog.closed.subscribe(() => {
      if (this.openDialog === dialog) this.openDialog = null;
    });
  }

  protected typed(value: string): void {
    this.password.set(value);
    if (this.passwordError()) this.passwordError.set(null);
  }

  protected cancel(): void {
    if (this.closing()) return;
    this.openDialog?.close();
  }

  protected async close(): Promise<void> {
    if (this.closing()) return;
    const password = this.password();
    if (password === '') {
      this.passwordError.set(PASSWORD_NEEDED);
      this.focusPassword();
      return;
    }

    this.closing.set(true);
    this.passwordError.set(null);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.close(password));
    } catch (error) {
      const refusal = closeAccountRefusal(error);
      this.passwordError.set(refusal.password);
      this.error.set(refusal.message);
      this.closing.set(false);
      // The field's reason is read with it, as Password and security does for its own fields.
      if (refusal.password) this.focusPassword();
      return;
    }

    this.password.set('');
    this.closing.set(false);
    this.openDialog?.close();
    // The server ended the session: read that back, forget the chosen space, and say so on sign-in.
    await this.auth.initialize(true);
    this.tenants.clear();
    await this.router.navigate(['/auth/sign-in'], {
      queryParams: { reason: ACCOUNT_CLOSED_REASON },
    });
  }

  private focusPassword(): void {
    setTimeout(() => document.getElementById('close-account-password')?.focus());
  }
}
