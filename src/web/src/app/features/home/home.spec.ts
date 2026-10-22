import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { WebsiteSettingsStore } from '../../core/website/website-settings';
import { Home } from './home';
import { HomeMotion, type HomeMotionState, type HomeMotionTargets } from './home-motion';
import { HOME_PLACEHOLDERS } from './home-placeholder';
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

async function render() {
  const motion = fakeMotion();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: HOME_PLACEHOLDERS, useValue: null },
      { provide: ApiClient, useValue: {} },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      {
        provide: WebsiteSettingsStore,
        useValue: { whatsAppLink: signal(null), load: vi.fn(() => Promise.resolve()) },
      },
    ],
  });
  TestBed.overrideComponent(Home, {
    set: { providers: [{ provide: HomeMotion, useValue: motion }] },
  });
  const fixture = TestBed.createComponent(Home);
  const startedBeforeRender = motion.start.mock.calls.length;
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, motion, startedBeforeRender };
}

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
});
