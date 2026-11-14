import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ClientSelfProfile } from '../../core/api/api.models';
import type { HouseProgramsView, StrengthMaxView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
import { fill, field, formSummary, press, settle, toggleFold } from '../../../testing/dom';
import {
  BASE_1_LISTING,
  BASE_2_LISTING,
  BENCH_ID,
  houseProgram,
  housePlansView,
  housePrograms,
  POWER_LISTING,
  powerbuilding,
  programMax,
  proPass,
  proPlusAsk,
  proPlusOffer,
  runningBlock,
  secondBlock,
  SQUAT_ID,
  startedView,
  typedMaxView,
  underPass,
} from '../../../testing/house-program-fixtures';
import { finishedProfile } from '../../../testing/intake-fixtures';
import { HousePlansApi } from '../account/house-plans-api';
import { toHousePlans, type HousePlans } from '../account/house-plans.models';
import { HousePrograms } from './house-programs';
import { HouseProgramsApi } from './house-programs-api';
import {
  toHouseProgramStarted,
  toHousePrograms,
  type HousePrograms as HouseProgramsRead,
  type HouseProgramStarted,
} from './house-programs.models';

type Answer<T> = () => Observable<T>;

interface Answers {
  readonly programs?: Answer<HouseProgramsRead>;
  readonly plans?: Answer<HousePlans>;
  /** The trainee's own profile: a trainee of the house on Free unless told (N9c5b). */
  readonly self?: Answer<ClientSelfProfile>;
  readonly start?: (listingId: string, request: unknown) => Observable<HouseProgramStarted>;
  readonly recordMax?: (request: unknown) => Observable<StrengthMaxView>;
}

const read = (view: HouseProgramsView) => () => of(toHousePrograms(view));
const refuse =
  (status: number, error: unknown = null) =>
  () =>
    throwError(() => new HttpErrorResponse({ status, error }));
const conflict = (code: string) => refuse(409, { code, message: 'The server’s own words.' });

async function render(answers: Answers = {}) {
  const calls: string[] = [];
  const start = answers.start ?? (() => of(toHouseProgramStarted(startedView())));
  const recordMax = answers.recordMax ?? (() => of(typedMaxView()));
  const api = {
    programs: vi.fn(answers.programs ?? read(housePrograms())),
    start: vi.fn((listingId: string, request: unknown) => {
      calls.push('start');
      return start(listingId, request);
    }),
    recordMax: vi.fn((request: unknown) => {
      calls.push('max');
      return recordMax(request);
    }),
  };
  const housePlans = {
    plans: vi.fn(answers.plans ?? (() => of(toHousePlans(housePlansView())))),
    ask: vi.fn(),
    moneySent: vi.fn(),
  };
  const profiles = {
    getSelfProfile: vi.fn(answers.self ?? (() => of(finishedProfile({ selfDirected: true })))),
  };
  const csrf = {
    refresh: vi.fn(() => {
      calls.push('csrf');
      return Promise.resolve();
    }),
  };
  const toast = { show: vi.fn() };
  await TestBed.configureTestingModule({
    imports: [HousePrograms],
    providers: [
      provideRouter([]),
      { provide: HouseProgramsApi, useValue: api },
      { provide: HousePlansApi, useValue: housePlans },
      { provide: ApiClient, useValue: profiles },
      { provide: CsrfService, useValue: csrf },
      { provide: UiToast, useValue: toast },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-house') } },
    ],
  }).compileComponents();
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(HousePrograms);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    api,
    housePlans,
    profiles,
    csrf,
    calls,
    toast,
    navigate,
    settle: () => settle(fixture),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The newest open dialog or sheet, which the kit draws outside the page. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};
const card = (host: HTMLElement, listingId: string) =>
  host.querySelector<HTMLElement>(`[data-program="${listingId}"]`)!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('HousePrograms', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  describe('its states', () => {
    it('shows a skeleton while the programs are on their way', async () => {
      const { host } = await render({ programs: () => new Subject<never>() });

      expect(textOf(host.querySelector('h1'))).toBe('Programs');
      expect(textOf(host.querySelector('.lede'))).toBe(
        'Programs written by TB Gym’s coach. You follow one at a time.',
      );
      expect(host.querySelector('app-skeleton')).not.toBeNull();
      expect(host.querySelector('[data-program]')).toBeNull();
    });

    it('says a failed read in words and reads again on Try again', async () => {
      const programs = vi
        .fn<Answer<HouseProgramsRead>>()
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
        .mockReturnValue(of(toHousePrograms(housePrograms())));
      const { host, api, settle } = await render({ programs });

      expect(textOf(host.querySelector('[role="alert"]'))).toBe(
        'TB Gym’s programs couldn’t be loaded.',
      );
      press(host, 'Try again');
      await settle();

      expect(api.programs).toHaveBeenCalledTimes(2);
      expect(host.querySelectorAll('[data-program]')).toHaveLength(3);
    });

    it('says the programs aren’t open outside the house, with the way back to Training', async () => {
      const { host, housePlans, profiles } = await render({ programs: refuse(404) });

      const gone = host.querySelector('[data-programs-gone]')!;
      expect(textOf(gone)).toContain('Programs aren’t open here');
      expect(textOf(gone)).toContain(
        'TB Gym’s programs are for people who train with TB Gym on their own.',
      );
      expect(gone.querySelector('a')!.getAttribute('href')).toBe('/training/program');
      expect(housePlans.plans).not.toHaveBeenCalled();
      expect(profiles.getSelfProfile).not.toHaveBeenCalled();
    });

    it('says Training is closed, for a 403 or when the server refuses every program for it', async () => {
      const { host } = await render({ programs: refuse(403) });
      expect(textOf(host.querySelector('[data-programs-closed]'))).toContain(
        'Training isn’t open for you right now.',
      );

      TestBed.resetTestingModule();
      const closed = await render({
        programs: read(
          housePrograms({
            programs: [
              houseProgram({ refusal: 'training_closed' }),
              secondBlock({ refusal: 'training_closed' }),
            ],
          }),
        ),
      });
      expect(textOf(closed.host.querySelector('[data-programs-closed]'))).toContain(
        'Programs are closed for now',
      );
      expect(closed.host.querySelector('[data-program]')).toBeNull();
      expect(closed.housePlans.plans).not.toHaveBeenCalled();
      expect(closed.profiles.getSelfProfile).not.toHaveBeenCalled();
    });

    it('says when TB Gym offers no program yet', async () => {
      const { host } = await render({ programs: read(housePrograms({ programs: [] })) });

      expect(textOf(host.querySelector('[data-programs-empty]'))).toContain('No programs yet');
    });
  });

  describe('on Free', () => {
    it('says Pro+ is needed and offers to ask for it on My plan while Pro+ is on sale', async () => {
      const { host, housePlans, profiles } = await render();

      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass.querySelector('.pass-title'))).toBe(
        'Starting a program needs Pro+. Free keeps running, with everything you logged.',
      );
      const ask = pass.querySelector<HTMLAnchorElement>('[data-ask-pro]')!;
      expect(textOf(ask)).toBe('Ask for Pro+');
      expect(ask.getAttribute('href')).toBe('/plan');
      expect(housePlans.plans).toHaveBeenCalledTimes(1);
      // Read beside the plans: Max does not coach this trainee, so Free's words stand (N9c5b).
      expect(profiles.getSelfProfile).toHaveBeenCalledTimes(1);
      expect(pass.querySelector('[data-max-coach]')).toBeNull();
    });

    it('lists each program with whom it suits, its block, its weeks and its week 1, and nothing to start', async () => {
      const { host, fixture } = await render();

      const first = card(host, BASE_1_LISTING);
      expect(textOf(first.querySelector('.kicker'))).toBe('Block 1 of Strength Base');
      expect(textOf(first.querySelector('h2'))).toBe('Strength Base 1');
      expect(textOf(first.querySelector('.suits'))).toBe(
        'For: New to the barbell, two days a week.',
      );
      expect(textOf(first.querySelector('.weeks'))).toBe('2 weeks · kg');
      expect(textOf(first.querySelector('.description'))).toBe(
        'Squat and row twice a week, adding a little each week.',
      );
      expect(textOf(card(host, POWER_LISTING).querySelector('.kicker'))).toBe('');

      await toggleFold(fixture, first, 'Week 1');
      const sessions = [...first.querySelectorAll('.sessions > li')];
      expect(sessions.map((session) => textOf(session.querySelector('h3')))).toEqual([
        'Day 1 · Day A',
        'Day 4 · Day B',
      ]);
      expect([...sessions[0].querySelectorAll('.exercises li')].map(textOf)).toEqual([
        'Back squat · 3 × 5 · main lift',
        'Barbell row · 2 × 8–12',
      ]);

      const maxes = first.querySelector('[data-maxes]')!;
      expect(textOf(maxes.querySelector('.maxes-head'))).toBe(
        'Works its weights out from your max for:',
      );
      expect([...maxes.querySelectorAll('li')].map(textOf)).toEqual(['Back squat: not typed yet']);
      // On Free nothing starts and nothing is typed: the pass card says why, once.
      expect(host.querySelector('[data-start-program], [data-type-maxes]')).toBeNull();
      expect(host.querySelector('[data-refusal]')).toBeNull();
      expect(textOf(host)).not.toContain('Started');
    });

    it('sends an open ask to My plan instead of asking again', async () => {
      const { host } = await render({
        plans: () =>
          of(toHousePlans(housePlansView({ asks: [proPlusAsk({ state: 'MoneySent' })] }))),
      });

      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass.querySelector('[data-asked]'))).toBe(
        'You asked for Pro+ Programs. My plan shows where it stands.',
      );
      expect(pass.querySelector('[data-my-plan]')!.getAttribute('href')).toBe('/plan');
      expect(pass.querySelector('[data-ask-pro]')).toBeNull();
    });

    it('says Pro+ can’t be asked for while asks are off, or no Pro+ is on sale', async () => {
      const { host } = await render({
        plans: () => of(toHousePlans(housePlansView({ asksOpen: false, plans: [] }))),
      });
      expect(textOf(host.querySelector('[data-asks-off]'))).toBe('Pro+ can’t be asked for yet.');
      expect(host.querySelector('[data-ask-pro]')).toBeNull();

      TestBed.resetTestingModule();
      const maxOnly = await render({
        plans: () =>
          of(toHousePlans(housePlansView({ plans: [proPlusOffer({ tier: 'Max', name: 'Max' })] }))),
      });
      expect(maxOnly.host.querySelector('[data-asks-off]')).not.toBeNull();
      expect(maxOnly.host.querySelector('[data-ask-pro]')).toBeNull();
    });

    it('keeps the first sentence alone when what TB Gym sells can’t be read', async () => {
      const { host } = await render({ plans: refuse(404) });

      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass)).toBe(
        'Starting a program needs Pro+. Free keeps running, with everything you logged.',
      );
      expect(host.querySelectorAll('[data-program]')).toHaveLength(3);
    });
  });

  describe('on Max (notes plan N9c5b)', () => {
    /** A trainee of the house whom Max coaches today. */
    const onMax = () => () => of(finishedProfile({ selfDirected: true, coachedByTheHouse: true }));
    const MAX_WORDS = 'You’re on Max, so your coach picks your program and puts it on Training.';

    it('says their coach picks their program, with the way to Training, and offers no Pro+', async () => {
      const { host, housePlans, profiles } = await render({ self: onMax() });

      const pass = host.querySelector('[data-pass]')!;
      expect(pass.getAttribute('aria-label')).toBe('Your plan');
      const title = pass.querySelector('.pass-title')!;
      expect(title.hasAttribute('data-max-coach')).toBe(true);
      expect(textOf(title)).toBe(MAX_WORDS);
      const open = pass.querySelector<HTMLAnchorElement>('[data-open-training]')!;
      expect(textOf(open)).toBe('Open Training');
      expect(open.getAttribute('href')).toBe('/training/program');
      expect(textOf(pass)).toBe(`${MAX_WORDS} Open Training`);
      // Nothing to ask for and no line of Free's; the tab bar, not this page, leads to Messages.
      expect(pass.querySelector('[data-ask-pro], [data-asked], [data-asks-off]')).toBeNull();
      expect(textOf(host)).not.toContain('Free keeps running');
      expect(textOf(host)).not.toContain('Ask for Pro+');
      expect(host.querySelector('a[href="/plan"], a[href="/messages"]')).toBeNull();
      expect(host.querySelector('[data-start-program], [data-type-maxes]')).toBeNull();
      expect(host.querySelectorAll('[data-program]')).toHaveLength(3);
      expect(profiles.getSelfProfile).toHaveBeenCalledTimes(1);
      expect(housePlans.plans).toHaveBeenCalledTimes(1);
    });

    it('names the program their coach put on Training, and the day it runs until', async () => {
      const { host } = await render({
        self: onMax(),
        programs: read(housePrograms({ running: runningBlock() })),
      });

      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass.querySelector('[data-max-coach]'))).toBe(MAX_WORDS);
      expect(textOf(pass.querySelector('[data-running]'))).toBe(
        'Strength Base 1 runs until Fri 27 Nov.',
      );
      expect(pass.querySelector('[data-running] bdi')?.getAttribute('dir')).toBe('auto');
      expect(pass.querySelector('[data-open-training]')).not.toBeNull();
      expect(pass.querySelector('[data-running-stranded]')).toBeNull();
      expect(textOf(pass)).not.toContain('Pro+');
    });

    it('reads the profile beside the plans, and draws the card once both have answered', async () => {
      const self = new Subject<ClientSelfProfile>();
      const plans = new Subject<HousePlans>();
      const { host, housePlans, profiles, settle } = await render({
        self: () => self,
        plans: () => plans,
      });

      // Both asked at once, before either answers: Free waits for no second round trip.
      expect(profiles.getSelfProfile).toHaveBeenCalledTimes(1);
      expect(housePlans.plans).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[data-pass]')).toBeNull();
      expect(host.querySelector('app-skeleton')).not.toBeNull();

      plans.next(toHousePlans(housePlansView()));
      plans.complete();
      await settle();
      // Ask for Pro+ never shows first, to be taken away once the profile says Max.
      expect(host.querySelector('[data-pass]')).toBeNull();
      expect(host.querySelector('[data-ask-pro]')).toBeNull();

      self.next(finishedProfile({ selfDirected: true, coachedByTheHouse: true }));
      self.complete();
      await settle();
      expect(textOf(host.querySelector('[data-max-coach]'))).toBe(MAX_WORDS);
      expect(host.querySelector('[data-ask-pro]')).toBeNull();
    });

    it('keeps the Pro+ card under a running Pro+ pass, and reads neither the profile nor the plans', async () => {
      const { host, housePlans, profiles } = await render({
        self: onMax(),
        programs: read(underPass({ running: runningBlock() })),
      });

      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass.querySelector('.pass-title'))).toBe('Pro+ until Fri 11 Dec');
      expect(pass.querySelector('[data-max-coach]')).toBeNull();
      expect(textOf(card(host, BASE_1_LISTING).querySelector('[data-start-program]'))).toBe(
        'Start Strength Base 1',
      );
      expect(profiles.getSelfProfile).not.toHaveBeenCalled();
      expect(housePlans.plans).not.toHaveBeenCalled();
    });

    it('keeps Free’s words when the profile can’t be read', async () => {
      const { host } = await render({ self: refuse(500) });

      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass.querySelector('.pass-title'))).toBe(
        'Starting a program needs Pro+. Free keeps running, with everything you logged.',
      );
      expect(pass.querySelector('[data-ask-pro]')).not.toBeNull();
      expect(pass.querySelector('[data-max-coach]')).toBeNull();
      expect(host.querySelectorAll('[data-program]')).toHaveLength(3);
    });

    it('keeps Max’s words when what TB Gym sells can’t be read', async () => {
      const { host } = await render({ self: onMax(), plans: refuse(500) });

      expect(textOf(host.querySelector('[data-pass]'))).toBe(`${MAX_WORDS} Open Training`);
    });
  });

  describe('under a pass', () => {
    it('names the pass and the program running, and never reads what TB Gym sells', async () => {
      const { host, housePlans, profiles } = await render({
        programs: read(underPass({ running: runningBlock() })),
      });

      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass.querySelector('.pass-title'))).toBe('Pro+ until Fri 11 Dec');
      expect(textOf(pass)).toContain('Strength Base 1 runs until Fri 27 Nov.');
      const open = pass.querySelector('[data-open-training]')!;
      expect(textOf(open)).toBe('Open Training');
      expect(open.getAttribute('href')).toBe('/training/program');
      expect(host.querySelector('[data-running-stranded]')).toBeNull();
      expect(housePlans.plans).not.toHaveBeenCalled();
      expect(profiles.getSelfProfile).not.toHaveBeenCalled();
    });

    it('never says “runs until” for a program whose plan ended with a workout of it open', async () => {
      const typed = programMax({ value: 140, from: 'Typed', on: '2026-11-12' });
      const { host } = await render({
        programs: read(
          underPass({
            // A new pass, booked after the one block 1 was started under was cancelled.
            pass: proPass(),
            running: runningBlock({ startDate: '2026-11-07', endDateExclusive: '2026-11-21' }),
            programs: [
              secondBlock({ maxes: [typed], refusal: 'house_program_block_not_open' }),
              powerbuilding({
                maxes: [typed],
                refusal: 'mesocycle_overlap',
                opensOn: null,
                lastStartDay: null,
              }),
            ],
          }),
        ),
      });

      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass.querySelector('[data-running-stranded]'))).toBe(
        'Strength Base 1’s plan has ended, and a workout you started in it is still open.',
      );
      expect(textOf(pass)).not.toContain('runs until');
      expect(pass.querySelector('[data-running]')).toBeNull();
      expect(pass.querySelector('[data-open-training]')!.getAttribute('href')).toBe(
        '/training/program',
      );
      expect(textOf(card(host, POWER_LISTING).querySelector('[data-refusal]'))).toBe(
        'A workout you started in “Strength Base 1” is still open, and its plan has ended, so another program can’t start yet.',
      );
    });

    it('offers Start with its last day, and says why the others wait', async () => {
      const { host } = await render({ programs: read(underPass()) });

      const first = card(host, BASE_1_LISTING);
      expect(textOf(first.querySelector('[data-start-program]'))).toBe('Start Strength Base 1');
      expect(textOf(first.querySelector('[data-last-start]'))).toBe(
        'Last day to start it under this pass: Fri 27 Nov',
      );
      expect(textOf(card(host, BASE_2_LISTING).querySelector('[data-refusal]'))).toBe(
        'This is block 2 of Strength Base. Start block 1 first.',
      );
      expect(textOf(card(host, POWER_LISTING).querySelector('[data-refusal]'))).toBe(
        'This block runs 6 weeks, longer than your pass, so it can’t start under it.',
      );
      expect(host.querySelectorAll('[data-start-program]')).toHaveLength(1);
      // Every lift of block 1 has a max: the button changes them.
      const change = first.querySelector('[data-type-maxes]')!;
      expect(textOf(change)).toBe('Change your maxes');
      expect(change.getAttribute('aria-label')).toBe('Change your maxes, for Strength Base 1');
      const type = card(host, POWER_LISTING).querySelector('[data-type-maxes]')!;
      expect(textOf(type)).toBe('Type your maxes');
      expect(type.getAttribute('aria-label')).toBe('Type your maxes, for Powerbuilding 6');
    });

    it('says when the next block opens', async () => {
      const { host } = await render({
        programs: read(
          underPass({
            running: runningBlock(),
            programs: [
              houseProgram({
                maxes: [programMax({ value: 140, from: 'Typed', on: '2026-11-14' })],
                refusal: 'mesocycle_overlap',
                opensOn: '2026-11-28',
                lastStartDay: '2026-11-27',
              }),
              secondBlock({ refusal: 'house_program_block_not_open', opensOn: '2026-11-28' }),
            ],
          }),
        ),
      });

      expect(textOf(card(host, BASE_2_LISTING).querySelector('[data-refusal]'))).toBe(
        'Block 2 of Strength Base opens on Sat 28 Nov, once block 1 has ended.',
      );
      expect(textOf(card(host, BASE_1_LISTING).querySelector('[data-refusal]'))).toBe(
        '“Strength Base 1” runs until Fri 27 Nov. One program at a time.',
      );
      expect(host.querySelector('[data-start-program]')).toBeNull();
    });
  });

  describe('Start', () => {
    it('asks once, then starts the version read with a key, says so and opens Training', async () => {
      const { host, api, calls, toast, navigate, settle } = await render({
        programs: read(underPass()),
      });

      press(card(host, BASE_1_LISTING), 'Start Strength Base 1');
      await settle();
      expect(textOf(dialog()!.querySelector('.tb-modal__title'))).toBe('Start Strength Base 1?');
      expect(textOf(dialog())).toContain(
        'It runs 2 weeks, from today until Fri 27 Nov. One program at a time: TB Gym’s other programs wait until it ends.',
      );
      press(dialog()!, 'Start program');
      await settle();
      await settle();

      expect(api.start).toHaveBeenCalledTimes(1);
      const [listingId, request] = api.start.mock.calls[0] as [
        string,
        { templateVersionId: string; idempotencyKey: string },
      ];
      expect(listingId).toBe(BASE_1_LISTING);
      expect(request.templateVersionId).toBe(houseProgram().templateVersionId);
      expect(request.idempotencyKey).toMatch(UUID);
      expect(calls).toEqual(['csrf', 'start']);
      expect(toast.show).toHaveBeenCalledWith(
        'Strength Base 1 started. Its sessions are on Today and Training.',
        { tone: 'success' },
      );
      expect(navigate).toHaveBeenCalledWith(['/training/program']);
    });

    it('starts nothing on Not now, and opens one question for two presses', async () => {
      const { host, api, settle } = await render({ programs: read(underPass()) });

      const start = card(host, BASE_1_LISTING).querySelector<HTMLButtonElement>(
        '[data-start-program]',
      )!;
      start.click();
      start.click();
      await settle();
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      press(dialog()!, 'Not now');
      await settle();

      expect(api.start).not.toHaveBeenCalled();
      expect(dialog()).toBeNull();
    });

    it('says a refusal under the button in the card’s words, and a retry sends the same key', async () => {
      const start = vi
        .fn()
        .mockReturnValueOnce(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 409,
                error: { code: 'house_program_unit', message: 'The server’s words.' },
              }),
          ),
        )
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
        .mockReturnValue(of(toHouseProgramStarted(startedView())));
      const { host, api, navigate, settle } = await render({ programs: read(underPass()), start });

      const first = card(host, BASE_1_LISTING);
      press(first, 'Start Strength Base 1');
      await settle();
      press(dialog()!, 'Start program');
      await settle();
      await settle();
      expect(textOf(first.querySelector('[data-start-problem][role="alert"]'))).toBe(
        'This program mixes kg and lb, so it can’t be started until TB Gym puts it in one unit.',
      );
      expect(api.programs).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalled();

      press(first, 'Start Strength Base 1');
      await settle();
      press(dialog()!, 'Start program');
      await settle();
      await settle();
      expect(textOf(first.querySelector('[data-start-problem]'))).toBe(
        'Couldn’t start it. Check your connection and try again.',
      );

      press(first, 'Start Strength Base 1');
      await settle();
      press(dialog()!, 'Start program');
      await settle();
      await settle();
      const keys = api.start.mock.calls.map(
        (call) => (call[1] as { idempotencyKey: string }).idempotencyKey,
      );
      expect(new Set(keys).size).toBe(1);
      expect(navigate).toHaveBeenCalledWith(['/training/program']);
    });

    it('makes a new key after the server says the key was spent', async () => {
      const start = vi
        .fn()
        .mockReturnValueOnce(conflict('idempotency_conflict')())
        .mockReturnValue(of(toHouseProgramStarted(startedView())));
      const { host, api, settle } = await render({ programs: read(underPass()), start });

      for (let press_ = 0; press_ < 2; press_++) {
        press(card(host, BASE_1_LISTING), 'Start Strength Base 1');
        await settle();
        press(dialog()!, 'Start program');
        await settle();
        await settle();
        if (press_ === 0) {
          expect(textOf(host.querySelector('[data-start-problem]'))).toBe(
            'Couldn’t start it. Press Start again.',
          );
        }
      }
      const [first, second] = api.start.mock.calls.map(
        (call) => (call[1] as { idempotencyKey: string }).idempotencyKey,
      );
      expect(first).not.toBe(second);
    });

    it('reads the list again when TB Gym changed the program, and says so above it with focus', async () => {
      const programs = vi
        .fn<Answer<HouseProgramsRead>>()
        .mockReturnValueOnce(of(toHousePrograms(underPass())))
        .mockReturnValue(
          of(
            toHousePrograms(
              underPass({
                programs: [
                  houseProgram({
                    templateVersionId: 'version-2',
                    maxes: [programMax({ value: 140, from: 'Typed', on: '2026-11-12' })],
                    canStart: true,
                    refusal: null,
                    lastStartDay: '2026-11-27',
                  }),
                ],
              }),
            ),
          ),
        );
      const { host, api, settle } = await render({
        programs,
        start: conflict('house_program_changed'),
      });

      press(card(host, BASE_1_LISTING), 'Start Strength Base 1');
      await settle();
      press(dialog()!, 'Start program');
      await settle();
      await settle();

      expect(api.programs).toHaveBeenCalledTimes(2);
      const notice = host.querySelector<HTMLElement>('[data-notice]')!;
      expect(textOf(notice)).toBe(
        'TB Gym changed this program since you read it. Read it again, then start it.',
      );
      expect(document.activeElement).toBe(notice);
      expect(host.querySelectorAll('[data-program]')).toHaveLength(1);
      expect(host.querySelector('[data-start-problem]')).toBeNull();
    });

    it('reads the list again when TB Gym withdrew the program', async () => {
      const programs = vi
        .fn<Answer<HouseProgramsRead>>()
        .mockReturnValueOnce(of(toHousePrograms(underPass())))
        .mockReturnValue(
          of(
            toHousePrograms(
              underPass({ programs: [powerbuilding({ refusal: 'house_program_does_not_fit' })] }),
            ),
          ),
        );
      const { host, api, settle } = await render({
        programs,
        start: conflict('house_program_not_offered'),
      });

      press(card(host, BASE_1_LISTING), 'Start Strength Base 1');
      await settle();
      press(dialog()!, 'Start program');
      await settle();
      await settle();

      expect(api.programs).toHaveBeenCalledTimes(2);
      expect(textOf(host.querySelector('[data-notice]'))).toBe(
        'TB Gym no longer offers this program. Pick another from the list.',
      );
      expect(card(host, BASE_1_LISTING)).toBeNull();
    });

    /** Presses Start on block 1 and confirms. */
    async function startBlock1(host: HTMLElement, settle: () => Promise<void>) {
      press(card(host, BASE_1_LISTING), 'Start Strength Base 1');
      await settle();
      press(dialog()!, 'Start program');
      await settle();
      await settle();
    }

    it('reads the list again when another tab started a program meanwhile, and each card says its own', async () => {
      const typed = programMax({ value: 140, from: 'Typed', on: '2026-11-12' });
      const programs = vi
        .fn<Answer<HouseProgramsRead>>()
        .mockReturnValueOnce(of(toHousePrograms(underPass())))
        .mockReturnValue(
          of(
            toHousePrograms(
              underPass({
                running: runningBlock({ name: 'Powerbuilding 6', endDateExclusive: '2026-12-26' }),
                programs: [
                  houseProgram({
                    maxes: [typed],
                    refusal: 'mesocycle_overlap',
                    opensOn: '2026-12-26',
                    lastStartDay: '2026-11-27',
                  }),
                ],
              }),
            ),
          ),
        );
      const { host, api, navigate, settle } = await render({
        programs,
        start: conflict('mesocycle_overlap'),
      });

      await startBlock1(host, settle);

      expect(api.programs).toHaveBeenCalledTimes(2);
      const notice = host.querySelector<HTMLElement>('[data-notice]')!;
      expect(textOf(notice)).toBe(
        'Your programs changed since you read them. Here they are again.',
      );
      expect(document.activeElement).toBe(notice);
      const first = card(host, BASE_1_LISTING);
      expect(textOf(first.querySelector('[data-refusal]'))).toBe(
        '“Powerbuilding 6” runs until Fri 25 Dec. One program at a time.',
      );
      expect(textOf(host.querySelector('[data-pass]'))).toContain(
        'Powerbuilding 6 runs until Fri 25 Dec.',
      );
      expect(host.querySelector('[data-start-program], [data-start-problem]')).toBeNull();
      expect(textOf(host)).not.toContain('plan has ended');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('reads the list again for each refusal the server weighs from what it holds now', async () => {
      for (const code of [
        'house_program_block_not_open',
        'house_program_does_not_fit',
        'house_program_needs_maxes',
      ]) {
        TestBed.resetTestingModule();
        const { host, api, settle } = await render({
          programs: read(underPass()),
          start: conflict(code),
        });

        await startBlock1(host, settle);

        expect(api.programs, code).toHaveBeenCalledTimes(2);
        expect(textOf(host.querySelector('[data-notice]')), code).toBe(
          'Your programs changed since you read them. Here they are again.',
        );
        expect(host.querySelector('[data-start-problem]'), code).toBeNull();
      }
    });

    it('reads the list again when the pass isn’t running now, and shows Free with Ask for Pro+', async () => {
      const programs = vi
        .fn<Answer<HouseProgramsRead>>()
        .mockReturnValueOnce(of(toHousePrograms(underPass())))
        .mockReturnValue(of(toHousePrograms(housePrograms())));
      const { host, api, housePlans, settle } = await render({
        programs,
        start: conflict('house_program_needs_pass'),
      });

      await startBlock1(host, settle);

      expect(api.programs).toHaveBeenCalledTimes(2);
      expect(textOf(host.querySelector('[data-notice]'))).toBe(
        'Your Pro+ pass isn’t running now, so this program couldn’t start.',
      );
      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass)).not.toContain('Pro+ until');
      expect(textOf(pass.querySelector('.pass-title'))).toBe(
        'Starting a program needs Pro+. Free keeps running, with everything you logged.',
      );
      expect(pass.querySelector('[data-ask-pro]')).not.toBeNull();
      expect(housePlans.plans).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[data-start-program], [data-start-problem]')).toBeNull();
    });

    it('reads the list again when the pass isn’t running now, and shows Max to a trainee Max coaches', async () => {
      const programs = vi
        .fn<Answer<HouseProgramsRead>>()
        .mockReturnValueOnce(of(toHousePrograms(underPass())))
        .mockReturnValue(of(toHousePrograms(housePrograms())));
      const { host, profiles, settle } = await render({
        programs,
        self: () => of(finishedProfile({ selfDirected: true, coachedByTheHouse: true })),
        start: conflict('house_program_needs_pass'),
      });
      expect(profiles.getSelfProfile).not.toHaveBeenCalled();

      await startBlock1(host, settle);

      expect(profiles.getSelfProfile).toHaveBeenCalledTimes(1);
      const pass = host.querySelector('[data-pass]')!;
      expect(textOf(pass.querySelector('.pass-title'))).toBe(
        'You’re on Max, so your coach picks your program and puts it on Training.',
      );
      expect(pass.querySelector('[data-ask-pro]')).toBeNull();
      expect(textOf(host.querySelector('[data-notice]'))).toBe(
        'Your Pro+ pass isn’t running now, so this program couldn’t start.',
      );
    });

    it('reads the list again when Training closed meanwhile, and shows the page closed', async () => {
      const programs = vi
        .fn<Answer<HouseProgramsRead>>()
        .mockReturnValueOnce(of(toHousePrograms(underPass())))
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
      const { host, api, settle } = await render({ programs, start: refuse(403) });

      await startBlock1(host, settle);

      expect(api.programs).toHaveBeenCalledTimes(2);
      expect(textOf(host.querySelector('[data-programs-closed]'))).toContain(
        'Training isn’t open for you right now.',
      );
      expect(host.querySelector('[data-program], [data-start-problem]')).toBeNull();
      expect(document.activeElement).toBe(host.querySelector('h1'));
    });
  });

  describe('typing a max', () => {
    /** Under the pass, Powerbuilding 6 reads Back squat (typed) and Bench press (not yet). */
    const typing = () =>
      read(
        underPass({
          programs: [
            powerbuilding({
              maxes: [
                programMax({ value: 140, from: 'Typed', on: '2026-11-12' }),
                programMax({ exerciseId: BENCH_ID, exerciseName: 'Bench press' }),
              ],
              refusal: 'house_program_needs_maxes',
              lastStartDay: null,
            }),
          ],
          pass: proPass({ endDateExclusive: '2027-01-30' }),
        }),
      );

    it('names the lifts with no max, and opens a box per lift in the program’s unit', async () => {
      const { host, settle } = await render({ programs: typing() });

      const power = card(host, POWER_LISTING);
      expect(textOf(power.querySelector('[data-refusal]'))).toBe(
        'Type your max for Bench press first, in kg: this program works its weights out from it.',
      );
      press(power, 'Type your maxes');
      await settle();

      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('.tb-modal__title'))).toBe('Your maxes');
      expect(textOf(sheet)).toContain(
        'Your training max: the weight the program’s percentages read. In kg for this program.',
      );
      const squat = field(sheet, 'Back squat');
      expect(squat.value).toBe('140');
      expect(squat.getAttribute('inputmode')).toBe('decimal');
      expect(field(sheet, 'Bench press').value).toBe('');
      expect([...sheet.querySelectorAll('.unit')].map(textOf)).toEqual(['kg', 'kg']);
      expect(sheet.querySelector('app-segmented-control')).toBeNull();
      expect(textOf(sheet)).toContain('Typed Thu 12 Nov.');
      expect(textOf(sheet)).toContain('Not typed yet.');
    });

    it('checks a max as the server does before anything is sent', async () => {
      const { host, api, settle } = await render({ programs: typing() });

      press(card(host, POWER_LISTING), 'Type your maxes');
      await settle();
      fill(dialog()!, 'Bench press', '501');
      await settle();
      press(dialog()!, 'Save maxes');
      await settle();

      expect(api.recordMax).not.toHaveBeenCalled();
      expect(textOf(dialog())).toContain(
        'Enter a max above 0 and at most 500 kg (1,100 lb), with two decimals at most.',
      );
      expect(field(dialog()!, 'Bench press').getAttribute('aria-invalid')).toBe('true');
    });

    it('sends only the lifts that changed, after a token, then reads the programs again', async () => {
      const { host, api, calls, toast, settle } = await render({ programs: typing() });

      press(card(host, POWER_LISTING), 'Type your maxes');
      await settle();
      fill(dialog()!, 'Bench press', '102.35');
      await settle();
      press(dialog()!, 'Save maxes');
      await settle();
      await settle();

      expect(api.recordMax.mock.calls).toEqual([
        [{ exerciseId: BENCH_ID, value: 102.35, unit: 'Kilogram' }],
      ]);
      expect(calls).toEqual(['csrf', 'max']);
      expect(dialog()).toBeNull();
      expect(toast.show).toHaveBeenCalledWith('Your maxes are saved.', { tone: 'success' });
      expect(api.programs).toHaveBeenCalledTimes(2);
    });

    it('sends each changed lift in order, and closes at once when nothing changed', async () => {
      const { host, api, settle } = await render({ programs: typing() });

      press(card(host, POWER_LISTING), 'Type your maxes');
      await settle();
      press(dialog()!, 'Save maxes');
      await settle();
      expect(dialog()).toBeNull();
      expect(api.recordMax).not.toHaveBeenCalled();
      expect(api.programs).toHaveBeenCalledTimes(1);

      press(card(host, POWER_LISTING), 'Type your maxes');
      await settle();
      fill(dialog()!, 'Back squat', '142.5');
      fill(dialog()!, 'Bench press', '100');
      await settle();
      press(dialog()!, 'Save maxes');
      await settle();
      await settle();
      expect(
        api.recordMax.mock.calls.map((call) => (call[0] as { exerciseId: string }).exerciseId),
      ).toEqual([SQUAT_ID, BENCH_ID]);
    });

    it('puts the server’s words under the box, and never adds a saved lift twice', async () => {
      const sentence = 'Enter a max above 0 and at most 500 kg, with two decimals at most.';
      const recordMax = vi
        .fn()
        .mockReturnValueOnce(of(typedMaxView({ value: 142.5 })))
        .mockReturnValueOnce(
          throwError(
            () => new HttpErrorResponse({ status: 400, error: { errors: { value: [sentence] } } }),
          ),
        )
        .mockReturnValue(of(typedMaxView({ exerciseId: BENCH_ID, value: 100 })));
      const { host, api, settle } = await render({ programs: typing(), recordMax });

      press(card(host, POWER_LISTING), 'Type your maxes');
      await settle();
      fill(dialog()!, 'Back squat', '142.5');
      fill(dialog()!, 'Bench press', '100');
      await settle();
      press(dialog()!, 'Save maxes');
      await settle();
      await settle();

      expect(dialog()).not.toBeNull();
      expect(textOf(dialog()!.querySelector('[data-max="' + BENCH_ID + '"]'))).toContain(sentence);
      expect(textOf(formSummary(dialog()!))).toBe('Check the max marked above.');

      fill(dialog()!, 'Bench press', '100');
      await settle();
      press(dialog()!, 'Save maxes');
      await settle();
      await settle();
      expect(
        api.recordMax.mock.calls.map((call) => (call[0] as { exerciseId: string }).exerciseId),
      ).toEqual([SQUAT_ID, BENCH_ID, BENCH_ID]);
      expect(dialog()).toBeNull();
    });

    it('says typing needs Pro+ and reads the programs again once the sheet closes', async () => {
      const { host, api, settle } = await render({
        programs: typing(),
        recordMax: conflict('house_program_needs_pass'),
      });

      press(card(host, POWER_LISTING), 'Type your maxes');
      await settle();
      fill(dialog()!, 'Bench press', '100');
      await settle();
      press(dialog()!, 'Save maxes');
      await settle();
      await settle();

      expect(textOf(formSummary(dialog()!))).toBe(
        'Typing your max is for a program, which needs Pro+.',
      );
      expect(api.programs).toHaveBeenCalledTimes(1);
      press(dialog()!, 'Not now');
      await settle();
      // What was typed would be lost: the page asks first.
      press(dialog()!, 'Discard');
      await settle();
      await settle();
      expect(dialog()).toBeNull();
      expect(api.programs).toHaveBeenCalledTimes(2);
    });

    it('keeps the sheet open while a save is on its way', async () => {
      const answer = new Subject<StrengthMaxView>();
      const { host, settle } = await render({ programs: typing(), recordMax: () => answer });

      press(card(host, POWER_LISTING), 'Type your maxes');
      await settle();
      fill(dialog()!, 'Bench press', '100');
      await settle();
      press(dialog()!, 'Save maxes');
      await settle();
      dialog()!.querySelector<HTMLButtonElement>('.tb-modal__header [aria-label="Close"]')!.click();
      await settle();
      expect(dialog()).not.toBeNull();
      expect(textOf(dialog()!.querySelector('.tb-modal__title'))).toBe('Your maxes');

      answer.next(typedMaxView({ exerciseId: BENCH_ID, value: 100 }));
      answer.complete();
      await settle();
      await settle();
      expect(dialog()).toBeNull();
    });

    it('offers no typing on Free', async () => {
      const { host } = await render({ programs: read(housePrograms()) });

      expect(host.querySelector('[data-type-maxes]')).toBeNull();
    });
  });
});
