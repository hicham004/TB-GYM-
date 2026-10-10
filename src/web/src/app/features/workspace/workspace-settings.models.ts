import type { DayOfWeek, WorkspaceDetails } from '../../core/api/api.models';

/**
 * Settings › Name and region (R5.2a): the coaching space's name, its time zone, the first day of its
 * week and the currency new plans start in. Pure helpers, so the page and its tests share them.
 */

/** The two currencies Lebanese coaches price in, offered first; any other ISO code is one tap away. */
export const OFFERED_CURRENCIES = ['USD', 'LBP'] as const;

export type CurrencyChoice = (typeof OFFERED_CURRENCIES)[number] | 'other';

export interface SpaceDraft {
  name: string;
  timeZoneId: string;
  weekStartsOn: DayOfWeek;
  currencyChoice: CurrencyChoice;
  /** The code typed under Another currency; ignored for USD and LBP. */
  otherCurrency: string;
}

export type SpaceField = 'name' | 'currency';

export function draftFrom(workspace: WorkspaceDetails): SpaceDraft {
  const code = workspace.defaultCurrencyCode.toUpperCase();
  const offered = (OFFERED_CURRENCIES as readonly string[]).includes(code);
  return {
    name: workspace.name,
    timeZoneId: workspace.timeZoneId,
    weekStartsOn: workspace.weekStartsOn,
    currencyChoice: offered ? (code as CurrencyChoice) : 'other',
    otherCurrency: offered ? '' : code,
  };
}

/** The currency the draft means, as the API takes it. */
export function draftCurrency(draft: SpaceDraft): string {
  return draft.currencyChoice === 'other'
    ? draft.otherCurrency.trim().toUpperCase()
    : draft.currencyChoice;
}

/** Whether saving the draft would change anything the server holds. */
export function draftChanged(draft: SpaceDraft, workspace: WorkspaceDetails): boolean {
  return (
    draft.name.trim() !== workspace.name ||
    draft.timeZoneId !== workspace.timeZoneId ||
    draft.weekStartsOn !== workspace.weekStartsOn ||
    draftCurrency(draft) !== workspace.defaultCurrencyCode.toUpperCase()
  );
}

/** What is wrong with each field, in words; an empty list when it is fine. */
export function draftErrors(draft: SpaceDraft): Record<SpaceField, readonly string[]> {
  const name = draft.name.trim();
  const code = draftCurrency(draft);
  return {
    name:
      name.length === 0
        ? [$localize`Give your coaching space a name.`]
        : name.length > 200
          ? [$localize`Keep the name to 200 characters.`]
          : [],
    currency:
      draft.currencyChoice !== 'other'
        ? []
        : code.length === 0
          ? [$localize`Type the currency’s three-letter code, like EUR.`]
          : !isKnownCurrency(code)
            ? [$localize`${code}:code: isn’t a currency code. Try one like EUR or AED.`]
            : [],
  };
}

/** True when the ISO 4217 code is one the browser knows, or looks like one where it cannot say. */
export function isKnownCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    return Intl.supportedValuesOf('currency').includes(code);
  } catch {
    return true;
  }
}

/** "US dollar" for USD in English; the code itself where the browser has no name. */
export function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface TimeZoneOption {
  readonly id: string;
  /** "Beirut", "New York", "UTC". */
  readonly city: string;
  /** "Asia", "America"; empty for UTC. */
  readonly area: string;
  /** "GMT+3" now; it moves with daylight saving. */
  readonly offset: string;
  readonly offsetMinutes: number;
  /** The time there now, "7:27 PM". */
  readonly now: string;
  /** Lower-case words to search: the id, the city, the area, the offset and the zone's long name. */
  readonly search: string;
}

/** Every IANA zone the browser knows, with UTC and the saved zone always present. */
export function timeZoneIds(saved: string): readonly string[] {
  let ids: string[];
  try {
    ids = [...Intl.supportedValuesOf('timeZone')];
  } catch {
    ids = ['Asia/Beirut'];
  }
  for (const id of ['UTC', saved]) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function timeZoneOption(id: string, at: Date, locale: string): TimeZoneOption {
  const segments = id.split('/');
  const city = (segments.at(-1) ?? id).replace(/_/g, ' ');
  const area = segments.length > 1 ? segments[0].replace(/_/g, ' ') : '';
  const offset = zonePart(id, at, locale, 'shortOffset') || 'GMT';
  const longName = zonePart(id, at, locale, 'longGeneric');
  let now: string;
  try {
    now = new Intl.DateTimeFormat(locale, {
      timeZone: id,
      hour: 'numeric',
      minute: '2-digit',
    }).format(at);
  } catch {
    now = '';
  }
  return {
    id,
    city,
    area,
    offset,
    offsetMinutes: offsetMinutes(offset),
    now,
    search: normalize([id, city, area, offset, longName].join(' ')),
  };
}

/**
 * The zones whose words hold every word typed, best first: a city that starts with the search, then
 * any other match; each set in order of offset and then city, as a world clock lists them.
 */
export function searchTimeZones(
  options: readonly TimeZoneOption[],
  query: string,
): readonly TimeZoneOption[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const byOffset = (a: TimeZoneOption, b: TimeZoneOption) =>
    a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city);
  if (words.length === 0) return [...options].sort(byOffset);

  const matches = options.filter((option) => words.every((word) => option.search.includes(word)));
  const first = normalize(query.trim());
  const leading = matches.filter((option) => normalize(option.city).startsWith(first));
  const rest = matches.filter((option) => !leading.includes(option));
  return [...leading.sort(byOffset), ...rest.sort(byOffset)];
}

function zonePart(
  id: string,
  at: Date,
  locale: string,
  style: 'shortOffset' | 'longGeneric',
): string {
  try {
    return (
      new Intl.DateTimeFormat(locale, { timeZone: id, timeZoneName: style })
        .formatToParts(at)
        .find((part) => part.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

/** "GMT+5:30" as 330, "GMT-3" as -180, "GMT" as 0. */
function offsetMinutes(offset: string): number {
  const match = /([+-−])(\d{1,2})(?::(\d{2}))?/.exec(offset);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_/]/g, ' ')
    .toLowerCase();
}
