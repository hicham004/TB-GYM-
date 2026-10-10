import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { FormAttempt } from '../../core/forms/form-attempt';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { PasswordReveal } from '../../ui/password-reveal';
import { UiToast } from '../../ui/toast';
import { SettingsFrame } from '../settings/settings-frame';
import { LeaveWorkspace } from './leave-workspace';

type PasswordField = 'current' | 'next' | 'confirm';

interface PasswordDraft {
  current: string;
  next: string;
  confirm: string;
}

const EMPTY: PasswordDraft = { current: '', next: '', confirm: '' };

/**
 * Settings › Password and security (C9, R5.2a), for staff and clients: change the password, sign
 * out on every device, and leave this coaching space (coaches and clients, ADR 0027). A client opens
 * it from Me and goes back there; staff reach it in Settings.
 *
 * Presentation only. The server checks the current password and the new one's strength, and ends
 * every session itself.
 */
@Component({
  selector: 'app-account-security',
  imports: [
    Button,
    Control,
    Field,
    Icon,
    LeaveWorkspace,
    PasswordReveal,
    RouterLink,
    SettingsFrame,
    UiConfirm,
  ],
  templateUrl: './account-security.html',
  styleUrl: './account-security.scss',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class AccountSecurity implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  protected readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly csrf = inject(CsrfService);
  private readonly router = inject(Router);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');

  protected readonly isClient = this.tenants.isClient;
  protected readonly closeLabel = $localize`Close`;
  protected readonly draft = signal<PasswordDraft>(EMPTY);
  protected readonly changing = signal(false);
  protected readonly signingOut = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly sessionsError = signal<string | null>(null);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );
  protected readonly attempt = new FormAttempt();

  protected readonly errors = computed(() => passwordErrors(this.draft()));
  /** Anything typed counts: a half-typed password is work the person may not want to lose. */
  private readonly typed = computed(() => {
    const draft = this.draft();
    return draft.current !== '' || draft.next !== '' || draft.confirm !== '';
  });

  constructor() {
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(unregister);
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  /** Asks before the router, a workspace switch or a sign-out drops a half-typed change (§9). */
  async canLeave(): Promise<boolean> {
    if (!this.typed() || this.changing()) return true;
    return this.ask(
      $localize`Your new password isn’t saved. If you leave now, what you typed is lost.`,
      $localize`Leave without saving`,
      $localize`Stay`,
      $localize`Leave without saving?`,
      false,
    );
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.typed()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  protected set(change: Partial<PasswordDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...change }));
    this.passwordError.set(null);
  }

  protected shownErrors(field: PasswordField): readonly string[] | null {
    const errors = this.errors()[field];
    return this.attempt.shows(field, errors) ? errors : null;
  }

  protected async changePassword(): Promise<void> {
    if (this.changing()) return;
    const errors = this.errors();
    const invalid = (['current', 'next', 'confirm'] as const).find(
      (field) => errors[field].length > 0,
    );
    if (invalid) {
      this.attempt.attempt();
      setTimeout(() => document.getElementById(`password-${invalid}`)?.focus());
      return;
    }

    this.changing.set(true);
    this.passwordError.set(null);
    try {
      await this.csrf.refresh();
      const draft = this.draft();
      await firstValueFrom(this.api.changePassword(draft.current, draft.next));
      this.draft.set(EMPTY);
      this.attempt.reset();
      this.toast.show($localize`Password changed. Use the new one next time you sign in.`, {
        tone: 'success',
      });
    } catch (error) {
      this.passwordError.set(
        apiErrorMessage(error, $localize`Your password couldn’t be changed. Try again.`),
      );
    } finally {
      this.changing.set(false);
    }
  }

  protected async signOutEverywhere(): Promise<void> {
    if (this.signingOut()) return;
    const yes = await this.ask(
      $localize`This signs your account out on every phone and computer, this one too. You sign in again with your password.`,
      $localize`Sign out everywhere`,
      $localize`Cancel`,
      $localize`Sign out everywhere?`,
      true,
    );
    if (!yes) return;

    this.signingOut.set(true);
    this.sessionsError.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.revokeAllSessions());
      // Nothing typed here is worth keeping once every session has ended.
      this.draft.set(EMPTY);
      await this.auth.initialize(true);
      await this.router.navigateByUrl('/auth/sign-in');
    } catch (error) {
      this.sessionsError.set(
        apiErrorMessage(error, $localize`You couldn’t be signed out everywhere. Try again.`),
      );
    } finally {
      this.signingOut.set(false);
    }
  }

  private async ask(
    message: string,
    confirm: string,
    cancel: string,
    title: string,
    closeOnNavigation: boolean,
  ): Promise<boolean> {
    this.asking.set({ message, confirm, cancel });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title,
      closeLabel: this.closeLabel,
      closeOnNavigation,
    });
    const answer = await firstValueFrom(dialog.closed);
    this.asking.set(null);
    return answer === true;
  }
}

function passwordErrors(draft: PasswordDraft): Record<PasswordField, readonly string[]> {
  return {
    current: draft.current === '' ? [$localize`Type the password you use now.`] : [],
    next:
      draft.next.length < 12
        ? [$localize`Use at least 12 characters with upper, lower, number, and symbol.`]
        : draft.next === draft.current
          ? [$localize`Choose a password different from the one you use now.`]
          : [],
    confirm:
      draft.confirm === ''
        ? [$localize`Type the new password again.`]
        : draft.confirm !== draft.next
          ? [$localize`This doesn’t match the new password. Type it again.`]
          : [],
  };
}
