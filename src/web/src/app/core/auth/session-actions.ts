import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { UnsavedWork } from '../forms/unsaved-work';
import { MessageUnreadStore } from '../messaging/message-unread.store';
import { NotificationStore } from '../notifications/notification.store';
import { TenantStore } from '../tenancy/tenant.store';
import { AuthStore } from './auth.store';

/**
 * Workspace switching and sign-out, one sequence each, whichever screen offers them: the coach
 * shell's top bar, the member top bar, or a client's Me page.
 */
@Injectable({ providedIn: 'root' })
export class SessionActions {
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly notifications = inject(NotificationStore);
  private readonly messages = inject(MessageUnreadStore);
  private readonly unsavedWork = inject(UnsavedWork);
  private readonly router = inject(Router);

  /**
   * `select` invalidates the tenant context synchronously, so every tenant-scoped request still in
   * flight is discarded before it can paint the new workspace. An open editor is asked first, while
   * its work can still be saved to the workspace it belongs to.
   */
  async switchWorkspace(tenantId: string | null): Promise<void> {
    if (!(await this.unsavedWork.confirmLeave())) return;
    this.tenants.select(tenantId);
    void this.router.navigateByUrl('/');
  }

  async signOut(): Promise<void> {
    if (!(await this.unsavedWork.confirmLeave())) return;
    // Cleared here as well as by the stores' own effects on the signed-in user, so no badge outlives
    // the sign-out request. The two counts have separate sources, so each is cleared separately.
    this.notifications.clear();
    this.messages.clear();
    await this.auth.logout();
    await this.router.navigateByUrl('/auth/sign-in');
  }
}
