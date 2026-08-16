import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { CurrentUser } from '../api/api.models';
import { TenantStore } from '../tenancy/tenant.store';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly userState = signal<CurrentUser | null>(null);
  private readonly loadingState = signal(true);

  readonly user = this.userState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  async initialize(): Promise<void> {
    this.loadingState.set(true);
    try {
      await firstValueFrom(this.api.getCsrfToken());
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

  async login(email: string, password: string, rememberMe: boolean): Promise<void> {
    this.loadingState.set(true);
    try {
      await firstValueFrom(this.api.getCsrfToken());
      const user = await firstValueFrom(this.api.login({ email, password, rememberMe }));
      this.userState.set(user);
      await this.tenants.load();
    } finally {
      this.loadingState.set(false);
    }
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.api.getCsrfToken());
    await firstValueFrom(this.api.logout());
    this.userState.set(null);
    this.tenants.clear();
  }
}
