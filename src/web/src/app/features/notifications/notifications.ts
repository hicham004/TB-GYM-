import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import {
  groupByDay,
  noticeIcon,
  noticeTarget,
  type NoticeTarget,
} from './notification-inbox.models';
import { appendPage, type NotificationItem } from './notification.models';

const pageSize = 25;

type InboxFilter = 'all' | 'unread';

/**
 * The signed-in member's own inbox for one workspace (R5.1c), for coaches and clients alike.
 *
 * Notices sit in days, newest first. Opening one marks it read and takes the reader to what it is
 * about; "Mark all as read" clears the rest. There is no Refresh button: the list reads itself again
 * when the reader comes back to the tab, and the badge keeps its own count (NotificationStore).
 *
 * Everything here belongs to one recipient in one workspace, so every piece of state is discarded
 * the moment that pair changes, and every reply checks which pair it was asked for before it writes.
 * Without that, a slow list for the previous workspace would land on top of the current one.
 */
@Component({
  selector: 'app-notifications',
  imports: [
    Button,
    DatePipe,
    EmptyState,
    Icon,
    NgTemplateOutlet,
    RouterLink,
    SegmentedControl,
    Skeleton,
  ],
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:visibilitychange)': 'onVisibilityChange()' },
})
export class Notifications {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly auth = inject(AuthStore);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly notifications = inject(NotificationStore);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  /** Bumped whenever the recipient or the workspace changes; every reply is checked against it. */
  private contextGeneration = 0;
  private cursor: string | undefined;
  private readonly readIds = new Set<string>();
  private readRevision = 0;
  private listGeneration = 0;
  private context: string | null = null;

  protected readonly items = signal<readonly NotificationItem[]>([]);
  /** Rows received on this visit, used only to decide when a quiet first-page refresh is safe. */
  protected readonly consumedOffset = signal(0);
  protected readonly total = signal(0);
  private readonly serverExhausted = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly markingAll = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly filter = signal<InboxFilter>('all');
  /** When the list was read, so "Today" means the day it was read on. */
  private readonly readAt = signal(new Date());

  protected readonly unread = this.notifications.unread;
  protected readonly filterOptions: readonly SegmentOption[] = [
    { value: 'all', label: $localize`All` },
    { value: 'unread', label: $localize`Unread` },
  ];
  protected readonly filterLabel = $localize`Show`;
  protected readonly loadingLabel = $localize`Loading your notifications…`;
  protected readonly loadedCount = computed(() => this.items().length);
  protected readonly hasMore = computed(() => !this.serverExhausted());
  protected readonly isEmpty = computed(
    () => !this.loading() && this.error() === null && this.loadedCount() === 0,
  );
  protected readonly days = computed(() => groupByDay(this.items(), this.readAt(), this.locale));
  protected readonly summary = computed(() => {
    const unread = this.unread();
    return unread === 0
      ? $localize`You're all caught up.`
      : unread === 1
        ? $localize`1 unread`
        : $localize`${unread}:count: unread`;
  });
  private readonly isOwner = this.tenants.isOwner;
  protected readonly isClient = this.tenants.isClient;

  private readonly contextKey = computed(() => {
    const userId = this.auth.user()?.id ?? null;
    const membership = this.tenants.selectedMembership();
    return userId === null || membership === undefined ? null : `${userId}|${membership.tenantId}`;
  });

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
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
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected target(item: NotificationItem): NoticeTarget | null {
    return noticeTarget(item, this.isOwner());
  }

  protected icon(item: NotificationItem) {
    return noticeIcon(item.kind);
  }

  protected setFilter(value: string): void {
    const next: InboxFilter = value === 'unread' ? 'unread' : 'all';
    if (next === this.filter()) {
      return;
    }

    this.filter.set(next);
    void this.reload();
  }

  /** A notice with somewhere to go is a link; following it marks it read on the way. */
  protected opened(item: NotificationItem): void {
    if (!item.isRead) {
      void this.markRead(item);
    }
  }

  /** Coming back to the tab reads the first page again, quietly, so new notices appear without a button. */
  protected onVisibilityChange(): void {
    if (document.visibilityState !== 'visible' || this.loading() || this.loadingMore()) {
      return;
    }

    if (this.contextKey() !== null && this.consumedOffset() <= pageSize) {
      void this.load(this.contextGeneration, true);
    }
  }

  protected async reload(): Promise<void> {
    return this.scope.run('reload', async (owner) => {
      const generation = this.contextGeneration;
      if (this.contextKey() === null) {
        return;
      }

      this.items.set([]);
      this.consumedOffset.set(0);
      this.total.set(0);
      this.serverExhausted.set(false);
      await owner.wait(this.load(generation));
    });
  }

  protected async loadMore(): Promise<void> {
    if (!this.hasMore() || this.loadingMore() || this.loading() || this.markingAll()) return;
    return this.scope.run('notifications', async (owner) => {
      const generation = this.contextGeneration;

      const request = ++this.listGeneration;
      const readRevision = this.readRevision;
      this.loadingMore.set(true);
      this.error.set(null);
      try {
        const page = await owner.wait(
          firstValueFrom(
            this.api.listNotifications(0, pageSize, this.filter() === 'unread', this.cursor),
          ),
        );
        if (!this.owns(generation, request)) {
          return;
        }

        // The cursor keeps reads/insertions ahead of the boundary from shifting later pages.
        // Deduplication also protects against a stale reply overlapping already-rendered rows.
        this.items.update((loaded) =>
          appendPage(
            loaded,
            this.filter() === 'unread'
              ? page.items.filter((item) => !this.readIds.has(item.id))
              : page.items,
          ),
        );
        const nextCursor = page.items.at(-1)?.id;
        const advanced = nextCursor !== undefined && nextCursor !== this.cursor;
        this.cursor = nextCursor ?? this.cursor;
        this.consumedOffset.update((consumed) => consumed + page.items.length);
        this.total.set(page.total);
        this.serverExhausted.set(
          !(page.hasMore ?? page.items.length === pageSize) || page.items.length === 0 || !advanced,
        );
        if (readRevision === this.readRevision) this.notifications.set(page.unreadTotal);
        else void this.notifications.refresh();
      } catch (error) {
        if (!owner.current) return;
        if (this.owns(generation, request)) {
          this.error.set(
            apiErrorMessage(error, $localize`More notifications could not be loaded.`),
          );
        }
      } finally {
        if (owner.current) {
          if (this.contextGeneration === generation && this.listGeneration === request) {
            this.loadingMore.set(false);
          }
        }
      }
    });
  }

  /**
   * The write itself belongs to `NotificationStore`, which outlives this page, so a notice opened
   * through its link is marked read even though the link has already taken the reader elsewhere
   * (audit WEB-2). This page only shows the answer while it is still here.
   */
  protected async markRead(notification: NotificationItem): Promise<void> {
    if (notification.isRead || this.busyId() !== null) return;
    return this.scope.run('markRead', async (owner) => {
      const generation = this.contextGeneration;

      this.busyId.set(notification.id);
      this.error.set(null);
      try {
        const updated = await owner.wait(this.notifications.markRead(notification.id));
        if (updated === null || this.contextGeneration !== generation) {
          return;
        }

        ++this.readRevision;
        this.readIds.add(updated.id);
        this.items.update((loaded) =>
          this.filter() === 'unread'
            ? loaded.filter((item) => item.id !== updated.id)
            : loaded.map((item) => (item.id === updated.id ? updated : item)),
        );
      } catch (error) {
        if (!owner.current) return;
        if (this.contextGeneration === generation) {
          // The row keeps its unread presentation: the server did not accept the change, so pretending
          // it did would leave the badge and the list disagreeing with the workspace.
          this.error.set(
            apiErrorMessage(error, $localize`This notification could not be marked as read.`),
          );
        }
      } finally {
        if (owner.current) {
          if (this.contextGeneration === generation) {
            this.busyId.set(null);
          }
        }
      }
    });
  }

  protected async markAllRead(): Promise<void> {
    if (this.markingAll() || this.unread() === 0) return;
    return this.scope.run('markAllRead', async (owner) => {
      const generation = this.contextGeneration;

      this.markingAll.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        if (this.contextGeneration !== generation) {
          return;
        }

        const left = await owner.wait(firstValueFrom(this.api.markAllNotificationsRead()));
        if (this.contextGeneration !== generation) {
          return;
        }

        ++this.listGeneration;
        ++this.readRevision;
        this.loadingMore.set(false);
        this.notifications.set(left);
        const now = new Date().toISOString();
        if (this.filter() === 'unread') {
          // Everything listed was unread and now is not: the filter shows what came in since, if anything.
          this.items.set([]);
          this.consumedOffset.set(0);
          this.total.set(0);
          this.serverExhausted.set(left === 0);
          if (left > 0) {
            await owner.wait(this.load(generation, true));
          }
        } else {
          this.items.update((loaded) =>
            loaded.map((item) =>
              item.isRead ? item : { ...item, isRead: true, readAtUtc: item.readAtUtc ?? now },
            ),
          );
        }
      } catch (error) {
        if (!owner.current) return;
        if (this.contextGeneration === generation) {
          this.error.set(
            apiErrorMessage(error, $localize`Your notifications could not be marked as read.`),
          );
        }
      } finally {
        if (owner.current && this.contextGeneration === generation) {
          this.markingAll.set(false);
        }
      }
    });
  }

  /** Reads the first page. A quiet read keeps what is on screen until the answer replaces it. */
  private async load(generation: number, quiet = false): Promise<void> {
    return this.scope.run('notifications', async (owner) => {
      const request = ++this.listGeneration;
      const readRevision = this.readRevision;
      this.loadingMore.set(false);
      if (!quiet) {
        this.loading.set(true);
      }

      this.error.set(null);
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.listNotifications(0, pageSize, this.filter() === 'unread')),
        );
        if (!this.owns(generation, request)) {
          return;
        }

        this.readAt.set(new Date());
        this.items.set(
          this.filter() === 'unread'
            ? page.items.filter((item) => !this.readIds.has(item.id))
            : page.items,
        );
        this.cursor = page.items.at(-1)?.id;
        this.consumedOffset.set(page.items.length);
        this.total.set(page.total);
        this.serverExhausted.set(
          !(page.hasMore ?? page.items.length === pageSize) || page.items.length === 0,
        );
        if (readRevision === this.readRevision) this.notifications.set(page.unreadTotal);
        else void this.notifications.refresh();
      } catch (error) {
        if (!owner.current) return;
        if (this.owns(generation, request) && !quiet) {
          this.items.set([]);
          this.consumedOffset.set(0);
          this.total.set(0);
          this.serverExhausted.set(false);
          this.error.set(apiErrorMessage(error, $localize`Notifications could not be loaded.`));
        }
      } finally {
        if (owner.current) {
          if (this.contextGeneration === generation && this.listGeneration === request) {
            this.loading.set(false);
          }
        }
      }
    });
  }

  /** A reply is only allowed to write if it is both the current context and the newest request. */
  private owns(generation: number, request: number): boolean {
    return this.contextGeneration === generation && this.listGeneration === request;
  }

  private reset(): void {
    ++this.listGeneration;
    this.cursor = undefined;
    this.readIds.clear();
    this.items.set([]);
    this.consumedOffset.set(0);
    this.total.set(0);
    this.serverExhausted.set(false);
    this.loading.set(false);
    this.loadingMore.set(false);
    this.markingAll.set(false);
    this.busyId.set(null);
    this.error.set(null);
  }

  private resetTenantState(): void {
    ++this.contextGeneration;
    this.context = null;
    this.reset();
  }
}
