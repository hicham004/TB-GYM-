import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backOut,
  EASE,
  linearEasing,
  Motion,
  MOTION_KEY,
  RISE_CAP,
  ROWS_KEY,
  SWITCH_ATTRIBUTE,
} from './motion';

/** What `Element.animate` hands back here: a clock a test can move and a promise it can settle. */
function fakeAnimation() {
  let settle: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { currentTime: 0, playState: 'running', finished, cancel: vi.fn(), settle };
}

type FakeAnimation = ReturnType<typeof fakeAnimation>;

/**
 * jsdom has neither `matchMedia` nor `Element.animate`. A browser that moves is stubbed onto the
 * window the service reads (`document.defaultView`), with frames a test runs by hand.
 */
function browserThatMoves() {
  const view = document.defaultView as Window;
  const animations: FakeAnimation[] = [];
  const frames: FrameRequestCallback[] = [];
  const animate = vi.fn(() => {
    const animation = fakeAnimation();
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(view, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({ matches: query.includes('no-preference') })),
  });
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: animate,
  });
  const frame = { request: view.requestAnimationFrame, cancel: view.cancelAnimationFrame };
  view.requestAnimationFrame = (callback) => frames.push(callback);
  view.cancelAnimationFrame = vi.fn();
  return {
    animate,
    animations,
    runFrame: () => frames.shift()?.(0),
    restore: () => {
      delete (view as { matchMedia?: unknown }).matchMedia;
      delete (Element.prototype as { animate?: unknown }).animate;
      view.requestAnimationFrame = frame.request;
      view.cancelAnimationFrame = frame.cancel;
    },
  };
}

describe('Motion', () => {
  let motion: Motion;

  beforeEach(() => {
    motion = TestBed.inject(Motion);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute(SWITCH_ATTRIBUTE);
    history.replaceState(null, '', '/');
  });

  describe('where the browser cannot move (jsdom)', () => {
    it('allows nothing and lands every move on its final state at once', () => {
      expect(motion.allowed()).toBe(false);

      const number = document.createElement('strong');
      number.textContent = '2,187.5';
      motion.countUp(number, 2187.5, (value) => value.toFixed(1));
      expect(number.textContent).toBe('2,187.5');

      const empty = document.createElement('strong');
      motion.countUp(empty, 42, (value) => `${Math.round(value)} kg`);
      expect(empty.textContent).toBe('42 kg');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      motion.ring(circle, 100, 25);
      expect(circle.getAttribute('stroke-dashoffset')).toBe('25');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      expect(() => motion.drawLine(path)()).not.toThrow();
      expect(() => motion.rise([document.createElement('p')])()).not.toThrow();
      expect(() => motion.pop(document.createElement('span'))()).not.toThrow();
    });
  });

  describe('in a browser that moves', () => {
    let browser: ReturnType<typeof browserThatMoves>;

    beforeEach(() => {
      browser = browserThatMoves();
    });

    afterEach(() => {
      browser.restore();
    });

    it('is allowed until the person asks for less', () => {
      expect(motion.allowed()).toBe(true);
      expect(motion.allowed('W3')).toBe(true);
    });

    it('rises at most six elements, 50 ms apart, hidden through their delay, and a stop cancels them', () => {
      const elements = Array.from({ length: RISE_CAP + 2 }, () => document.createElement('li'));
      const stop = motion.rise(elements, { from: 14 });

      expect(browser.animate).toHaveBeenCalledTimes(RISE_CAP);
      const [keyframes, options] = browser.animate.mock.calls[2] as unknown as [
        Keyframe[],
        KeyframeAnimationOptions,
      ];
      expect(keyframes[0]).toEqual({ opacity: 0, transform: 'translateY(14px)' });
      expect(options).toMatchObject({ duration: 450, delay: 100, fill: 'backwards' });

      stop();
      expect(
        browser.animations.every((animation) => animation.cancel.mock.calls.length === 1),
      ).toBe(true);
    });

    it('pops from half size with an overshoot and sweeps a ring from one offset to the other', () => {
      motion.pop(document.createElement('span'));
      const [popFrames, popOptions] = browser.animate.mock.calls[0] as unknown as [
        Keyframe[],
        KeyframeAnimationOptions,
      ];
      expect(popFrames[0]).toEqual({ transform: 'scale(0.5)' });
      expect(popOptions.duration).toBe(550);
      // jsdom's CSS.supports is absent, so the classic back-out stands in for the linear() curve.
      expect(String(popOptions.easing)).toMatch(/^cubic-bezier|^linear\(/);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      motion.ring(circle, 138, 34.5);
      expect(circle.getAttribute('stroke-dashoffset')).toBe('34.5');
      const [ringFrames, ringOptions] = browser.animate.mock.calls[1] as unknown as [
        Keyframe[],
        KeyframeAnimationOptions,
      ];
      expect(ringFrames).toEqual([{ strokeDashoffset: 138 }, { strokeDashoffset: 34.5 }]);
      expect(ringOptions).toMatchObject({ duration: 1100, easing: EASE.outStrong });
    });

    it('counts up through the frames and ends on the string the element already showed', async () => {
      const number = document.createElement('strong');
      number.textContent = '2,187.5';
      const format = (value: number) => value.toFixed(1);
      const stop = motion.countUp(number, 2187.5, format);
      const clock = browser.animations[0];

      browser.runFrame();
      expect(number.textContent).toBe('0.0');

      clock.currentTime = 550;
      browser.runFrame();
      const halfway = Number(number.textContent);
      expect(halfway).toBeGreaterThan(1000);
      expect(halfway).toBeLessThan(2187.5);

      clock.currentTime = 1100;
      browser.runFrame();
      expect(number.textContent).toBe('2,187.5');

      clock.settle();
      await clock.finished;
      expect(number.textContent).toBe('2,187.5');
      stop();
      expect(clock.cancel).toHaveBeenCalled();
    });

    it('rests at once when the stop is called mid-count', () => {
      const number = document.createElement('strong');
      number.textContent = '12';
      const stop = motion.countUp(number, 12, (value) => String(Math.round(value)));
      browser.runFrame();
      expect(number.textContent).toBe('0');
      stop();
      expect(number.textContent).toBe('12');
    });

    it('counts through the element’s one text node, which a template binding holds', () => {
      const number = document.createElement('strong');
      const node = document.createTextNode('42');
      number.append(node);
      motion.countUp(number, 42, (value) => String(Math.round(value)));
      browser.runFrame();
      expect(node.data).toBe('0');
      expect(number.firstChild).toBe(node);
      browser.animations[0].currentTime = 1100;
      browser.runFrame();
      expect(node.data).toBe('42');
      expect(number.childNodes).toHaveLength(1);
    });

    it('is off while ?motion=off has been seen, until ?motion=on, and marks <html>', () => {
      history.replaceState(null, '', '/?motion=off');
      motion.readSwitch();
      expect(localStorage.getItem(MOTION_KEY)).toBe('off');
      expect(document.documentElement.getAttribute(SWITCH_ATTRIBUTE)).toBe('off');
      expect(motion.allowed()).toBe(false);

      history.replaceState(null, '', '/today');
      motion.readSwitch();
      expect(motion.allowed()).toBe(false);

      history.replaceState(null, '', '/?motion=on');
      motion.readSwitch();
      expect(localStorage.getItem(MOTION_KEY)).toBeNull();
      expect(document.documentElement.hasAttribute(SWITCH_ATTRIBUTE)).toBe(false);
      expect(motion.allowed()).toBe(true);
    });

    it('turns single rows off through tb-motion-off, read per call', () => {
      localStorage.setItem(ROWS_KEY, 'W3, W7');
      expect(motion.allowed()).toBe(true);
      expect(motion.allowed('W3')).toBe(false);
      expect(motion.allowed('W7')).toBe(false);
      expect(motion.allowed('W4')).toBe(true);

      const element = document.createElement('span');
      expect(motion.pop(element, { moment: 'W3' })).toBeTypeOf('function');
      expect(browser.animate).not.toHaveBeenCalled();
    });

    it('moves nothing for a person who prefers reduced motion', () => {
      Object.defineProperty(document.defaultView, 'matchMedia', {
        configurable: true,
        writable: true,
        value: () => ({ matches: false }),
      });
      expect(motion.allowed()).toBe(false);
      motion.rise([document.createElement('p')]);
      expect(browser.animate).not.toHaveBeenCalled();
    });
  });

  describe('the curves', () => {
    it("renders GSAP's back.out as a linear() curve that starts at 0, overshoots and rests at 1", () => {
      const curve = backOut(2.5);
      expect(curve(0)).toBeCloseTo(0, 6);
      expect(curve(1)).toBeCloseTo(1, 6);
      expect(curve(0.7)).toBeGreaterThan(1);
      expect(EASE.backOut.startsWith('linear(0 0%')).toBe(true);
      expect(EASE.backOut.endsWith('1 100%)')).toBe(true);
      expect(EASE.backOut.length).toBeLessThan(400);
      expect(linearEasing((t) => t, 2)).toBe('linear(0 0%, 0.5 50%, 1 100%)');
    });
  });
});
