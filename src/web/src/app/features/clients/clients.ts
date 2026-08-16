import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { ClientSummary } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';

@Component({
  selector: 'app-clients',
  imports: [ReactiveFormsModule],
  templateUrl: './clients.html',
  styleUrl: './clients.scss',
})
export class Clients {
  private readonly api = inject(ApiClient);
  private readonly formBuilder = inject(FormBuilder);
  private loadedTenantId: string | null = null;

  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  protected readonly clients = signal<ClientSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showCreate = signal(false);
  protected readonly clientForm = this.formBuilder.nonNullable.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    birthDate: [''],
  });

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.loadClients();
      }
    });
  }

  protected async loadClients(): Promise<void> {
    if (!this.tenants.selectedTenantId()) {
      this.clients.set([]);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    try {
      this.clients.set(await firstValueFrom(this.api.getClients()));
    } catch (error) {
      this.clients.set([]);
      this.error.set(this.messageFor(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async createClient(): Promise<void> {
    if (this.clientForm.invalid) {
      this.clientForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.getCsrfToken());
      const value = this.clientForm.getRawValue();
      const created = await firstValueFrom(
        this.api.createClient({
          firstName: value.firstName,
          lastName: value.lastName,
          email: value.email,
          birthDate: value.birthDate || null,
        }),
      );
      this.clients.update((current) => [...current, created]);
      this.clientForm.reset();
      this.showCreate.set(false);
    } catch (error) {
      this.error.set(this.messageFor(error));
    } finally {
      this.loading.set(false);
    }
  }

  private messageFor(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        return 'Sign in to view clients.';
      }
      if (error.status === 403) {
        return 'The active workspace does not grant coach access.';
      }
      if (error.status === 409) {
        return error.error?.error ?? 'A client with this email already exists.';
      }
    }

    return 'The client request failed.';
  }
}
