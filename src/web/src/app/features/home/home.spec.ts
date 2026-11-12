import { signal, type DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { TEST_PLACEHOLDERS } from '../../../testing/placeholder-fixtures';
import { ApiClient } from '../../core/api/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { WebsiteAnalytics } from '../../core/website/website-analytics';
import { WebsiteSettingsStore } from '../../core/website/website-settings';
import { Home } from './home';
import { FEATURE_ROWS } from './home-content';
import { HomeMotion, type HomeMotionState, type HomeMotionTargets } from './home-motion';
import { HOME_PLACEHOLDERS, type PlaceholderSet } from './home-placeholder';
import { HomeRows } from './home-rows';
import { HomeWeek } from './home-week';

/** Where the parts the header watches sit in the document, in CSS pixels from its top. */
const LAYOUT: readonly (readonly [selector: string, top: number, bottom: number])[] = [
  ['app-home-hero', 0, 900],
  ['#week', 900, 3000],
  ['#inside', 3000, 6000],
  ['#for-gyms', 6000, 7000],
  ['app-home-finale', 7800, 8400],
];
/** The sticky header's bottom edge, which stays put while the page scrolls under it. */
const HEADER_EDGE = 72;
/** The window's height: the reading line is 40 % down it, 360 px. */
const WINDOW_HEIGHT = 900;

let scrolled = 0;
/** Every element whose rectangle was read, in order. */
let measured: Element[] = [];
let frames = new Map<number, FrameRequestCallback>();
let lastFrame = 0;
let cancelFrame: Mock<(id: number) => void>;

const box = (top: number, bottom: number) =>
  ({
    top,
    bottom,
    left: 0,
    right: 1440,
    width: 1440,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/** jsdom lays nothing out: the page's parts are placed by hand, scrolled by `scrolled`. */
function layOutThePage(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    measured.push(this);
    if (this.matches('app-home-header')) return box(0, HEADER_EDGE);
    const place = LAYOUT.find(([selector]) => this.matches(selector));
    return place ? box(place[1] - scrolled, place[2] - scrolled) : box(0, 0);
  });
}

/** The frames the page asked for, run as the browser would on its next one. */
function runFrames(): void {
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback(0);
}

function fakeMotion() {
  return {
    state: signal<HomeMotionState>('idle').asReadonly(),
    start: vi.fn<(targets: HomeMotionTargets) => Promise<void>>(() => Promise.resolve()),
    stop: vi.fn<() => void>(),
  };
}

/** Who opens the page, and on which build: the private pre-launch one is the one with stand-ins. */
interface Opening {
  readonly signedIn?: boolean;
  readonly placeholders?: PlaceholderSet | null;
}

/** The page's doubles, and the session's answer: `user` is who is signed in, nobody by default. */
function setUp(opening: Opening = {}) {
  const motion = fakeMotion();
  const closed = vi.fn();
  // The count's end comes with the page's own DestroyRef: the double notes when that page closes.
  const analytics = { pageview: vi.fn((page: DestroyRef) => void page.onDestroy(closed)) };
  const user = signal<object | null>(opening.signedIn ? { id: 'me' } : null);
  TestBed.configureTestingModule({
    providers: [
      // The address the page has inside the app (notes plan N2), on the same component.
      provideRouter([{ path: 'about', component: Home }]),
      { provide: HOME_PLACEHOLDERS, useValue: opening.placeholders ?? null },
      { provide: ApiClient, useValue: {} },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: AuthStore, useValue: { user } },
      {
        provide: WebsiteSettingsStore,
        useValue: { whatsAppLink: signal(null), load: vi.fn(() => Promise.resolve()) },
      },
      { provide: WebsiteAnalytics, useValue: analytics },
    ],
  });
  TestBed.overrideComponent(Home, {
    set: { providers: [{ provide: HomeMotion, useValue: motion }] },
  });
  return { motion, analytics, closed, user };
}

/** The homepage at its own address, `/`, which only a visitor reaches. */
async function render(opening: Opening = {}) {
  const doubles = setUp(opening);
  const fixture = TestBed.createComponent(Home);
  const startedBeforeRender = doubles.motion.start.mock.calls.length;
  const countedBeforeRender = doubles.analytics.pageview.mock.calls.length;
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    ...doubles,
    startedBeforeRender,
    countedBeforeRender,
  };
}

/**
 * The same page inside the app, at `/about` (notes plan N2), opened by the router as the app opens
 * it. The test router keeps its own address, so the browser's is set beside it, as the count reads it.
 */
async function renderAbout(opening: Opening = {}) {
  const doubles = setUp(opening);
  history.replaceState(null, '', '/about');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/about', Home);
  await settle(harness.fixture);
  return { fixture: harness.fixture, host: harness.routeNativeElement as HTMLElement, ...doubles };
}

/** The robots tags in the document, which say whether search engines may show the address. */
const robots = () => Array.from(document.head.querySelectorAll('meta[name="robots"]'));

/** Every link of the page with an address, in reading order: its words and where it leads. */
const links = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('a[href]')).map((link) => ({
    words: (link.textContent ?? '').replace(/\s+/g, ' ').trim(),
    href: link.getAttribute('href') ?? '',
  }));

const hrefs = (host: HTMLElement) => links(host).map((link) => link.href);

const BACK_TO_TODAY = { words: 'Back to Today', href: '/' };
const SIGN_IN = { words: 'Sign in', href: '/auth/sign-in' };
const START = { words: 'Start your coaching space', href: '/auth/register' };
/**
 * The links to sign-up a visitor meets: Start your coaching space in the phone menu, the hero, the
 * coach's half and the finale, and the quiet link under each feature row.
 */
const SIGN_UP_LINKS = 4 + FEATURE_ROWS.length;

/** What the header shows: the tone it takes and the section its links mark. */
function header(host: HTMLElement) {
  return {
    tone: query(host, 'app-home-header .header').getAttribute('data-tone'),
    marks:
      host.querySelector<HTMLElement>('app-home-header .links .is-current')?.dataset['section'] ??
      null,
  };
}

async function scrollTo(fixture: Parameters<typeof settle>[0], top: number): Promise<void> {
  scrolled = top;
  window.dispatchEvent(new Event('scroll'));
  runFrames();
  await settle(fixture);
}

const headerReads = () => measured.filter((element) => element.matches('app-home-header')).length;

describe('Home', () => {
  beforeEach(() => {
    scrolled = 0;
    measured = [];
    frames = new Map();
    lastFrame = 0;
    cancelFrame = vi.fn((id: number) => void frames.delete(id));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++lastFrame, callback);
      return lastFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    vi.stubGlobal('innerHeight', WINDOW_HEIGHT);
    layOutThePage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    history.replaceState(null, '', '/');
    for (const tag of robots()) tag.remove();
  });

  it('counts the visit once it is drawn in the browser, at the homepage’s address, until the page closes', async () => {
    const { fixture, analytics, countedBeforeRender, closed } = await render();
    expect(countedBeforeRender).toBe(0);
    expect(analytics.pageview).toHaveBeenCalledTimes(1);

    await settle(fixture);
    expect(analytics.pageview).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
    fixture.destroy();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('counts nothing when the same page opens at another address', async () => {
    history.replaceState(null, '', '/about');
    const { analytics } = await render();

    expect(analytics.pageview).not.toHaveBeenCalled();
  });

  it('puts the header and every section in reading order, after a skip link to the content', async () => {
    const { host } = await render();

    const skip = query<HTMLAnchorElement>(host, '.home > a.skip-link');
    expect(skip.textContent?.trim()).toBe('Skip to content');
    expect(skip.getAttribute('href')).toBe('#home-content');
    expect(host.querySelector('.home')?.firstElementChild).toBe(skip);
    // The header comes before the content the link skips to, so the link passes it.
    const content = query<HTMLElement>(host, '#home-content');
    expect(content.getAttribute('tabindex')).toBe('-1');
    expect(content.previousElementSibling?.tagName).toBe('APP-HOME-HEADER');
    expect(Array.from(content.children).map((section) => section.tagName.toLowerCase())).toEqual([
      'app-home-hero',
      'app-home-week',
      'app-home-rows',
      'app-home-who',
      'app-home-talk',
      'app-home-finale',
    ]);
  });

  it('marks the page live once it is drawn in the browser', async () => {
    const { host } = await render();

    expect(query(host, '.home').classList).toContain('home--live');
  });

  it('starts the motion once the page is drawn, with the week’s parts, every headline and the page', async () => {
    const { fixture, host, motion, startedBeforeRender } = await render();
    expect(startedBeforeRender).toBe(0);
    expect(motion.start).toHaveBeenCalledTimes(1);

    const targets = motion.start.mock.calls[0][0];
    const week = fixture.debugElement.query(By.directive(HomeWeek)).componentInstance as HomeWeek;
    const rows = fixture.debugElement.query(By.directive(HomeRows)).componentInstance as HomeRows;
    const ofTheWeek = week.motionTargets();
    expect(targets.page).toBe(host);
    expect(targets.week).toBe(query(host, '#week'));
    expect(targets.panel).toBe(ofTheWeek.panel);
    expect(targets.marker).toBe(ofTheWeek.marker);
    expect(targets.marker).toBe(query(host, '#week .days__marker'));
    expect(targets.stages).toHaveLength(4);
    targets.stages.forEach((stage, index) => expect(stage).toBe(ofTheWeek.stages[index]));
    // The panel's two slots, the window's and the phone's, which the motion carries between stages.
    expect(targets.slots).toHaveLength(2);
    targets.slots.forEach((slot, index) => expect(slot).toBe(ofTheWeek.slots[index]));
    // The week's headlines first, then What's inside and its six rows, each the element on screen.
    const titles = [...week.titles(), ...rows.titles()];
    expect(targets.titles).toHaveLength(titles.length);
    targets.titles.forEach((title, index) => expect(title).toBe(titles[index]));
    expect(targets.titles.map((title) => title.className)).toEqual([
      ...Array<string>(4).fill('stage__title'),
      'rows__title',
      ...Array<string>(6).fill('row__title'),
    ]);

    // Told a stage, the week shows it: the motion drives the real section.
    targets.onStage(2);
    await settle(fixture);
    expect(query(host, '#week').getAttribute('data-stage')).toBe('checkin');
    expect(targets.dayOf(2)).toBe(ofTheWeek.dayOf(2));
  });

  it('gives the header the tone of what is under it and marks the section in view as the page scrolls', async () => {
    const { fixture, host } = await render();
    // At the top the hero is under the header and no section is marked.
    expect(header(host)).toEqual({ tone: 'dark', marks: null });

    const stops: [top: number, tone: string, marks: string | null][] = [
      // The hero has gone under the header; the week has reached the reading line.
      [1000, 'light', 'week'],
      [2800, 'light', 'inside'],
      // Who it's for reaches the reading line before its dark band reaches the header.
      [5800, 'light', 'for-gyms'],
      [5950, 'night', 'for-gyms'],
      // The finale, still dark, marks nothing.
      [7600, 'night', null],
      // And back up to the hero.
      [0, 'dark', null],
    ];
    for (const [top, tone, marks] of stops) {
      await scrollTo(fixture, top);
      expect(header(host), `scrolled ${top}px`).toEqual({ tone, marks });
    }
  });

  it('measures the page once a frame, however many scroll and resize events come in it', async () => {
    const { fixture, host } = await render();
    const before = headerReads();

    scrolled = 2800;
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(headerReads()).toBe(before);

    runFrames();
    await settle(fixture);
    expect(headerReads()).toBe(before + 1);
    expect(header(host)).toEqual({ tone: 'light', marks: 'inside' });
  });

  it('stops the motion and cancels the frame it asked for when the page goes', async () => {
    const { fixture, motion } = await render();
    scrolled = 1000;
    window.dispatchEvent(new Event('scroll'));
    const pending = lastFrame;

    fixture.destroy();

    expect(motion.stop).toHaveBeenCalledTimes(1);
    expect(cancelFrame).toHaveBeenCalledWith(pending);
  });

  it('stops listening to the window when the page goes', async () => {
    const { fixture } = await render();
    // A frame already drawn, so a listener left behind would ask for the next one.
    window.dispatchEvent(new Event('scroll'));
    runFrames();

    fixture.destroy();
    const reads = headerReads();
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));

    expect(frames.size).toBe(0);
    runFrames();
    expect(headerReads()).toBe(reads);
  });

  // The same page inside the app, at /about (notes plan N2).

  it('counts nothing inside the app at /about, for a visitor or for someone signed in', async () => {
    const visitor = await renderAbout();
    expect(visitor.analytics.pageview).not.toHaveBeenCalled();
    await settle(visitor.fixture);
    expect(visitor.analytics.pageview).not.toHaveBeenCalled();
    // The page did come alive there: only the count is left out.
    expect(query(visitor.host, '.home').classList).toContain('home--live');
    expect(visitor.motion.start).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();

    const signedIn = await renderAbout({ signedIn: true });
    expect(signedIn.analytics.pageview).not.toHaveBeenCalled();
  });

  it('at /about asks search engines not to show that address while the page is there, and no longer once it has gone', async () => {
    const { fixture } = await renderAbout();

    expect(robots().map((tag) => tag.getAttribute('content'))).toEqual(['noindex']);

    fixture.destroy();
    expect(robots()).toHaveLength(0);
  });

  it('at its own address carries no robots tag, so search engines may show the homepage', async () => {
    const { fixture } = await render();
    expect(robots()).toHaveLength(0);

    fixture.destroy();
    expect(robots()).toHaveLength(0);
  });

  it.each(['noindex', 'noindex, nofollow'])(
    'at /about leaves a robots tag the document already has (%s): no second one, and it stays when the page goes',
    async (content) => {
      const own = document.createElement('meta');
      own.setAttribute('name', 'robots');
      own.setAttribute('content', content);
      document.head.append(own);
      const { fixture } = await renderAbout();

      expect(robots()).toHaveLength(1);
      expect(robots()[0]).toBe(own);
      expect(own.getAttribute('content')).toBe(content);

      fixture.destroy();
      expect(robots()).toHaveLength(1);
      expect(robots()[0]).toBe(own);
      expect(own.getAttribute('content')).toBe(content);
    },
  );

  it('on the private build adds no tag of its own at /about: the header’s says it on every page and stays when the page goes', async () => {
    const { fixture } = await renderAbout({ placeholders: TEST_PLACEHOLDERS });

    expect(robots().map((tag) => tag.getAttribute('content'))).toEqual(['noindex, nofollow']);

    fixture.destroy();
    expect(robots().map((tag) => tag.getAttribute('content'))).toEqual(['noindex, nofollow']);
  });

  it('at /about sends the skip link to the content on that address', async () => {
    const { host } = await renderAbout();

    const skip = query<HTMLAnchorElement>(host, '.home > a.skip-link');
    expect(skip.textContent?.trim()).toBe('Skip to content');
    // A bare fragment would resolve against the base address, which is the homepage's own.
    expect(skip.getAttribute('href')).toBe('/about#home-content');
    expect(host.querySelector('.home')?.firstElementChild).toBe(skip);
    expect(query(host, '#home-content').getAttribute('tabindex')).toBe('-1');
  });

  it('at /about, signed in, leads back to Today, offers no sign-up or sign-in, and keeps every other link on /about', async () => {
    const { host } = await renderAbout({ signedIn: true });

    // The header's, the phone menu's and the foot's: the only links that leave for Today.
    expect(links(host).filter((link) => link.href === '/')).toEqual([
      BACK_TO_TODAY,
      BACK_TO_TODAY,
      BACK_TO_TODAY,
    ]);
    expect(host.querySelector('[href="/auth/register"]')).toBeNull();
    expect(host.querySelector('[href="/auth/sign-in"]')).toBeNull();
    expect(host.textContent).not.toContain('Start your coaching space');
    expect(host.textContent).not.toContain('Sign in');
    expect(query(host, '.clients').textContent?.trim()).toBe(
      'Here as a client? Your coach sends the invitation.',
    );
    expect(hrefs(host).filter((href) => href.startsWith('/#'))).toEqual([]);
    // Everything else stays on the page, but What changed, a page of its own.
    expect(hrefs(host).filter((href) => href !== '/' && href !== '/changelog')).toEqual([
      '/about#home-content',
      // The wordmark, the three section links, and the three again in the phone menu.
      '/about',
      '/about#week',
      '/about#inside',
      '/about#for-gyms',
      '/about#week',
      '/about#inside',
      '/about#for-gyms',
      // Talk to us: the hero's, the gyms' half's and the finale's.
      '/about#talk',
      '/about#talk',
      '/about#talk',
    ]);
    // The form those three lead to is on the page.
    expect(host.querySelector('#talk form')).not.toBeNull();
  });

  it('at /about a visitor still gets Sign in and Start your coaching space, with the page’s links on /about', async () => {
    const { host } = await renderAbout();

    const all = links(host);
    // The header's, the phone menu's, the clients' strip's and the foot's.
    expect(all.filter((link) => link.href === '/auth/sign-in')).toEqual([
      SIGN_IN,
      SIGN_IN,
      SIGN_IN,
      SIGN_IN,
    ]);
    // The phone menu's, the hero's, the coach's half's and the finale's, besides the six rows' links.
    const signUp = all.filter((link) => link.href === '/auth/register');
    expect(signUp.filter((link) => link.words === START.words)).toEqual([
      START,
      START,
      START,
      START,
    ]);
    expect(signUp).toHaveLength(SIGN_UP_LINKS);
    expect(host.textContent).not.toContain('Back to Today');
    expect(hrefs(host).filter((href) => href === '/' || href.startsWith('/#'))).toEqual([]);
    expect(hrefs(host).filter((href) => href.startsWith('/about'))).toEqual([
      '/about#home-content',
      '/about',
      '/about#week',
      '/about#inside',
      '/about#for-gyms',
      '/about#week',
      '/about#inside',
      '/about#for-gyms',
      '/about#talk',
      '/about#talk',
      '/about#talk',
    ]);
  });

  it('at its own address keeps every link on the homepage’s address, and none on /about', async () => {
    const { host } = await render();

    expect(hrefs(host).filter((href) => href.startsWith('/about'))).toEqual([]);
    expect(hrefs(host).filter((href) => href === '/' || /^\/?#/.test(href))).toEqual([
      '#home-content',
      '/',
      '/#week',
      '/#inside',
      '/#for-gyms',
      '/#week',
      '/#inside',
      '/#for-gyms',
      '/#talk',
      '/#talk',
      '/#talk',
    ]);
    expect(links(host).filter((link) => link.href === '/auth/register')).toHaveLength(
      SIGN_UP_LINKS,
    );
    expect(host.textContent).not.toContain('Back to Today');
  });

  it('at /about swaps the sign-up and Sign in for Back to Today the moment someone is signed in', async () => {
    const { fixture, host, user } = await renderAbout();
    expect(host.querySelectorAll('[href="/auth/register"]')).toHaveLength(SIGN_UP_LINKS);

    user.set({ id: 'me' });
    await settle(fixture);

    expect(host.querySelector('[href="/auth/register"]')).toBeNull();
    expect(host.querySelector('[href="/auth/sign-in"]')).toBeNull();
    expect(links(host).filter((link) => link.href === '/')).toEqual([
      BACK_TO_TODAY,
      BACK_TO_TODAY,
      BACK_TO_TODAY,
    ]);
  });
});
