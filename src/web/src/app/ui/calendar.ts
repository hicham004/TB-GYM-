/**
 * Calendar-date maths for the kit's date field. A day is a `YYYY-MM-DD` string and every step is done
 * in UTC, so no time zone or daylight-saving change can move a date by a day (AGENTS.md: calendar
 * dates are dates, not instants). Weekdays are ISO numbers: 1 is Monday, 7 is Sunday.
 */
export type IsoDate = string;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` is a real calendar day written `YYYY-MM-DD` (2026-02-30 is not). */
export function isIsoDate(value: string | null | undefined): value is IsoDate {
  const match = ISO_DAY.exec(value ?? '');
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return toIso(date) === value;
}

export function toDate(iso: IsoDate): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIso(date: Date): IsoDate {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The device's own calendar day, for a field that has not been told what "today" is. */
export function deviceToday(now: Date = new Date()): IsoDate {
  return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

/** Moves by whole months; the day stays when the month has it, else it is the month's last day. */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const date = toDate(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);
  date.setUTCDate(Math.min(day, lastDay));
  return toIso(date);
}

export function addYears(iso: IsoDate, years: number): IsoDate {
  return addMonths(iso, years * 12);
}

/**
 * The latest birth date of someone who is 18 on `today`, by the server's rule: a person is an adult
 * once their birth date plus 18 years, a 29 February landing on the 28th, is no later than today. So
 * on 28 February of a common year a person born on 29 February 18 years ago already counts.
 */
export function adultCutoff(today: IsoDate): IsoDate {
  const cutoff = addYears(today, -18);
  const next = addDays(cutoff, 1);
  return addYears(next, 18) <= today ? next : cutoff;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthStart(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 7)}-01`;
}

/** ISO weekday: 1 Monday … 7 Sunday. */
export function weekday(iso: IsoDate): number {
  return toDate(iso).getUTCDay() || 7;
}

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** The ISO weekday of a day's English name as the API writes it ("Monday" is 1), or null. */
export function isoWeekdayOfName(name: string | null | undefined): number | null {
  const index = WEEKDAY_NAMES.indexOf(name ?? '');
  return index < 0 ? null : index + 1;
}

export function startOfWeek(iso: IsoDate, firstDay: number): IsoDate {
  return addDays(iso, -((weekday(iso) - firstDay + 7) % 7));
}

export function endOfWeek(iso: IsoDate, firstDay: number): IsoDate {
  return addDays(startOfWeek(iso, firstDay), 6);
}

export function clampIso(iso: IsoDate, min: IsoDate | null, max: IsoDate | null): IsoDate {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export interface CalendarDay {
  readonly iso: IsoDate;
  readonly number: number;
  /** Belongs to the month before or after the one shown. */
  readonly outside: boolean;
}

/**
 * The six weeks that show a month, from the week containing its first day. Always six rows, so the
 * calendar keeps its height as the month changes.
 */
export function monthWeeks(month: IsoDate, firstDay: number): CalendarDay[][] {
  const first = monthStart(month);
  const shown = first.slice(0, 7);
  let day = startOfWeek(first, firstDay);
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week++) {
    const row: CalendarDay[] = [];
    for (let column = 0; column < 7; column++) {
      row.push({ iso: day, number: Number(day.slice(8)), outside: day.slice(0, 7) !== shown });
      day = addDays(day, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/** The first day of the week the locale uses, as an ISO weekday; Monday when the browser will not say. */
export function localeFirstDay(locale: string): number {
  try {
    const intlLocale = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
    return info?.firstDay ?? 1;
  } catch {
    return 1;
  }
}
