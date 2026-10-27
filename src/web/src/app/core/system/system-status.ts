import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SystemStatusResponse } from '../api/generated';

/**
 * What this deployment is set up for, asked for once per visit. It describes the deployment, never
 * a person, so every screen that needs it shares the one answer: whether email goes out (audit
 * LOST-1) and whether uploads are taken (critique T25).
 */
@Injectable({ providedIn: 'root' })
export class SystemStatus {
  private readonly http = inject(HttpClient);
  private readonly status = signal<SystemStatusResponse | null>(null);
  private request: Promise<void> | null = null;

  /** Null until the server answers, and if it cannot be read. */
  readonly current = this.status.asReadonly();

  load(): Promise<void> {
    this.request ??= firstValueFrom(this.http.get<SystemStatusResponse>('/api/system/status')).then(
      (status) => this.status.set(status),
      () => this.status.set(null),
    );
    return this.request;
  }
}
