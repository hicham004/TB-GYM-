import type { IconName } from '../../ui/icon';
import type { NotificationItem } from './notification.models';

/** Where a notice leads when it is opened: a route and its query, or nowhere. */
export interface NoticeTarget {
  readonly commands: readonly string[];
  readonly queryParams?: Readonly<Record<string, string | number>>;
}

/** One day of the inbox, newest first, under its heading. */
export interface NoticeDay {
  readonly key: string;
  readonly heading: string;
  /** Today or Yesterday, which open from the start; an older day opens when the reader asks (audit UIQ-21). */
  readonly recent: boolean;
  readonly items: readonly NotificationItem[];
}

/**
 * The screen a notice opens (every kind has one since audit COACH-12). Each page still checks what its
 * reader may see; the link is a shortcut, not a permission. Only a notice whose own target is missing
 * (a client's note without its client) opens nothing and is just marked read.
 */
export function noticeTarget(item: NotificationItem, isOwner: boolean): NoticeTarget | null {
  switch (item.kind) {
    case 'RenewalRequested':
      return item.clientProfileId
        ? { commands: ['/clients', item.clientProfileId, 'service'] }
        : null;
    case 'ClientWorkoutNote':
      return item.clientProfileId
        ? {
            commands: ['/clients', item.clientProfileId, 'training'],
            ...(item.sessionId ? { queryParams: { session: item.sessionId } } : {}),
          }
        : null;
    case 'ProgramAssigned':
      return { commands: ['/training/program'] };
    case 'WeeksShared':
    case 'WeeksChanged':
      return {
        commands: ['/training/program'],
        ...(item.weekNumber !== null
          ? {
              queryParams: {
                week: item.weekNumber,
                ...(item.mesocycleId ? { program: item.mesocycleId } : {}),
              },
            }
          : {}),
      };
    case 'CoachWorkoutNote':
      return {
        commands: ['/training/program'],
        ...(item.workoutExecutionId ? { queryParams: { workout: item.workoutExecutionId } } : {}),
      };
    // The client's plan, and their coach leaving: their Today, which says where the plan stands and
    // offers Ask to renew once it has ended.
    case 'PaymentRequired':
    case 'EnrollmentActivated':
    case 'EnrollmentEndingSoon':
    case 'EnrollmentExpired':
    case 'EnrollmentRenewed':
    case 'CoachDeparted':
      return { commands: ['/'] };
    case 'CoachResigned':
      return { commands: ['/clients'] };
    // Former clients are the owner's list; a coach opens their own, where the client who left is gone.
    case 'ClientLeft':
      return { commands: isOwner ? ['/clients/former'] : ['/clients'] };
    default:
      return null;
  }
}

/** The small picture beside a notice: what it is about. */
export function noticeIcon(kind: NotificationItem['kind']): IconName {
  switch (kind) {
    case 'ProgramAssigned':
    case 'WeeksShared':
    case 'WeeksChanged':
      return 'training';
    case 'CoachWorkoutNote':
    case 'ClientWorkoutNote':
      return 'messages';
    case 'CoachDeparted':
    case 'ClientLeft':
    case 'CoachResigned':
      return 'clients';
    default:
      return 'products';
  }
}

/**
 * The inbox in days, newest first: Today, Yesterday, the weekday for the rest of the last week, then
 * the date. Days are the reader's own (the device's calendar), since a notice is personal.
 */
export function groupByDay(
  items: readonly NotificationItem[],
  now: Date,
  locale: string,
): NoticeDay[] {
  const today = startOfDay(now);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  const sameYear = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });
  const otherYear = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const days: { key: string; heading: string; recent: boolean; items: NotificationItem[] }[] = [];
  for (const item of items) {
    const at = new Date(item.createdAtUtc);
    const day = startOfDay(at);
    const key = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
    let current = days.at(-1);
    if (current?.key !== key) {
      const ago = Math.round((today.getTime() - day.getTime()) / 86_400_000);
      const heading =
        ago <= 0
          ? $localize`Today`
          : ago === 1
            ? $localize`Yesterday`
            : ago < 7
              ? weekday.format(at)
              : (at.getFullYear() === now.getFullYear() ? sameYear : otherYear).format(at);
      current = { key, heading, recent: ago <= 1, items: [] };
      days.push(current);
    }

    current.items.push(item);
  }

  return days;
}

/** What a folded day holds: "3 notifications, 1 unread". */
export function dayCount(day: NoticeDay): string {
  const total = day.items.length;
  const unread = day.items.filter((item) => !item.isRead).length;
  const all = total === 1 ? $localize`1 notification` : $localize`${total}:count: notifications`;
  if (unread === 0) return all;
  return unread === 1
    ? $localize`${all}:notifications:, 1 unread`
    : $localize`${all}:notifications:, ${unread}:unread: unread`;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
