import { HttpErrorResponse } from '@angular/common/http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantMembership } from '../../core/api/api.models';
import type { TraineeSignUpStatusView } from '../../core/api/generated';
import {
  ageSentence,
  birthDateReasons,
  CLOSED_SIGN_UP,
  fullSentence,
  houseClock,
  houseMembership,
  onceAWeekSentence,
  refusalSentence,
  type TrainRefusal,
  toTrainSignUp,
  trainRefusal,
  weekdayOf,
} from './train.models';

const LOCALE = 'en-US';

/** A refused sign-up as HttpClient hands it over: the status and the server's JSON body. */
const refused = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

// Two instants of the house's year: Beirut is on GMT+2 in November and on summer time, GMT+3, in July.
const NOVEMBER = new Date('2026-11-16T09:00:00Z');
const JULY = new Date('2026-07-15T09:00:00Z');

/** Angular's en-US time puts a narrow no-break space before AM and PM. */
const abroad = (time: string) =>
  `On your device’s clock, a new training day starts at ${time.replace(' ', ' ')}.`;

describe('toTrainSignUp', () => {
  it('keeps what an open sign-up says: the house, its clock and age, and the stamp the form sends back', () => {
    const view: TraineeSignUpStatusView = {
      status: 'Open',
      workspaceName: 'Juniper Yard',
      timeZoneId: 'Asia/Beirut',
      minimumAge: 19,
      opensAgainOn: null,
      formStamp: 'stamp-1',
      callerSignUp: null,
    };

    expect(toTrainSignUp(view)).toEqual({
      status: 'Open',
      workspaceName: 'Juniper Yard',
      timeZoneId: 'Asia/Beirut',
      minimumAge: 19,
      opensAgainOn: null,
      formStamp: 'stamp-1',
      caller: null,
    });
  });

  it('reads a closed answer that names nothing as nothing at all', () => {
    expect(toTrainSignUp({ status: 'Closed' })).toEqual(CLOSED_SIGN_UP);
  });

  it('keeps the day a full week opens again, and who someone signed in is to the house', () => {
    expect(
      toTrainSignUp({ status: 'Full', opensAgainOn: '2026-11-23', callerSignUp: 'Waiting' }),
    ).toMatchObject({ status: 'Full', opensAgainOn: '2026-11-23', caller: 'Waiting' });
    expect(toTrainSignUp({ status: 'Open', callerSignUp: 'Joined' }).caller).toBe('Joined');
  });

  it('reads the age whether the server writes it as a number or as text, and drops one that is no number', () => {
    const age = (minimumAge: TraineeSignUpStatusView['minimumAge']) =>
      toTrainSignUp({ status: 'Open', minimumAge }).minimumAge;

    expect(age(19)).toBe(19);
    expect(age('23')).toBe(23);
    expect(age('nineteen')).toBeNull();
    expect(age(null)).toBeNull();
    expect(age(undefined)).toBeNull();
  });
});

describe('CLOSED_SIGN_UP', () => {
  it('is closed and says nothing about the house', () => {
    expect(CLOSED_SIGN_UP).toEqual({
      status: 'Closed',
      workspaceName: null,
      timeZoneId: null,
      minimumAge: null,
      opensAgainOn: null,
      formStamp: null,
      caller: null,
    });
  });
});

/**
 * This device's clock moved to `zone`, `offset` minutes from UTC all year, for whatever reads a calendar
 * day: Date's local fields and Intl's default zone. A worker thread's own zone is fixed when it starts.
 */
function deviceIn(zone: string, offset: number): void {
  const shift = offset * 60_000;
  type Fields = Record<string, (...args: number[]) => number>;
  const wall = (date: Date) => new Date(date.getTime() + shift) as unknown as Fields;
  const local = Date.prototype as unknown as Fields;
  for (const field of [
    'FullYear',
    'Month',
    'Date',
    'Hours',
    'Minutes',
    'Seconds',
    'Milliseconds',
  ]) {
    vi.spyOn(local, `get${field}`).mockImplementation(function (this: Date) {
      return wall(this)[`getUTC${field}`]();
    });
    vi.spyOn(local, `set${field}`).mockImplementation(function (this: Date, ...args: number[]) {
      const clock = wall(this);
      clock[`setUTC${field}`](...args);
      return this.setTime(clock['getTime']() - shift);
    });
  }
  vi.spyOn(local, 'getDay').mockImplementation(function (this: Date) {
    return wall(this)['getUTCDay']();
  });
  vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-offset);
  const Format = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new Format(locales, { timeZone: zone, ...options });
  } as unknown as typeof Intl.DateTimeFormat);
  vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new Format(locales as string | undefined, { timeZone: zone, ...options }).format(this);
  });
}

describe('weekdayOf', () => {
  afterEach(() => vi.restoreAllMocks());

  it('names the weekday of a house calendar day', () => {
    expect(weekdayOf('2026-11-16', LOCALE)).toBe('Monday');
    expect(weekdayOf('2026-11-22', LOCALE)).toBe('Sunday');
  });

  it('gives no weekday for no day, or for anything not written YYYY-MM-DD', () => {
    expect(weekdayOf(null, LOCALE)).toBeNull();
    expect(weekdayOf('', LOCALE)).toBeNull();
    expect(weekdayOf('16/11/2026', LOCALE)).toBeNull();
    expect(weekdayOf('2026-11-16T00:00:00Z', LOCALE)).toBeNull();
  });

  it.each([
    ['Pacific/Pago_Pago', -660, 'Sunday'],
    ['UTC', 0, 'Monday'],
    ['Pacific/Kiritimati', 840, 'Monday'],
  ])(
    'reads 16 November 2026 as a Monday on a device in %s',
    (zone: string, offset: number, atUtcMidnight: string) => {
      deviceIn(zone, offset);

      // Read as an instant, UTC's midnight that day is still Sunday the 15th west of Greenwich.
      expect(
        new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(new Date('2026-11-16')),
      ).toBe(atUtcMidnight);
      expect(new Date('2026-11-16').getDay()).toBe(atUtcMidnight === 'Sunday' ? 0 : 1);
      expect(weekdayOf('2026-11-16', LOCALE)).toBe('Monday');
      expect(fullSentence('2026-11-16', LOCALE)).toBe(
        'Sign-up is full for this week. It opens again on Monday.',
      );
    },
  );
});

describe('houseMembership', () => {
  const space = (
    tenantId: string,
    tenantName: string,
    role: TenantMembership['role'] = 'Client',
  ): TenantMembership => ({ tenantId, tenantName, tenantSlug: tenantId, role });

  // A coach's space the person is a client of, and the house, by the name the status read gives it.
  const COACHED = space('space-coach', 'Northside Coaching');
  const HOUSE = space('space-house', 'Juniper Yard');

  it('picks the one client membership named like the house, before a team membership of that name', () => {
    expect(houseMembership([COACHED, HOUSE], 'Juniper Yard')).toBe(HOUSE);
    const team = space('space-namesake', 'Juniper Yard', 'Coach');
    expect(houseMembership([team, COACHED, HOUSE], 'Juniper Yard')).toBe(HOUSE);
  });

  it('picks the one membership so named when none is a client’s: the house’s own staff', () => {
    const owner = space('space-house', 'Juniper Yard', 'Owner');
    expect(houseMembership([COACHED, owner], 'Juniper Yard')).toBe(owner);
    const coach = space('space-house', 'Juniper Yard', 'Coach');
    expect(houseMembership([coach], 'Juniper Yard')).toBe(coach);
  });

  it('picks none when two spaces carry the name, since the server names no id', () => {
    expect(
      houseMembership([HOUSE, space('space-namesake', 'Juniper Yard')], 'Juniper Yard'),
    ).toBeUndefined();
    expect(
      houseMembership(
        [space('space-a', 'Juniper Yard', 'Owner'), space('space-b', 'Juniper Yard', 'Coach')],
        'Juniper Yard',
      ),
    ).toBeUndefined();
  });

  it('picks none without a name, or when no space carries it', () => {
    expect(houseMembership([COACHED, HOUSE], null)).toBeUndefined();
    expect(houseMembership([COACHED, HOUSE], '')).toBeUndefined();
    expect(houseMembership([COACHED], 'Juniper Yard')).toBeUndefined();
    expect(houseMembership([], 'Juniper Yard')).toBeUndefined();
  });
});

describe('the sign-up’s sentences', () => {
  it('says when a full week opens again, by its weekday, or only that it is full', () => {
    expect(fullSentence('2026-11-23', LOCALE)).toBe(
      'Sign-up is full for this week. It opens again on Monday.',
    );
    expect(fullSentence(null, LOCALE)).toBe('Sign-up is full for this week.');
    expect(fullSentence('next week', LOCALE)).toBe('Sign-up is full for this week.');
  });

  it('tells someone who already signed up this week the day they can sign up again', () => {
    expect(onceAWeekSentence('2026-11-23', LOCALE)).toBe(
      'You already signed up this week. You can sign up again on Monday.',
    );
    expect(onceAWeekSentence(null, LOCALE)).toBe(
      'You already signed up this week. You can sign up again next week.',
    );
  });

  it('names the house’s age when it has one, and no age when it has none', () => {
    expect(ageSentence(19)).toBe('Sign-up is open to people aged 19 or older.');
    expect(ageSentence(null)).toBe('Sign-up is not open to people of your age.');
  });
});

describe('houseClock', () => {
  it('says nothing while the server names no clock', () => {
    expect(houseClock(null, LOCALE, NOVEMBER, 'UTC')).toBeNull();
  });

  it('names the house’s city, with no second line on a device that reads the house’s clock', () => {
    const line = 'Training days follow Beirut time.';

    expect(houseClock('Asia/Beirut', LOCALE, NOVEMBER, 'Asia/Beirut')).toEqual({
      line,
      abroad: null,
    });
    // A device that cannot say its zone is told nothing it could misread.
    expect(houseClock('Asia/Beirut', LOCALE, NOVEMBER, null)).toEqual({ line, abroad: null });
    // Another city on the same offset reads the same hour.
    expect(houseClock('Asia/Beirut', LOCALE, NOVEMBER, 'Europe/Athens')).toEqual({
      line,
      abroad: null,
    });
    expect(houseClock('America/New_York', LOCALE, NOVEMBER, 'America/New_York')?.line).toBe(
      'Training days follow New York time.',
    );
  });

  it.each([
    ['UTC', '10:00 PM'],
    ['America/New_York', '5:00 PM'],
    ['Pacific/Kiritimati', '12:00 PM'],
    ['Asia/Kolkata', '3:30 AM'],
  ])(
    'tells a device in %s the hour a new training day starts on its own clock',
    (device: string, time: string) => {
      expect(houseClock('Asia/Beirut', LOCALE, NOVEMBER, device)).toEqual({
        line: 'Training days follow Beirut time.',
        abroad: abroad(time),
      });
    },
  );

  it('reads the offsets as they are now: the same device matches the house in November and not in July', () => {
    expect(houseClock('Asia/Beirut', LOCALE, NOVEMBER, 'Africa/Johannesburg')?.abroad).toBeNull();
    expect(houseClock('Asia/Beirut', LOCALE, JULY, 'Africa/Johannesburg')?.abroad).toBe(
      abroad('11:00 PM'),
    );
    expect(houseClock('Asia/Beirut', LOCALE, JULY, 'UTC')?.abroad).toBe(abroad('9:00 PM'));
  });
});

describe('trainRefusal', () => {
  it.each<[string, number, Record<string, unknown>, TrainRefusal]>([
    ['trainee_sign_up_closed', 409, {}, { kind: 'closed' }],
    [
      'trainee_sign_up_full',
      409,
      { opensAgainOn: '2026-11-23' },
      { kind: 'full', opensAgainOn: '2026-11-23' },
    ],
    ['trainee_sign_up_age_not_met', 409, { minimumAge: 19 }, { kind: 'age', minimumAge: 19 }],
    ['sign_up_form_too_fast', 400, {}, { kind: 'too-fast' }],
    ['sign_up_form_stamp_invalid', 400, {}, { kind: 'stamp' }],
    ['existing_account_sign_in_required', 409, {}, { kind: 'existing-account' }],
    ['wrong_signed_in_account', 403, {}, { kind: 'wrong-account' }],
    ['trainee_already_joined', 409, {}, { kind: 'already-joined' }],
    ['trainee_former_staff', 409, {}, { kind: 'former-staff' }],
    ['trainee_sign_up_not_available', 409, {}, { kind: 'not-available' }],
    [
      'trainee_sign_up_once_a_week',
      409,
      { opensAgainOn: '2026-11-23' },
      { kind: 'once-a-week', opensAgainOn: '2026-11-23' },
    ],
    ['legal_acceptance_required', 409, {}, { kind: 'legal' }],
  ])('reads %s as what it means for the page', (code, status, extra, expected) => {
    expect(trainRefusal(refused(status, { code, message: 'Server wording.', ...extra }))).toEqual(
      expected,
    );
  });

  it('keeps the day sign-up opens again only when the server wrote one', () => {
    expect(trainRefusal(refused(409, { code: 'trainee_sign_up_full' }))).toEqual({
      kind: 'full',
      opensAgainOn: null,
    });
    expect(
      trainRefusal(refused(409, { code: 'trainee_sign_up_once_a_week', opensAgainOn: 20261123 })),
    ).toEqual({ kind: 'once-a-week', opensAgainOn: null });
  });

  it('keeps the house’s age when the server sent one, as a number or as text', () => {
    const age = (minimumAge: unknown) =>
      trainRefusal(refused(409, { code: 'trainee_sign_up_age_not_met', minimumAge }));

    expect(age('21')).toEqual({ kind: 'age', minimumAge: 21 });
    expect(age(undefined)).toEqual({ kind: 'age', minimumAge: null });
    expect(age(null)).toEqual({ kind: 'age', minimumAge: null });
    expect(age('old enough')).toEqual({ kind: 'age', minimumAge: null });
  });

  it('reads too many sign-ups from one connection as busy, whatever the body says', () => {
    expect(trainRefusal(refused(429, null))).toEqual({ kind: 'busy' });
    expect(trainRefusal(refused(429, { code: 'trainee_sign_up_full' }))).toEqual({
      kind: 'busy',
    });
  });

  it('puts each server field message under the form’s own field, the password rules under Password', () => {
    const refusal = trainRefusal(
      refused(400, {
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: {
          FirstName: ['First name has a character that is not allowed.'],
          lastName: ['Last name has a character that is not allowed.'],
          Email: ['Use another email address.'],
          Password: ['Passwords must have at least one digit.'],
          Identity: ['Passwords must have at least one non alphanumeric character.'],
          BirthDate: ['Check the date of birth.'],
        },
      }),
    );

    expect(refusal).toEqual({
      kind: 'fields',
      errors: {
        firstName: ['First name has a character that is not allowed.'],
        lastName: ['Last name has a character that is not allowed.'],
        email: ['Use another email address.'],
        password: [
          'Passwords must have at least one digit.',
          'Passwords must have at least one non alphanumeric character.',
        ],
        birthDate: ['Check the date of birth.'],
      },
    });
    expect(
      trainRefusal(refused(400, { errors: { identity: ['Use an upper-case letter.'] } })),
    ).toEqual({ kind: 'fields', errors: { password: ['Use an upper-case letter.'] } });
  });

  it('keeps only the text messages of the form’s own fields, and reads a refusal left with none as other', () => {
    expect(
      trainRefusal(
        refused(400, { errors: { LastName: [7, '', 'Enter a last name.'], Website: ['No.'] } }),
      ),
    ).toEqual({ kind: 'fields', errors: { lastName: ['Enter a last name.'] } });
    expect(
      trainRefusal(
        refused(400, {
          errors: { Website: ['Leave this empty.'], FirstName: [], Email: 'Not a list.' },
        }),
      ),
    ).toEqual({ kind: 'other' });
    expect(trainRefusal(refused(400, { errors: null }))).toEqual({ kind: 'other' });
    // Field messages count only on a 400, as the server sends them.
    expect(trainRefusal(refused(409, { errors: { Email: ['Taken.'] } }))).toEqual({
      kind: 'other',
    });
  });

  it('reads anything else as other: an unknown code, a body that is no object, or no HTTP answer', () => {
    expect(
      trainRefusal(
        refused(409, {
          code: 'registration_conflict',
          message: 'The sign-up could not be completed.',
        }),
      ),
    ).toEqual({ kind: 'other' });
    expect(trainRefusal(refused(502, 'Bad gateway'))).toEqual({ kind: 'other' });
    expect(trainRefusal(refused(0, null))).toEqual({ kind: 'other' });
    expect(trainRefusal(new Error('Boom'))).toEqual({ kind: 'other' });
    expect(trainRefusal(undefined)).toEqual({ kind: 'other' });
  });
});

describe('refusalSentence', () => {
  it.each<[string, TrainRefusal, string]>([
    [
      'an age the house has',
      { kind: 'age', minimumAge: 19 },
      'Sign-up is open to people aged 19 or older.',
    ],
    [
      'an age the server left out',
      { kind: 'age', minimumAge: null },
      'Sign-up is not open to people of your age.',
    ],
    [
      'fields',
      { kind: 'fields', errors: { email: ['Use another email address.'] } },
      'Check the fields marked above.',
    ],
    [
      'a form sent too fast',
      { kind: 'too-fast' },
      'That was quick. Give it a moment and send again.',
    ],
    [
      'a stamp the server no longer takes',
      { kind: 'stamp' },
      'The form needs to be opened again before it can be sent. Reload the page and send it again.',
    ],
    [
      'an email that has an account',
      { kind: 'existing-account' },
      'An account already uses this email. Sign in with it, then sign up from there. If you already signed up here, open the link in the email we sent you; if that link has stopped working, sign up again in a few days.',
    ],
    [
      'another account signed in',
      { kind: 'wrong-account' },
      'You are signed in with a different email. Use that email, or sign out first.',
    ],
    [
      'a trainee already in',
      { kind: 'already-joined' },
      'You are already part of this coaching space.',
    ],
    [
      'someone who was on the team',
      { kind: 'former-staff' },
      'You were on this coaching space’s team, so you can’t sign up to train in it. Talk to its owner.',
    ],
    [
      'someone the house ended or blocked',
      { kind: 'not-available' },
      'This coaching space ended your coaching or blocked your access, so you can’t sign up again by yourself. Ask it to invite you back.',
    ],
    [
      'a second sign-up this week, with its day',
      { kind: 'once-a-week', opensAgainOn: '2026-11-23' },
      'You already signed up this week. You can sign up again on Monday.',
    ],
    [
      'a second sign-up this week, with no day',
      { kind: 'once-a-week', opensAgainOn: null },
      'You already signed up this week. You can sign up again next week.',
    ],
    [
      'too many sign-ups from one connection',
      { kind: 'busy' },
      'Too many sign-ups from this connection for now. Try again in an hour.',
    ],
  ])('words %s for the summary', (_label, refusal, sentence) => {
    expect(refusalSentence(refusal, LOCALE)).toBe(sentence);
  });

  it('says nothing in the summary where the page changes state or words the refusal itself', () => {
    const silent: TrainRefusal[] = [
      { kind: 'closed' },
      { kind: 'full', opensAgainOn: '2026-11-23' },
      { kind: 'legal' },
      { kind: 'other' },
    ];

    expect(silent.map((refusal) => refusalSentence(refusal, LOCALE))).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('birthDateReasons', () => {
  const TODAY = '2026-11-16';

  it('asks for a date of birth, then for each part of it, then for a day that exists', () => {
    expect(birthDateReasons('empty', '', TODAY)).toEqual(['Enter your date of birth.']);
    expect(birthDateReasons('incomplete', '', TODAY)).toEqual(['Enter the day, month and year.']);
    expect(birthDateReasons('invalid', '', TODAY)).toEqual([
      'That day does not exist. Check the day and the month.',
    ]);
    expect(birthDateReasons('valid', '1990-03-27', TODAY)).toEqual([]);
  });

  it('takes today at the latest and 120 years ago at the earliest, as the server does', () => {
    const year = ['Check the year of your date of birth.'];

    expect(birthDateReasons('valid', '2026-11-16', TODAY)).toEqual([]);
    expect(birthDateReasons('valid', '2026-11-17', TODAY)).toEqual(year);
    expect(birthDateReasons('valid', '1906-11-16', TODAY)).toEqual([]);
    expect(birthDateReasons('valid', '1906-11-15', TODAY)).toEqual(year);
  });
});
