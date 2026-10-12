import changelogMarkdown from '../../../content/changelog.md';
import { formatChangeDate, newestChange } from './changelog-parser';

/** The newest date in `src/content/changelog.md`, read at build time; null until it holds a release. */
export const LAST_CHANGE_DATE: string | null = newestChange(changelogMarkdown);

/** That date as the homepage prints it ("13 Oct 2026") in the given locale, or null. */
export function lastChange(locale: string): string | null {
  return LAST_CHANGE_DATE ? formatChangeDate(LAST_CHANGE_DATE, locale) : null;
}
