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
  private sessionRequest = 0;

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
    const request = ++this.sessionRequest;
    this.tenants.clear();
    this.userState.set(null);
    this.loadingState.set(true);
    try {
      await this.csrf.refresh();
      if (request !== this.sessionRequest) return;
      const user = await firstValueFrom(this.api.login({ email, password, rememberMe }));
      if (request !== this.sessionRequest) return;
      this.userState.set(user);
      await this.tenants.load();
    } finally {
      if (request === this.sessionRequest) this.loadingState.set(false);
    }
  }

  async logout(): Promise<void> {
    const request = ++this.sessionRequest;
    this.userState.set(null);
    this.tenants.clear();
    this.loadingState.set(false);
    this.initialization = Promise.resolve();
    await this.csrf.refresh();
    if (request !== this.sessionRequest) return;
    await firstValueFrom(this.api.logout());
  }

  private async loadSession(): Promise<void> {
    const request = ++this.sessionRequest;
    this.loadingState.set(true);
    try {
      await this.csrf.refresh();
      if (request !== this.sessionRequest) return;
      const user = await firstValueFrom(this.api.getCurrentUser());
      if (request !== this.sessionRequest) return;
      // Only a *different* account invalidates the persisted workspace. On a cold load there is
      // no previous user, so the stored selection is this same user's own choice and must
      // survive the refresh; `TenantStore.load` still discards an id they no longer belong to.
      const previous = this.userState();
      if (previous !== null && previous.id !== user.id) this.tenants.clear();
      this.userState.set(user);
      await this.tenants.load();
    } catch {
      if (request !== this.sessionRequest) return;
      this.userState.set(null);
      this.tenants.clear();
    } finally {
      if (request === this.sessionRequest) this.loadingState.set(false);
    }
  }
}
