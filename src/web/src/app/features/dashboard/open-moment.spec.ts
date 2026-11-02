import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMotion } from '../../../testing/motion-fake';
import type { Motion } from '../../core/motion/motion';
import {
  OPEN_MOMENT,
  preloadPlayer,
  REVEAL_CAP_MS,
  REVEAL_CLASS,
  revealInto,
  revealTarget,
  whenIdle,
} from './open-moment';

/** A `ViewTransition` for jsdom: the update runs on a microtask, the rest is settled by hand. */
function fakeViewTransition() {
  let settleUpdate!: () => void;
  let failUpdate!: (reason: unknown) => void;
  let settleReady!: () => void;
  let failReady!: (reason: unknown) => void;
  let settleFinished!: () => void;
  const updateCallbackDone = new Promise<void>((resolve, reject) => {
    settleUpdate = resolve;
    failUpdate = reject;
  });
  const ready = new Promise<void>((resolve, reject) => {
    settleReady = resolve;
    failReady = reject;
  });
  const finished = new Promise<void>((resolve) => {
    settleFinished = resolve;
  });
  const transition = {
    ready,
    finished,
    updateCallbackDone,
    types: new Set<string>(),
    skipTransition: vi.fn(() => failReady(new DOMException('skipped', 'AbortError'))),
  };
  const start = vi.fn((update: () => Promise<void> | void) => {
    Promise.resolve()
      .then(update)
      .then(() => {
        settleUpdate();
        settleReady();
      }, failUpdate);
    return transition as unknown as ViewTransition;
  });
  return { transition, start, finish: () => settleFinished() };
}

function cardWithLink() {
  const card = document.createElement('section');
  card.className = 'today-card';
  card.style.borderTopLeftRadius = '16px';
  const link = document.createElement('a');
  link.className = 'tb-button today-action';
  link.setAttribute('href', '/training/today?sessionId=session-1');
  link.textContent = 'Open workout';
  const other = document.createElement('a');
  other.className = 'text-link';
  other.setAttribute('href', '/training/today');
  other.textContent = '1 more session today';
  card.append(link, other);
  document.body.appendChild(card);
  return { card, link, other };
}

/** A click as Today's capture listener sees it: on its way down, nothing has handled it yet. */
function clicked(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

function withViewTransitions(start: unknown): void {
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
}

describe('revealTarget (W7)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });

  it('takes a plain left click on the card’s link to the player when the reveal can run', () => {
    withViewTransitions(vi.fn());
    const motion = fakeMotion({ allowed: true });
    const { link } = cardWithLink();

    const event = clicked(link);

    expect(revealTarget(event, document, motion as unknown as Motion)).toBe(link);
    expect(motion.allowed).toHaveBeenCalledWith(OPEN_MOMENT);
  });

  it('leaves every other click to RouterLink: a modifier, another button, another link, no feature, no motion', () => {
    withViewTransitions(vi.fn());
    const motion = fakeMotion({ allowed: true }) as unknown as Motion;
    const { link, other } = cardWithLink();

    for (const init of [
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { metaKey: true },
    ]) {
      expect(revealTarget(clicked(link, init), document, motion)).toBeNull();
    }
    expect(revealTarget(clicked(link, { button: 1 }), document, motion)).toBeNull();
    expect(revealTarget(clicked(other), document, motion)).toBeNull();
    const prevented = clicked(link);
    prevented.preventDefault();
    expect(revealTarget(prevented, document, motion)).toBeNull();

    expect(
      revealTarget(clicked(link), document, fakeMotion({ allowed: false }) as unknown as Motion),
    ).toBeNull();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    expect(revealTarget(clicked(link), document, motion)).toBeNull();
  });
});

describe('revealInto (W7)', () => {
  const rect = (box: Partial<DOMRect>) =>
    ({ top: 100, left: 20, right: 370, bottom: 400, width: 350, height: 300, ...box }) as DOMRect;
  const html = () => document.documentElement;
  const property = (name: string) => html().style.getPropertyValue(name);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    html().classList.remove(REVEAL_CLASS);
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    TestBed.resetTestingModule();
  });

  it('marks <html> with the card’s rectangle, navigates inside the transition and tidies when it ends', async () => {
    const { start, finish } = fakeViewTransition();
    withViewTransitions(start);
    const { card } = cardWithLink();
    card.getBoundingClientRect = () => rect({});
    const navigate = vi.fn(() => Promise.resolve(true));

    revealInto(card, navigate, document, TestBed.inject(EnvironmentInjector));

    expect(start).toHaveBeenCalledTimes(1);
    expect(html().classList.contains(REVEAL_CLASS)).toBe(true);
    expect(property('--tb-open-top')).toBe('100px');
    expect(property('--tb-open-left')).toBe('20px');
    // jsdom's window is 1024 x 768.
    expect(property('--tb-open-right')).toBe('654px');
    expect(property('--tb-open-bottom')).toBe('368px');
    expect(property('--tb-open-radius')).toBe('16px');
    // The navigation runs inside the update, not before it.
    expect(navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate).toHaveBeenCalledTimes(1);
    // The new page's draw is awaited for 100 ms at most, then the transition is ready.
    await vi.advanceTimersByTimeAsync(100);
    expect(html().classList.contains(REVEAL_CLASS)).toBe(true);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(html().classList.contains(REVEAL_CLASS)).toBe(false);
    expect(property('--tb-open-top')).toBe('');
  });

  it('grows from the visible part of a card under the fold', () => {
    const { start } = fakeViewTransition();
    withViewTransitions(start);
    const { card } = cardWithLink();
    card.getBoundingClientRect = () => rect({ top: 600, bottom: 900, left: -10, right: 1100 });

    revealInto(card, () => Promise.resolve(true), document, TestBed.inject(EnvironmentInjector));

    expect(property('--tb-open-top')).toBe('600px');
    expect(property('--tb-open-bottom')).toBe('0px');
    expect(property('--tb-open-left')).toBe('0px');
    expect(property('--tb-open-right')).toBe('0px');
  });

  it('gives up the reveal for a plain cut when the new page takes longer than the cap', async () => {
    const { transition, start, finish } = fakeViewTransition();
    withViewTransitions(start);
    const { card } = cardWithLink();
    card.getBoundingClientRect = () => rect({});
    let arrive!: (went: boolean) => void;
    const navigate = vi.fn(() => new Promise<boolean>((resolve) => (arrive = resolve)));

    revealInto(card, navigate, document, TestBed.inject(EnvironmentInjector));
    await vi.advanceTimersByTimeAsync(REVEAL_CAP_MS - 1);
    expect(transition.skipTransition).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transition.skipTransition).toHaveBeenCalledTimes(1);

    // The late navigation still lands, and the page is tidied when the transition ends.
    arrive(true);
    await vi.advanceTimersByTimeAsync(0);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(html().classList.contains(REVEAL_CLASS)).toBe(false);
  });

  it('skips the transition when the navigation did not go, and a quick one is never capped', async () => {
    const { transition, start, finish } = fakeViewTransition();
    withViewTransitions(start);
    const { card } = cardWithLink();
    card.getBoundingClientRect = () => rect({});

    revealInto(card, () => Promise.resolve(false), document, TestBed.inject(EnvironmentInjector));
    await vi.advanceTimersByTimeAsync(0);
    expect(transition.skipTransition).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);

    const quick = fakeViewTransition();
    withViewTransitions(quick.start);
    revealInto(card, () => Promise.resolve(true), document, TestBed.inject(EnvironmentInjector));
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(REVEAL_CAP_MS);
    expect(quick.transition.skipTransition).not.toHaveBeenCalled();
  });

  it('lets the newest reveal own <html> when a second press follows the first', async () => {
    const first = fakeViewTransition();
    withViewTransitions(first.start);
    const { card } = cardWithLink();
    card.getBoundingClientRect = () => rect({});
    const injector = TestBed.inject(EnvironmentInjector);

    revealInto(card, () => Promise.resolve(true), document, injector);
    const second = fakeViewTransition();
    withViewTransitions(second.start);
    revealInto(card, () => Promise.resolve(true), document, injector);
    first.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(html().classList.contains(REVEAL_CLASS)).toBe(true);

    second.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(html().classList.contains(REVEAL_CLASS)).toBe(false);
  });
});

describe('whenIdle and preloadPlayer (W7)', () => {
  afterEach(() => vi.useRealTimers());

  it('asks the browser for an idle moment where it can say, and cancels through it', () => {
    const cancelIdleCallback = vi.fn();
    const requestIdleCallback = vi.fn(() => 7);
    const view = { requestIdleCallback, cancelIdleCallback } as unknown as Window;
    const work = vi.fn();

    const cancel = whenIdle(view, work);

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    (requestIdleCallback.mock.calls[0] as unknown as [() => void])[0]();
    expect(work).toHaveBeenCalledTimes(1);
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it('waits 200 ms where the browser cannot say, and a cancel clears it', () => {
    vi.useFakeTimers();
    const work = vi.fn();
    const cancelled = vi.fn();

    whenIdle(window, work);
    const cancel = whenIdle(window, cancelled);
    cancel();
    vi.advanceTimersByTime(199);
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(work).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('loads the training routes and the player once, and hands back the same promise', async () => {
    const first = preloadPlayer();

    expect(preloadPlayer()).toBe(first);
    const [routes, player] = (await first) as [
      typeof import('../training/training.routes'),
      typeof import('../training/today-training'),
    ];
    expect(routes.trainingRoutes.some((route) => route.path === 'today')).toBe(true);
    expect(typeof player.TodayTraining).toBe('function');
  });
});
