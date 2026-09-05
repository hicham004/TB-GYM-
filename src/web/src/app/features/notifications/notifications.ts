import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { appendPage, type NotificationItem } from './notification.models';

const pageSize = 25;

/**
 * The signed-in member's own inbox for one workspace.
 *
 * Everything on this screen belongs to one recipient in one workspace, so every piece of state is
 * discarded the moment that pair changes and every asynchronous result checks which pair it was
 * asked for before it writes anything. Without that, a slow list for the previous workspace lands on
 * top of the current one and the user reads somebody else's notifications — which the API would
 * never have returned, but the screen would have shown.
 *
 * There is no polling and no realtime channel in this slice. The inbox is passive persisted state:
 * it is read when the screen is opened and when the user asks for more.
 */
@Component({
  selector: 'app-notifications',
  imports: [DatePipe, RouterLink],
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
})
export class Notifications {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly notifications = inject(NotificationStore);

  /** Bumped whenever the recipient or the workspace changes; every reply is checked against it. */
  private contextGeneration = 0;
  private listGeneration = 0;
  private context: string | null = null;

  protected readonly items = signal<readonly NotificationItem[]>([]);
  /** Server offset positions consumed, which can exceed rendered rows when pages overlap. */
  protected readonly consumedOffset = signal(0);
  protected readonly total = signal(0);
  private readonly serverExhausted = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly pageSize = pageSize;

  protected readonly unread = this.notifications.unread;
  protected readonly loadedCount = computed(() => this.items().length);
  protected readonly hasMore = computed(
    () => !this.serverExhausted() && this.consumedOffset() < this.total(),
  );
  protected readonly isEmpty = computed(
    () => !this.loading() && this.error() === null && this.loadedCount() === 0,
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
      const generation = ++this.contextGeneration;
      // Cleared before anything is requested. An inbox from the workspace the user has just left
      // must not stay on screen for the length of a request.
      this.reset();
      if (key !== null) {
        void this.load(generation);
      }
    });
  }

  protected async reload(): Promise<void> {
    const generation = this.contextGeneration;
    if (this.contextKey() === null) {
      return;
    }

    this.items.set([]);
    this.consumedOffset.set(0);
    this.total.set(0);
    this.serverExhausted.set(false);
    await this.load(generation);
  }

  protected async loadMore(): Promise<void> {
    const generation = this.contextGeneration;
    if (!this.hasMore() || this.loadingMore() || this.loading()) {
      return;
    }

    const request = ++this.listGeneration;
    const skip = this.consumedOffset();
    this.loadingMore.set(true);
    this.error.set(null);
    try {
      const page = await firstValueFrom(this.api.listNotifications(skip, pageSize));
      if (!this.owns(generation, request)) {
        return;
      }

      // Appended by identifier rather than by position: something delivered between the two requests
      // shifts the page boundary, and a duplicated row would be a rendering error.
      this.items.update((loaded) => appendPage(loaded, page.items));
      // Offset progress belongs to rows the server returned, not unique rows that survived DOM
      // deduplication. An overlapping page still consumed every one of its server positions.
      this.consumedOffset.update((consumed) => consumed + page.items.length);
      this.total.set(page.total);
      this.serverExhausted.set(page.items.length === 0);
      this.notifications.set(page.unreadTotal);
    } catch (error) {
      if (this.owns(generation, request)) {
        this.error.set(apiErrorMessage(error, $localize`More notifications could not be loaded.`));
      }
    } finally {
      if (this.contextGeneration === generation && this.listGeneration === request) {
        this.loadingMore.set(false);
      }
    }
  }

  protected async markRead(notification: NotificationItem): Promise<void> {
    const generation = this.contextGeneration;
    if (notification.isRead || this.busyId() !== null) {
      return;
    }

    this.busyId.set(notification.id);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      if (this.contextGeneration !== generation) {
        return;
      }

      const updated = await firstValueFrom(this.api.markNotificationRead(notification.id));
      if (this.contextGeneration !== generation) {
        return;
      }

      this.items.update((loaded) =>
        loaded.map((item) => (item.id === updated.id ? updated : item)),
      );
      this.notifications.decrement();
    } catch (error) {
      if (this.contextGeneration === generation) {
        // The row keeps its unread presentation: the server did not accept the change, so pretending
        // it did would leave the badge and the list disagreeing with the workspace.
        this.error.set(
          apiErrorMessage(error, $localize`This notification could not be marked as read.`),
        );
      }
    } finally {
      if (this.contextGeneration === generation) {
        this.busyId.set(null);
      }
    }
  }

  private async load(generation: number): Promise<void> {
    const request = ++this.listGeneration;
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await firstValueFrom(this.api.listNotifications(0, pageSize));
      if (!this.owns(generation, request)) {
        return;
      }

      this.items.set(page.items);
      this.consumedOffset.set(page.items.length);
      this.total.set(page.total);
      this.serverExhausted.set(page.items.length === 0);
      this.notifications.set(page.unreadTotal);
    } catch (error) {
      if (this.owns(generation, request)) {
        this.items.set([]);
        this.consumedOffset.set(0);
        this.total.set(0);
        this.serverExhausted.set(false);
        this.error.set(apiErrorMessage(error, $localize`Notifications could not be loaded.`));
      }
    } finally {
      if (this.contextGeneration === generation && this.listGeneration === request) {
        this.loading.set(false);
      }
    }
  }

  /** A reply is only allowed to write if it is both the current context and the newest request. */
  private owns(generation: number, request: number): boolean {
    return this.contextGeneration === generation && this.listGeneration === request;
  }

  private reset(): void {
    ++this.listGeneration;
    this.items.set([]);
    this.consumedOffset.set(0);
    this.total.set(0);
    this.serverExhausted.set(false);
    this.loading.set(false);
    this.loadingMore.set(false);
    this.busyId.set(null);
    this.error.set(null);
  }
}
