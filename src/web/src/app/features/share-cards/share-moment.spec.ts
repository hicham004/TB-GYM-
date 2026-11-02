import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Motion } from '../../core/motion/motion';
import {
  APPROACH_MS,
  DRAG_LIMIT,
  elasticOut,
  holdShareCard,
  placeOn,
  poseFor,
  REST,
  rubberBand,
  SHARE_HAND,
  SPRING,
  SPRING_MS,
  transformOf,
} from './share-moment';

/** What `Element.animate` hands back here: a promise a test can settle and keyframes it can reset. */
function fakeAnimation() {
  let settle: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { cancel: vi.fn(), finished, settle, effect: { setKeyframes: vi.fn() } };
}

type FakeAnimation = ReturnType<typeof fakeAnimation>;

/**
 * jsdom has no `Element.animate` and no frames: a browser that moves is stubbed onto the window,
 * with frames a test runs by hand.
 */
function browserThatMoves() {
  const view = document.defaultView as Window;
  const animations: FakeAnimation[] = [];
  const animate = vi.fn<
    (keyframes: Keyframe[], options: KeyframeAnimationOptions) => FakeAnimation
  >(() => {
    const animation = fakeAnimation();
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: animate,
  });
  const frames: FrameRequestCallback[] = [];
  const frame = { request: view.requestAnimationFrame, cancel: view.cancelAnimationFrame };
  view.requestAnimationFrame = (callback) => frames.push(callback);
  view.cancelAnimationFrame = vi.fn();
  return {
    animate,
    animations,
    pending: () => frames.length,
    runFrame: () => frames.shift()?.(0),
    /** The latest animation reaches its end, as a browser's would. */
    finish: async () => {
      animations.at(-1)?.settle();
      await new Promise((resolve) => setTimeout(resolve));
    },
    restore: () => {
      delete (Element.prototype as { animate?: unknown }).animate;
      view.requestAnimationFrame = frame.request;
      view.cancelAnimationFrame = frame.cancel;
    },
  };
}

/** A card 300 x 200 at (100, 200) with its face inside, in the player's section. */
function cardInHand(allowed = true) {
  const player = document.createElement('section');
  const card = document.createElement('div');
  const face = document.createElement('div');
  card.appendChild(face);
  player.appendChild(card);
  document.body.appendChild(player);
  card.getBoundingClientRect = () => ({ left: 100, top: 200, width: 300, height: 200 }) as DOMRect;
  const capture = vi.fn();
  (card as HTMLElement & { setPointerCapture: unknown }).setPointerCapture = capture;
  const motion = { allowed: vi.fn(() => allowed) } as unknown as Motion;
  const stop = holdShareCard(face, motion);
  return { player, card, face, capture, motion, stop };
}

function pointer(
  face: Element,
  type: string,
  x: number,
  y: number,
  init: { pointerType?: string; pointerId?: number; button?: number } = {},
) {
  face.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerType: init.pointerType ?? 'mouse',
      pointerId: init.pointerId ?? 1,
      button: init.button ?? 0,
    }),
  );
}

const poseOf = (face: HTMLElement) =>
  ['--rx', '--ry', '--dx', '--dy', '--rz', '--sx'].map((name) => face.style.getPropertyValue(name));

describe('the share card in the hand', () => {
  it('pulls against a rubber band that never reaches its limit', () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(100)).toBeCloseTo(37.71, 2);
    expect(rubberBand(-100)).toBeCloseTo(-37.71, 2);
    expect(rubberBand(400)).toBeCloseTo(77.65, 2);
    expect(rubberBand(100000)).toBeLessThan(DRAG_LIMIT);
    expect(rubberBand(100000)).toBeGreaterThan(rubberBand(400));
  });

  it('reads where the pointer is on the card and poses the face pressed down there', () => {
    const box = { left: 100, top: 200, width: 300, height: 200 };
    expect(placeOn(box, 250, 300)).toEqual({ nx: 0, ny: 0 });
    expect(placeOn(box, 400, 200)).toEqual({ nx: 1, ny: -1 });
    expect(placeOn({ ...box, width: 0, height: 0 }, 400, 200)).toEqual({ nx: 0, ny: 0 });
    expect(poseFor(0, 0)).toEqual(REST);
    expect(poseFor(1, -1)).toEqual({ rx: 12, ry: 12, dx: 0, dy: 0, rz: 0, sx: 50 });
    expect(poseFor(-3, 2)).toEqual({ rx: -12, ry: -12, dx: 0, dy: 0, rz: 0, sx: -50 });
    const pulled = poseFor(0.5, 0, 100, -50);
    expect(pulled.dx).toBeCloseTo(37.71, 2);
    expect(pulled.dy).toBeCloseTo(-22.37, 2);
    expect(pulled.rz).toBeCloseTo(1.89, 2);
    expect(pulled.ry).toBe(6);
  });

  it('composes the transform as the stylesheet does, and none at rest', () => {
    expect(transformOf(REST)).toBe('none');
    expect(transformOf({ rx: 12, ry: -6.5, dx: 37.714, dy: 0, rz: 1.886, sx: 50 })).toBe(
      'translate(37.71px, 0px) rotate(1.89deg) rotateX(12deg) rotateY(-6.5deg)',
    );
  });

  it('springs on the teaser’s own landing curve, drawn as a linear() easing', () => {
    const curve = elasticOut(0.6);
    expect(curve(0)).toBe(0);
    expect(curve(1)).toBe(1);
    expect(curve(0.25)).toBeCloseTo(1.153, 3);
    expect(curve(0.5)).toBeCloseTo(0.984, 3);
    expect(SPRING.startsWith('linear(0 0%, ')).toBe(true);
    expect(SPRING.endsWith(', 1 100%)')).toBe(true);
    expect(SPRING.split(',')).toHaveLength(33);
  });

  describe('in a browser that moves', () => {
    let browser: ReturnType<typeof browserThatMoves>;

    beforeEach(() => {
      browser = browserThatMoves();
    });

    afterEach(() => {
      browser.restore();
      document.body.innerHTML = '';
    });

    it('poses the face under the mouse one frame at a time, and springs back when it leaves', async () => {
      const { card, face, motion, stop } = cardInHand();
      pointer(face, 'pointermove', 400, 200);
      pointer(face, 'pointermove', 250, 300);
      pointer(face, 'pointermove', 400, 200);
      expect(motion.allowed).toHaveBeenCalledWith(SHARE_HAND);
      expect(face.classList.contains('held')).toBe(true);
      // The face comes to the pointer over 150 ms, retargeted as the pointer moves.
      expect(browser.animate).toHaveBeenCalledTimes(1);
      expect(browser.animate.mock.calls[0]?.[1]).toMatchObject({ duration: APPROACH_MS });
      expect(poseOf(face)).toEqual(['', '', '', '', '', '']);
      expect(browser.pending()).toBe(1);
      browser.runFrame();
      expect(poseOf(face)).toEqual(['12deg', '12deg', '0px', '0px', '0deg', '50%']);
      expect(browser.animations[0]?.effect.setKeyframes).toHaveBeenLastCalledWith([
        { transform: 'none' },
        { transform: 'translate(0px, 0px) rotate(0deg) rotateX(12deg) rotateY(12deg)' },
      ]);

      await browser.finish();
      pointer(card, 'pointerleave', 500, 100);
      expect(face.classList.contains('held')).toBe(false);
      expect(poseOf(face)).toEqual(['', '', '', '', '', '50%']);
      expect(browser.animate).toHaveBeenCalledTimes(2);
      expect(browser.animate.mock.calls[1]).toEqual([
        [
          { transform: 'translate(0px, 0px) rotate(0deg) rotateX(12deg) rotateY(12deg)' },
          { transform: 'none' },
        ],
        { duration: SPRING_MS, easing: SPRING },
      ]);
      stop();
    });

    it('drags with a captured finger against the rubber band, turning as it goes, and springs back on release', async () => {
      const { face, capture, stop } = cardInHand();
      // A finger cannot hover: a touch move without a grab poses nothing.
      pointer(face, 'pointermove', 400, 200, { pointerType: 'touch', pointerId: 7 });
      expect(browser.pending()).toBe(0);
      expect(face.classList.contains('held')).toBe(false);

      pointer(face, 'pointerdown', 250, 300, { pointerType: 'touch', pointerId: 7 });
      expect(capture).toHaveBeenCalledWith(7);
      expect(face.classList.contains('held')).toBe(true);
      browser.runFrame();
      expect(poseOf(face)).toEqual(['0deg', '0deg', '0px', '0px', '0deg', '0%']);

      pointer(face, 'pointermove', 350, 300, { pointerType: 'touch', pointerId: 7 });
      // Another pointer's move is not this drag's.
      pointer(face, 'pointermove', 100, 200, { pointerType: 'touch', pointerId: 8 });
      browser.runFrame();
      expect(poseOf(face)).toEqual(['0deg', '8deg', '37.71px', '0px', '1.89deg', '33.33%']);

      await browser.finish();
      pointer(face, 'pointerup', 350, 300, { pointerType: 'touch', pointerId: 8 });
      expect(face.classList.contains('held')).toBe(true);
      pointer(face, 'pointerup', 350, 300, { pointerType: 'touch', pointerId: 7 });
      expect(face.classList.contains('held')).toBe(false);
      expect(poseOf(face)).toEqual(['', '', '', '', '', '33.33%']);
      expect(browser.animate).toHaveBeenLastCalledWith(
        [
          { transform: 'translate(37.71px, 0px) rotate(1.89deg) rotateX(0deg) rotateY(8deg)' },
          { transform: 'none' },
        ],
        { duration: SPRING_MS, easing: SPRING },
      );
      stop();
    });

    it('takes the card out of a spring when it is grabbed again, and lets a cancelled pointer go', async () => {
      const { face, stop } = cardInHand();
      pointer(face, 'pointerdown', 400, 200);
      browser.runFrame();
      await browser.finish();
      pointer(face, 'pointerup', 400, 200);
      const spring = browser.animations[1];
      expect(spring).toBeDefined();

      pointer(face, 'pointerdown', 250, 300);
      expect(spring?.cancel).toHaveBeenCalled();
      expect(browser.animate).toHaveBeenCalledTimes(3);
      pointer(face, 'pointercancel', 250, 300);
      expect(face.classList.contains('held')).toBe(false);
      // Nothing to spring from: the grab had not posed the face yet.
      expect(browser.animate).toHaveBeenCalledTimes(3);
      stop();
    });

    it('keeps its touches from the player’s swipe, with or without motion', () => {
      for (const allowed of [true, false]) {
        const { player, face, stop } = cardInHand(allowed);
        const swipe = vi.fn();
        player.addEventListener('touchstart', swipe);
        player.addEventListener('touchend', swipe);
        face.dispatchEvent(new Event('touchstart', { bubbles: true }));
        face.dispatchEvent(new Event('touchend', { bubbles: true }));
        expect(swipe).not.toHaveBeenCalled();
        stop();
        face.dispatchEvent(new Event('touchstart', { bubbles: true }));
        expect(swipe).toHaveBeenCalledTimes(1);
      }
    });

    it('leaves the card still with reduced motion or the switch on', () => {
      const { face, stop } = cardInHand(false);
      pointer(face, 'pointermove', 400, 200);
      pointer(face, 'pointerdown', 400, 200);
      expect(browser.pending()).toBe(0);
      expect(face.classList.contains('held')).toBe(false);
      expect(browser.animate).not.toHaveBeenCalled();
      stop();
    });

    it('lets go without a spring when the card leaves the page', () => {
      const { face, stop } = cardInHand();
      pointer(face, 'pointerdown', 400, 200);
      browser.runFrame();
      expect(poseOf(face)[0]).toBe('12deg');
      stop();
      expect(poseOf(face)).toEqual(['', '', '', '', '', '']);
      expect(face.classList.contains('held')).toBe(false);
      expect(browser.animations[0]?.cancel).toHaveBeenCalled();
      expect(browser.animate).toHaveBeenCalledTimes(1);
      pointer(face, 'pointermove', 250, 300);
      expect(browser.pending()).toBe(0);
    });
  });
});
