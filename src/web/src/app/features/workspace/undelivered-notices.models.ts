import { toNumber } from '../../core/api/api-client';
import type {
  CommercialNotificationKind,
  NotificationChannel,
  NotificationDeadLetterPage,
} from '../../core/api/generated';
import { houseMoment } from '../../core/i18n/house-dates';

/**
 * Settings › Undelivered notices (audit INV-4; ADR 0018): what the owner may read about a notice TB Gym
 * gave up delivering. Deliberately little (NOT-007): what it was about, how it was sent, when, why it
 * stopped and a reference for TB Gym. Never who it was for or what it said. Pure helpers, so the page
 * and its tests share them.
 */
export interface UndeliveredNotice {
  /** The channel delivery's id: the reference TB Gym can look up. */
  readonly id: string;
  readonly kind: CommercialNotificationKind;
  readonly channel: NotificationChannel;
  readonly scheduledAtUtc: string;
  readonly attemptCount: number;
  readonly deadLetteredAtUtc: string | null;
  readonly failureCode: string | null;
}

export interface UndeliveredNoticePage {
  readonly total: number;
  readonly items: readonly UndeliveredNotice[];
}

export function toUndeliveredNoticePage(page: NotificationDeadLetterPage): UndeliveredNoticePage {
  return {
    total: toNumber(page.total),
    items: page.items.map((item) => ({
      id: item.channelDeliveryId,
      kind: item.kind,
      channel: item.channel,
      scheduledAtUtc: item.scheduledAtUtc,
      attemptCount: toNumber(item.attemptCount),
      deadLetteredAtUtc: item.deadLetteredAtUtc,
      failureCode: item.failureCode,
    })),
  };
}

/** One notice as the owner reads it. */
export interface UndeliveredNoticeRow {
  readonly id: string;
  /** What the notice was about: "A plan waiting for payment". */
  readonly about: string;
  /** "Email" or "In the app". */
  readonly channel: string;
  /** Why TB Gym stopped: "Tried 6 times without getting through." */
  readonly reason: string;
  /**
   * Who such a notice goes to (from its kind alone), when it was due and when TB Gym gave up, on the
   * workspace's clock: "For a client · Due Mon 12 Oct, 9:00 AM · Given up Mon 12 Oct, 3:12 PM".
   */
  readonly facts: string;
}

export function undeliveredNoticeRow(
  notice: UndeliveredNotice,
  locale: string,
  timeZone: string | null,
): UndeliveredNoticeRow {
  const due = houseMoment(notice.scheduledAtUtc, locale, timeZone);
  const gaveUp = notice.deadLetteredAtUtc
    ? houseMoment(notice.deadLetteredAtUtc, locale, timeZone)
    : null;
  const audience = noticeAudience(notice.kind);
  const facts = [
    ...(audience === null ? [] : [audience]),
    $localize`Due ${due}:when:`,
    ...(gaveUp === null ? [] : [$localize`Given up ${gaveUp}:when:`]),
  ];
  return {
    id: notice.id,
    about: noticeAbout(notice.kind),
    channel: notice.channel === 'Email' ? $localize`Email` : $localize`In the app`,
    reason: undeliveredReason(notice.failureCode, notice.attemptCount),
    facts: facts.join(' · '),
  };
}

/** What a notice of this kind was about, in the words its readers saw, told from the owner's side. */
export function noticeAbout(kind: CommercialNotificationKind): string {
  switch (kind) {
    case 'PaymentRequired':
      return $localize`A plan waiting for payment`;
    case 'EnrollmentActivated':
      return $localize`A plan that started`;
    case 'EnrollmentEndingSoon':
      return $localize`A plan ending soon`;
    case 'EnrollmentExpired':
      return $localize`A plan that ended`;
    case 'EnrollmentRenewed':
      return $localize`A plan renewed`;
    case 'CoachDeparted':
      return $localize`A change of coach`;
    case 'ClientLeft':
      return $localize`A client who left`;
    case 'CoachResigned':
      return $localize`A coach who left your team`;
    case 'RenewalRequested':
      return $localize`A client asking to renew`;
    case 'ProgramAssigned':
      return $localize`A new program`;
    case 'WeeksShared':
      return $localize`Program weeks shared`;
    case 'WeeksChanged':
      return $localize`Program weeks updated`;
    case 'CoachWorkoutNote':
      return $localize`A coach’s note on a workout`;
    case 'ClientWorkoutNote':
      return $localize`A client’s note on a workout`;
    default:
      return $localize`A notice`;
  }
}

/**
 * Who a notice of this kind goes to, as its kind alone says (the list never names the person), or null
 * for a kind this build does not know. A client hears of their plan, coach and program; staff hear of
 * clients and team changes, and the owner may be the coach a client's notice goes to.
 */
export function noticeAudience(kind: CommercialNotificationKind): string | null {
  switch (kind) {
    case 'PaymentRequired':
    case 'EnrollmentActivated':
    case 'EnrollmentEndingSoon':
    case 'EnrollmentExpired':
    case 'EnrollmentRenewed':
    case 'CoachDeparted':
    case 'ProgramAssigned':
    case 'WeeksShared':
    case 'WeeksChanged':
    case 'CoachWorkoutNote':
      return $localize`For a client`;
    case 'CoachResigned':
      return $localize`For you`;
    case 'ClientLeft':
    case 'RenewalRequested':
    case 'ClientWorkoutNote':
      return $localize`For you or a coach`;
    default:
      // A kind this build does not know yet: rather than guess who it was for, the row says nothing.
      return null;
  }
}

/**
 * Why TB Gym stopped, from the delivery's stable code (ADR 0018, 0022). The schedule running out says
 * how many tries it took; a refusal says who refused; anything else is TB Gym's own.
 */
export function undeliveredReason(code: string | null, attempts: number): string {
  switch (code) {
    case 'notification-attempts-exhausted':
      return attempts === 1
        ? $localize`Tried once without getting through.`
        : $localize`Tried ${attempts}:count: times without getting through.`;
    case 'notification-email-provider-response-invalid':
      return $localize`The email service answered in a way TB Gym couldn’t use.`;
    case 'notification-payload-invalid':
    case 'notification-template-missing':
    case 'notification-aggregate-mismatch':
      return $localize`TB Gym couldn’t put this notice together.`;
    default:
      return code?.startsWith('notification-email-')
        ? $localize`The email service refused it.`
        : $localize`TB Gym couldn’t deliver it.`;
  }
}

/** "1 notice TB Gym gave up on" or "3 notices TB Gym gave up on": the line under the heading. */
export function undeliveredSummary(total: number): string {
  return total === 1
    ? $localize`1 notice TB Gym gave up on, newest first.`
    : $localize`${total}:count: notices TB Gym gave up on, newest first.`;
}
