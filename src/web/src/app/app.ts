import { DOCUMENT } from '@angular/common';
import { Component, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthStore } from './core/auth/auth.store';
import { tenantRoleLabel } from './core/i18n/display-labels';
import { MessageUnreadStore } from './core/messaging/message-unread.store';
import { NotificationStore } from './core/notifications/notification.store';
import { TenantStore } from './core/tenancy/tenant.store';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
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

  ngOnInit(): void {
    this.document.documentElement.lang = this.locale;
    this.document.documentElement.dir = this.locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
    void this.auth.initialize();
  }

  protected selectTenant(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.tenants.select(value || null);
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
