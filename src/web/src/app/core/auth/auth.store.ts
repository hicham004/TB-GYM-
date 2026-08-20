import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { CurrentUser } from '../api/api.models';
import { CsrfService } from '../security/csrf.service';
import { TenantStore } from '../tenancy/tenant.store';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly userState = signal<CurrentUser | null>(null);
  private readonly loadingState = signal(true);
  private initialization: Promise<void> | null = null;

  readonly user = this.userState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  initialize(force = false): Promise<void> {
    if (!force && this.initialization) {
      return this.initialization;
    }

    this.initialization = this.loadSession();
    return this.initialization;
  }

  async login(email: string, password: string, rememberMe: boolean): Promise<void> {
    this.loadingState.set(true);
    try {
      await this.csrf.refresh();
      const user = await firstValueFrom(this.api.login({ email, password, rememberMe }));
      this.userState.set(user);
      await this.tenants.load();
    } finally {
      this.loadingState.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.csrf.refresh();
    await firstValueFrom(this.api.logout());
    this.userState.set(null);
    this.tenants.clear();
    this.initialization = Promise.resolve();
  }

  private async loadSession(): Promise<void> {
    this.loadingState.set(true);
    try {
      await this.csrf.refresh();
      const user = await firstValueFrom(this.api.getCurrentUser());
      this.userState.set(user);
      await this.tenants.load();
    } catch {
      this.userState.set(null);
      this.tenants.clear();
    } finally {
      this.loadingState.set(false);
    }
  }
}
