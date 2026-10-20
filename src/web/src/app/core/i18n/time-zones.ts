/**
 * Time zones as a person picks one (R5.2a's sheet, on Settings › Name and region and on registration):
 * by city, with its offset and the time there now. Pure helpers, so the pages, the kit's field and their
 * tests share them.
 */

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

/**
 * The zone this device is set to, when it names a real place ("Asia/Dubai") or UTC; null when the
 * browser cannot say.
 */
export function deviceTimeZoneId(): string | null {
  let id: string;
  try {
    id = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT'].includes(id)) return 'UTC';
  return id && id.includes('/') && !id.startsWith('Etc/') ? id : null;
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

/** "Beirut, Asia"; "UTC" alone. */
export function zoneLabel(option: TimeZoneOption): string {
  return option.area ? `${option.city}, ${option.area}` : option.city;
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
