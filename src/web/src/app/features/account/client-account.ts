import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionActions } from '../../core/auth/session-actions';
import { tenantRoleLabel } from '../../core/i18n/display-labels';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';

/**
 * A client's own account page, reached from the "Me" avatar in Today's header. The client shell has
 * no top bar, so workspace switching and sign-out live here, through the same sequences the coach
 * shell uses.
 */
@Component({
  selector: 'app-client-account',
  imports: [Avatar, Button, RouterLink],
  templateUrl: './client-account.html',
  styleUrl: './client-account.scss',
})
export class ClientAccount {
  private readonly session = inject(SessionActions);
  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  protected readonly roleLabel = tenantRoleLabel;
  protected readonly signingOut = signal(false);

  protected readonly displayName = computed(() => this.auth.user()?.displayName ?? '');
  protected readonly initials = computed(() =>
    initialsOf(this.displayName(), this.auth.user()?.email ?? ''),
  );
  protected readonly isPlatformAdmin = computed(
    () => this.auth.user()?.roles?.includes('PlatformAdmin') ?? false,
  );

  protected chooseWorkspace(tenantId: string): void {
    this.session.switchWorkspace(tenantId);
  }

  protected async signOut(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.session.signOut();
    } finally {
      this.signingOut.set(false);
    }
  }
}
