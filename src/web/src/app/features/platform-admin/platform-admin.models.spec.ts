import { describe, expect, it } from 'vitest';
import {
  atlasDetail,
  discount,
  invoice,
  plan,
  platformSpaces,
  SPACE_IDS,
  space,
  TODAY,
} from '../../../testing/platform-admin-fixtures';
import {
  daysBetween,
  discountEndExclusive,
  discountErrors,
  discountLastDay,
  discountState,
  filterCounts,
  foldText,
  invoiceUsage,
  invoiceWhen,
  lastDayAfterMonths,
  matchesFilter,
  matchesQuery,
  nextLine,
  owedText,
  paymentErrors,
  paymentTermDays,
  planChanges,
  planEntryFrom,
  planErrors,
  planSummaryLine,
  planTermRows,
  seatsAndClients,
  sortInvoices,
  sortSpaces,
  statusSentence,
  summarize,
  toPublishRequest,
  trialDaysLeft,
  urgencyRank,
  utcToday,
  voidErrors,
  voidOutcome,
  type DiscountEntry,
} from './platform-admin.models';

const LOCALE = 'en-US';

const byId = (id: string) => platformSpaces().find((item) => item.tenantId === id)!;

describe('platform billing: the list', () => {
  it('takes the day in UTC, the days billing runs on', () => {
    expect(utcToday(new Date('2026-10-09T23:30:00-05:00'))).toBe('2026-10-10');
    expect(utcToday(new Date('2026-10-09T01:00:00+03:00'))).toBe('2026-10-08');
    expect(daysBetween('2026-10-09', '2026-10-12')).toBe(3);
    expect(daysBetween('2026-10-12', '2026-10-09')).toBe(-3);
    expect(daysBetween('2026-03-27', '2026-03-30')).toBe(3);
  });

  it('puts the space that needs the admin first: locked, overdue, owing, a trial ending, paid up, a trial with time', () => {
    const names = sortSpaces(platformSpaces(), TODAY).map((item) => item.name);

    expect(names).toEqual([
      'Cedar Barbell Club',
      'Atlas Performance',
      'Beirut Barbell',
      'Strength Lab',
      'Nour Fitness',
      'نادي الأرز',
      'Maya Rahme Coaching',
    ]);
    const ranks = sortSpaces(platformSpaces(), TODAY).map((item) => urgencyRank(item, TODAY));
    expect(ranks).toEqual([0, 1, 2, 3, 4, 4, 5]);
  });

  it('orders spaces of the same rank by the earliest lock, due day or trial end', () => {
    const later = space({
      tenantId: 'later',
      name: 'Aaa Later',
      status: 'Overdue',
      unpaidTotal: 10,
      oldestUnpaidDueOn: '2026-10-07',
      readOnlyFrom: '2026-10-14',
    });
    const earlier = space({
      tenantId: 'earlier',
      name: 'Zzz Earlier',
      status: 'Overdue',
      unpaidTotal: 10,
      oldestUnpaidDueOn: '2026-10-02',
      readOnlyFrom: '2026-10-09',
    });
    expect(sortSpaces([later, earlier], TODAY).map((item) => item.tenantId)).toEqual([
      'earlier',
      'later',
    ]);

    const soon = space({ name: 'B', status: 'Trial', trialEndsAtUtc: '2026-10-10T09:00:00Z' });
    const sooner = space({ name: 'A', status: 'Trial', trialEndsAtUtc: '2026-10-11T09:00:00Z' });
    expect(sortSpaces([sooner, soon], TODAY).map((item) => item.name)).toEqual(['B', 'A']);
  });

  it('calls a trial ending when it ends within a week, and not before', () => {
    const ends = (day: string) => space({ status: 'Trial', trialEndsAtUtc: `${day}T09:00:00Z` });
    expect(trialDaysLeft(ends('2026-10-16'), TODAY)).toBe(7);
    expect(urgencyRank(ends('2026-10-16'), TODAY)).toBe(3);
    expect(urgencyRank(ends('2026-10-17'), TODAY)).toBe(5);
    expect(urgencyRank(ends('2026-10-09'), TODAY)).toBe(3);
  });

  it('filters by what the admin is looking for, and counts each', () => {
    const spaces = platformSpaces();
    expect(filterCounts(spaces)).toEqual({ all: 7, owing: 3, trial: 2, paid: 2 });
    expect(
      spaces
        .filter((item) => matchesFilter(item, 'owing'))
        .map((item) => item.name)
        .sort(),
    ).toEqual(['Atlas Performance', 'Beirut Barbell', 'Cedar Barbell Club']);
    expect(spaces.filter((item) => matchesFilter(item, 'trial'))).toHaveLength(2);
    expect(
      spaces
        .filter((item) => matchesFilter(item, 'paid'))
        .map((item) => item.name)
        .sort(),
    ).toEqual(['Nour Fitness', 'نادي الأرز']);
  });

  it('finds a space by its name, its owner or the owner’s email, without accents or case', () => {
    expect(matchesQuery(byId(SPACE_IDS.atlas), 'KARIM')).toBe(true);
    expect(matchesQuery(byId(SPACE_IDS.atlas), 'atlas.example')).toBe(true);
    expect(matchesQuery(byId(SPACE_IDS.atlas), 'performance')).toBe(true);
    expect(matchesQuery(byId(SPACE_IDS.atlas), 'beirut')).toBe(false);
    expect(matchesQuery(byId(SPACE_IDS.atlas), '   ')).toBe(true);
    expect(matchesQuery(space({ name: 'Café Gym' }), 'cafe')).toBe(true);
    expect(matchesQuery(byId(SPACE_IDS.arz), 'الأرز')).toBe(true);
    expect(foldText('Éclair ÀÉ')).toBe('eclair ae');
  });

  it('adds up what is owed and counts the spaces in each state', () => {
    const summary = summarize(platformSpaces(), TODAY);

    expect(summary.owed).toEqual([{ currencyCode: 'USD', amount: 155 }]);
    expect(summary.owingSpaces).toBe(3);
    expect(summary.readOnlySpaces).toBe(1);
    expect(summary.overdueSpaces).toBe(1);
    expect(summary.trialsEnding).toBe(1);
    expect(owedText(summary, LOCALE)).toBe('$155.00');
    expect(owedText(summarize([byId(SPACE_IDS.nour)], TODAY), LOCALE)).toBe('$0.00');
  });

  it('adds what is owed in whole cents, so no fraction of a cent creeps in', () => {
    const spaces = [
      space({ tenantId: 'a', unpaidTotal: 0.1 }),
      space({ tenantId: 'b', unpaidTotal: 0.2 }),
      space({ tenantId: 'c', unpaidTotal: 38.5 }),
    ];

    expect(summarize(spaces, TODAY).owed).toEqual([{ currencyCode: 'USD', amount: 38.8 }]);
  });

  it('keeps a second currency apart instead of adding it to dollars', () => {
    const lira = space({ tenantId: 'lbp', unpaidTotal: 1_000_000, currencyCode: 'LBP' });
    const summary = summarize([byId(SPACE_IDS.beirut), lira], TODAY);

    expect(summary.owed).toEqual([
      { currencyCode: 'USD', amount: 30 },
      { currencyCode: 'LBP', amount: 1_000_000 },
    ]);
    expect(owedText(summary, LOCALE)).toContain(' + ');
  });

  it('says what happens next with each space’s money', () => {
    const line = (id: string) => nextLine(byId(id), TODAY, LOCALE);

    expect(line(SPACE_IDS.cedar)).toBe('Read-only since Oct 1');
    expect(line(SPACE_IDS.atlas)).toBe('Was due Oct 5, read-only from Oct 12');
    expect(line(SPACE_IDS.beirut)).toBe('Due Oct 14');
    expect(line(SPACE_IDS.strength)).toBe('Trial ends in 3 days');
    expect(line(SPACE_IDS.maya)).toBe('Trial until Oct 29');
    expect(line(SPACE_IDS.nour)).toBe('Paid up');

    const trial = (day: string) =>
      nextLine(space({ status: 'Trial', trialEndsAtUtc: `${day}T09:00:00Z` }), TODAY, LOCALE);
    expect(trial('2026-10-09')).toBe('Trial ends today');
    expect(trial('2026-10-10')).toBe('Trial ends tomorrow');
    expect(nextLine(space({ status: 'ReadOnly' }), TODAY, LOCALE)).toBe('Read-only until paid');
    expect(nextLine(space({ status: 'Overdue' }), TODAY, LOCALE)).toBe('Overdue');
  });

  it('counts seats and clients with the right singular', () => {
    expect(seatsAndClients(space({ seatsThisMonth: 1, billableClientsThisMonth: 1 }))).toBe(
      '1 seat · 1 client',
    );
    expect(seatsAndClients(space({ seatsThisMonth: 3, billableClientsThisMonth: 14 }))).toBe(
      '3 seats · 14 clients',
    );
  });
});

describe('platform billing: one coaching space', () => {
  it('lists invoices newest month first, a correction before the invoice it replaced', () => {
    const ids = sortInvoices(atlasDetail().invoices).map((item) => item.id);

    expect(ids).toEqual(['invoice-sep', 'invoice-aug', 'invoice-jul-2', 'invoice-jul']);
  });

  it('tells a running discount from one that has not started, has ended or was revoked', () => {
    expect(discountState(discount(), TODAY)).toBe('running');
    expect(discountState(discount({ startsOn: '2026-10-10' }), TODAY)).toBe('upcoming');
    expect(discountState(discount({ endsOnExclusive: '2026-10-09' }), TODAY)).toBe('ended');
    expect(discountState(discount({ endsOnExclusive: '2026-10-10' }), TODAY)).toBe('running');
    expect(discountState(discount({ revokedAtUtc: '2026-09-02T09:00:00Z' }), TODAY)).toBe(
      'revoked',
    );
    expect(discountLastDay(discount())).toBe('2026-11-30');
  });

  it('writes where a space stands in full sentences', () => {
    const sentence = (id: string) => statusSentence(byId(id), TODAY, LOCALE);

    expect(sentence(SPACE_IDS.cedar)).toContain('Read-only since Oct 1, 2026');
    expect(sentence(SPACE_IDS.cedar)).toContain('clients keep full use');
    expect(sentence(SPACE_IDS.atlas)).toBe(
      'An invoice was due Oct 5, 2026. The space goes read-only on Oct 12, 2026 if it is still unpaid.',
    );
    expect(sentence(SPACE_IDS.beirut)).toBe('An invoice is due Oct 14, 2026.');
    expect(sentence(SPACE_IDS.strength)).toBe(
      'On a free trial until Oct 12, 2026. Nothing has been charged.',
    );
    expect(sentence(SPACE_IDS.nour)).toBe('Paid up. The next invoice comes on the 1st.');
  });

  it('describes an invoice by when it falls due or what became of it', () => {
    const when = (overrides: Parameters<typeof invoice>[0]) =>
      invoiceWhen(invoice(overrides), LOCALE);

    expect(when({ status: 'Open', dueOn: '2026-10-14' })).toBe('Due Oct 14, 2026');
    expect(when({ status: 'Overdue' })).toBe('Was due Oct 8, 2026, read-only from Oct 15, 2026');
    expect(
      when({
        status: 'Paid',
        payment: {
          id: 'p',
          amount: 55,
          currencyCode: 'USD',
          reference: 'W',
          note: null,
          receivedOn: '2026-10-03',
          recordedAtUtc: '2026-10-04T09:00:00Z',
        },
      }),
    ).toBe('Paid Oct 3, 2026');
    expect(when({ status: 'Void', voidedAtUtc: '2026-10-05T09:00:00Z' })).toBe(
      'Voided Oct 5, 2026',
    );
    expect(when({ status: 'NothingToPay' })).toBe('Nothing to pay');
    expect(invoiceUsage(invoice())).toBe('Plan version 1 · 3 seats · 14 clients');
  });
});

describe('platform billing: recording a payment', () => {
  const entry = { reference: 'WHISH-1', receivedOn: '2026-10-08', note: '' };
  const unpaid = invoice({ issuedAtUtc: '2026-10-01T00:10:00Z' });
  const check = (change: Partial<typeof entry>) =>
    paymentErrors({ ...entry, ...change }, unpaid, TODAY, LOCALE);

  it('accepts a reference and a day from the invoice’s day up to today', () => {
    expect(check({})).toEqual({});
    expect(check({ receivedOn: '2026-10-01' })).toEqual({});
    expect(check({ receivedOn: TODAY })).toEqual({});
  });

  it('asks for the reference and keeps it and the note to the server’s limits', () => {
    expect(check({ reference: '   ' })['reference']).toEqual([
      'Enter the Whish or transfer reference.',
    ]);
    expect(check({ reference: 'x'.repeat(101) })['reference']).toEqual([
      'Keep the reference to 100 characters.',
    ]);
    expect(check({ reference: 'x'.repeat(100) })).toEqual({});
    expect(check({ note: 'n'.repeat(501) })['note']).toEqual(['Keep the note to 500 characters.']);
  });

  it('refuses money that arrived before the invoice existed or after today', () => {
    expect(check({ receivedOn: '' })['receivedOn']).toEqual(['Choose the day the money arrived.']);
    expect(check({ receivedOn: '2026-09-30' })['receivedOn']).toEqual([
      'Choose a day from Oct 1, 2026 (when the invoice was issued) up to today.',
    ]);
    expect(check({ receivedOn: '2026-10-10' })['receivedOn']).toHaveLength(1);
  });
});

describe('platform billing: voiding an invoice', () => {
  it('needs a reason, kept to 500 characters', () => {
    expect(voidErrors({ reason: '' })['reason']).toEqual(['Say why the invoice is voided.']);
    expect(voidErrors({ reason: '  ' })['reason']).toHaveLength(1);
    expect(voidErrors({ reason: 'r'.repeat(501) })['reason']).toEqual([
      'Keep the reason to 500 characters.',
    ]);
    expect(voidErrors({ reason: 'Wrong seat count' })).toEqual({});
  });

  it('says what a correction does, from the invoice’s own payment term', () => {
    const sept = invoice();
    expect(paymentTermDays(sept)).toBe(7);

    const reissue = voidOutcome(sept, true, 'Atlas Performance', 'September 2026');
    expect(reissue).toContain('A new invoice for September 2026 is issued today');
    expect(reissue).toContain('plan version 1');
    expect(reissue).toContain('due 7 days from today');
    expect(reissue).toContain('The owner is emailed it');

    expect(voidOutcome(sept, false, 'Atlas Performance', 'September 2026')).toBe(
      'Atlas Performance will owe nothing for September 2026. The voided invoice stays on record, struck through.',
    );
  });
});

describe('platform billing: granting a discount', () => {
  const entry: DiscountEntry = {
    percent: 30,
    startsOn: '2026-12-01',
    lastDay: '2027-02-28',
    note: 'Founding coach',
  };
  const check = (change: Partial<DiscountEntry>, existing = [discount()]) =>
    discountErrors({ ...entry, ...change }, existing, LOCALE);

  it('takes a percentage, a first and last day and a reason', () => {
    expect(check({})).toEqual({});
    expect(check({ percent: 100 })).toEqual({});
    expect(check({ percent: 0.01 })).toEqual({});
  });

  it('refuses a percentage the server would', () => {
    for (const percent of [null, 0, -5, 100.5, 12.345, Number.NaN]) {
      expect(check({ percent })['percent'], String(percent)).toBeDefined();
    }
  });

  it('wants both days, in order, and a reason', () => {
    expect(check({ startsOn: '' })['startsOn']).toEqual(['Choose the first day.']);
    expect(check({ lastDay: '' })['lastDay']).toEqual(['Choose the last day.']);
    expect(check({ lastDay: '2026-11-30' })['lastDay']).toEqual([
      'The last day cannot be before the first.',
    ]);
    expect(check({ lastDay: '2026-12-01' })).toEqual({});
    expect(check({ note: ' ' })['note']).toEqual(['Say what the discount is for.']);
    expect(check({ note: 'n'.repeat(201) })['note']).toEqual(['Keep it to 200 characters.']);
  });

  it('warns of an overlap with a discount still in force, but not with one revoked or already over', () => {
    const clash = check({ startsOn: '2026-11-30', lastDay: '2027-02-28' });
    expect(clash['startsOn']).toEqual([
      'That overlaps the 30% discount from Sep 1, 2026 to Nov 30, 2026. Revoke it first.',
    ]);
    expect(check({ startsOn: '2026-12-01' })).toEqual({});
    expect(
      check({ startsOn: '2026-11-30' }, [discount({ revokedAtUtc: '2026-09-02T09:00:00Z' })]),
    ).toEqual({});
  });

  it('sends the API’s half-open end and offers lengths from the first day', () => {
    expect(discountEndExclusive('2026-11-30')).toBe('2026-12-01');
    expect(discountEndExclusive('2026-12-31')).toBe('2027-01-01');
    expect(lastDayAfterMonths('2026-10-09', 3)).toBe('2027-01-08');
    expect(lastDayAfterMonths('2026-10-01', 12)).toBe('2027-09-30');
    expect(lastDayAfterMonths('2026-01-31', 1)).toBe('2026-02-27');
  });
});

describe('platform billing: publishing a price plan', () => {
  const current = plan();
  const entry = () => planEntryFrom(current);

  it('starts from the version in force and finds nothing changed', () => {
    expect(planErrors(entry())).toEqual({});
    expect(planChanges(current, entry(), LOCALE)).toEqual([]);
  });

  it('lists only the terms that differ, in the form’s order, as words', () => {
    const changes = planChanges(
      current,
      { ...entry(), seatPrice: 20, trialDays: 14, extraClientPrice: 2.5 },
      LOCALE,
    );

    expect(changes.map((change) => [change.label, change.from, change.to])).toEqual([
      ['Price per seat', '$15.00', '$20.00'],
      ['Price per extra client', '$2.00', '$2.50'],
      ['Free trial (days)', '30', '14'],
    ]);
  });

  it('holds each term to the server’s bounds', () => {
    const bad = (change: Partial<ReturnType<typeof entry>>) =>
      planErrors({ ...entry(), ...change });

    expect(bad({ seatPrice: -1 })['seatPrice']).toEqual(['Enter an amount from 0 to 100000.']);
    expect(bad({ seatPrice: 100_001 })['seatPrice']).toHaveLength(1);
    expect(bad({ seatPrice: 12.345 })['seatPrice']).toEqual(['Use at most two decimal places.']);
    expect(bad({ seatPrice: null })['seatPrice']).toEqual(['Enter a number.']);
    expect(bad({ includedClientsPerSeat: 1_001 })['includedClientsPerSeat']).toEqual([
      'Enter a whole number from 0 to 1000.',
    ]);
    expect(bad({ includedClientsPerSeat: 2.5 })['includedClientsPerSeat']).toHaveLength(1);
    expect(bad({ gymFeeMinimumSeats: 0 })['gymFeeMinimumSeats']).toHaveLength(1);
    expect(bad({ trialDays: 366 })['trialDays']).toHaveLength(1);
    expect(bad({ paymentTermDays: 91 })['paymentTermDays']).toHaveLength(1);
    expect(bad({ graceDays: -1 })['graceDays']).toHaveLength(1);
    // A workspace is never read-only on the due day itself, so the form says 1, not 0 (BILL-4).
    expect(bad({ graceDays: 0 })['graceDays']).toEqual(['Enter a whole number from 1 to 90.']);
    expect(bad({ note: 'n'.repeat(501) })['note']).toEqual(['Keep the note to 500 characters.']);
    expect(bad({ seatPrice: 0, graceDays: 1, trialDays: 0 })).toEqual({});
  });

  it('asks the API to publish against the version it was shown', () => {
    expect(toPublishRequest({ ...entry(), seatPrice: 20, note: '  New price ' }, current)).toEqual({
      seatPrice: 20,
      includedClientsPerSeat: 5,
      extraClientPrice: 2,
      gymFee: 10,
      gymFeeMinimumSeats: 2,
      trialDays: 30,
      paymentTermDays: 7,
      graceDays: 7,
      expectedCurrentVersion: 2,
      note: 'New price',
    });
    expect(toPublishRequest(entry(), current).note).toBeNull();
  });

  it('writes a version’s terms one to a line, and a line for the history', () => {
    expect(planTermRows(current, LOCALE)).toEqual([
      { label: 'Price per seat', value: '$15.00, with 5 clients included' },
      { label: 'Price per extra client', value: '$2.00' },
      { label: 'Gym fee', value: '$10.00, from 2 seats' },
      { label: 'Free trial', value: '30 days' },
      { label: 'To pay an invoice', value: '7 days after it is issued' },
      { label: 'Read-only', value: '7 days after it is due' },
    ]);
    expect(planTermRows(plan({ graceDays: 0 }), LOCALE).at(-1)?.value).toBe(
      '1 day after it is due',
    );
    expect(planSummaryLine(current, LOCALE)).toBe(
      '$15.00 a seat · 5 included · $2.00 extra · $10.00 gym fee',
    );
  });
});
