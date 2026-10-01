import { formatDate } from '@angular/common';
import type { Message } from './messaging.models';

/**
 * How a thread reads as a chat: messages grouped by the reader's calendar day, consecutive messages
 * from one side joined into a run, and the first message that was unread when the thread opened.
 *
 * Days are the reader's own local days. A message instant is UTC and a chat is read where the reader
 * is, so "Today" means the reader's today — the same zone every time on the screen is formatted in.
 * Nothing here is a business date; due dates and plan dates never go through it.
 */
export interface ChatDay {
  readonly key: string;
  readonly label: string;
  readonly entries: readonly ChatEntry[];
}

export interface ChatEntry {
  readonly message: Message;
  /** First of a run of messages from the same side, so the bubble gets its full corner and gap. */
  readonly startsRun: boolean;
  readonly endsRun: boolean;
  /** Where the "New messages" divider goes. */
  readonly firstUnread: boolean;
}

/** Two messages from one side this close together read as one burst. */
const runGapMs = 5 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

/**
 * @param unreadFrom the sequence of the first message that was unread when the thread was opened.
 *   It is fixed for the visit, so the divider stays put after the read cursor moves past it.
 */
export function chatTimeline(
  messages: readonly Message[],
  unreadFrom: number | null,
  now: Date,
  locale: string,
): ChatDay[] {
  const days: { key: string; label: string; entries: ChatEntry[] }[] = [];
  let dividerPlaced = false;
  const breaks = messages.map((message, index) => {
    const previous = messages[index - 1];
    const firstUnread = !dividerPlaced && unreadFrom !== null && message.sequence >= unreadFrom;
    dividerPlaced ||= firstUnread;
    return { firstUnread, breaks: firstUnread || !continues(previous, message) };
  });

  messages.forEach((message, index) => {
    const sent = new Date(message.sentAtUtc);
    const key = localDayKey(sent);
    if (days.at(-1)?.key !== key) {
      days.push({ key, label: chatDayLabel(sent, now, locale), entries: [] });
    }

    days.at(-1)!.entries.push({
      message,
      startsRun: breaks[index].breaks,
      endsRun: breaks[index + 1]?.breaks ?? true,
      firstUnread: breaks[index].firstUnread,
    });
  });

  return days;
}

/** "Today", "Yesterday", "Mon 28 Sep", or "Mon 28 Sep 2025" for another year. */
export function chatDayLabel(date: Date, now: Date, locale: string): string {
  const days = daysBetween(date, now);
  if (days === 0) return $localize`:Chat day separator:Today`;
  if (days === 1) return $localize`:Chat day separator:Yesterday`;
  return formatDate(date, sameYear(date, now) ? 'EEE d MMM' : 'EEE d MMM y', locale);
}

/** A conversation row's time: the time today, then "Yesterday", a weekday, and a date. */
export function conversationTimeLabel(value: string, now: Date, locale: string): string {
  const date = new Date(value);
  const days = daysBetween(date, now);
  // A server instant slightly ahead of this device's clock is still today.
  if (days <= 0) return formatDate(date, 'shortTime', locale);
  if (days === 1) return $localize`:Conversation list time:Yesterday`;
  if (days < 7) return formatDate(date, 'EEE', locale);
  return formatDate(date, sameYear(date, now) ? 'd MMM' : 'd MMM y', locale);
}

/** The sequence of the first message from the other side still unread on arrival, if any. */
export function firstUnreadSequence(messages: readonly Message[]): number | null {
  return (
    messages.find((message) => message.isUnreadByCaller && !message.isFromCaller)?.sequence ?? null
  );
}

function continues(earlier: Message | undefined, later: Message): boolean {
  if (earlier === undefined || earlier.isFromCaller !== later.isFromCaller) return false;
  const from = new Date(earlier.sentAtUtc);
  const to = new Date(later.sentAtUtc);
  return localDayKey(from) === localDayKey(to) && to.getTime() - from.getTime() < runGapMs;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Whole local calendar days from `date` to `now`; rounding absorbs a daylight-saving hour. */
function daysBetween(date: Date, now: Date): number {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((end - start) / dayMs);
}

function sameYear(date: Date, now: Date): boolean {
  return date.getFullYear() === now.getFullYear();
}
