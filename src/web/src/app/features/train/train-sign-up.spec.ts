import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { type Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser, TenantMembership } from '../../core/api/api.models';
import type { RegisterTraineeRequest, TraineeRegistrationResponse } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { field, fill, press, query, settle, tick, type } from '../../../testing/dom';
import { LegalApi } from '../legal/legal-api';
import type { LegalAudience, LegalToAccept } from '../legal/legal.models';
import { TrainSignUpPage } from './train-sign-up';
import { TrainApi } from './train-api';
import { CLOSED_SIGN_UP, type TrainSignUp } from './train.models';

// Monday 16 November 2026, 11:00 in Beirut: the status read is stamped at this instant.
const NOW = new Date('2026-11-16T09:00:00Z');

/** TB Gym's own space while sign-up is open, as the status read names it; the name is made up. */
const OPEN: TrainSignUp = {
  status: 'Open',
  workspaceName: 'Juniper Yard',
  timeZoneId: 'Asia/Beirut',
  minimumAge: 19,
  opensAgainOn: null,
  formStamp: 'stamp-1',
  caller: null,
};

const FULL: TrainSignUp = { ...OPEN, status: 'Full', opensAgainOn: '2026-11-23', formStamp: null };

const REGISTERED: TraineeRegistrationResponse = {
  email: 'nour@example.test',
  developmentConfirmationUrl: null,
  emailAvailable: true,
  joined: false,
};

const JOINED: TraineeRegistrationResponse = {
  email: 'member@example.test',
  developmentConfirmationUrl: null,
  emailAvailable: true,
  joined: true,
};

const MEMBER: CurrentUser = {
  id: 'user-1',
  email: 'member@example.test',
  displayName: 'Nour Sample',
  preferredCulture: 'en-LB',
  preferredThemeMode: 'system',
  preferredWeightUnit: 'Kilogram',
  emailConfirmed: true,
  roles: [],
};

const membership = (tenantId: string, tenantName: string): TenantMembership => ({
  tenantId,
  tenantName,
  tenantSlug: tenantId,
  role: 'Client',
});

const COACHED = membership('space-coach', 'Northside Coaching');
const HOUSE = membership('space-house', 'Juniper Yard');

/** A published version as the to-accept read gives it; the words are placeholders, not legal text. */
function legalDocument(id: string, kind: LegalToAccept['kind'], name: string): LegalToAccept {
  return {
    id,
    kind,
    name,
    version: '2026-11',
    statement: `Placeholder sentence for the ${name}.`,
    culture: 'en',
    link: `/legal/${id}`,
  };
}

const CONSUMER = legalDocument('consumer-1', 'ConsumerTerms', 'Consumer terms');
const PRIVACY = legalDocument('privacy-1', 'PrivacyPolicy', 'Privacy Policy');

/** A refusal as the sign-up sends it (N9a1): its code, with the server's own words beside it. */
const refusal = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new HttpErrorResponse({ status, error: { code, message: 'Server wording.', ...extra } });

const TOO_FAST = refusal(400, 'sign_up_form_too_fast');
const STAMP_REFUSED = refusal(400, 'sign_up_form_stamp_invalid');

/** A refusal of fields, in the shape ASP.NET gives its validation problems. */
const fieldsRefused = (errors: Record<string, string[]>) =>
  new HttpErrorResponse({
    status: 400,
    error: { title: 'One or more validation errors occurred.', status: 400, errors },
  });

/** Successive answers to one call, the last one repeated. */
function inTurn<T>(...answers: (() => Observable<T>)[]): () => Observable<T> {
  let call = 0;
  return () => answers[Math.min(call++, answers.length - 1)]();
}

interface Visit {
  /** Each status read; sign-up is open unless a test says otherwise. */
  readonly status?: () => Observable<TrainSignUp>;
  readonly register?: () => Observable<TraineeRegistrationResponse>;
  /** The documents in force; none is published unless a test says so. */
  readonly toAccept?: () => Observable<LegalToAccept[]>;
  readonly refresh?: () => Promise<void>;
  readonly user?: CurrentUser | null;
  /** The session ended by itself (it ran out, or was ended on another device). */
  readonly ended?: boolean;
  /** The memberships before the sign-up, and what reading them again gives after it. */
  readonly memberships?: TenantMembership[];
  readonly after?: TenantMembership[] | 'fails';
}

async function render(visit: Visit = {}) {
  const user = signal<CurrentUser | null>(visit.user ?? null);
  const memberships = signal<TenantMembership[]>(visit.memberships ?? []);
  const api = {
    status: vi.fn(visit.status ?? (() => of(OPEN))),
    register: vi.fn<(request: RegisterTraineeRequest) => Observable<TraineeRegistrationResponse>>(
      visit.register ?? (() => of(REGISTERED)),
    ),
  };
  const legal = {
    toAccept: vi.fn<(audience: LegalAudience) => Observable<LegalToAccept[]>>(
      visit.toAccept ?? (() => of([])),
    ),
  };
  const csrf = { refresh: vi.fn(visit.refresh ?? (() => Promise.resolve())) };
  const auth = {
    user,
    ended: signal(visit.ended ?? false),
    // Signing out really ends the session here: the page reads the sign-up again as a visitor.
    logout: vi.fn(() => {
      user.set(null);
      return Promise.resolve();
    }),
    initialize: vi.fn<(force?: boolean) => Promise<void>>(() => Promise.resolve()),
  };
  const tenants = {
    memberships,
    load: vi.fn(() => {
      if (visit.after === 'fails') return Promise.reject(new HttpErrorResponse({ status: 0 }));
      if (visit.after) memberships.set(visit.after);
      return Promise.resolve();
    }),
    select: vi.fn<(tenantId: string | null) => void>(),
  };
  await TestBed.configureTestingModule({
    imports: [TrainSignUpPage],
    providers: [
      provideRouter([]),
      { provide: TrainApi, useValue: api },
      { provide: LegalApi, useValue: legal },
      { provide: CsrfService, useValue: csrf },
      { provide: AuthStore, useValue: auth },
      { provide: TenantStore, useValue: tenants },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TrainSignUpPage);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api,
    legal,
    csrf,
    auth,
    tenants,
    router: TestBed.inject(Router),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Each link inside `element`, by its words and where it leads. */
const links = (element: Element | null) =>
  Array.from(element?.querySelectorAll('a') ?? []).map((link) => [
    textOf(link),
    link.getAttribute('href'),
  ]);

const summary = (host: HTMLElement) => query<HTMLElement>(host, '#train-summary');

/** The summary's lines: its heading and one reason each, or the one sentence a refusal is. */
const lines = (host: HTMLElement) =>
  Array.from(summary(host).querySelectorAll(':scope > span')).map(textOf);

const submit = (host: HTMLElement) => query<HTMLButtonElement>(host, 'button[type="submit"]');

/** What a field says under it now: its error, else its help; '' when it says nothing. */
function under(host: HTMLElement, label: string): string {
  const described = field(host, label).getAttribute('aria-describedby');
  return described ? textOf(host.querySelector(`#${described}`)) : '';
}

const underBirthDate = (host: HTMLElement) =>
  textOf(host.querySelector('app-date-input .tb-field__support--error'));

/** Types a date of birth into its three boxes. */
function birthDate(host: HTMLElement, day: string, month: string, year: string): void {
  type(host, 'input.day', day);
  type(host, 'input.month', month);
  type(host, 'input.year', year);
}

/** Fills everything a visitor is asked for; a test then changes what it is about. */
async function fillVisitor(fixture: ComponentFixture<unknown>, host: HTMLElement) {
  fill(host, 'First name', 'Nour');
  fill(host, 'Last name', 'Sample');
  fill(host, 'Email', 'nour@example.test');
  fill(host, 'Password', 'Correct-horse-9');
  fill(host, 'Confirm password', 'Correct-horse-9');
  birthDate(host, '27', '3', '1990');
  await settle(fixture);
}

/** The same for someone signed in, who is asked no email and no password. */
async function fillSignedIn(fixture: ComponentFixture<unknown>, host: HTMLElement) {
  fill(host, 'First name', 'Nour');
  fill(host, 'Last name', 'Sample');
  birthDate(host, '27', '3', '1990');
  await settle(fixture);
}

/** What a visitor sends with the form as `fillVisitor` leaves it. */
const VISITOR_BODY: RegisterTraineeRequest = {
  firstName: 'Nour',
  lastName: 'Sample',
  email: 'nour@example.test',
  birthDate: '1990-03-27',
  password: 'Correct-horse-9',
  website: '',
  legalDocumentIds: [],
  formStamp: 'stamp-1',
};

/** Timeouts run on the faked clock from here; its Date goes on from where it stood. */
const fakeTimeouts = () => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });

/** `milliseconds` pass on the faked clock, and what they set off is drawn. */
async function pass(fixture: ComponentFixture<unknown>, milliseconds: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(milliseconds);
  fixture.detectChanges();
  for (let index = 0; index < 4; index++) await Promise.resolve();
  fixture.detectChanges();
}

/** Timeouts are real again, once whatever the faked clock still held has run. */
async function realTimeouts(fixture: ComponentFixture<unknown>): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
  vi.useFakeTimers({ toFake: ['Date'] });
  await settle(fixture);
}

const robots = () => Array.from(document.head.querySelectorAll('meta[name="robots"]'));

/** A plain left click on a link, as the browser sends it. */
const leftClick = () => new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

/** The link inside `element` that reads `words`. */
function linkReading(element: Element, words: string): HTMLAnchorElement {
  const found = Array.from(element.querySelectorAll<HTMLAnchorElement>('a')).find(
    (link) => textOf(link) === words,
  );
  if (!found) throw new Error(`No link reads "${words}".`);
  return found;
}

describe('TrainSignUpPage', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    for (const tag of robots()) tag.remove();
  });

  describe('the page', () => {
    it('asks search engines to leave the form out whatever sign-up says, and takes the tag away with the page', async () => {
      for (const answer of [OPEN, FULL, CLOSED_SIGN_UP]) {
        const { fixture } = await render({ status: () => of(answer) });

        expect(robots().map((tag) => tag.getAttribute('content'))).toEqual(['noindex']);
        fixture.destroy();
        expect(robots()).toHaveLength(0);
        TestBed.resetTestingModule();
      }
    });

    it('leaves a robots tag the document already has: no second one, and it stays when the page goes', async () => {
      const own = document.createElement('meta');
      own.setAttribute('name', 'robots');
      own.setAttribute('content', 'noindex, nofollow');
      document.head.append(own);
      const { fixture } = await render();

      expect(robots()).toEqual([own]);
      fixture.destroy();
      expect(robots()).toEqual([own]);
    });

    it('shows what /train says instead of the form while sign-up is closed or full, and reads no documents', async () => {
      const closed = await render({ status: () => of(CLOSED_SIGN_UP) });
      expect(textOf(closed.host.querySelector('.auth-eyebrow'))).toBe('TB Gym');
      expect(textOf(query(closed.host, '[data-closed] .auth-message'))).toBe(
        'Sign-up is closed right now.',
      );
      expect(links(query(closed.host, '[data-closed]'))).toEqual([
        ['Back to Train with TB Gym', '/train'],
      ]);
      expect(closed.host.querySelector('form')).toBeNull();
      expect(closed.legal.toAccept).not.toHaveBeenCalled();
      TestBed.resetTestingModule();

      const full = await render({ status: () => of(FULL) });
      expect(textOf(full.host.querySelector('.auth-eyebrow'))).toBe('Juniper Yard');
      expect(textOf(query(full.host, '[data-full] .auth-message'))).toBe(
        'Sign-up is full for this week. It opens again on Monday.',
      );
      expect(links(query(full.host, '[data-full]'))).toEqual([
        ['Back to Train with TB Gym', '/train'],
      ]);
      expect(full.host.querySelector('form')).toBeNull();
      expect(full.legal.toAccept).not.toHaveBeenCalled();
    });

    it('tells a trainee already in the house so, with Today, and shows no form', async () => {
      const { host } = await render({
        user: MEMBER,
        status: () => of({ ...OPEN, caller: 'Joined' }),
      });

      expect(textOf(query(host, '[data-joined] .auth-message'))).toBe(
        'You’re already training with TB Gym.',
      );
      expect(links(query(host, '[data-joined]'))).toEqual([['Open Today', '/']]);
      expect(host.querySelector('form')).toBeNull();
    });

    it('opens Today in the house from there, selected first though a coach’s space comes first', async () => {
      const { fixture, host, tenants, router } = await render({
        user: MEMBER,
        status: () => of({ ...OPEN, caller: 'Joined' }),
        memberships: [COACHED, HOUSE],
      });
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const click = leftClick();

      linkReading(query(host, '[data-joined]'), 'Open Today').dispatchEvent(click);
      await settle(fixture);

      expect(click.defaultPrevented).toBe(true);
      expect(tenants.load).not.toHaveBeenCalled();
      expect(tenants.select).toHaveBeenCalledTimes(1);
      expect(tenants.select).toHaveBeenCalledWith('space-house');
      expect(navigate).toHaveBeenCalledWith('/');
      expect(tenants.select.mock.invocationCallOrder[0]).toBeLessThan(
        navigate.mock.invocationCallOrder[0],
      );
    });

    it('asks for no documents when the person is already a trainee, since no form is drawn', async () => {
      const { legal } = await render({
        user: MEMBER,
        status: () => of({ ...OPEN, caller: 'Joined' }),
      });

      expect(legal.toAccept).not.toHaveBeenCalled();
    });

    it('offers someone confirmed and waiting the form to finish signing up while a place is open', async () => {
      const { host } = await render({
        user: MEMBER,
        status: () => of({ ...OPEN, caller: 'Waiting' }),
      });

      expect(textOf(host.querySelector('.train-account'))).toBe(
        'Sign up using member@example.test.',
      );
      expect(textOf(submit(host))).toBe('Sign up');
    });

    it('says so when the status cannot be read, and reads it again on Try again', async () => {
      const { fixture, host, api, legal } = await render({
        status: inTurn<TrainSignUp>(
          () => throwError(() => new HttpErrorResponse({ status: 0 })),
          () => of(OPEN),
        ),
      });

      expect(textOf(host.querySelector('h1'))).toBe('Create your account.');
      expect(textOf(query(host, '[role="alert"]'))).toBe(
        'This page couldn’t load. Check your connection and try again.',
      );
      expect(host.querySelector('form')).toBeNull();
      expect(legal.toAccept).not.toHaveBeenCalled();

      press(host, 'Try again');
      await settle(fixture);
      expect(api.status).toHaveBeenCalledTimes(2);
      expect(legal.toAccept).toHaveBeenCalledWith('Trainee');
      expect(host.querySelector('form')).not.toBeNull();
    });

    it('heads a status that cannot be read as a sign-up, not a new account, for someone signed in', async () => {
      const { host } = await render({
        user: MEMBER,
        status: () => throwError(() => new HttpErrorResponse({ status: 0 })),
      });

      expect(textOf(host.querySelector('h1'))).toBe('Sign up to train.');
      expect(textOf(query(host, '[role="alert"]'))).toBe(
        'This page couldn’t load. Check your connection and try again.',
      );
      expect(host.textContent).not.toContain('Create your account');
    });
  });

  describe('a visitor’s form', () => {
    it('asks for a name, an email, a password twice and a date of birth, under the house’s name', async () => {
      const { host, legal } = await render();

      expect(legal.toAccept).toHaveBeenCalledWith('Trainee');
      expect(textOf(host.querySelector('.auth-eyebrow'))).toBe('Juniper Yard');
      expect(textOf(host.querySelector('h1'))).toBe('Create your account.');
      expect(
        ['First name', 'Last name', 'Email', 'Password', 'Confirm password'].map((label) =>
          field(host, label).getAttribute('autocomplete'),
        ),
      ).toEqual(['given-name', 'family-name', 'email', 'new-password', 'new-password']);
      const birth = query(host, 'app-date-input');
      expect(textOf(birth.querySelector('legend'))).toBe('Date of birth');
      expect(textOf(birth.querySelector('.tb-field__support'))).toBe('For example, 27 3 1990.');
      expect(query(host, 'input.day').getAttribute('autocomplete')).toBe('bday-day');
      // The honeypot: out of sight, out of reach, and named as a website field a script would fill.
      const honeypot = query<HTMLInputElement>(host, '#train-website');
      expect(honeypot.name).toBe('website');
      expect(honeypot.tabIndex).toBe(-1);
      expect(honeypot.getAttribute('autocomplete')).toBe('off');
      expect(honeypot.closest('.train-nope')?.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('[data-legal]')).toBeNull();
      expect(textOf(submit(host))).toBe('Create account');
      expect(textOf(host.querySelector('.auth-alt span'))).toBe('Already have an account?');
      expect(links(host.querySelector('.auth-alt'))).toEqual([
        ['Sign in', '/auth/sign-in?returnUrl=%2Ftrain%2Fsign-up'],
      ]);
      // A form just drawn announces nothing.
      expect(textOf(summary(host))).toBe('');
      expect(host.querySelector('.auth--embedded')).toBeNull();
    });

    it('refuses an empty form without sending it, naming every missing answer in the summary', async () => {
      const { fixture, host, api, csrf } = await render();

      press(host, 'Create account');
      await settle(fixture);

      expect(csrf.refresh).not.toHaveBeenCalled();
      expect(api.register).not.toHaveBeenCalled();
      expect(lines(host)).toEqual([
        "Your account can't be created yet:",
        'Enter your first name.',
        'Enter your last name.',
        'Enter your email address.',
        'Use at least 12 characters with upper, lower, number, and symbol.',
        'Enter the same password again.',
        'Enter your date of birth.',
      ]);
      expect(document.activeElement).toBe(summary(host));
      expect(under(host, 'First name')).toBe('Enter your first name.');
      expect(field(host, 'First name').getAttribute('aria-invalid')).toBe('true');
      expect(underBirthDate(host)).toBe('Enter your date of birth.');
    });

    it('counts a name of spaces alone as no name, and takes up to 100 characters', async () => {
      const { fixture, host, api } = await render();
      await fillVisitor(fixture, host);
      fill(host, 'First name', '   ');
      fill(host, 'Last name', 'x'.repeat(101));
      await settle(fixture);

      press(host, 'Create account');
      await settle(fixture);
      expect(api.register).not.toHaveBeenCalled();
      expect(lines(host)).toEqual([
        "Your account can't be created yet:",
        'Enter your first name.',
        'Use 100 characters or fewer.',
      ]);

      fill(host, 'First name', 'Nour');
      fill(host, 'Last name', 'x'.repeat(100));
      await settle(fixture);
      press(host, 'Create account');
      await settle(fixture);
      expect(api.register).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Nour', lastName: 'x'.repeat(100) }),
      );
    });

    it('asks for an email address and a password of 12 characters, then for the same password twice', async () => {
      const { fixture, host, api } = await render();
      await fillVisitor(fixture, host);
      fill(host, 'Email', 'nour.example.test');
      fill(host, 'Password', 'Short-pw-9');
      fill(host, 'Confirm password', 'Short-pw-9');
      await settle(fixture);

      press(host, 'Create account');
      await settle(fixture);
      expect(lines(host)).toEqual([
        "Your account can't be created yet:",
        'Enter an email address in the format name@example.com.',
        'Use at least 12 characters with upper, lower, number, and symbol.',
      ]);

      fill(host, 'Email', 'nour@example.test');
      fill(host, 'Password', 'Correct-horse-9');
      fill(host, 'Confirm password', 'Correct-horse-8');
      await settle(fixture);
      press(host, 'Create account');
      await settle(fixture);
      expect(lines(host)).toEqual(['Passwords do not match.']);
      expect(document.activeElement).toBe(summary(host));
      expect(api.register).not.toHaveBeenCalled();
    });

    it.each([
      ['left empty', ['', '', ''], 'Enter your date of birth.'],
      ['missing its month and year', ['27', '', ''], 'Enter the day, month and year.'],
      ['written with a two-digit year', ['27', '3', '90'], 'Enter the day, month and year.'],
      [
        'a day that does not exist',
        ['31', '2', '1990'],
        'That day does not exist. Check the day and the month.',
      ],
      [
        'tomorrow on the house’s clock',
        ['17', '11', '2026'],
        'Check the year of your date of birth.',
      ],
      ['more than 120 years ago', ['15', '11', '1906'], 'Check the year of your date of birth.'],
    ])(
      'refuses a date of birth %s without sending it',
      async (_case, [day, month, year], reason) => {
        const { fixture, host, api } = await render();
        await fillVisitor(fixture, host);
        birthDate(host, day, month, year);
        await settle(fixture);

        press(host, 'Create account');
        await settle(fixture);

        expect(api.register).not.toHaveBeenCalled();
        expect(lines(host)).toEqual(["Your account can't be created yet:", reason]);
        expect(underBirthDate(host)).toBe(reason);
      },
    );

    it.each([
      ['today', 'Asia/Beirut', NOW, ['16', '11', '2026'], '2026-11-16'],
      ['120 years ago to the day', 'Asia/Beirut', NOW, ['16', '11', '1906'], '1906-11-16'],
      // Already the 17th in Kiritimati, while still the 16th on this device.
      [
        'today on a house clock ahead of the device',
        'Pacific/Kiritimati',
        new Date('2026-11-16T12:00:00Z'),
        ['17', '11', '2026'],
        '2026-11-17',
      ],
    ])(
      'sends a date of birth of %s, leaving the age to the server',
      async (_case, zone, now, [day, month, year], sent) => {
        vi.setSystemTime(now);
        const { fixture, host, api } = await render({
          status: () => of({ ...OPEN, timeZoneId: zone }),
        });
        await fillVisitor(fixture, host);
        birthDate(host, day, month, year);
        await settle(fixture);

        press(host, 'Create account');
        await settle(fixture);

        expect(api.register).toHaveBeenCalledWith(expect.objectContaining({ birthDate: sent }));
      },
    );

    it('refreshes the antiforgery token first, then sends exactly what was typed, the stamp and an empty honeypot', async () => {
      let release!: () => void;
      const { fixture, host, api, csrf } = await render({
        refresh: () => new Promise<void>((resolve) => (release = resolve)),
      });
      await fillVisitor(fixture, host);

      press(host, 'Create account');
      await settle(fixture);
      expect(csrf.refresh).toHaveBeenCalledTimes(1);
      expect(api.register).not.toHaveBeenCalled();

      release();
      await settle(fixture);
      expect(api.register).toHaveBeenCalledTimes(1);
      expect(api.register.mock.calls[0][0]).toStrictEqual(VISITOR_BODY);
    });

    it('sends whatever filled the honeypot, for the server to drop', async () => {
      const { fixture, host, api } = await render();
      await fillVisitor(fixture, host);
      type(host, '#train-website', 'https://offers.example');
      await settle(fixture);

      press(host, 'Create account');
      await settle(fixture);

      expect(api.register.mock.calls[0][0]).toStrictEqual({
        ...VISITOR_BODY,
        website: 'https://offers.example',
      });
    });

    it('asks for each published document to be ticked, and sends the ones ticked', async () => {
      const { fixture, host, api } = await render({ toAccept: () => of([CONSUMER, PRIVACY]) });
      expect(textOf(query(host, 'fieldset[data-legal] legend'))).toBe('Legal documents');
      await fillVisitor(fixture, host);

      press(host, 'Create account');
      await settle(fixture);
      expect(api.register).not.toHaveBeenCalled();
      expect(lines(host)).toEqual([
        "Your account can't be created yet:",
        'Tick the box for the Consumer terms.',
        'Tick the box for the Privacy Policy.',
      ]);

      tick(host, 'Placeholder sentence for the Consumer terms.');
      tick(host, 'Placeholder sentence for the Privacy Policy.');
      await settle(fixture);
      press(host, 'Create account');
      await settle(fixture);
      expect(api.register.mock.calls[0][0]).toStrictEqual({
        ...VISITOR_BODY,
        legalDocumentIds: ['consumer-1', 'privacy-1'],
      });
    });

    it('says it is signing you up while the server works, with the ellipsis character', async () => {
      const answer = new Subject<TraineeRegistrationResponse>();
      const { fixture, host } = await render({ register: () => answer });
      await fillVisitor(fixture, host);

      press(host, 'Create account');
      await settle(fixture);
      expect(textOf(submit(host))).toBe('Signing you up…');
      expect(submit(host).getAttribute('aria-disabled')).toBe('true');

      answer.next(REGISTERED);
      answer.complete();
      await settle(fixture);
      expect(host.querySelector('[data-registered]')).not.toBeNull();
    });
  });

  describe('someone signed in', () => {
    it('signs up with the account’s own email and no password, asking for neither', async () => {
      const { fixture, host, api } = await render({ user: MEMBER });

      expect(textOf(host.querySelector('h1'))).toBe('Sign up to train.');
      expect(textOf(host.querySelector('.train-account'))).toBe(
        'Sign up using member@example.test.',
      );
      for (const label of ['Email', 'Password', 'Confirm password']) {
        expect(() => field(host, label)).toThrow();
      }
      expect(host.querySelector('input[type="password"]')).toBeNull();
      expect(host.querySelector('.auth-alt')).toBeNull();
      expect(host.querySelector('.auth--embedded')).not.toBeNull();
      expect(textOf(submit(host))).toBe('Sign up');

      await fillSignedIn(fixture, host);
      press(host, 'Sign up');
      await settle(fixture);

      expect(api.register.mock.calls[0][0]).toStrictEqual({
        firstName: 'Nour',
        lastName: 'Sample',
        email: 'member@example.test',
        birthDate: '1990-03-27',
        password: null,
        website: '',
        legalDocumentIds: [],
        formStamp: 'stamp-1',
      });
    });

    it('asks only for the names and the date of birth before sending, as a sign-up, not an account', async () => {
      const { fixture, host, api } = await render({ user: MEMBER });

      press(host, 'Sign up');
      await settle(fixture);

      expect(api.register).not.toHaveBeenCalled();
      expect(lines(host)).toEqual([
        "You can't sign up yet:",
        'Enter your first name.',
        'Enter your last name.',
        'Enter your date of birth.',
      ]);
    });

    it('treats a session that ended by itself as a visitor’s: the email and passwords are asked and sent', async () => {
      const { fixture, host, api } = await render({ user: MEMBER, ended: true });

      expect(textOf(host.querySelector('h1'))).toBe('Create your account.');
      expect(host.querySelector('.train-account')).toBeNull();
      expect(host.querySelector('.auth--embedded')).toBeNull();
      expect(textOf(submit(host))).toBe('Create account');

      // fillVisitor fails if Email, Password or Confirm password is not drawn.
      await fillVisitor(fixture, host);
      press(host, 'Create account');
      await settle(fixture);

      expect(api.register).toHaveBeenCalledTimes(1);
      expect(api.register.mock.calls[0][0]).toStrictEqual(VISITOR_BODY);
    });
  });

  describe('the answer', () => {
    it('replaces the form with Check your email once the account waits for its link', async () => {
      const { fixture, host } = await render();
      await fillVisitor(fixture, host);

      press(host, 'Create account');
      await settle(fixture);

      const answer = query(host, '[data-registered]');
      expect(answer.getAttribute('role')).toBe('status');
      expect(textOf(answer.querySelector('h2'))).toBe('Check your email');
      expect(textOf(answer)).toContain(
        'We sent a link to nour@example.test. Open it to finish signing up.',
      );
      expect(textOf(answer)).toContain(
        'The link works for one day. This week’s places go to the people who open their link first.',
      );
      expect(links(answer)).toEqual([['Return to sign in', '/auth/sign-in']]);
      expect(host.querySelector('form')).toBeNull();
      expect(document.activeElement).toBe(answer.querySelector('h2'));
    });

    it('says plainly that no link is coming when this server sends no email', async () => {
      const { fixture, host } = await render({
        register: () => of({ ...REGISTERED, emailAvailable: false }),
      });
      await fillVisitor(fixture, host);

      press(host, 'Create account');
      await settle(fixture);

      const answer = query(host, '[data-registered]');
      expect(textOf(answer.querySelector('h2'))).toBe('Email is off on this server');
      expect(textOf(answer)).toContain(
        'Your account for nour@example.test is created, but this server sends no email, so the confirmation link you need to sign in can’t reach you.',
      );
      expect(textOf(answer)).toContain(
        'If you were given a sign-in for this server, use that instead.',
      );
      expect(textOf(answer)).not.toContain('Check your email');
    });

    it('offers the development confirmation when the server gives its link', async () => {
      const link = '/auth/confirm-email?userId=user-9&token=dev-token';
      const { fixture, host } = await render({
        register: () => of({ ...REGISTERED, developmentConfirmationUrl: link }),
      });
      await fillVisitor(fixture, host);

      press(host, 'Create account');
      await settle(fixture);

      expect(links(query(host, '[data-registered]'))).toEqual([
        ['Open development confirmation', link],
        ['Return to sign in', '/auth/sign-in'],
      ]);
    });

    it('opens Today in the house the account just joined, chosen by its name among the new memberships', async () => {
      const { fixture, host, tenants, router } = await render({
        user: MEMBER,
        register: () => of(JOINED),
        memberships: [COACHED],
        after: [COACHED, membership('space-other', 'Harbour Lifts'), HOUSE],
      });
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      await fillSignedIn(fixture, host);

      press(host, 'Sign up');
      await settle(fixture);

      expect(tenants.load).toHaveBeenCalledTimes(1);
      expect(tenants.select).toHaveBeenCalledWith('space-house');
      expect(navigate).toHaveBeenCalledWith('/');
      expect(tenants.select.mock.invocationCallOrder[0]).toBeLessThan(
        navigate.mock.invocationCallOrder[0],
      );
    });

    it('opens the one new membership whatever its name, never a space the account was already in', async () => {
      const namesake = membership('space-namesake', 'Juniper Yard');
      const { fixture, host, tenants, router } = await render({
        user: MEMBER,
        register: () => of(JOINED),
        memberships: [namesake],
        after: [namesake, membership('space-house', 'TB Gym')],
      });
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      await fillSignedIn(fixture, host);

      press(host, 'Sign up');
      await settle(fixture);

      expect(tenants.select).toHaveBeenCalledWith('space-house');
      expect(tenants.select).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/');
    });

    it('still opens Today when the memberships cannot be read again', async () => {
      const { fixture, host, tenants, router } = await render({
        user: MEMBER,
        register: () => of(JOINED),
        memberships: [COACHED],
        after: 'fails',
      });
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      await fillSignedIn(fixture, host);

      press(host, 'Sign up');
      await settle(fixture);

      expect(tenants.load).toHaveBeenCalledTimes(1);
      expect(tenants.select).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/');
    });
  });

  describe('a refusal', () => {
    async function refusedWith(error: HttpErrorResponse, visit: Visit = {}) {
      const view = await render({ register: () => throwError(() => error), ...visit });
      if (visit.user) await fillSignedIn(view.fixture, view.host);
      else await fillVisitor(view.fixture, view.host);
      press(view.host, visit.user ? 'Sign up' : 'Create account');
      await settle(view.fixture);
      return view;
    }

    it('turns the page into the closed one when sign-up closed meanwhile, naming no house', async () => {
      const { host } = await refusedWith(refusal(409, 'trainee_sign_up_closed'));

      const notice = query(host, '[data-closed] .auth-message');
      expect(textOf(notice)).toBe('Sign-up is closed right now.');
      expect(links(query(host, '[data-closed]'))).toEqual([
        ['Back to Train with TB Gym', '/train'],
      ]);
      expect(host.querySelector('form')).toBeNull();
      expect(textOf(host.querySelector('.auth-eyebrow'))).toBe('TB Gym');
      expect(host.textContent).not.toContain('Juniper Yard');
      expect(document.activeElement).toBe(notice);
    });

    it('turns the page into the full one, with the weekday the refusal says it opens again', async () => {
      const { host } = await refusedWith(
        refusal(409, 'trainee_sign_up_full', { opensAgainOn: '2026-11-23' }),
      );

      const notice = query(host, '[data-full] .auth-message');
      expect(textOf(notice)).toBe('Sign-up is full for this week. It opens again on Monday.');
      expect(host.querySelector('form')).toBeNull();
      expect(textOf(host.querySelector('.auth-eyebrow'))).toBe('Juniper Yard');
      expect(document.activeElement).toBe(notice);
    });

    it('puts the house’s age under the date of birth and in the summary, until the date changes', async () => {
      const { fixture, host } = await refusedWith(
        refusal(409, 'trainee_sign_up_age_not_met', { minimumAge: 19 }),
      );

      expect(underBirthDate(host)).toBe('Sign-up is open to people aged 19 or older.');
      expect(query(host, 'input.year').getAttribute('aria-invalid')).toBe('true');
      expect(lines(host)).toEqual(['Sign-up is open to people aged 19 or older.']);
      expect(document.activeElement).toBe(summary(host));

      birthDate(host, '27', '3', '1989');
      await settle(fixture);
      expect(host.querySelector('app-date-input .tb-field__support--error')).toBeNull();
    });

    it('puts each server field message under its field, and takes one away when that field changes', async () => {
      const { fixture, host } = await refusedWith(
        new HttpErrorResponse({
          status: 400,
          error: {
            title: 'One or more validation errors occurred.',
            status: 400,
            errors: {
              FirstName: ['First name has a character that is not allowed.'],
              Email: ['Use an email address you can open.'],
              Identity: ['Passwords must have at least one non alphanumeric character.'],
            },
          },
        }),
      );

      expect(lines(host)).toEqual(['Check the fields marked above.']);
      expect(under(host, 'First name')).toBe('First name has a character that is not allowed.');
      expect(field(host, 'First name').getAttribute('aria-invalid')).toBe('true');
      expect(under(host, 'Last name')).toBe('');
      expect(under(host, 'Email')).toBe('Use an email address you can open.');
      expect(under(host, 'Password')).toBe(
        'Passwords must have at least one non alphanumeric character.',
      );

      fill(host, 'First name', 'Noura');
      await settle(fixture);
      expect(under(host, 'First name')).toBe('');
      expect(under(host, 'Email')).toBe('Use an email address you can open.');

      fill(host, 'Password', 'Correct-horse-9!');
      await settle(fixture);
      // The help is back under the password once its message goes.
      expect(under(host, 'Password')).toBe(
        'At least 12 characters with upper, lower, number, and symbol.',
      );
    });

    it('offers sign-in and a password reset for an email that has an account, and clears the passwords', async () => {
      const { host } = await refusedWith(refusal(409, 'existing_account_sign_in_required'));

      expect(textOf(summary(host).querySelector('span'))).toBe(
        'An account already uses this email. Sign in with it, then sign up from there. If you already signed up here, open the link in the email we sent you; if that link has stopped working, sign up again in a few days.',
      );
      expect(links(summary(host))).toEqual([
        ['Sign in', '/auth/sign-in?returnUrl=%2Ftrain%2Fsign-up'],
        ['Reset your password', '/auth/forgot-password'],
      ]);
      expect(field(host, 'Password').value).toBe('');
      expect(field(host, 'Confirm password').value).toBe('');
      expect(field(host, 'Email').value).toBe('nour@example.test');
      expect(document.activeElement).toBe(summary(host));
    });

    it('signs the wrong account out on request and reads the sign-up again as a visitor', async () => {
      const { fixture, host, api, auth } = await refusedWith(
        refusal(403, 'wrong_signed_in_account'),
        { user: MEMBER },
      );

      expect(lines(host)).toEqual([
        'You are signed in with a different email. Use that email, or sign out first.',
      ]);
      expect(links(summary(host))).toEqual([]);

      press(host, 'Sign out and continue');
      await settle(fixture);

      expect(auth.logout).toHaveBeenCalledTimes(1);
      expect(auth.initialize).toHaveBeenCalledWith(true);
      expect(api.status).toHaveBeenCalledTimes(2);
      expect(auth.logout.mock.invocationCallOrder[0]).toBeLessThan(
        api.status.mock.invocationCallOrder[1],
      );
      // A visitor's form now, with what was typed kept and nothing left to say.
      expect(textOf(host.querySelector('h1'))).toBe('Create your account.');
      expect(field(host, 'Email').value).toBe('');
      expect(field(host, 'First name').value).toBe('Nour');
      expect(textOf(submit(host))).toBe('Create account');
      expect(textOf(summary(host))).toBe('');
      expect(host.textContent).not.toContain('Sign out and continue');
    });

    it('offers Today to a trainee already in the house', async () => {
      const { host } = await refusedWith(refusal(409, 'trainee_already_joined'), {
        user: MEMBER,
      });

      expect(textOf(summary(host).querySelector('span'))).toBe(
        'You are already part of this coaching space.',
      );
      expect(links(summary(host))).toEqual([['Open Today', '/']]);
    });

    it('opens Today in the house from that refusal, reading the memberships once when the list lacks it', async () => {
      const { fixture, host, tenants, router } = await refusedWith(
        refusal(409, 'trainee_already_joined'),
        { user: MEMBER, memberships: [COACHED], after: [COACHED, HOUSE] },
      );
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      expect(tenants.load).not.toHaveBeenCalled();
      const click = leftClick();

      linkReading(summary(host), 'Open Today').dispatchEvent(click);
      await settle(fixture);

      expect(click.defaultPrevented).toBe(true);
      expect(tenants.load).toHaveBeenCalledTimes(1);
      expect(tenants.select).toHaveBeenCalledTimes(1);
      expect(tenants.select).toHaveBeenCalledWith('space-house');
      expect(navigate).toHaveBeenCalledWith('/');
      expect(tenants.load.mock.invocationCallOrder[0]).toBeLessThan(
        tenants.select.mock.invocationCallOrder[0],
      );
      expect(tenants.select.mock.invocationCallOrder[0]).toBeLessThan(
        navigate.mock.invocationCallOrder[0],
      );
    });

    it.each([
      [
        'someone who was on the house’s team',
        refusal(409, 'trainee_former_staff'),
        'You were on this coaching space’s team, so you can’t sign up to train in it. Talk to its owner.',
      ],
      [
        'someone the house ended or blocked',
        refusal(409, 'trainee_sign_up_not_available'),
        'This coaching space ended your coaching or blocked your access, so you can’t sign up again by yourself. Ask it to invite you back.',
      ],
      [
        'someone who signed up this week already, with the weekday they can again',
        refusal(409, 'trainee_sign_up_once_a_week', { opensAgainOn: '2026-11-23' }),
        'You already signed up this week. You can sign up again on Monday.',
      ],
      [
        'a connection that sent too many sign-ups',
        new HttpErrorResponse({
          status: 429,
          error: { code: 'too_many_attempts', message: 'Server wording.' },
          headers: new HttpHeaders({ 'Retry-After': '45' }),
        }),
        'Too many sign-ups from this connection for now. Try again in an hour.',
      ],
    ])('tells %s why, and keeps the form', async (_who, error, sentence) => {
      const { host, api } = await refusedWith(error);

      expect(lines(host)).toEqual([sentence]);
      expect(links(summary(host))).toEqual([]);
      expect(document.activeElement).toBe(summary(host));
      expect(host.querySelector('form')).not.toBeNull();
      expect(api.register).toHaveBeenCalledTimes(1);
    });

    it('reads the documents again when the server says they changed, keeping what was typed', async () => {
      const replaced = legalDocument('consumer-2', 'ConsumerTerms', 'Consumer terms');
      const { fixture, host, api, legal } = await render({
        toAccept: inTurn<LegalToAccept[]>(
          () => of([CONSUMER]),
          () => of([replaced, PRIVACY]),
        ),
        register: () => throwError(() => refusal(409, 'legal_acceptance_required')),
      });
      await fillVisitor(fixture, host);
      tick(host, 'Placeholder sentence for the Consumer terms.');
      await settle(fixture);

      press(host, 'Create account');
      await settle(fixture);

      expect(api.register).toHaveBeenCalledWith(
        expect.objectContaining({ legalDocumentIds: ['consumer-1'] }),
      );
      expect(legal.toAccept).toHaveBeenCalledTimes(2);
      expect(legal.toAccept).toHaveBeenLastCalledWith('Trainee');
      expect(lines(host)).toEqual([
        'The documents to accept changed while this page was open. Read them again below and tick each box.',
      ]);
      expect(document.activeElement).toBe(summary(host));
      expect(field(host, 'Placeholder sentence for the Consumer terms.').checked).toBe(false);
      expect(host.querySelector('#legal-read-consumer-2')).not.toBeNull();
      expect(host.querySelector('#legal-read-privacy-1')).not.toBeNull();
      expect(field(host, 'First name').value).toBe('Nour');
    });

    it('words anything else as the server did, or with the page’s own sentence', async () => {
      const { fixture, host } = await render({
        register: inTurn<TraineeRegistrationResponse>(
          () =>
            throwError(() =>
              refusal(409, 'registration_conflict', {
                message: 'The sign-up could not be completed. Try again.',
              }),
            ),
          () => throwError(() => new HttpErrorResponse({ status: 500, error: null })),
        ),
      });
      await fillVisitor(fixture, host);

      press(host, 'Create account');
      await settle(fixture);
      expect(lines(host)).toEqual(['The sign-up could not be completed. Try again.']);

      press(host, 'Create account');
      await settle(fixture);
      expect(lines(host)).toEqual(['Your account could not be created. Try again.']);
      expect(host.querySelector('form')).not.toBeNull();
    });

    it('words anything else for someone signed in as their sign-up, not an account', async () => {
      const { host } = await refusedWith(new HttpErrorResponse({ status: 500, error: null }), {
        user: MEMBER,
      });

      expect(lines(host)).toEqual(['You couldn’t be signed up. Try again.']);
      expect(document.activeElement).toBe(summary(host));
      expect(host.querySelector('form')).not.toBeNull();
    });

    // The signed-in form sends no password, so a refusal naming the password or the email means the
    // server saw no session (it ended on another device, or ran out with the page left open).
    describe('of a signed-in form, for a field it does not draw', () => {
      const NO_PASSWORD = fieldsRefused({
        Password: ['A password is required for a new account.'],
      });

      it('reads the session again and, signed out, becomes a visitor’s form keeping the names and date of birth', async () => {
        const { fixture, host, api, auth } = await render({
          user: MEMBER,
          register: () => throwError(() => NO_PASSWORD),
        });
        // Read again, the session is gone.
        auth.initialize.mockImplementation(() => {
          auth.user.set(null);
          return Promise.resolve();
        });
        await fillSignedIn(fixture, host);

        press(host, 'Sign up');
        await settle(fixture);

        expect(auth.initialize).toHaveBeenCalledTimes(1);
        expect(auth.initialize).toHaveBeenCalledWith(true);
        expect(api.status).toHaveBeenCalledTimes(2);
        expect(auth.initialize.mock.invocationCallOrder[0]).toBeLessThan(
          api.status.mock.invocationCallOrder[1],
        );
        expect(textOf(host.querySelector('h1'))).toBe('Create your account.');
        expect(textOf(submit(host))).toBe('Create account');
        expect(field(host, 'First name').value).toBe('Nour');
        expect(field(host, 'Last name').value).toBe('Sample');
        expect(
          ['input.day', 'input.month', 'input.year'].map(
            (box) => query<HTMLInputElement>(host, box).value,
          ),
        ).toEqual(['27', '3', '1990']);
        expect(field(host, 'Email').value).toBe('');
        expect(textOf(summary(host).querySelector('span'))).toBe(
          'You were signed out, so this form now creates a new account. To sign up with the account you have, sign in again.',
        );
        expect(links(summary(host))).toEqual([
          ['Sign in', '/auth/sign-in?returnUrl=%2Ftrain%2Fsign-up'],
          ['Reset your password', '/auth/forgot-password'],
        ]);
        // The server's word was about the form it took for a new account, not this one's empty box.
        expect(under(host, 'Password')).toBe(
          'At least 12 characters with upper, lower, number, and symbol.',
        );
        expect(document.activeElement).toBe(summary(host));
      });

      it.each([
        ['the password', NO_PASSWORD],
        ['the email', fieldsRefused({ Email: ['Enter an email address.'] })],
      ])(
        'asks to try again when a form refused for %s finds the session still there',
        async (_field, error) => {
          const { host, api, auth } = await refusedWith(error, { user: MEMBER });

          expect(auth.initialize).toHaveBeenCalledWith(true);
          expect(api.status).toHaveBeenCalledTimes(2);
          expect(textOf(host.querySelector('h1'))).toBe('Sign up to train.');
          expect(lines(host)).toEqual(['You couldn’t be signed up. Try again.']);
          expect(links(summary(host))).toEqual([]);
          expect(() => field(host, 'Email')).toThrow();
          expect(document.activeElement).toBe(summary(host));
        },
      );

      it('keeps a refusal of a field it draws under that field, without reading the session again', async () => {
        const { host, api, auth } = await refusedWith(
          fieldsRefused({ FirstName: ['First name has a character that is not allowed.'] }),
          { user: MEMBER },
        );

        expect(auth.initialize).not.toHaveBeenCalled();
        expect(api.status).toHaveBeenCalledTimes(1);
        expect(lines(host)).toEqual(['Check the fields marked above.']);
        expect(under(host, 'First name')).toBe('First name has a character that is not allowed.');
      });
    });
  });

  describe('a form sent too soon, or with a stamp the server no longer takes', () => {
    it('sends a form refused as too fast once more, 3.2 seconds after the status was read', async () => {
      const { fixture, host, api, csrf } = await render({
        register: inTurn<TraineeRegistrationResponse>(
          () => throwError(() => TOO_FAST),
          () => of(REGISTERED),
        ),
      });
      await fillVisitor(fixture, host);
      // A second of the wait has gone by while the form was filled in.
      vi.setSystemTime(NOW.getTime() + 1000);
      fakeTimeouts();

      press(host, 'Create account');
      await pass(fixture, 0);
      expect(api.register).toHaveBeenCalledTimes(1);
      expect(textOf(submit(host))).toBe('Signing you up…');

      await pass(fixture, 2199);
      expect(api.register).toHaveBeenCalledTimes(1);
      await pass(fixture, 1);
      expect(api.register).toHaveBeenCalledTimes(2);
      expect(csrf.refresh).toHaveBeenCalledTimes(2);
      expect(api.register.mock.calls[1][0]).toStrictEqual(VISITOR_BODY);

      await realTimeouts(fixture);
      expect(textOf(query(host, '[data-registered] h2'))).toBe('Check your email');
    });

    it('sends again at once when the form was open longer than that', async () => {
      const { fixture, host, api } = await render({
        register: inTurn<TraineeRegistrationResponse>(
          () => throwError(() => TOO_FAST),
          () => of(REGISTERED),
        ),
      });
      await fillVisitor(fixture, host);
      vi.setSystemTime(NOW.getTime() + 10_000);

      press(host, 'Create account');
      await settle(fixture);

      expect(api.register).toHaveBeenCalledTimes(2);
      expect(host.querySelector('[data-registered]')).not.toBeNull();
    });

    it('says so when the second sending is refused as too fast as well, and sends no third', async () => {
      const { fixture, host, api } = await render({ register: () => throwError(() => TOO_FAST) });
      await fillVisitor(fixture, host);
      fakeTimeouts();

      press(host, 'Create account');
      await pass(fixture, 0);
      await pass(fixture, 3200);
      await realTimeouts(fixture);

      expect(api.register).toHaveBeenCalledTimes(2);
      expect(lines(host)).toEqual(['That was quick. Give it a moment and send again.']);
      expect(document.activeElement).toBe(summary(host));
    });

    it('reads a fresh stamp and sends once more with it, after the wait', async () => {
      const { fixture, host, api } = await render({
        status: inTurn<TrainSignUp>(
          () => of(OPEN),
          () => of({ ...OPEN, formStamp: 'stamp-2' }),
        ),
        register: inTurn<TraineeRegistrationResponse>(
          () => throwError(() => STAMP_REFUSED),
          () => of(REGISTERED),
        ),
      });
      await fillVisitor(fixture, host);
      // Long on the page: the wait now runs from the fresh read.
      vi.setSystemTime(NOW.getTime() + 60_000);
      fakeTimeouts();

      press(host, 'Create account');
      await pass(fixture, 0);
      expect(api.status).toHaveBeenCalledTimes(2);
      expect(api.register).toHaveBeenCalledTimes(1);

      await pass(fixture, 3199);
      expect(api.register).toHaveBeenCalledTimes(1);
      await pass(fixture, 1);
      expect(api.register).toHaveBeenCalledTimes(2);
      expect(api.register.mock.calls[1][0]).toStrictEqual({
        ...VISITOR_BODY,
        formStamp: 'stamp-2',
      });

      await realTimeouts(fixture);
      expect(host.querySelector('[data-registered]')).not.toBeNull();
    });

    it('asks to reload the page when the fresh stamp is refused too, and sends no third', async () => {
      const { fixture, host, api } = await render({
        status: inTurn<TrainSignUp>(
          () => of(OPEN),
          () => of({ ...OPEN, formStamp: 'stamp-2' }),
        ),
        register: () => throwError(() => STAMP_REFUSED),
      });
      await fillVisitor(fixture, host);
      fakeTimeouts();

      press(host, 'Create account');
      await pass(fixture, 0);
      await pass(fixture, 3200);
      await realTimeouts(fixture);

      expect(api.status).toHaveBeenCalledTimes(2);
      expect(api.register).toHaveBeenCalledTimes(2);
      expect(lines(host)).toEqual([
        'The form needs to be opened again before it can be sent. Reload the page and send it again.',
      ]);
    });

    it('shows what sign-up became when the fresh read is no longer open, without sending again', async () => {
      for (const [now, shown, sentence] of [
        [FULL, '[data-full]', 'Sign-up is full for this week. It opens again on Monday.'],
        [CLOSED_SIGN_UP, '[data-closed]', 'Sign-up is closed right now.'],
      ] as const) {
        const { fixture, host, api } = await render({
          status: inTurn<TrainSignUp>(
            () => of(OPEN),
            () => of(now),
          ),
          register: () => throwError(() => STAMP_REFUSED),
        });
        await fillVisitor(fixture, host);

        press(host, 'Create account');
        await settle(fixture);

        expect(api.register).toHaveBeenCalledTimes(1);
        expect(host.querySelector('form')).toBeNull();
        const notice = query(host, `${shown} .auth-message`);
        expect(textOf(notice)).toBe(sentence);
        expect(document.activeElement).toBe(notice);
        TestBed.resetTestingModule();
      }
    });

    it('stops when the fresh read says the account joined meanwhile, and says so with Today', async () => {
      const { fixture, host, api } = await render({
        user: MEMBER,
        status: inTurn<TrainSignUp>(
          () => of(OPEN),
          () => of({ ...OPEN, formStamp: 'stamp-2', caller: 'Joined' }),
        ),
        register: () => throwError(() => STAMP_REFUSED),
      });
      await fillSignedIn(fixture, host);

      press(host, 'Sign up');
      await settle(fixture);

      expect(api.register).toHaveBeenCalledTimes(1);
      expect(host.querySelector('form')).toBeNull();
      const notice = query(host, '[data-joined] .auth-message');
      expect(textOf(notice)).toBe('You’re already training with TB Gym.');
      expect(document.activeElement).toBe(notice);
    });

    it.each([
      ['too fast', TOO_FAST],
      ['with a stamp the server no longer takes', STAMP_REFUSED],
    ])(
      'sends nothing more and opens nothing when the page is left during the wait after a form sent %s',
      async (_case, first) => {
        const { fixture, host, api, tenants, router } = await render({
          user: MEMBER,
          status: inTurn<TrainSignUp>(
            () => of(OPEN),
            () => of({ ...OPEN, formStamp: 'stamp-2' }),
          ),
          // Sent again, the form would join at once and open Today in the house.
          register: inTurn<TraineeRegistrationResponse>(
            () => throwError(() => first),
            () => of(JOINED),
          ),
          memberships: [COACHED],
          after: [COACHED, HOUSE],
        });
        const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
        const submitted = vi.spyOn(
          fixture.componentInstance as unknown as { submit(): Promise<void> },
          'submit',
        );
        await fillSignedIn(fixture, host);
        fakeTimeouts();

        press(host, 'Sign up');
        await pass(fixture, 0);
        expect(api.register).toHaveBeenCalledTimes(1);

        // Back to /train while the page waits out the rest of the three seconds.
        fixture.destroy();
        await vi.advanceTimersByTimeAsync(3200);

        // The press's work ends quietly: nothing is thrown into an unhandled rejection.
        expect(submitted).toHaveBeenCalledTimes(1);
        await expect(submitted.mock.results[0].value).resolves.toBeUndefined();
        expect(api.register).toHaveBeenCalledTimes(1);
        expect(tenants.load).not.toHaveBeenCalled();
        expect(tenants.select).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
      },
    );
  });
});
