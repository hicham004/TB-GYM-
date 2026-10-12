import { describe, expect, it } from 'vitest';
import { formatChangeDate, newestChange, parseChangelog } from './changelog-parser';

const FILE = `# What changed

Every change, newest first.

## 2026-10-13

- The homepage, rebuilt.

## 2026-10-12

- Share cards: a record becomes an image in the coach's colours,
  made on the phone.
- Before and after.

## 2026-10-11
`;

describe('parseChangelog', () => {
  it('reads one release per dated heading with its bullets, and leaves the intro out', () => {
    const releases = parseChangelog(FILE);

    expect(releases.map((release) => release.date)).toEqual(['2026-10-13', '2026-10-12']);
    expect(releases[0].items).toEqual(['The homepage, rebuilt.']);
    expect(releases[1].items).toEqual([
      "Share cards: a record becomes an image in the coach's colours, made on the phone.",
      'Before and after.',
    ]);
  });

  it('skips a release with no change under it and a heading that is not a date', () => {
    expect(parseChangelog('## Soon\n- Nothing\n## 2026-10-11\n')).toEqual([]);
  });

  it('names the newest date, and none for an empty file', () => {
    expect(newestChange(FILE)).toBe('2026-10-13');
    expect(newestChange('# Nothing yet')).toBeNull();
  });

  it('prints a date in the page’s own words', () => {
    expect(formatChangeDate('2026-10-13', 'en-LB')).toBe('13 Oct 2026');
    expect(formatChangeDate('2026-01-02', 'en-LB')).toBe('2 Jan 2026');
  });
});
