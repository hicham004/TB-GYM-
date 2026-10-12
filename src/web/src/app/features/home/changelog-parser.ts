import { formatDate } from '@angular/common';

/**
 * The changelog is a Markdown file (`src/content/changelog.md`) read at build time: a `## YYYY-MM-DD`
 * heading opens a release, each `- ` line under it is one change, and anything before the first
 * release (the title, an intro) is left out. Nothing else of Markdown is interpreted, so the file
 * stays plain for whoever edits it and the page needs no Markdown library.
 */
export interface ChangelogRelease {
  /** The day the changes shipped, as written in the heading (`YYYY-MM-DD`). */
  readonly date: string;
  /** The changes, one per bullet, newest release first as the file lists them. */
  readonly items: readonly string[];
}

const RELEASE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const ITEM = /^-\s+(.*)$/;

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: { date: string; items: string[] }[] = [];
  let current: { date: string; items: string[] } | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const release = RELEASE.exec(line);
    if (release) {
      current = { date: release[1], items: [] };
      releases.push(current);
      continue;
    }
    if (!current) continue;
    const item = ITEM.exec(line);
    if (item) {
      current.items.push(item[1].trim());
    } else if (/^\s+\S/.test(line) && current.items.length > 0) {
      // A bullet wrapped over several lines in the file is one change.
      current.items[current.items.length - 1] += ` ${line.trim()}`;
    }
  }
  return releases.filter((release) => release.items.length > 0);
}

/** The newest release's date, or null for a file with no release. */
export function newestChange(markdown: string): string | null {
  return parseChangelog(markdown)[0]?.date ?? null;
}

/**
 * `2026-10-13` as "13 Oct 2026" in the page's locale: a calendar day, formatted as a local date so
 * no time zone can move it, the same in the build-time render and the browser.
 */
export function formatChangeDate(date: string, locale: string): string {
  return formatDate(date, 'd MMM y', locale);
}
