import { describe, expect, it } from 'vitest';
import type { FoundingTermsView } from '../../core/api/generated';
import {
  adminProgressLine,
  clientCount,
  currentFoundingTerms,
  foundingSeatLine,
  markGuaranteeSentence,
  markSeatSentence,
  markTermsSentence,
  monthCount,
  ownerProgressLine,
  ownerTermsSentence,
  planGuaranteeSentence,
  planPublishedSentence,
  priceHoldLine,
  showsFoundingPage,
  termsGuaranteeSentence,
  termsSeatSentence,
  termsSentence,
  toAdminFounding,
  toFoundingBadge,
  toFoundingTerms,
  type FoundingBadge,
  type FoundingTerms,
} from './founding.models';

const waiting = (overrides: Partial<FoundingBadge> = {}): FoundingBadge => ({
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

const terms = (overrides: Partial<FoundingTerms> = {}): FoundingTerms => ({
  id: 'terms-1',
  versionNumber: 1,
  clientsWithActivePlan: 10,
  monthsSinceStart: 2,
  note: null,
  publishedAtUtc: '2026-09-01T00:00:00Z',
  isCurrent: true,
  foundingSeatIncludedClients: null,
  priceGuaranteeMonths: null,
  ...overrides,
});

describe('The Founding coach badge as the screens read it (notes plan N3b)', () => {
  it('reads the server’s badge with its numbers as numbers and its nulls kept', () => {
    expect(
      toFoundingBadge({
        state: 'Waiting',
        foundingSince: '2026-09-15',
        clientsWithActivePlan: '7',
        clientsNeeded: '10',
        monthsSinceStart: '1',
        monthsNeeded: '2',
        termsVersion: '1',
        earnedOn: null,
        endedOn: null,
        hidden: false,
      }),
    ).toEqual(waiting());
    expect(
      toFoundingBadge({
        state: 'NotFounding',
        foundingSince: null,
        clientsWithActivePlan: null,
        clientsNeeded: 10,
        monthsSinceStart: null,
        monthsNeeded: 2,
        termsVersion: 1,
        earnedOn: null,
        endedOn: null,
        hidden: false,
      }),
    ).toMatchObject({ state: 'NotFounding', clientsWithActivePlan: null, monthsSinceStart: null });
  });

  it('reads a version of the terms, and finds the one in force', () => {
    const view: FoundingTermsView = {
      id: 'terms-2',
      versionNumber: '2',
      clientsWithActivePlan: '12',
      monthsSinceStart: '3',
      note: null,
      publishedAtUtc: '2026-10-01T00:00:00Z',
      isCurrent: true,
      foundingSeatIncludedClients: '13',
      priceGuaranteeMonths: '5',
    };
    expect(toFoundingTerms(view)).toEqual(
      terms({
        id: 'terms-2',
        versionNumber: 2,
        clientsWithActivePlan: 12,
        monthsSinceStart: 3,
        publishedAtUtc: '2026-10-01T00:00:00Z',
        foundingSeatIncludedClients: 13,
        priceGuaranteeMonths: 5,
      }),
    );
    // Notes plan N8: no months published stays none, and no months after the last discount stays 0,
    // which is a guarantee (the prices are held while the discounts run), not none.
    expect(
      toFoundingTerms({ ...view, priceGuaranteeMonths: null }).priceGuaranteeMonths,
    ).toBeNull();
    expect(toFoundingTerms({ ...view, priceGuaranteeMonths: '0' }).priceGuaranteeMonths).toBe(0);
    expect(toFoundingTerms({ ...view, priceGuaranteeMonths: 11 }).priceGuaranteeMonths).toBe(11);
    const older = terms({ isCurrent: false });
    const newer = terms({ id: 'terms-2', versionNumber: 2, isCurrent: true });
    expect(currentFoundingTerms([older, newer])).toBe(newer);
    expect(currentFoundingTerms([older])).toBe(older);
    expect(currentFoundingTerms([])).toBeNull();
  });

  it('lists the owner’s page only while the badge waits or once it is earned', () => {
    expect(showsFoundingPage('Waiting')).toBe(true);
    expect(showsFoundingPage('Earned')).toBe(true);
    expect(showsFoundingPage('Ended')).toBe(false);
    expect(showsFoundingPage('NotFounding')).toBe(false);
    expect(showsFoundingPage(null)).toBe(false);
    expect(showsFoundingPage(undefined)).toBe(false);
  });

  it('says one or many, as every number the terms allow needs', () => {
    expect(clientCount(1)).toBe('1 client');
    expect(clientCount(10)).toBe('10 clients');
    expect(monthCount(1)).toBe('1 month');
    expect(monthCount(0)).toBe('0 months');
    expect(monthCount(2)).toBe('2 months');
  });

  it('words the terms in force for the mark sheet, the list and the owner', () => {
    expect(markTermsSentence(10, 2)).toBe(
      'The badge is earned once 10 of the space’s clients have an active plan and the space is 2 months old (the terms in force).',
    );
    expect(markTermsSentence(1, 1)).toBe(
      'The badge is earned once 1 of the space’s clients has an active plan and the space is 1 month old (the terms in force).',
    );
    expect(markTermsSentence(1, 0)).toBe(
      'The badge is earned once 1 of the space’s clients has an active plan (the terms in force).',
    );
    expect(termsSentence(10, 2)).toBe(
      'Earned once 10 of a founding space’s clients have an active plan and the space is 2 months old.',
    );
    expect(termsSentence(12, 0)).toBe(
      'Earned once 12 of a founding space’s clients have an active plan.',
    );
    expect(ownerTermsSentence(10, 2)).toBe(
      'The badge is earned once 10 of your clients have an active plan and your space is 2 months old.',
    );
    expect(ownerTermsSentence(1, 0)).toBe(
      'The badge is earned once 1 of your clients has an active plan.',
    );
  });

  it('says where a waiting badge stands, from the server’s counts', () => {
    expect(ownerProgressLine(waiting())).toBe('So far: 7 of 10 clients, 1 of 2 months.');
    expect(ownerProgressLine(waiting({ clientsNeeded: 1, clientsWithActivePlan: 0 }))).toBe(
      'So far: 0 of 1 client, 1 of 2 months.',
    );
    expect(ownerProgressLine(waiting({ monthsNeeded: 0, monthsSinceStart: 2 }))).toBe(
      'So far: 7 of 10 clients.',
    );
    expect(adminProgressLine(waiting())).toBe(
      'Badge: 7 of 10 clients with an active plan right now · 1 of 2 months since the space started.',
    );
    expect(adminProgressLine(waiting({ monthsNeeded: 1, monthsSinceStart: 0 }))).toBe(
      'Badge: 7 of 10 clients with an active plan right now · 0 of 1 month since the space started.',
    );
    expect(adminProgressLine(waiting({ monthsNeeded: 0 }))).toBe(
      'Badge: 7 of 10 clients with an active plan right now.',
    );
  });

  // Notes plan N11b: the founding seat in words, from the server's number; the larger of it and the
  // price plan's seat applies (PBL-011), so a number at or below the plan's reads as the plan's seat.
  it('words what a founding owner’s seat includes, for the space page, the mark sheet and the list', () => {
    const terms = (seat: number | null): FoundingTerms => ({
      id: 'terms-2',
      versionNumber: 2,
      clientsWithActivePlan: 10,
      monthsSinceStart: 2,
      note: null,
      publishedAtUtc: '2026-11-01T00:00:00Z',
      isCurrent: true,
      foundingSeatIncludedClients: seat,
      priceGuaranteeMonths: null,
    });
    const plan =
      'what the price plan’s seat includes: no founding number above it is published yet.';

    expect(foundingSeatLine(13)).toBe(
      'Its owner’s seat includes 13 clients while it stays founding.',
    );
    expect(foundingSeatLine(1)).toBe('Its owner’s seat includes 1 client while it stays founding.');
    expect(foundingSeatLine(null)).toBe(`Its owner’s seat includes ${plan}`);

    const marking =
      'Marking changes no access. While the space stays founding, its owner’s seat includes';
    expect(markSeatSentence(terms(13), 5)).toBe(`${marking} 13 clients (the terms in force).`);
    expect(markSeatSentence(terms(13), null)).toBe(`${marking} 13 clients (the terms in force).`);
    expect(markSeatSentence(terms(5), 5)).toBe(`${marking} ${plan}`);
    expect(markSeatSentence(terms(null), 5)).toBe(`${marking} ${plan}`);
    expect(markSeatSentence(null, 5)).toBe(
      `${marking} what the terms in force give a founding seat.`,
    );

    expect(termsSeatSentence(terms(13), 5)).toBe(
      'A founding space’s owner seat includes 13 clients.',
    );
    expect(termsSeatSentence(terms(4), 5)).toBe(`A founding space’s owner seat includes ${plan}`);
    expect(termsSeatSentence(terms(null), null)).toBe(
      `A founding space’s owner seat includes ${plan}`,
    );
  });

  // Notes plan N8: the price guarantee in words, from the server's months. None published holds no
  // price; 0 holds it while the discounts run; the months count from the last discount's last day, or
  // from the founding day of a space with no discount. The months are this test's own.
  it('words the price guarantee in the terms in force, for the list', () => {
    expect(termsGuaranteeSentence(null)).toBe(
      'A founding space’s prices are not held: no guarantee months are published yet.',
    );
    expect(termsGuaranteeSentence(0)).toBe(
      'A founding space keeps its plan version until its last discount ends; with no discount, only for its founding month.',
    );
    expect(termsGuaranteeSentence(1)).toBe(
      'A founding space keeps its plan version until 1 month after its last discount ends, or after its founding day when it has none.',
    );
    expect(termsGuaranteeSentence(5)).toBe(
      'A founding space keeps its plan version until 5 months after its last discount ends, or after its founding day when it has none.',
    );
  });

  it('words the price guarantee for the mark sheet, about the space being marked', () => {
    expect(markGuaranteeSentence(null)).toBe(
      'The space keeps its plan version for as long as the terms in force say.',
    );
    expect(markGuaranteeSentence(terms({ priceGuaranteeMonths: null }))).toBe(
      'The space’s prices are not held: no guarantee months are published yet.',
    );
    expect(markGuaranteeSentence(terms({ priceGuaranteeMonths: 0 }))).toBe(
      'The space keeps its plan version until its last discount ends; with no discount, only for its founding month.',
    );
    expect(markGuaranteeSentence(terms({ priceGuaranteeMonths: 1 }))).toBe(
      'The space keeps its plan version until 1 month after its last discount ends, or after its founding day when it has none.',
    );
    expect(markGuaranteeSentence(terms({ priceGuaranteeMonths: 7 }))).toBe(
      'The space keeps its plan version until 7 months after its last discount ends, or after its founding day when it has none.',
    );
    // The months alone decide the sentence: the badge's thresholds and the founding seat change nothing.
    expect(
      markGuaranteeSentence(
        terms({ monthsSinceStart: 0, foundingSeatIncludedClients: 13, priceGuaranteeMonths: 7 }),
      ),
    ).toBe(markGuaranteeSentence(terms({ priceGuaranteeMonths: 7 })));
  });

  // A new price plan version reaches a founding space only when nothing holds its prices: the sheet
  // may promise "keep their version" only while the terms in force name guarantee months, 0 included.
  it('words what a new price plan version means for founding spaces, on the price plan sheet', () => {
    // The terms not read: the sheet says nothing of founding spaces, rather than guess.
    expect(planGuaranteeSentence(undefined)).toBeNull();
    expect(planGuaranteeSentence(null)).toBe(
      'No guarantee months are published yet, so founding spaces are billed at the new version too.',
    );
    expect(planGuaranteeSentence(0)).toBe(
      'Founding spaces keep their version until their guarantee ends.',
    );
    expect(planGuaranteeSentence(1)).toBe(
      'Founding spaces keep their version until their guarantee ends.',
    );
    expect(planGuaranteeSentence(11)).toBe(
      'Founding spaces keep their version until their guarantee ends.',
    );
    // With no months published, nothing in the sentence says a version is kept.
    expect(planGuaranteeSentence(null)).not.toContain('keep');
  });

  it('words the toast after a price plan version is published, with the same account of founding spaces', () => {
    expect(planPublishedSentence(3, undefined)).toBe(
      'Price plan version 3 is published. Invoices issued from now on use it.',
    );
    expect(planPublishedSentence(3, null)).toBe(
      'Price plan version 3 is published. Invoices issued from now on use it, founding spaces’ too: no guarantee months are published.',
    );
    expect(planPublishedSentence(3, 0)).toBe(
      'Price plan version 3 is published. Invoices issued from now on use it; a founding space keeps its version until its guarantee ends.',
    );
    expect(planPublishedSentence(3, 5)).toBe(
      'Price plan version 3 is published. Invoices issued from now on use it; a founding space keeps its version until its guarantee ends.',
    );
    // The version is the one published, whatever the months.
    expect(planPublishedSentence(14, undefined)).toBe(
      'Price plan version 14 is published. Invoices issued from now on use it.',
    );
    expect(planPublishedSentence(14, null)).toBe(
      'Price plan version 14 is published. Invoices issued from now on use it, founding spaces’ too: no guarantee months are published.',
    );
    expect(planPublishedSentence(14, 11)).toBe(
      'Price plan version 14 is published. Invoices issued from now on use it; a founding space keeps its version until its guarantee ends.',
    );
    for (const months of [undefined, null]) {
      expect(planPublishedSentence(3, months)).not.toContain('keeps its version');
    }
  });

  it('says for the admin which plan version a founding space is held at, and until the day it is given', () => {
    expect(priceHoldLine(1, 'Dec 31, 2026')).toBe(
      'Prices held at plan version 1 until Dec 31, 2026.',
    );
    expect(priceHoldLine(14, '30 Apr 2027')).toBe(
      'Prices held at plan version 14 until 30 Apr 2027.',
    );
  });

  it('reads the admin’s founding view with what its owner’s seat includes, or none', () => {
    const view = {
      status: {
        id: 'founding-1',
        foundingSince: '2026-09-15',
        note: 'One of the first coaches',
        markedAtUtc: '2026-09-15T10:00:00Z',
        earnedOn: null,
        earnedUnderTermsVersion: null,
        earnedClientCount: null,
        badgeHidden: false,
        endedAtUtc: null,
        endReason: null,
      },
      badge: {
        state: 'Waiting' as const,
        foundingSince: '2026-09-15',
        clientsWithActivePlan: '7',
        clientsNeeded: '10',
        monthsSinceStart: '1',
        monthsNeeded: '2',
        termsVersion: '2',
        earnedOn: null,
        endedOn: null,
        hidden: false,
      },
    };
    expect(
      toAdminFounding({ ...view, foundingSeatIncludedClients: '13' }).foundingSeatIncludedClients,
    ).toBe(13);
    expect(
      toAdminFounding({ ...view, foundingSeatIncludedClients: null }).foundingSeatIncludedClients,
    ).toBeNull();
  });
});
