import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Motion } from '../../core/motion/motion';
import {
  LOAD_EASE,
  loadPlates,
  PLATE_MS,
  PLATES_MOMENT,
  sharedFromCollar,
  SLIDE_PX,
  STAGGER_MS,
  unloadPlates,
} from './plates-moment';

/** What `Element.animate` hands back here: a promise a test can settle. */
function fakeAnimation() {
  let settle: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { cancel: vi.fn(), finished, settle };
}

type FakeAnimation = ReturnType<typeof fakeAnimation>;

/** jsdom has no `Element.animate`: a browser that moves is stubbed on, with what it was asked. */
function browserThatMoves() {
  const animations: FakeAnimation[] = [];
  const animate = vi.fn<
    (keyframes: Keyframe[], options: KeyframeAnimationOptions) => FakeAnimation
  >(() => {
    const animation = fakeAnimation();
    animations.push(animation);
    return animation;
  });
  const running = new Map<Element, FakeAnimation[]>();
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = animate(keyframes, options);
      running.set(this, [...(running.get(this) ?? []), animation]);
      return animation;
    },
  });
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    writable: true,
    value: function (this: Element) {
      return running.get(this) ?? [];
    },
  });
  return {
    animate,
    animations,
    restore: () => {
      delete (Element.prototype as { animate?: unknown }).animate;
      delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
    },
  };
}

function motionThat(allowed: boolean): Motion {
  return { allowed: vi.fn(() => allowed) } as unknown as Motion;
}

function plates(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => document.createElement('span'));
}

describe('the barbell moment (W11)', () => {
  let browser: ReturnType<typeof browserThatMoves>;

  beforeEach(() => {
    browser = browserThatMoves();
  });

  afterEach(() => {
    browser.restore();
  });

  it('belongs to row W11 of the motion plan', () => {
    expect(PLATES_MOMENT).toBe('W11');
    const motion = motionThat(true);
    loadPlates(plates(1), motion);
    expect(motion.allowed).toHaveBeenCalledWith('W11');
  });

  it('slides plates on from the right one after another, from the collar out', () => {
    loadPlates(plates(3), motionThat(true));
    expect(browser.animate).toHaveBeenCalledTimes(3);
    const [keyframes, options] = browser.animate.mock.calls[0]!;
    expect(keyframes).toEqual([
      { transform: `translateX(${SLIDE_PX}px)`, opacity: 0 },
      { transform: 'none', opacity: 1 },
    ]);
    expect(options).toEqual({
      duration: PLATE_MS,
      delay: 0,
      easing: LOAD_EASE,
      fill: 'backwards',
    });
    expect(browser.animate.mock.calls[1]?.[1]).toMatchObject({ delay: STAGGER_MS });
    expect(browser.animate.mock.calls[2]?.[1]).toMatchObject({ delay: 2 * STAGGER_MS });
    expect(PLATE_MS).toBeLessThanOrEqual(300);
    expect(LOAD_EASE.startsWith('linear(')).toBe(true);
  });

  it('takes over a plate still holding its slide-off, so nothing shows in between', () => {
    const [plate] = plates(1);
    void unloadPlates([plate!], motionThat(true));
    const off = browser.animations[0]!;
    loadPlates([plate!], motionThat(true));
    expect(off.cancel).toHaveBeenCalledTimes(1);
    expect(browser.animate).toHaveBeenCalledTimes(2);
  });

  it('slides plates off to the right, the outermost first, and resolves once they have gone', async () => {
    const list = plates(2);
    let gone = false;
    const done = unloadPlates(list, motionThat(true)).then(() => {
      gone = true;
    });
    expect(browser.animate).toHaveBeenCalledTimes(2);
    expect(browser.animate.mock.calls[0]).toEqual([
      [
        { transform: 'none', opacity: 1 },
        { transform: `translateX(${SLIDE_PX}px)`, opacity: 0 },
      ],
      { duration: PLATE_MS, delay: STAGGER_MS / 2, easing: expect.any(String), fill: 'forwards' },
    ]);
    expect(browser.animate.mock.calls[1]?.[1]).toMatchObject({ delay: 0 });
    browser.animations[0]!.settle();
    await Promise.resolve();
    expect(gone).toBe(false);
    browser.animations[1]!.settle();
    await done;
    expect(gone).toBe(true);
  });

  it('resolves at once with nothing to unload, and where motion is not allowed', async () => {
    await unloadPlates([], motionThat(true));
    await unloadPlates(plates(2), motionThat(false));
    loadPlates(plates(2), motionThat(false));
    expect(browser.animate).not.toHaveBeenCalled();
  });

  it('counts the plates two loads share from the collar out', () => {
    expect(sharedFromCollar([15, 1.25], [15, 2.5])).toBe(1);
    expect(sharedFromCollar([15, 1.25], [15, 1.25])).toBe(2);
    expect(sharedFromCollar([], [20, 20])).toBe(0);
    expect(sharedFromCollar([20, 20], [20])).toBe(1);
    expect(sharedFromCollar([25, 10], [20, 10])).toBe(0);
  });
});
