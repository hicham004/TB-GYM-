import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { AuthStore } from '../auth/auth.store';
import { TenantStore } from '../tenancy/tenant.store';
import { MessagingRealtimeService } from './messaging-realtime.service';

/**
 * The unread-message badge in the topbar, and the single place that count is owned.
 *
 * Deliberately separate from `NotificationStore`. An unread notification and an unread message are
 * different facts with different sources and different meanings — one is a workspace event somebody
 * scheduled, the other is a person waiting for a reply — and a single badge summing them could never
 * be explained or acted on. They are counted apart and shown apart.
 *
 * The count belongs to one recipient in one workspace, so it is scoped to that pair. Whenever the
 * pair changes — a different workspace, a different account, a membership that has gone, a sign-out
 * — the count is cleared *before* anything is fetched, and every reply carries a generation so a
 * slow request for the workspace the user has just left is discarded rather than written.
 */
@Injectable({ providedIn: 'root' })
export class MessageUnreadStore {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  /**
   * Injected here so the badge keeps the connection alive for the whole session rather than only
   * while the lazy `/messages` route is loaded. A member who never opens the screen still has to see
   * the count move when somebody writes to them, and the compact invalidation that makes that happen
   * is addressed to the connection, not to the route.
   */
  private readonly realtime = inject(MessagingRealtimeService);

  private readonly unreadState = signal(0);
  private readonly loadingState = signal(false);
  private generation = 0;
  private context: string | null = null;
  private handledRefreshRequests = 0;

  readonly unread = this.unreadState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  /**
   * Whether messaging is reachable at all. Membership is what the API verifies, so the link and the
   * badge follow the membership rather than the selected workspace alone.
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
      // remain on screen for the length of a request.
      const generation = ++this.generation;
      this.unreadState.set(0);
      this.loadingState.set(false);
      if (key !== null) {
        void this.load(generation);
      }
    });

    // One coalesced invalidation becomes one bounded re-read. The count is never derived from the
    // event itself: an invalidation says something changed, and what the number now is is a question
    // only the server can answer — it depends on which conversations are still accessible, which
    // messages are still present and where this reader's cursor is.
    effect(() => {
      const requests = this.realtime.listRefreshRequests();
      if (requests === this.handledRefreshRequests) {
        return;
      }

      this.handledRefreshRequests = requests;
      if (this.contextKey() !== null) {
        void this.load(++this.generation);
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

  /** Used when a screen has just read an authoritative total for the current context. */
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
      const unread = await firstValueFrom(this.api.getMessagingUnreadCount());
      if (this.generation === generation) {
        this.unreadState.set(Math.max(0, unread));
      }
    } catch {
      // A refused or failed count shows no badge rather than an error: the topbar is not the place
      // to report that a background read did not work, and the messages screen reports its own
      // failures where the user is looking.
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
