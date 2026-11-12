import { describe, expect, it } from 'vitest';
import { foundingTerms } from '../../../testing/platform-admin-fixtures';
import {
  endErrors,
  endPresets,
  FOUNDING_EARLIEST_DAY,
  markErrors,
  termsChanges,
  termsEntryFrom,
  termsErrors,
  termsFields,
  toPublishTermsRequest,
} from './platform-founding.models';

const TODAY = '2026-10-09';

describe('What the founding sheets check before they send (notes plan N3b)', () => {
  it('takes a founding day from 1 January 2000 to today, in the server’s words', () => {
    const note = 'One of the first ten coaches';
    expect(markErrors({ foundingSince: TODAY, note }, TODAY)).toEqual({});
    expect(markErrors({ foundingSince: FOUNDING_EARLIEST_DAY, note }, TODAY)).toEqual({});
    expect(markErrors({ foundingSince: '2026-10-10', note }, TODAY)).toEqual({
      foundingSince: ['Choose today or an earlier day.'],
    });
    expect(markErrors({ foundingSince: '1999-12-31', note }, TODAY)).toEqual({
      foundingSince: ['Choose a day from 1 January 2000 to today.'],
    });
    expect(markErrors({ foundingSince: '', note }, TODAY)).toEqual({
      foundingSince: ['Choose the day the coaching space became founding.'],
    });
  });

  it('asks what the status is for, from 1 to 200 characters once trimmed', () => {
    const refused = { note: ['Say what the founding status is for, in up to 200 characters.'] };
    expect(markErrors({ foundingSince: TODAY, note: '   ' }, TODAY)).toEqual(refused);
    expect(markErrors({ foundingSince: TODAY, note: 'x'.repeat(201) }, TODAY)).toEqual(refused);
    expect(markErrors({ foundingSince: TODAY, note: ` ${'x'.repeat(200)} ` }, TODAY)).toEqual({});
  });

  it('asks why a status ends, from 1 to 500 characters, and offers the plan’s three causes', () => {
    const refused = { reason: ['Say why the founding status ends, in up to 500 characters.'] };
    expect(endErrors({ reason: '' })).toEqual(refused);
    expect(endErrors({ reason: 'x'.repeat(501) })).toEqual(refused);
    expect(endErrors({ reason: 'x'.repeat(500) })).toEqual({});
    expect(endPresets()).toEqual([
      'Misrepresented qualifications',
      'Harm to clients',
      'The coach asked to end it',
    ]);
    for (const preset of endPresets()) expect(endErrors({ reason: preset })).toEqual({});
  });

  it('takes the badge’s terms as whole numbers in the server’s ranges, never a missing one as 0', () => {
    const entry = termsEntryFrom(foundingTerms());
    expect(entry).toEqual({
      clientsWithActivePlan: 10,
      monthsSinceStart: 2,
      foundingSeatIncludedClients: null,
      note: '',
    });
    expect(termsErrors(entry)).toEqual({});
    expect(termsErrors({ ...entry, clientsWithActivePlan: 1, monthsSinceStart: 0 })).toEqual({});
    expect(termsErrors({ ...entry, clientsWithActivePlan: 1000, monthsSinceStart: 24 })).toEqual(
      {},
    );
    expect(
      termsErrors({
        clientsWithActivePlan: null,
        monthsSinceStart: null,
        foundingSeatIncludedClients: null,
        note: 'x'.repeat(501),
      }),
    ).toEqual({
      clientsWithActivePlan: ['Enter how many clients with an active plan earn the badge.'],
      monthsSinceStart: ['Enter how many whole months since the space started earn the badge.'],
      note: ['Keep the note to 500 characters.'],
    });
    expect(termsErrors({ ...entry, clientsWithActivePlan: 0, monthsSinceStart: 25 })).toEqual({
      clientsWithActivePlan: ['Enter a whole number from 1 to 1000.'],
      monthsSinceStart: ['Enter a whole number from 0 to 24.'],
    });
    expect(termsErrors({ ...entry, clientsWithActivePlan: 2.5, monthsSinceStart: 1.5 })).toEqual({
      clientsWithActivePlan: ['Enter a whole number from 1 to 1000.'],
      monthsSinceStart: ['Enter a whole number from 0 to 24.'],
    });
  });

  // Notes plan N11b: the founding seat's number, 0 to 1,000 or none (an empty box), in the server's words.
  it('takes the founding seat’s clients from 0 to 1000 or none, and marks a box it could not read', () => {
    const entry = termsEntryFrom(foundingTerms({ foundingSeatIncludedClients: 13 }));
    expect(entry.foundingSeatIncludedClients).toBe(13);
    for (const clients of [null, 0, 13, 1000]) {
      expect(termsErrors({ ...entry, foundingSeatIncludedClients: clients })).toEqual({});
    }
    const range = [
      'Enter a whole number of clients from 0 to 1000, or none for what the price plan’s seat includes.',
    ];
    for (const clients of [-1, 1001, 2.5, Number.NaN]) {
      expect(termsErrors({ ...entry, foundingSeatIncludedClients: clients })).toEqual({
        foundingSeatIncludedClients: range,
      });
    }
  });

  it('says what would change, and publishes against the version it saw', () => {
    const current = foundingTerms({ versionNumber: 3 });
    expect(termsChanges(current, termsEntryFrom(current))).toEqual([]);
    expect(
      termsChanges(current, {
        clientsWithActivePlan: 12,
        monthsSinceStart: 2,
        foundingSeatIncludedClients: null,
        note: 'Why',
      }),
    ).toEqual([
      { key: 'clientsWithActivePlan', label: 'Clients with an active plan', from: '10', to: '12' },
    ]);
    expect(
      toPublishTermsRequest(
        {
          clientsWithActivePlan: 12,
          monthsSinceStart: 3,
          foundingSeatIncludedClients: null,
          note: '  ',
        },
        current,
      ),
    ).toEqual({
      clientsWithActivePlan: 12,
      monthsSinceStart: 3,
      note: null,
      expectedCurrentVersion: 3,
      foundingSeatIncludedClients: null,
    });
    expect(
      toPublishTermsRequest(
        {
          clientsWithActivePlan: 12,
          monthsSinceStart: 3,
          foundingSeatIncludedClients: 13,
          note: ' After the talks ',
        },
        current,
      ).note,
    ).toBe('After the talks');
  });

  it('sends the founding seat’s number as the box holds it, and names it going to none as a change', () => {
    const current = foundingTerms({ versionNumber: 3, foundingSeatIncludedClients: 13 });
    const kept = termsEntryFrom(current);
    // The box starts with the version in force's number, so new thresholds alone never drop it.
    expect(
      toPublishTermsRequest({ ...kept, clientsWithActivePlan: 12 }, current)
        .foundingSeatIncludedClients,
    ).toBe(13);
    expect(
      toPublishTermsRequest({ ...kept, foundingSeatIncludedClients: 27 }, current)
        .foundingSeatIncludedClients,
    ).toBe(27);
    expect(
      toPublishTermsRequest({ ...kept, foundingSeatIncludedClients: null }, current)
        .foundingSeatIncludedClients,
    ).toBeNull();
    expect(termsChanges(current, { ...kept, foundingSeatIncludedClients: 27 })).toEqual([
      {
        key: 'foundingSeatIncludedClients',
        label: 'Clients a founding owner’s seat includes',
        from: '13',
        to: '27',
      },
    ]);
    expect(termsChanges(current, { ...kept, foundingSeatIncludedClients: null })).toEqual([
      {
        key: 'foundingSeatIncludedClients',
        label: 'Clients a founding owner’s seat includes',
        from: '13',
        to: 'None',
      },
    ]);
    expect(
      termsChanges(foundingTerms(), {
        ...termsEntryFrom(foundingTerms()),
        foundingSeatIncludedClients: 13,
      }),
    ).toEqual([
      {
        key: 'foundingSeatIncludedClients',
        label: 'Clients a founding owner’s seat includes',
        from: 'None',
        to: '13',
      },
    ]);
  });

  it('puts the price plan’s seat in the founding seat’s help, since the larger applies', () => {
    const seat = (plan: number | null) =>
      termsFields(plan).find((field) => field.key === 'foundingSeatIncludedClients')!;
    expect(seat(5).help).toBe(
      'The price plan’s seat includes 5 clients; the larger applies. Leave it empty for none; a space already founding keeps the highest number it has had.',
    );
    expect(seat(null).help).toBe(
      'The price plan’s seat applies when it includes more. Leave it empty for none; a space already founding keeps the highest number it has had.',
    );
    expect(seat(5).missing, 'An empty box is none, never a missing number.').toBeNull();
    expect(termsFields().map((field) => field.key)).toEqual([
      'clientsWithActivePlan',
      'monthsSinceStart',
      'foundingSeatIncludedClients',
    ]);
  });
});
