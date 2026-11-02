import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Motion } from '../../core/motion/motion';
import { pulseCard, RING, ringOffset, slideIn, slideOut, sweepRing } from './rest-moment';

describe('rest moment', () => {
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn(), currentTime: 0 }));
  const motion = (allowed: boolean) => ({ allowed: vi.fn(() => allowed) }) as unknown as Motion;

  function withAnimate(): void {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });
  }

  afterEach(() => {
    animate.mockClear();
    delete (Element.prototype as { animate?: unknown }).animate;
  });

  it('reads the ring from the time left: the whole ring at the start, none at the end', () => {
    expect(ringOffset(60, 60)).toBe(0);
    expect(ringOffset(0, 60)).toBe(RING);
    expect(ringOffset(45_000, 75_000)).toBeCloseTo(62.8, 6);
  });

  it('does nothing where motion is not allowed: the card is in place and the ring steps', () => {
    withAnimate();
    const card = document.createElement('div');
    const done = vi.fn();
    slideIn(card, motion(false));
    expect(slideOut(card, motion(false), done)).toBeTypeOf('function');
    expect(done).toHaveBeenCalledTimes(1);
    expect(sweepRing(card, motion(false), 60_000, 60_000, 0)).toBeNull();
    expect(pulseCard(card, motion(false))).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it('ends a slide out at once where there is no card to slide', () => {
    const done = vi.fn();
    slideOut(undefined, motion(true), done);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('measures how far a sweep sits from the clock', () => {
    withAnimate();
    const circle = document.createElement('div');
    const sweep = sweepRing(circle, motion(true), 60_000, 60_000, 1_000)!;
    expect(animate).toHaveBeenCalledTimes(1);
    // The sweep's clock stood still (0) while the wall clock moved 400 ms on.
    expect(sweep.drift(1_400)).toBe(400);
    sweep.cancel();
    expect(animate.mock.results[0]!.value.cancel).toHaveBeenCalledTimes(1);
  });
});
