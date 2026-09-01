import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { AuthStore } from '../auth/auth.store';
import { TenantStore } from '../tenancy/tenant.store';

/**
 * The unread badge in the topbar, and the single place the count is owned.
 *
 * The count belongs to one recipient in one workspace, so it is scoped to the pair. Whenever that
 * pair changes — a different workspace is selected, a different account signs in, the membership
 * disappears, the user signs out — the count is cleared *before* anything is fetched, so a stale
 * number is never shown against a context it did not come from.
 *
 * Every fetch carries a generation. A reply that arrives after the context has moved on is discarded
 * rather than written, which is what stops a slow request for the previous workspace from landing on
 * top of the current one.
 */
@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);

  private readonly unreadState = signal(0);
  private readonly loadingState = signal(false);
  private generation = 0;
  private context: string | null = null;

  readonly unread = this.unreadState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  /**
   * Whether the inbox is reachable at all. Membership is what the API verifies, so the link and the
   * badge follow the membership rather than the selected workspace alone: a workspace whose
   * membership has gone offers nothing to open.
   */
  readonly isAvailable = computed(
    () => this.auth.user() !== null && this.tenants.selectedMembership() !== undefined,
  );

  private readonly contextKey = computed(() => {
    const userId = this.auth.user()?.id ?? null;
    const membership = this.tenants.selectedMembership();
    return userId === null || membership === undefined ? null : `${userId}|${membership.tenantId}`;
  });

  constructor() {
    effect(() => {
      const key = this.contextKey();
      if (key === this.context) {
        return;
      }

      this.context = key;
      // Cleared first, unconditionally. A count from the workspace the user has just left must not
      // remain on screen for the length of a request, and if the new context has no inbox there is
      // nothing to replace it with.
      const generation = ++this.generation;
      this.unreadState.set(0);
      this.loadingState.set(false);
      if (key !== null) {
        void this.load(generation);
      }
    });
  }

  /** Re-reads the count for the current context, if there is one. */
  async refresh(): Promise<void> {
    if (this.contextKey() === null) {
      return;
    }

    await this.load(++this.generation);
  }

  /**
   * Applies a locally known change without a round trip, for the case where the screen has just
   * marked something read. Never goes below zero: the count is a display of state the server owns,
   * and a negative badge would be a worse lie than a stale one.
   */
  decrement(by = 1): void {
    this.unreadState.update((current) => Math.max(0, current - by));
  }

  /** Used when the inbox has just read an authoritative total for the current context. */
  set(unread: number): void {
    this.unreadState.set(Math.max(0, unread));
  }

  /** Signing out clears the badge immediately rather than waiting for the next effect pass. */
  clear(): void {
    ++this.generation;
    this.context = null;
    this.unreadState.set(0);
    this.loadingState.set(false);
  }

  private async load(generation: number): Promise<void> {
    this.loadingState.set(true);
    try {
      const unread = await firstValueFrom(this.api.getUnreadNotificationCount());
      if (this.generation === generation) {
        this.unreadState.set(Math.max(0, unread));
      }
    } catch {
      // A refused or failed count is shown as no badge rather than as an error: the topbar is not
      // the place to report that a background read did not work, and the inbox itself reports its
      // own failures where the user is looking.
      if (this.generation === generation) {
        this.unreadState.set(0);
      }
    } finally {
      if (this.generation === generation) {
        this.loadingState.set(false);
      }
    }
  }
}
