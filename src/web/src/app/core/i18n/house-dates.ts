import { formatDate } from '@angular/common';
import type { IsoDate } from '../../ui/calendar';

/**
 * Days as TB Gym writes them (UI plan §6): "Sun 25 Oct" in the current year and "3 Nov 2025" in another, never
 * ISO and never with seconds. An instant is first turned into the day it is on the workspace's clock, so a coach
 * and their client read the same day wherever their devices are (audit COACH-6).
 */
export function houseDay(day: IsoDate, locale: string, today: IsoDate): string {
  return formatDate(day, day.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'd MMM y', locale);
}

/** The calendar day an instant falls on in a time zone; the device's zone while none is known. */
export function dayInZone(instant: string | Date, timeZone: string | null): IsoDate {
  const parts = onClock('en-CA', timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(typeof instant === 'string' ? new Date(instant) : instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** "Sun 25 Oct, 9:16 PM": an instant's day and minute on the workspace's clock, without seconds. */
export function houseMoment(instant: string, locale: string, timeZone: string | null): string {
  const now = new Date();
  const day = houseDay(dayInZone(instant, timeZone), locale, dayInZone(now, timeZone));
  const time = onClock(locale, timeZone, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(instant),
  );
  return $localize`${day}:day:, ${time}:time:`;
}

/**
 * A formatter on the zone's clock, or on the device's while no zone is known or when this browser's zone
 * data lacks it (a newer IANA name, or a Windows id the server also accepts): a day a little off rather
 * than a page that breaks.
 */
function onClock(
  locale: string,
  timeZone: string | null,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone });
    } catch {
      // An unknown zone: the device's clock below.
    }
  }
  return new Intl.DateTimeFormat(locale, options);
}
