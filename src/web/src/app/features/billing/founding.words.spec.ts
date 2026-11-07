import { describe, expect, it } from 'vitest';
import clientAccount from '../account/client-account.html' with { loader: 'text' };
import accountFounding from '../account/account-founding.html' with { loader: 'text' };
import foundingEnd from '../platform-admin/platform-founding-end.html' with { loader: 'text' };
import foundingMark from '../platform-admin/platform-founding-mark.html' with { loader: 'text' };
import foundingTerms from '../platform-admin/platform-founding-terms.html' with { loader: 'text' };
import platformAdmin from '../platform-admin/platform-admin.html' with { loader: 'text' };
import platformSpace from '../platform-admin/platform-space.html' with { loader: 'text' };
import {
  endErrors,
  endPresets,
  markErrors,
  termsErrors,
  termsFields,
} from '../platform-admin/platform-founding.models';
import {
  adminProgressLine,
  FOUNDING_COACH,
  FOUNDING_COACH_LINE,
  markTermsSentence,
  ownerProgressLine,
  ownerTermsSentence,
  termsSentence,
  type FoundingBadge,
} from './founding.models';

/**
 * The badge's words (notes plan N3b, the plan's section 1): a coach is never called verified,
 * certified, qualified, licensed or approved on a screen. This reads every template the row added or
 * changed as it is written, and the words the screens draw from code, and refuses those words whole,
 * so the badge's own line ("Not a check of qualifications") still passes.
 */
const NEVER = /\b(verified|certified|qualified|licensed|approved)\b/i;

const TEMPLATES: Record<string, string> = {
  'platform-space.html': platformSpace,
  'platform-admin.html': platformAdmin,
  'platform-founding-mark.html': foundingMark,
  'platform-founding-end.html': foundingEnd,
  'platform-founding-terms.html': foundingTerms,
  'account-founding.html': accountFounding,
  'client-account.html': clientAccount,
};

const badge = (overrides: Partial<FoundingBadge> = {}): FoundingBadge => ({
  state: 'Waiting',
  foundingSince: '2026-09-15',
  clientsWithActivePlan: 7,
  clientsNeeded: 10,
  monthsSinceStart: 1,
  monthsNeeded: 2,
  termsVersion: 1,
  earnedOn: null,
  endedOn: null,
  hidden: false,
  ...overrides,
});

describe('The Founding coach badge’s words', () => {
  it.each(Object.entries(TEMPLATES))('%s never calls a coach checked', (_name, template) => {
    expect(template.length).toBeGreaterThan(0);
    expect(template).not.toMatch(NEVER);
  });

  it('names the badge and its line the way the plan wrote them', () => {
    expect(FOUNDING_COACH).toBe('Founding coach');
    expect(FOUNDING_COACH_LINE).toBe(
      'One of the first coaches on TB Gym. Not a check of qualifications',
    );
    expect(FOUNDING_COACH_LINE).not.toMatch(NEVER);
  });

  it('keeps every sentence the screens build from code free of those words', () => {
    const sentences = [
      ...[0, 1, 2].flatMap((months) =>
        [1, 10].flatMap((clients) => [
          markTermsSentence(clients, months),
          termsSentence(clients, months),
          ownerTermsSentence(clients, months),
        ]),
      ),
      ownerProgressLine(badge()),
      ownerProgressLine(badge({ monthsNeeded: 0 })),
      adminProgressLine(badge()),
      adminProgressLine(badge({ monthsNeeded: 0 })),
      ...endPresets(),
      ...termsFields().flatMap((field) => [field.label, field.help, field.missing]),
      ...Object.values(markErrors({ foundingSince: '', note: '' }, '2026-10-09')).flat(),
      ...Object.values(markErrors({ foundingSince: '2026-10-10', note: '' }, '2026-10-09')).flat(),
      ...Object.values(markErrors({ foundingSince: '1999-12-31', note: 'x' }, '2026-10-09')).flat(),
      ...Object.values(endErrors({ reason: '' })).flat(),
      ...Object.values(
        termsErrors({ clientsWithActivePlan: null, monthsSinceStart: 99, note: 'x'.repeat(501) }),
      ).flat(),
    ];
    expect(sentences.length).toBeGreaterThan(20);
    for (const sentence of sentences) expect(sentence).not.toMatch(NEVER);
  });
});
