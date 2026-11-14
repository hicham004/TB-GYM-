import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { houseListing, templateSummary } from '../../../testing/program-builder-fixtures';
import {
  listingRow,
  listingTerms,
  nothingToOffer,
  notTheHouse,
  offerableTemplates,
  offerRefusal,
  offerRequest,
  roundingHint,
  roundingLine,
  singleSpaced,
  startedWords,
  termsErrors,
  toHouseListing,
  withdrawRefusal,
  type ListingTerms,
} from './house-listings.models';

const terms = (overrides: Partial<ListingTerms> = {}): ListingTerms => ({
  suits: 'Beginners',
  runName: '',
  runPosition: null,
  loadIncrement: 2.5,
  loadRoundingMode: 'Nearest',
  ...overrides,
});

const conflict = (code: string, message = 'Training data was changed by another request.') =>
  new HttpErrorResponse({ status: 409, error: { code, message } });

describe('TB Gym’s programs for trainees, as its staff mark them (notes plan N9c4)', () => {
  it('turns the server’s numbers, sent as text or numbers, into numbers', () => {
    const listing = toHouseListing(
      houseListing({
        weeks: '4',
        runPosition: '2',
        loadIncrement: '1.25',
        timesStarted: '7',
        version: '12',
      }),
    );
    expect([
      listing.weeks,
      listing.runPosition,
      listing.loadIncrement,
      listing.timesStarted,
      listing.version,
    ]).toEqual([4, 2, 1.25, 7, 12]);
    expect(listing.name).toBe('Strength base');
    expect(
      toHouseListing(houseListing({ weeks: null, runPosition: null, templateVersionId: null })),
    ).toMatchObject({ weeks: null, runPosition: null, templateVersionId: null });
  });

  it('writes a row with its pill, block, weeks and unit, rounding and starts', () => {
    const row = listingRow(toHouseListing(houseListing()), [templateSummary()]);
    expect(row).toMatchObject({
      name: 'Strength base',
      link: ['/training/programs', 'template-1'],
      offered: true,
      pill: { label: 'Offered', tone: 'success' },
      block: 'Block 1 of Foundations',
      suits: 'New to the barbell, two days a week.',
      weeks: '2 weeks · kg',
      rounding: 'Loads rounded to 2.5 kg, nearest',
      started: 'Started 2 times',
      archived: false,
      mixesUnits: false,
      editLabel: 'Edit for trainees, Strength base',
      withdrawLabel: 'Withdraw, Strength base',
      offerAgainLabel: 'Offer again, Strength base',
    });
  });

  it('says a withdrawn, archived, never-started program on its own, in pounds, rounding up', () => {
    const row = listingRow(
      toHouseListing(
        houseListing({
          isOffered: false,
          runName: null,
          runPosition: null,
          weeks: 1,
          loadUnit: 'Pound',
          loadIncrement: 5,
          loadRoundingMode: 'Up',
          timesStarted: 0,
        }),
      ),
      [templateSummary({ isArchived: true })],
    );
    expect(row).toMatchObject({
      pill: { label: 'Withdrawn', tone: 'neutral' },
      block: null,
      weeks: '1 week · lb',
      rounding: 'Loads rounded to 5 lb, up',
      started: 'Not started yet',
      archived: true,
    });
  });

  it('leaves the unit out of a program mixing kg and lb, and says one never published', () => {
    const mixing = listingRow(
      toHouseListing(
        houseListing({ mixesUnits: true, loadUnit: null, loadRoundingMode: 'Down', weeks: 3 }),
      ),
      [],
    );
    expect([mixing.weeks, mixing.rounding, mixing.mixesUnits, mixing.archived]).toEqual([
      '3 weeks',
      'Loads rounded to 2.5, down',
      true,
      false,
    ]);
    const never = listingRow(
      toHouseListing(houseListing({ templateVersionId: null, weeks: null, loadUnit: null })),
      [],
    );
    expect(never.weeks).toBe('Not published yet');
  });

  it('counts starts in words', () => {
    expect([0, 1, 5].map(startedWords)).toEqual([
      'Not started yet',
      'Started once',
      'Started 5 times',
    ]);
  });

  it('writes the folded rounding’s hint as Assign program does', () => {
    expect(roundingHint(2.5, 'Nearest', 'Kilogram')).toBe('kg · rounded to the nearest 2.5');
    expect(roundingHint(5, 'Down', 'Pound')).toBe('lb · rounded down 5');
    expect(roundingHint(1, 'Up', null)).toBe('rounded up 1');
    expect(roundingHint(null, 'Up', 'Kilogram')).toBe('kg');
    expect(roundingLine(1.25, 'Nearest', null)).toBe('Loads rounded to 1.25, nearest');
  });

  it('offers published programs not archived and not listed, even withdrawn', () => {
    const unpublished = templateSummary({
      id: 'template-draft',
      name: 'Draft only',
      versions: [
        {
          id: 'v',
          versionNumber: 1,
          name: 'Draft only',
          isPublished: false,
          weekCount: 1,
          createdAtUtc: '2026-10-01T09:00:00Z',
        },
      ],
    });
    const archived = templateSummary({ id: 'template-old', name: 'Old', isArchived: true });
    const free = templateSummary({ id: 'template-3', name: 'Upper lower' });
    const listed = [toHouseListing(houseListing({ isOffered: false }))];
    const templates = [templateSummary(), unpublished, archived, free];

    expect(offerableTemplates(templates, listed).map((template) => template.id)).toEqual([
      'template-3',
    ]);
    expect(nothingToOffer(templates, listed)).toBeNull();
    expect(nothingToOffer([templateSummary()], listed)).toBe(
      'Every published program is listed here already.',
    );
    expect(nothingToOffer([unpublished, archived], [])).toBe('Publish a program first.');
    expect(nothingToOffer([], [])).toBe('Publish a program first.');
  });

  it('checks the terms as the server does, in its words', () => {
    expect(termsErrors(terms())).toEqual({});
    expect(termsErrors(terms({ suits: '   ' }))).toEqual({
      suits: ['Say in one line whom this program suits.'],
    });
    expect(termsErrors(terms({ suits: 'x'.repeat(201) }))['suits']).toEqual([
      'Keep whom it suits to 200 characters or fewer.',
    ]);
    expect(termsErrors(terms({ suits: ` ${'x'.repeat(200)} ` }))).toEqual({});
    // The run's name is counted single-spaced, as the server keeps it.
    expect(
      termsErrors(terms({ runName: `${'a'.repeat(40)}    ${'b'.repeat(39)}`, runPosition: 1 })),
    ).toEqual({});
    expect(termsErrors(terms({ runName: 'r'.repeat(81), runPosition: 1 }))).toEqual({
      runName: ['Keep the run’s name to 80 characters or fewer.'],
    });
  });

  it('asks for a whole block number from 1 to 52 beside a run, and a run beside a block number', () => {
    expect(termsErrors(terms({ runName: 'Foundations' }))).toEqual({
      runPosition: ['Say which block of the run this is: 1 for the first.'],
    });
    for (const place of [0, 53, 1.5, -1]) {
      expect(termsErrors(terms({ runName: 'Foundations', runPosition: place }))).toEqual({
        runPosition: ['A block’s place in its run is a whole number from 1 to 52.'],
      });
    }
    expect(termsErrors(terms({ runName: 'Foundations', runPosition: 52 }))).toEqual({});
    expect(termsErrors(terms({ runName: '  ', runPosition: 2 }))).toEqual({
      runName: ['Name the run this block belongs to, or leave its place empty.'],
    });
  });

  it('asks for a rounding step above 0, at most 50, with two decimals at most', () => {
    const message = ['Round loads to a step above 0 and at most 50, with two decimals at most.'];
    for (const step of [null, 0, -1, 50.01, 1.255, Number.NaN]) {
      expect(termsErrors(terms({ loadIncrement: step }))).toEqual({ loadIncrement: message });
    }
    for (const step of [0.01, 1.25, 50, 2.5]) {
      expect(termsErrors(terms({ loadIncrement: step }))).toEqual({});
    }
  });

  it('sends the terms trimmed, the run single-spaced, the rounding by its name and the version', () => {
    expect(
      offerRequest(
        terms({
          suits: '  Lifters with a year behind them. ',
          runName: '  Strength   Base ',
          runPosition: 2,
          loadIncrement: 1.25,
          loadRoundingMode: 'Down',
        }),
        4,
      ),
    ).toEqual({
      suits: 'Lifters with a year behind them.',
      runName: 'Strength Base',
      runPosition: 2,
      loadIncrement: 1.25,
      loadRoundingMode: 'Down',
      version: 4,
    });
    expect(offerRequest(terms(), null)).toEqual({
      suits: 'Beginners',
      runName: null,
      runPosition: null,
      loadIncrement: 2.5,
      loadRoundingMode: 'Nearest',
      version: null,
    });
    expect(singleSpaced('  a  b   c ')).toBe('a b c');
  });

  it('starts a new listing at the defaults, and an existing one at its terms', () => {
    expect(listingTerms(null)).toEqual({
      suits: '',
      runName: '',
      runPosition: null,
      loadIncrement: 2.5,
      loadRoundingMode: 'Nearest',
    });
    expect(listingTerms(toHouseListing(houseListing({ loadRoundingMode: 'Up' })))).toEqual({
      suits: 'New to the barbell, two days a week.',
      runName: 'Foundations',
      runPosition: 1,
      loadIncrement: 2.5,
      loadRoundingMode: 'Up',
    });
  });

  it('puts a refused term under its field, in the server’s words, camel or Pascal', () => {
    for (const field of ['suits', 'runName', 'runPosition', 'loadIncrement', 'templateId']) {
      const error = new HttpErrorResponse({
        status: 400,
        error: { errors: { [field]: [`No ${field}.`] } },
      });
      expect(offerRefusal(error, true)).toEqual({ field, message: `No ${field}.`, stale: false });
    }
    const pascal = new HttpErrorResponse({
      status: 400,
      error: { errors: { Suits: ['Say in one line whom this program suits.'] } },
    });
    expect(offerRefusal(pascal, true).field).toBe('suits');
  });

  it('says a place already taken under Block number, in the server’s words', () => {
    const message =
      '"Upper lower" is already block 2 of Foundations. Give this one another place, or withdraw that one first.';
    expect(offerRefusal(conflict('house_program_run_position_taken', message), true)).toEqual({
      field: 'runPosition',
      message,
      stale: false,
    });
  });

  it('says a change made meanwhile in its own words and marks the list out of date', () => {
    const changed = {
      field: null,
      message: 'Someone changed this program’s terms meanwhile. Read them again.',
      stale: true,
    };
    expect(offerRefusal(conflict('concurrency_conflict'), false)).toEqual(changed);
    expect(withdrawRefusal(conflict('concurrency_conflict'))).toEqual({
      message: changed.message,
      stale: true,
    });
    const gone = new HttpErrorResponse({ status: 404 });
    expect(offerRefusal(gone, true)).toEqual({
      field: null,
      message: 'This program isn’t listed here any more. The list has been read again.',
      stale: true,
    });
    expect(withdrawRefusal(gone).stale).toBe(true);
  });

  it('says a read-only space, a lost connection and anything else', () => {
    const readOnly = new HttpErrorResponse({
      status: 403,
      error: { code: 'workspace_read_only', message: 'Read only.' },
    });
    const words =
      'Your coaching space is read-only until its TB Gym bill is paid. You can still view everything.';
    expect(offerRefusal(readOnly, true)).toEqual({ field: null, message: words, stale: false });
    expect(withdrawRefusal(readOnly)).toEqual({ message: words, stale: false });
    const offline = new HttpErrorResponse({ status: 0 });
    expect(offerRefusal(offline, true).message).toBe(
      'The app couldn’t connect. Check your connection and try again.',
    );
    const broken = new HttpErrorResponse({ status: 500 });
    expect(offerRefusal(broken, true).message).toBe('The program couldn’t be offered. Try again.');
    expect(offerRefusal(broken, false).message).toBe('Your changes couldn’t be saved. Try again.');
    expect(withdrawRefusal(broken).message).toBe('The program couldn’t be withdrawn. Try again.');
  });

  it('reads a 404 of the list as another space', () => {
    expect(notTheHouse(new HttpErrorResponse({ status: 404 }))).toBe(true);
    expect(notTheHouse(new HttpErrorResponse({ status: 500 }))).toBe(false);
    expect(notTheHouse(new Error('x'))).toBe(false);
  });
});
