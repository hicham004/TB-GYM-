import type {
  CommercialNotificationKind,
  NotificationPage as ContractNotificationPage,
  NotificationUnreadCount as ContractUnreadCount,
  NotificationView as ContractNotificationView,
} from '../../core/api/generated';

/**
 * Angular-owned view models for the inbox.
 *
 * The generated contracts type every 64-bit number as `number | string`, and a component that reads
 * those directly ends up comparing a string count against a number and silently rendering the wrong
 * thing. Mapping once, here, keeps that conversion in a single place and keeps the screen's own
 * vocabulary stable if the transport shape changes.
 */
export interface NotificationItem {
  readonly id: string;
  readonly kind: CommercialNotificationKind;
  readonly title: string;
  readonly body: string;
  readonly createdAtUtc: string;
  readonly readAtUtc: string | null;
  readonly isRead: boolean;
}

export interface NotificationPage {
  readonly total: number;
  readonly unreadTotal: number;
  readonly items: readonly NotificationItem[];
}

export function mapNotification(value: ContractNotificationView): NotificationItem {
  return {
    id: value.id,
    kind: value.kind,
    title: value.title,
    body: value.body,
    createdAtUtc: value.createdAtUtc,
    readAtUtc: value.readAtUtc ?? null,
    isRead: value.isRead,
  };
}

export function mapNotificationPage(value: ContractNotificationPage): NotificationPage {
  return {
    total: toCount(value.total),
    unreadTotal: toCount(value.unreadTotal),
    items: value.items.map(mapNotification),
  };
}

export function mapUnreadCount(value: ContractUnreadCount): number {
  return toCount(value.unread);
}

/**
 * Appends a page without letting an identifier appear twice. A page that overlaps the one already
 * loaded — because something was delivered between the two requests — must not duplicate a row, and
 * a duplicated `@for` key is a rendering error rather than a cosmetic one.
 */
export function appendPage(
  loaded: readonly NotificationItem[],
  incoming: readonly NotificationItem[],
): NotificationItem[] {
  const seen = new Set(loaded.map((item) => item.id));
  return [...loaded, ...incoming.filter((item) => !seen.has(item.id))];
}

function toCount(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}
