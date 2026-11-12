import { describe, expect, it } from 'vitest';
import {
  adminProgressLine,
  clientCount,
  currentFoundingTerms,
  foundingSeatLine,
  markSeatSentence,
  markTermsSentence,
  monthCount,
  ownerProgressLine,
  ownerTermsSentence,
  showsFoundingPage,
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
    expect(
      toFoundingTerms({
        id: 'terms-2',
        versionNumber: '2',
        clientsWithActivePlan: '12',
        monthsSinceStart: '3',
        note: null,
        publishedAtUtc: '2026-10-01T00:00:00Z',
        isCurrent: true,
        foundingSeatIncludedClients: '13',
      }),
    ).toEqual(
      terms({
        id: 'terms-2',
        versionNumber: 2,
        clientsWithActivePlan: 12,
        monthsSinceStart: 3,
        publishedAtUtc: '2026-10-01T00:00:00Z',
        foundingSeatIncludedClients: 13,
      }),
    );
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
