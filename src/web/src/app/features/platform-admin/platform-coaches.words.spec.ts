import { describe, expect, it } from 'vitest';
import appShell from '../../app.html' with { loader: 'text' };
import coachShell from '../../shell/coach-shell.html' with { loader: 'text' };
import accountCertificates from '../account/account-certificates.html' with { loader: 'text' };
import clientAccount from '../account/client-account.html' with { loader: 'text' };
import platformAdmin from './platform-admin.html' with { loader: 'text' };
import coachAdd from './platform-coach-add.html' with { loader: 'text' };
import coachConfirm from './platform-coach-confirm.html' with { loader: 'text' };
import coachErase from './platform-coach-erase.html' with { loader: 'text' };
import coachLines from './platform-coach-lines.html' with { loader: 'text' };
import platformCoaches from './platform-coaches.html' with { loader: 'text' };
import { ownLines, ownTakenDownLine } from '../../../testing/account-certificates-fixtures';
import {
  certificateCoach,
  certificateLine,
  confirmedLine,
  erasedLine,
  takenDownLine,
} from '../../../testing/platform-admin-fixtures';
import {
  CERTIFICATES_EMPTY,
  CERTIFICATES_LEDE,
  ownPillFor,
  SHOW_TO_CLIENTS,
  SWITCH_REFUSED,
} from '../account/account-certificates.models';
import {
  addLineErrors,
  byLine,
  certificateRefusal,
  coachCountSummary,
  confirmLineErrors,
  countLine,
  deadlineSentence,
  erasedText,
  eraseErrors,
  erasureToast,
  pillFor,
  roleLine,
} from './platform-coaches.models';

/**
 * The certificate record's words (notes plan N4a, the plan's Point 2): a coach is never called
 * verified, certified, licensed, qualified or approved on a screen. This reads every template the row
 * added or changed as it is written, and the sentences the screens draw from code, and refuses those
 * words whole. (Legal documents is left out on purpose: it asks for text "a qualified reviewer
 * approved", which is about the legal text, not a coach.)
 */
const NEVER = /\b(verified|certified|licensed|qualified|approved)\b/i;

const TEMPLATES: Record<string, string> = {
  'platform-coaches.html': platformCoaches,
  'platform-coach-lines.html': coachLines,
  'platform-coach-add.html': coachAdd,
  'platform-coach-confirm.html': coachConfirm,
  'platform-coach-erase.html': coachErase,
  'platform-admin.html': platformAdmin,
  'coach-shell.html': coachShell,
  'client-account.html': clientAccount,
  'app.html': appShell,
  // Notes plan N4b: the coach's own lines, under Settings › Your account.
  'account-certificates.html': accountCertificates,
};

describe('The certificate record’s words', () => {
  it.each(Object.entries(TEMPLATES))('%s never calls a coach checked', (_name, template) => {
    expect(template.length).toBeGreaterThan(0);
    expect(template).not.toMatch(NEVER);
  });

  it('links the Coaches page from every place an admin finds the other admin pages', () => {
    for (const template of [platformAdmin, coachShell, clientAccount, appShell]) {
      expect(template).toContain('routerLink="/admin/coaches"');
    }
  });

  it('links the House page last, right after Coaches, wherever Coaches is linked (notes plan N9a2)', () => {
    for (const template of [platformAdmin, coachShell, clientAccount, appShell]) {
      const links = Array.from(
        template.matchAll(/routerLink="(\/admin\/[^"]*)"/g),
        ([, href]) => href,
      );
      expect(links.slice(-2)).toEqual(['/admin/coaches', '/admin/house']);
    }
  });

  it('keeps every sentence the screens build from code free of those words', () => {
    const lines = [
      certificateLine(),
      confirmedLine(),
      confirmedLine({ confirmedByName: 'Hicham Haddad' }),
      // Notes plan N4b: a confirmed line the coach hides from their clients, and one a former coach
      // left switched on, which no client reads.
      confirmedLine({ coachShows: false }),
      confirmedLine({ shownToClients: false }),
      takenDownLine(),
      erasedLine(),
      erasedLine({ erasureReason: 'KeepingPeriod', requestedOn: null, erasedByName: null }),
    ];
    const sentences = [
      ...[true, false].flatMap((isActiveStaff) =>
        (['Owner', 'Coach', 'Client'] as const).map((role) =>
          roleLine(certificateCoach({ role, isActiveStaff })),
        ),
      ),
      ...[0, 1, 2].flatMap((count) => [
        countLine({
          waitingLines: count,
          confirmedLines: count,
          takenDownLines: count,
          erasedLines: count,
        }),
        coachCountSummary(count),
        erasureToast({ erased: count, dropped: 2 - count }),
      ]),
      ...lines.flatMap((line) => [
        pillFor(line, 'en-LB').label,
        byLine(line, 'en-LB'),
        erasedText(line),
      ]),
      deadlineSentence('2026-10-09', 'en-LB'),
      deadlineSentence('', 'en-LB'),
      ...Object.values(addLineErrors({ what: '', shownOn: '' }, '2026-10-09')).flat(),
      ...Object.values(
        addLineErrors({ what: 'x'.repeat(121), shownOn: '2026-10-10' }, '2026-10-09'),
      ).flat(),
      ...Object.values(addLineErrors({ what: 'x', shownOn: '1999-01-01' }, '2026-10-09')).flat(),
      ...Object.values(confirmLineErrors({ confirmedByName: '' })).flat(),
      ...Object.values(confirmLineErrors({ confirmedByName: 'x'.repeat(81) })).flat(),
      ...Object.values(eraseErrors({ requestedOn: '' }, '2026-10-09')).flat(),
      certificateRefusal(new Error('offline')).message ?? '',
      // Notes plan N4b: the coach's own page, its lede, its empty state, its switch and its pills.
      CERTIFICATES_LEDE,
      CERTIFICATES_EMPTY,
      SHOW_TO_CLIENTS,
      SWITCH_REFUSED,
      ...[...ownLines(), ownTakenDownLine({ takenDownOn: null })].map(
        (line) => ownPillFor(line, 'en-LB').label,
      ),
    ];
    expect(sentences.length).toBeGreaterThan(40);
    for (const sentence of sentences) {
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence).not.toMatch(NEVER);
    }
  });

  it('says what a coach’s clients see of a confirmed line, on the admin’s page and the coach’s own', () => {
    expect(
      [
        confirmedLine(),
        confirmedLine({ coachShows: false }),
        confirmedLine({ shownToClients: false }),
      ].map((line) => pillFor(line, 'en-LB').label),
    ).toEqual(['Shown to clients', 'Hidden by the coach', 'Not shown: no longer coaching here']);
    expect(ownLines().map((line) => ownPillFor(line, 'en-LB').label)).toEqual([
      'Taken down 3 Nov 2026',
      'Shown to clients',
      'Hidden',
      'Waiting for TB Gym',
    ]);
  });
});
