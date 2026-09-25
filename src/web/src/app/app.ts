import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthStore } from './core/auth/auth.store';
import { tenantRoleLabel } from './core/i18n/display-labels';
import { MessageUnreadStore } from './core/messaging/message-unread.store';
import { NotificationStore } from './core/notifications/notification.store';
import { TenantStore } from './core/tenancy/tenant.store';
import { BillingBanner } from './features/billing/billing-banner';
import { CoachShell } from './shell/coach-shell';

/**
 * Which chrome surrounds the routed page. Presentation only: every route keeps its own guards and
 * the API authorises every request, so choosing a shell never grants or withholds anything.
 *
 * - `coach`: an Owner or Coach membership is selected — the design-system coach shell.
 * - `member`: signed in without one — a Client (who also gets the bottom tabs) or an account with
 *   no workspace. This is the pre-existing top bar, unchanged.
 * - `public`: nobody is signed in.
 * - `pending`: the session, or the first membership list after signing in, is still loading.
 */
export type ShellKind = 'coach' | 'member' | 'public' | 'pending';

@Component({
  selector: 'app-root',
  imports: [BillingBanner, CoachShell, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '[class.coach-layout]': "shell() === 'coach'" },
})
export class App implements OnInit {
  private readonly document = inject(DOCUMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  protected readonly notifications = inject(NotificationStore);
  protected readonly messages = inject(MessageUnreadStore);
  protected readonly menuOpen = signal(false);
  protected readonly roleLabel = tenantRoleLabel;

  protected readonly shell = computed<ShellKind>(() => {
    if (this.auth.user() === null) {
      return this.auth.loading() ? 'pending' : 'public';
    }
    // A reload of an already-known session keeps its shell; only a session whose memberships have
    // not arrived yet waits, so an owner never sees the member bar flash before the coach shell.
    if (this.auth.loading() && this.tenants.memberships().length === 0) {
      return 'pending';
    }
    return this.tenants.canCoach() ? 'coach' : 'member';
  });

  ngOnInit(): void {
    this.document.documentElement.lang = this.locale;
    this.document.documentElement.dir = this.locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
    void this.auth.initialize();
  }

  protected selectTenant(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.switchWorkspace(value || null);
  }

  /**
   * One path for both shells' workspace controls. `select` invalidates the tenant context
   * synchronously, so every tenant-scoped request still in flight is discarded before it can paint
   * the new workspace, and the coach shell closes its menus and navigation dialog on that change.
   */
  protected switchWorkspace(tenantId: string | null): void {
    this.tenants.select(tenantId);
    this.menuOpen.set(false);
    void this.router.navigateByUrl('/');
  }

  protected async logout(): Promise<void> {
    this.menuOpen.set(false);
    // Cleared here as well as by the store's own effect on the signed-in user, so the badge is gone
    // before the sign-out request completes rather than one change-detection pass afterwards.
    this.notifications.clear();
    // Message unread is a separate count with a separate source, so it is cleared separately.
    this.messages.clear();
    await this.auth.logout();
    await this.router.navigateByUrl('/auth/sign-in');
  }
}
