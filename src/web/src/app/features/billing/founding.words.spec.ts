import { describe, expect, it } from 'vitest';
import clientAccount from '../account/client-account.html' with { loader: 'text' };
import accountFounding from '../account/account-founding.html' with { loader: 'text' };
import clientGrant from '../platform-admin/platform-client-grant.html' with { loader: 'text' };
import foundingEnd from '../platform-admin/platform-founding-end.html' with { loader: 'text' };
import foundingMark from '../platform-admin/platform-founding-mark.html' with { loader: 'text' };
import foundingTerms from '../platform-admin/platform-founding-terms.html' with { loader: 'text' };
import platformAdmin from '../platform-admin/platform-admin.html' with { loader: 'text' };
import platformSpace from '../platform-admin/platform-space.html' with { loader: 'text' };
import {
  amounts,
  foundingTerms as termsVersion,
  invoice,
} from '../../../testing/platform-admin-fixtures';
import {
  clientGrantErrors,
  invoiceUsage,
  revokeGrantQuestion,
} from '../platform-admin/platform-admin.models';
import {
  endErrors,
  endPresets,
  markErrors,
  termsErrors,
  termsFields,
} from '../platform-admin/platform-founding.models';
import billingPage from './billing.html' with { loader: 'text' };
import { billLines, includedClientSentences, pricesHeldSentence } from './billing.models';
import {
  adminProgressLine,
  FOUNDING_COACH,
  FOUNDING_COACH_LINE,
  foundingSeatLine,
  markGuaranteeSentence,
  markSeatSentence,
  markTermsSentence,
  ownerProgressLine,
  ownerTermsSentence,
  planGuaranteeSentence,
  planPublishedSentence,
  priceHoldLine,
  termsGuaranteeSentence,
  termsSeatSentence,
  termsSentence,
  type FoundingBadge,
} from './founding.models';

/**
 * The badge's words (notes plan N3b, the plan's section 1): a coach is never called verified,
 * certified, qualified, licensed or approved on a screen. This reads every template the rows added or
 * changed as it is written (N11b's grant sheet and the owner's Billing page too), and the words the
 * screens draw from code (N8's price guarantee among them), and refuses those words whole, so the
 * badge's own line ("Not a check of qualifications") still passes.
 */
const NEVER = /\b(verified|certified|qualified|licensed|approved)\b/i;

const TEMPLATES: Record<string, string> = {
  'platform-space.html': platformSpace,
  'platform-admin.html': platformAdmin,
  'platform-client-grant.html': clientGrant,
  'platform-founding-mark.html': foundingMark,
  'platform-founding-end.html': foundingEnd,
  'platform-founding-terms.html': foundingTerms,
  'account-founding.html': accountFounding,
  'client-account.html': clientAccount,
  'billing.html': billingPage,
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
      ...[null, 5].flatMap((plan) =>
        termsFields(plan).flatMap((field) => [
          field.label,
          field.help,
          field.missing ?? '',
          field.range ?? '',
        ]),
      ),
      ...Object.values(markErrors({ foundingSince: '', note: '' }, '2026-10-09')).flat(),
      ...Object.values(markErrors({ foundingSince: '2026-10-10', note: '' }, '2026-10-09')).flat(),
      ...Object.values(markErrors({ foundingSince: '1999-12-31', note: 'x' }, '2026-10-09')).flat(),
      ...Object.values(endErrors({ reason: '' })).flat(),
      ...Object.values(
        termsErrors({
          clientsWithActivePlan: null,
          monthsSinceStart: 99,
          foundingSeatIncludedClients: 1_001,
          priceGuaranteeMonths: 121,
          note: 'x'.repeat(501),
        }),
      ).flat(),
      // The founding seat and extra included clients (notes plan N11b).
      foundingSeatLine(null),
      foundingSeatLine(13),
      markSeatSentence(null, null),
      ...[null, 13].flatMap((seat) =>
        [null, 5, 20].flatMap((plan) => [
          markSeatSentence(termsVersion({ foundingSeatIncludedClients: seat }), plan),
          termsSeatSentence(termsVersion({ foundingSeatIncludedClients: seat }), plan),
        ]),
      ),
      ...includedClientSentences(
        13,
        [
          {
            clients: 7,
            startsOn: '2026-09-01',
            lastDay: '2026-11-30',
            endsOnExclusive: '2026-12-01',
            startsLater: false,
          },
          {
            clients: 1,
            startsOn: '2026-12-01',
            lastDay: '2027-02-28',
            endsOnExclusive: '2027-03-01',
            startsLater: true,
          },
        ],
        'en-US',
      ),
      ...billLines(
        amounts({ includedClients: 34, foundingIncludedClients: 8, grantedIncludedClients: 11 }),
        'en-US',
      ).map((line) => line.label),
      ...Object.values(
        clientGrantErrors({ clients: 0, startsOn: '2026-11-15', lastDay: '2026-12-30', note: '' }),
      ).flat(),
      ...Object.values(
        clientGrantErrors({ clients: null, startsOn: '', lastDay: '', note: 'x'.repeat(201) }),
      ).flat(),
      ...[1, 7].flatMap((clients) =>
        Object.values(revokeGrantQuestion(clients, 'Sep 1, 2026', 'Nov 30, 2026')),
      ),
      invoiceUsage(invoice({ foundingSeatIncludedClients: 13, foundingTermsVersion: 2 })),
      // The price guarantee (notes plan N8): the list, the mark sheet, the admin's space page and the
      // owner's Billing page; the months and days are this test's own.
      markGuaranteeSentence(null),
      ...[null, 0, 1, 5].flatMap((months) => [
        termsGuaranteeSentence(months),
        markGuaranteeSentence(termsVersion({ priceGuaranteeMonths: months })),
      ]),
      priceHoldLine(1, 'Dec 31, 2026'),
      pricesHeldSentence('2026-12-31', 'en-US') ?? '',
      // The price plan sheet's line on founding spaces and the toast after publishing: the terms
      // not read, no months published, none after the last discount, and some.
      ...[undefined, null, 0, 5].flatMap((months) => [
        planGuaranteeSentence(months) ?? '',
        planPublishedSentence(3, months),
      ]),
    ];
    expect(sentences.length).toBeGreaterThan(40);
    expect(sentences, 'A held day gives the owner’s sentence, so it is read too.').toContain(
      'Your prices are held until Dec 31, 2026.',
    );
    expect(sentences, 'Both of the plan sheet’s sentences and all three toasts are read.').toEqual(
      expect.arrayContaining([
        'No guarantee months are published yet, so founding spaces are billed at the new version too.',
        'Founding spaces keep their version until their guarantee ends.',
        'Price plan version 3 is published. Invoices issued from now on use it.',
        'Price plan version 3 is published. Invoices issued from now on use it, founding spaces’ too: no guarantee months are published.',
        'Price plan version 3 is published. Invoices issued from now on use it; a founding space keeps its version until its guarantee ends.',
      ]),
    );
    for (const sentence of sentences) expect(sentence).not.toMatch(NEVER);
  });
});
