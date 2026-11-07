import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ownHiddenLine,
  ownLines,
  ownShownLine,
  ownTakenDownLine,
  ownWaitingLine,
} from '../../../testing/account-certificates-fixtures';
import type { CoachCertificateOwnView } from '../../core/api/generated';
import {
  CERTIFICATES_EMPTY,
  CERTIFICATES_LEDE,
  formatOwnCertificateDay,
  ownPillFor,
  SHOW_TO_CLIENTS,
  SWITCH_REFUSED,
  takesSwitch,
  toOwnCertificateLine,
  toOwnCertificateLines,
  withLine,
} from './account-certificates.models';

const LOCALE = 'en-LB';

const NEVER = /\b(verified|certified|licensed|qualified|approved)\b/i;

describe('A coach’s own certificate lines (notes plan N4b)', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('reading the API', () => {
    it('turns the versions the API may send as text into numbers, and keeps the rest as it came', () => {
      const line = toOwnCertificateLine({ ...ownShownLine(), version: '7', wordingVersion: '1' });

      expect(line.version).toBe(7);
      expect(line.wordingVersion).toBe(1);
      // The server's sentence, its parts and its days are kept exactly as they came.
      expect(line).toEqual(ownShownLine({ version: 7 }));
    });

    it('reads every line of the answer, in the server’s order', () => {
      const view: CoachCertificateOwnView = {
        lines: ownLines().map((line) => ({
          ...line,
          version: String(line.version),
          wordingVersion: String(line.wordingVersion),
        })),
      };

      expect(toOwnCertificateLines(view)).toEqual(ownLines());
      expect(toOwnCertificateLines({ lines: [] })).toEqual([]);
    });
  });

  describe('the switch', () => {
    it('is a confirmed line’s alone, whether it is on or off', () => {
      expect(takesSwitch(ownShownLine())).toBe(true);
      expect(takesSwitch(ownHiddenLine())).toBe(true);
      expect(takesSwitch(ownWaitingLine())).toBe(false);
      expect(takesSwitch(ownTakenDownLine())).toBe(false);
      expect(takesSwitch({ state: 'Erased' })).toBe(false);
    });
  });

  describe('the pill', () => {
    it('says where each line stands for the coach, in words and a tone', () => {
      expect(ownPillFor(ownWaitingLine(), LOCALE)).toEqual({
        label: 'Waiting for TB Gym',
        tone: 'warning',
      });
      expect(ownPillFor(ownShownLine(), LOCALE)).toEqual({
        label: 'Shown to clients',
        tone: 'success',
      });
      expect(ownPillFor(ownHiddenLine(), LOCALE)).toEqual({ label: 'Hidden', tone: 'neutral' });
      expect(ownPillFor(ownTakenDownLine(), LOCALE)).toEqual({
        label: 'Taken down 3 Nov 2026',
        tone: 'neutral',
      });
      // The server never lists an erased line; were one sent, it would say only that.
      expect(
        ownPillFor({ state: 'Erased', coachShows: true, takenDownOn: '2026-11-03' }, LOCALE),
      ).toEqual({ label: 'Erased', tone: 'neutral' });
    });

    it('says a line is down or waiting whatever the coach’s switch says', () => {
      expect(ownPillFor(ownTakenDownLine({ coachShows: false }), LOCALE)).toEqual({
        label: 'Taken down 3 Nov 2026',
        tone: 'neutral',
      });
      expect(ownPillFor(ownWaitingLine({ coachShows: false }), LOCALE)).toEqual({
        label: 'Waiting for TB Gym',
        tone: 'warning',
      });
    });

    it('says a taken-down line is down without a day it cannot read', () => {
      expect(ownPillFor(ownTakenDownLine({ takenDownOn: null }), LOCALE).label).toBe('Taken down');
      expect(ownPillFor(ownTakenDownLine({ takenDownOn: '2026-02-30' }), LOCALE).label).toBe(
        'Taken down',
      );
      expect(ownPillFor(ownTakenDownLine({ takenDownOn: '3 Nov 2026' }), LOCALE).label).toBe(
        'Taken down',
      );
    });
  });

  describe('the day', () => {
    it('writes a day the way the line’s sentence does', () => {
      expect(formatOwnCertificateDay('2026-11-03', LOCALE)).toBe('3 Nov 2026');
      expect(formatOwnCertificateDay('2027-01-01', LOCALE)).toBe('1 Jan 2027');
      expect(formatOwnCertificateDay('2026-12-31', 'en-US')).toBe('31 Dec 2026');
    });

    it('reads a YYYY-MM-DD day on the device’s own clock, so a device east of UTC never writes the day before', () => {
      // The device says it is 14 hours ahead of UTC (Kiritimati, the far-zone project's clock). The day
      // is that day at local midnight, so a reading on a UTC clock would shift it back into the day
      // before; the local clock keeps it, as the server's sentence writes it.
      vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-14 * 60);

      expect(formatOwnCertificateDay('2026-11-03', LOCALE)).toBe('3 Nov 2026');
      expect(formatOwnCertificateDay('2027-01-01', LOCALE)).toBe('1 Jan 2027');
      expect(ownPillFor(ownTakenDownLine(), LOCALE).label).toBe('Taken down 3 Nov 2026');
    });
  });

  describe('a line the server answered', () => {
    it('takes the place of the line it is, and leaves the others and their order', () => {
      const lines = ownLines();
      const newer = ownShownLine({ coachShows: false, version: 3 });

      const next = withLine(lines, newer);

      expect(next.map((line) => line.id)).toEqual(lines.map((line) => line.id));
      expect(next[1]).toBe(newer);
      expect(next.filter((line, index) => line !== lines[index])).toEqual([newer]);
      // The list it was given is left as it was.
      expect(lines[1]).toEqual(ownShownLine());
    });

    it('adds no line the page does not hold', () => {
      const lines = ownLines();

      expect(withLine(lines, ownWaitingLine({ id: 'line-other' }))).toEqual(lines);
      expect(withLine([], ownShownLine())).toEqual([]);
    });
  });

  describe('the words', () => {
    it('says what the page is for, and what an empty one waits for, in the plan’s words', () => {
      expect(CERTIFICATES_LEDE).toBe(
        'What TB Gym shows your clients about you. Switch a line off and your clients stop seeing it at once. TB Gym keeps only these words, never a copy of a document.',
      );
      expect(CERTIFICATES_EMPTY).toBe(
        'No lines yet. Send TB Gym your certificates, the gym you own or the years you’ve coached, and each confirmed one appears here.',
      );
      expect(SHOW_TO_CLIENTS).toBe('Show to my clients');
      expect(SWITCH_REFUSED).toBe('Couldn’t save your choice. Try again.');
    });

    it('never calls a coach checked, in any sentence it builds', () => {
      const sentences = [
        CERTIFICATES_LEDE,
        CERTIFICATES_EMPTY,
        SHOW_TO_CLIENTS,
        SWITCH_REFUSED,
        ...[
          ...ownLines(),
          ownTakenDownLine({ takenDownOn: null }),
          { ...ownShownLine(), state: 'Erased' as const },
        ].map((line) => ownPillFor(line, LOCALE).label),
      ];

      expect(sentences).toHaveLength(10);
      for (const sentence of sentences) {
        expect(sentence.length).toBeGreaterThan(0);
        expect(sentence).not.toMatch(NEVER);
      }
    });
  });
});
