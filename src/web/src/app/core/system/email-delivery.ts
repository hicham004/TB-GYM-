import { computed, inject, Injectable } from '@angular/core';
import { SystemStatus } from './system-status';

/**
 * Whether this deployment sends email at all (audit LOST-1), asked for once per visit. A deployment
 * with email off, such as the Render test copy, still saves invitations and the end of coaching, but
 * nobody receives an email about them, so the screens that would promise one say so instead. Until
 * the answer arrives, and if the request fails, email counts as on: the common case, and the screens
 * then read as they always have.
 */
@Injectable({ providedIn: 'root' })
export class EmailDelivery {
  private readonly status = inject(SystemStatus);

  /** True only once the server has said that it sends no email. */
  readonly off = computed(() => this.status.current()?.emailAvailable === false);

  constructor() {
    void this.load();
  }

  load(): Promise<void> {
    return this.status.load();
  }
}
