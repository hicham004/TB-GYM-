import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_WORD_REFUSAL,
  certificateCoach,
  certificateLine,
  confirmedLine,
  erasedLine,
  takenDownLine,
} from '../../../testing/platform-admin-fixtures';
import type { CoachCertificateLinesView } from '../../core/api/generated';
import {
  addLineErrors,
  byLine,
  certificateRefusal,
  coachCountSummary,
  confirmLineErrors,
  countLine,
  deadlineSentence,
  eraseDeadline,
  erasedText,
  eraseErrors,
  erasureToast,
  formatCertificateDay,
  matchesCoach,
  pillFor,
  roleLabel,
  roleLine,
  toCertificateCoach,
  toCertificateLines,
} from './platform-coaches.models';

const LOCALE = 'en-LB';
const TODAY = '2026-10-09';

const counts = (waiting: number, confirmed: number, takenDown: number, erased: number) =>
  countLine({
    waitingLines: waiting,
    confirmedLines: confirmed,
    takenDownLines: takenDown,
    erasedLines: erased,
  });

const badRequest = (errors: Record<string, string[]>) =>
  new HttpErrorResponse({ status: 400, error: { title: 'One or more errors.', errors } });

describe('The certificate record’s words (notes plan N4a)', () => {
  describe('reading the API', () => {
    it('turns the counts and the versions the API may send as text into numbers', () => {
      const coach = toCertificateCoach({
        ...certificateCoach(),
        waitingLines: '2',
        confirmedLines: '1',
        takenDownLines: '0',
        erasedLines: '3',
      });
      expect([
        coach.waitingLines,
        coach.confirmedLines,
        coach.takenDownLines,
        coach.erasedLines,
      ]).toEqual([2, 1, 0, 3]);

      const view: CoachCertificateLinesView = {
        userId: 'user-1',
        name: 'Karim Haddad',
        email: 'karim@atlas.example',
        tenantId: 'space-1',
        spaceName: 'Atlas Performance',
        role: 'Owner',
        isActiveStaff: true,
        spaceToday: TODAY,
        lines: [{ ...confirmedLine(), version: '7', wordingVersion: '1' }],
      };
      const lines = toCertificateLines(view);
      expect(lines.lines[0].version).toBe(7);
      expect(lines.lines[0].wordingVersion).toBe(1);
      // The server's sentence is kept exactly as it came.
      expect(lines.lines[0].text).toBe('NASM CPT, 2019, shown to TB Gym on 1 Oct 2026');
      expect(lines.spaceToday).toBe(TODAY);
    });
  });

  describe('the list', () => {
    it('names the role in the space, and a former one for someone who no longer coaches there', () => {
      expect(roleLine(certificateCoach())).toBe('Owner · Atlas Performance');
      expect(roleLine(certificateCoach({ role: 'Coach' }))).toBe('Coach · Atlas Performance');
      expect(roleLine(certificateCoach({ isActiveStaff: false }))).toBe(
        'Former owner · Atlas Performance',
      );
      expect(roleLine(certificateCoach({ role: 'Coach', isActiveStaff: false }))).toBe(
        'Former coach · Atlas Performance',
      );
      // A client's membership shows only while it holds lines, given while they coached.
      expect(roleLabel({ role: 'Client', isActiveStaff: false })).toBe('Former coach');
    });

    it('counts every line not erased, then what is waiting, taken down and erased', () => {
      expect(counts(0, 0, 0, 0)).toBe('No lines yet');
      expect(counts(0, 0, 0, 2)).toBe('No lines · 2 erased');
      expect(counts(0, 1, 0, 0)).toBe('1 line');
      expect(counts(1, 1, 0, 0)).toBe('2 lines · 1 waiting');
      expect(counts(2, 0, 0, 0)).toBe('2 lines · 2 waiting');
      expect(counts(1, 1, 1, 0)).toBe('3 lines · 1 waiting · 1 taken down');
      expect(counts(1, 1, 1, 1)).toBe('3 lines · 1 waiting · 1 taken down · 1 erased');
      expect(counts(0, 0, 2, 0)).toBe('2 lines · 2 taken down');
    });

    it('finds a coach by their name, their email or the space, without minding accents or case', () => {
      const coach = certificateCoach({ name: 'Léa Khoury', email: 'lea@atlas.example' });
      expect(matchesCoach(coach, '')).toBe(true);
      expect(matchesCoach(coach, '  LEA ')).toBe(true);
      expect(matchesCoach(coach, 'lea@atlas')).toBe(true);
      expect(matchesCoach(coach, 'atlas perf')).toBe(true);
      expect(matchesCoach(coach, 'Beirut')).toBe(false);
      expect(matchesCoach(certificateCoach({ spaceName: 'نادي الأرز' }), 'الأرز')).toBe(true);
    });

    it('sums the rows on show for a screen reader', () => {
      expect(coachCountSummary(0)).toBe('No coach matches');
      expect(coachCountSummary(1)).toBe('1 coach');
      expect(coachCountSummary(3)).toBe('3 coaches');
    });
  });

  describe('a coach’s lines', () => {
    it('writes a day the way the server’s sentence does', () => {
      expect(formatCertificateDay('2026-11-03', LOCALE)).toBe('3 Nov 2026');
      expect(formatCertificateDay('2027-01-01', LOCALE)).toBe('1 Jan 2027');
    });

    it('gives each state its pill, with the day it got there', () => {
      expect(pillFor(certificateLine(), LOCALE)).toEqual({
        label: 'Waiting for confirmation',
        tone: 'warning',
      });
      expect(pillFor(confirmedLine(), LOCALE)).toEqual({
        label: 'Confirmed 2 Oct 2026',
        tone: 'success',
      });
      expect(pillFor(takenDownLine(), LOCALE)).toEqual({
        label: 'Taken down 20 Aug 2026',
        tone: 'neutral',
      });
      expect(pillFor(erasedLine(), LOCALE)).toEqual({
        label: 'Erased 2 Jul 2026',
        tone: 'neutral',
      });
      expect(pillFor(confirmedLine({ confirmedOn: null }), LOCALE).label).toBe('Confirmed');
    });

    it('says who confirmed and who recorded, once when it is the same person', () => {
      expect(byLine(confirmedLine(), LOCALE)).toBe(
        'Confirmed by Tarek Bou · recorded by Hicham Haddad',
      );
      expect(byLine(takenDownLine(), LOCALE)).toBe('Confirmed and recorded by Hicham Haddad');
      expect(byLine(confirmedLine({ confirmedByName: ' hicham haddad ' }), LOCALE)).toBe(
        'Confirmed and recorded by hicham haddad',
      );
      expect(byLine(certificateLine(), LOCALE)).toBe('Recorded by Hicham Haddad');
    });

    it('says when and by whom a line was erased, and why', () => {
      expect(byLine(erasedLine(), LOCALE)).toBe('Asked on 1 Jul 2026 · erased by Hicham Haddad');
      expect(
        byLine(
          erasedLine({ erasureReason: 'KeepingPeriod', requestedOn: null, erasedByName: null }),
          LOCALE,
        ),
      ).toBe('Erased after the keeping period');
      expect(erasedText(erasedLine())).toBe('Erased at the coach’s request');
      expect(erasedText({ erasureReason: 'KeepingPeriod' })).toBe(
        'Erased after the keeping period',
      );
    });
  });

  describe('the writes', () => {
    it('meets a request within 10 days of the day it was asked', () => {
      expect(eraseDeadline('2026-10-09')).toBe('2026-10-19');
      expect(eraseDeadline('2026-10-25')).toBe('2026-11-04');
      expect(eraseDeadline('2026-12-28')).toBe('2027-01-07');
      expect(deadlineSentence('2026-10-09', LOCALE)).toBe(
        'Requests are met within 10 days: by 19 Oct 2026.',
      );
      expect(deadlineSentence('', LOCALE)).toBe('Requests are met within 10 days.');
    });

    it('says what an erasure did, in one and many', () => {
      expect(erasureToast({ erased: 2, dropped: 0 })).toBe('Erased 2 lines.');
      expect(erasureToast({ erased: 1, dropped: 0 })).toBe('Erased 1 line.');
      expect(erasureToast({ erased: 1, dropped: 1 })).toBe(
        'Erased 1 line and dropped 1 waiting line.',
      );
      expect(erasureToast({ erased: 3, dropped: 2 })).toBe(
        'Erased 3 lines and dropped 2 waiting lines.',
      );
      expect(erasureToast({ erased: 0, dropped: 2 })).toBe('Dropped 2 waiting lines.');
      expect(erasureToast({ erased: 0, dropped: 1 })).toBe('Dropped 1 waiting line.');
      expect(erasureToast({ erased: 0, dropped: 0 })).toBe('Nothing was left to erase.');
    });

    it('checks a new line in the server’s words, leaving the refused words to the server', () => {
      expect(addLineErrors({ what: '  ', shownOn: '' }, TODAY)).toEqual({
        what: ['Write what the coach showed: the certificate, the gym, the years.'],
        shownOn: ['Choose the day the coach showed it.'],
      });
      expect(addLineErrors({ what: 'x'.repeat(121), shownOn: '2026-10-10' }, TODAY)).toEqual({
        what: ['Use 120 characters or fewer.'],
        shownOn: ['Choose today or an earlier day.'],
      });
      expect(addLineErrors({ what: 'NASM CPT', shownOn: '1999-12-31' }, TODAY)).toEqual({
        shownOn: ['Choose a day from 1 January 2000 to today.'],
      });
      expect(addLineErrors({ what: ` ${'x'.repeat(120)} `, shownOn: TODAY }, TODAY)).toEqual({});
      // Whether the words may be shown is the server's to say.
      expect(addLineErrors({ what: 'Licensed trainer', shownOn: TODAY }, TODAY)).toEqual({});
    });

    it('asks who confirmed it, in up to 80 characters', () => {
      expect(confirmLineErrors({ confirmedByName: ' ' })).toEqual({
        confirmedByName: ['Write who confirmed it with the coach.'],
      });
      expect(confirmLineErrors({ confirmedByName: 'x'.repeat(81) })).toEqual({
        confirmedByName: ['Use 80 characters or fewer.'],
      });
      expect(confirmLineErrors({ confirmedByName: 'Tarek Bou' })).toEqual({});
    });

    it('asks the day of the request, today or earlier', () => {
      expect(eraseErrors({ requestedOn: '' }, TODAY)).toEqual({
        requestedOn: ['Choose the day the coach asked.'],
      });
      expect(eraseErrors({ requestedOn: '2026-10-10' }, TODAY)).toEqual({
        requestedOn: ['Choose today or an earlier day.'],
      });
      expect(eraseErrors({ requestedOn: TODAY }, TODAY)).toEqual({});
    });
  });

  describe('a refused save', () => {
    it('puts each sentence of a 400 under the field it names', () => {
      expect(
        certificateRefusal(
          badRequest({
            what: [CERTIFICATE_WORD_REFUSAL],
            shownOn: ['Choose today or an earlier day.'],
          }),
        ),
      ).toEqual({
        fields: {
          what: [CERTIFICATE_WORD_REFUSAL],
          shownOn: ['Choose today or an earlier day.'],
        },
        message: null,
      });
      expect(
        certificateRefusal(
          badRequest({ confirmedByName: ['Write who confirmed it with the coach.'] }),
        ).fields,
      ).toEqual({ confirmedByName: ['Write who confirmed it with the coach.'] });
      expect(
        certificateRefusal(badRequest({ requestedOn: ['Choose the day the coach asked.'] })).fields,
      ).toEqual({ requestedOn: ['Choose the day the coach asked.'] });
    });

    it('says a sentence of no field in the sheet’s alert, beside the fields', () => {
      expect(
        certificateRefusal(
          badRequest({
            confirmedByName: ['Write who confirmed it with the coach.'],
            version: ['Read the lines again, then try once more.'],
          }),
        ),
      ).toEqual({
        fields: { confirmedByName: ['Write who confirmed it with the coach.'] },
        message: 'Read the lines again, then try once more.',
      });
      expect(
        certificateRefusal(badRequest({ version: ['Read the lines again, then try once more.'] })),
      ).toEqual({ fields: {}, message: 'Read the lines again, then try once more.' });
    });

    it('says a conflict’s own sentence, and the fallback for what the server did not explain', () => {
      const conflict = new HttpErrorResponse({
        status: 409,
        error: {
          code: 'certificate_line_changed',
          message:
            'This line changed since the page read it. Read the lines again, then try once more.',
        },
      });
      expect(certificateRefusal(conflict, 'Fallback.')).toEqual({
        fields: {},
        message:
          'This line changed since the page read it. Read the lines again, then try once more.',
      });
      expect(certificateRefusal(new HttpErrorResponse({ status: 404 }), 'Fallback.')).toEqual({
        fields: {},
        message: 'Fallback.',
      });
      expect(certificateRefusal(new HttpErrorResponse({ status: 0 }), 'Fallback.').message).toBe(
        'The app couldn’t connect. Check your connection and try again.',
      );
      expect(certificateRefusal(new Error('boom')).message).toBe(
        'The change couldn’t be saved. Try again.',
      );
    });
  });
});
