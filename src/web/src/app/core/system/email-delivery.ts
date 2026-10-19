import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SystemStatusResponse } from '../api/generated';

/**
 * Whether this deployment sends email at all (audit LOST-1), asked for once per visit. A deployment
 * with email off, such as the Render test copy, still saves invitations and the end of coaching, but
 * nobody receives an email about them, so the screens that would promise one say so instead. Until
 * the answer arrives, and if the request fails, email counts as on: the common case, and the screens
 * then read as they always have.
 */
@Injectable({ providedIn: 'root' })
export class EmailDelivery {
  private readonly http = inject(HttpClient);
  private readonly available = signal<boolean | null>(null);
  private request: Promise<void> | null = null;

  /** True only once the server has said that it sends no email. */
  readonly off = computed(() => this.available() === false);

  constructor() {
    void this.load();
  }

  load(): Promise<void> {
    this.request ??= firstValueFrom(this.http.get<SystemStatusResponse>('/api/system/status')).then(
      (status) => this.available.set(status.emailAvailable),
      () => this.available.set(null),
    );
    return this.request;
  }
}
