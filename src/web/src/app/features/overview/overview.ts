import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { HealthResponse, SystemStatus } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';

@Component({
  selector: 'app-overview',
  imports: [ReactiveFormsModule],
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
})
export class Overview implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  protected readonly system = signal<SystemStatus | null>(null);
  protected readonly liveHealth = signal<HealthResponse | null>(null);
  protected readonly readyHealth = signal<HealthResponse | null>(null);
  protected readonly statusError = signal<string | null>(null);
  protected readonly loginError = signal<string | null>(null);
  protected readonly loginForm = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
    rememberMe: [false],
  });

  ngOnInit(): void {
    void this.refreshStatus();
  }

  protected async refreshStatus(): Promise<void> {
    this.statusError.set(null);

    const [systemResult, liveResult, readyResult] = await Promise.allSettled([
      firstValueFrom(this.api.getSystemStatus()),
      firstValueFrom(this.api.getLiveHealth()),
      firstValueFrom(this.api.getReadyHealth()),
    ]);

    this.system.set(systemResult.status === 'fulfilled' ? systemResult.value : null);
    this.liveHealth.set(liveResult.status === 'fulfilled' ? liveResult.value : null);
    this.readyHealth.set(
      readyResult.status === 'fulfilled'
        ? readyResult.value
        : this.healthFromError(readyResult.reason),
    );

    if (systemResult.status === 'rejected' || liveResult.status === 'rejected') {
      this.statusError.set('The API is not reachable.');
    }
  }

  protected async login(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.loginError.set(null);
    const value = this.loginForm.getRawValue();
    try {
      await this.auth.login(value.email, value.password, value.rememberMe);
      this.loginForm.controls.password.reset();
    } catch (error) {
      this.loginError.set(
        error instanceof HttpErrorResponse && error.status === 401
          ? 'Email or password is incorrect.'
          : 'Sign in failed. Check the API and database status.',
      );
    }
  }

  private healthFromError(error: unknown): HealthResponse | null {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object') {
      return error.error as HealthResponse;
    }

    return null;
  }
}
