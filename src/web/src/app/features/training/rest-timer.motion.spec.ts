import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button } from '../../../testing/dom';
import { Motion } from '../../core/motion/motion';
import { ringOffset } from './rest-moment';
import { RestTimer } from './rest-timer';

/**
 * The rest timer's motion (docs/MOTION-PLAN-2026-11.md, W5), with `Element.animate` stubbed and
 * motion allowed; rest-timer.spec.ts covers the timer itself, where jsdom's missing `animate`
 * lands every move on its final state at once.
 */

/** `Element.animate` as the moment uses it: the keyframes, the options, a clock and an end to call. */
class FakeAnimation {
  readonly finished: Promise<FakeAnimation>;
  readonly cancel = vi.fn(() => this.reject(new Error('cancelled')));
  private readonly startedAt = Date.now();
  private frozenAt: number | null = null;
  private settle!: (animation: FakeAnimation) => void;
  private reject!: (reason: Error) => void;

  constructor(
    readonly target: Element,
    readonly keyframes: Keyframe[],
    readonly options: KeyframeAnimationOptions,
  ) {
    this.finished = new Promise((resolve, reject) => {
      this.settle = resolve;
      this.reject = reject;
    });
    this.finished.catch(() => undefined);
  }

  /** Follows the (faked) clock, as a document timeline does while the page is awake. */
  get currentTime(): number {
    return this.frozenAt ?? Date.now() - this.startedAt;
  }

  /** The document's timeline stops: a locked phone. */
  freeze(): void {
    this.frozenAt = this.currentTime;
  }

  finish(): void {
    this.settle(this);
  }
}

describe('RestTimer with motion', () => {
  let fixture: ComponentFixture<RestTimer>;
  let timer: RestTimer;
  let host: HTMLElement;
  let animations: FakeAnimation[];

  beforeEach(() => {
    animations = [];
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
        const animation = new FakeAnimation(this, keyframes, options);
        animations.push(animation);
        return animation;
      },
    });
    TestBed.overrideProvider(Motion, { useValue: { allowed: () => true } });
    fixture = TestBed.createComponent(RestTimer);
    timer = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    // After rendering: faking timers first leaves later tests waiting forever.
    vi.useFakeTimers();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (Element.prototype as { animate?: unknown }).animate;
    TestBed.resetTestingModule();
  });

  function pass(milliseconds: number): void {
    vi.advanceTimersByTime(milliseconds);
    fixture.detectChanges();
  }

  /** The slide's end reaches the timer a microtask later. */
  async function flush(): Promise<void> {
    for (let index = 0; index < 3; index++) await Promise.resolve();
    fixture.detectChanges();
  }

  const card = () => host.querySelector<HTMLElement>('[role="timer"]');
  const live = () => host.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? '';

  it('slides the card in and drains the ring in one sweep to the end time', () => {
    timer.start(60);
    fixture.detectChanges();

    const [slide, sweep] = animations;
    expect(animations).toHaveLength(2);
    expect(slide.target).toBe(card());
    expect(slide.keyframes[0]).toEqual({ opacity: 0, transform: 'translateY(140px)' });
    expect(slide.options).toMatchObject({ duration: 500 });
    expect(sweep.target).toBe(host.querySelector('.fill'));
    expect(sweep.keyframes).toEqual([{ strokeDashoffset: 0 }, { strokeDashoffset: 157 }]);
    expect(sweep.options).toMatchObject({ duration: 60_000, easing: 'linear', fill: 'forwards' });

    // The sweep keeps the clock's time, so the ticks restart nothing.
    pass(30_000);
    expect(animations).toHaveLength(2);
    expect(sweep.cancel).not.toHaveBeenCalled();
    expect(card()?.textContent).toContain('0:30');
  });

  it('restarts the sweep from the current fraction on +15 s', () => {
    timer.start(60);
    fixture.detectChanges();
    pass(30_000);

    button(host, '+15 s').click();
    fixture.detectChanges();

    expect(animations[1].cancel).toHaveBeenCalledTimes(1);
    const sweep = animations.at(-1)!;
    expect(sweep.target).toBe(host.querySelector('.fill'));
    expect(sweep.keyframes[0]).toEqual({ strokeDashoffset: ringOffset(45_000, 75_000) });
    expect(sweep.options).toMatchObject({ duration: 45_000 });
    expect(card()?.textContent).toContain('0:45');
  });

  it('slides the card out on Skip, taking no tap meanwhile, and ends the rest once it has gone', async () => {
    timer.start(60);
    fixture.detectChanges();
    pass(10_000);

    button(host, 'Skip').click();
    fixture.detectChanges();

    // On its way out: still there, holding its clock, out of reach of a second tap.
    const leaving = card();
    expect(leaving).not.toBeNull();
    expect(leaving?.classList.contains('leaving')).toBe(true);
    expect(leaving?.textContent).toContain('0:50');
    const out = animations.at(-1)!;
    expect(out.target).toBe(leaving);
    expect(out.keyframes[1]).toEqual({ opacity: 0, transform: 'translateY(140px)' });
    expect(out.options).toMatchObject({ duration: 350, fill: 'forwards' });
    expect(animations[1].cancel).not.toHaveBeenCalled();

    out.finish();
    await flush();
    expect(card()).toBeNull();
    expect(host.textContent).not.toContain('Rest is over');
    expect(animations[1].cancel).toHaveBeenCalledTimes(1);
    expect(live()).toBe('');
  });

  it('keeps a card that is on its way out when a new rest starts', async () => {
    timer.start(60);
    fixture.detectChanges();
    button(host, 'Skip').click();
    fixture.detectChanges();
    const out = animations.at(-1)!;

    timer.start(90);
    fixture.detectChanges();

    expect(out.cancel).toHaveBeenCalledTimes(1);
    expect(card()?.classList.contains('leaving')).toBe(false);
    expect(card()?.textContent).toContain('1:30');
    // The card was showing, so it does not slide in again; its ring sweeps afresh.
    const entrances = animations.filter((animation) => animation.keyframes[0]['opacity'] === 0);
    expect(entrances).toHaveLength(1);
    expect(animations.at(-1)?.keyframes).toEqual([
      { strokeDashoffset: 0 },
      { strokeDashoffset: 157 },
    ]);

    out.finish();
    await flush();
    expect(card()?.textContent).toContain('1:30');
  });

  /** A phone locked through part of the rest: the sweep stood still while the clock went on. */
  it('corrects a sweep that fell behind the clock when the page shows again', () => {
    vi.spyOn(Document.prototype, 'visibilityState', 'get').mockReturnValue('visible');
    timer.start(60);
    fixture.detectChanges();
    const sweep = animations[1];

    sweep.freeze();
    vi.setSystemTime(Date.now() + 5_000);
    document.dispatchEvent(new Event('visibilitychange'));
    fixture.detectChanges();

    expect(sweep.cancel).toHaveBeenCalledTimes(1);
    const again = animations.at(-1)!;
    expect(again.target).toBe(host.querySelector('.fill'));
    expect(again.keyframes[0]).toEqual({ strokeDashoffset: ringOffset(55_000, 60_000) });
    expect(again.options).toMatchObject({ duration: 55_000 });
    expect(card()?.textContent).toContain('0:55');

    // Awake and in step again: nothing more is restarted.
    pass(10_000);
    expect(animations.at(-1)).toBe(again);
  });

  it('pulses through the last three seconds, and not after +15 s until they come again', () => {
    timer.start(10);
    fixture.detectChanges();

    pass(6_750);
    expect(animations).toHaveLength(2);
    pass(250);
    const pulse = animations.at(-1)!;
    expect(animations).toHaveLength(3);
    expect(pulse.target).toBe(card());
    expect(pulse.keyframes[1]).toEqual({ transform: 'scale(1.025)', offset: 0.5 });
    expect(pulse.options).toMatchObject({ duration: 1000, iterations: 3, composite: 'add' });

    button(host, '+15 s').click();
    fixture.detectChanges();
    expect(pulse.cancel).toHaveBeenCalledTimes(1);
    const pulses = () => animations.filter((animation) => animation.options.iterations === 3);
    pass(14_750);
    expect(pulses()).toHaveLength(1);
    pass(250);
    expect(pulses()).toHaveLength(2);
  });

  it('still announces the end, then slides Rest is over out on Dismiss', async () => {
    timer.start(5);
    fixture.detectChanges();
    pass(5_000);

    expect(card()).toBeNull();
    expect(host.textContent).toContain('Rest is over');
    expect(live()).toBe('Rest is over.');
    expect(animations[1].cancel).toHaveBeenCalledTimes(1);

    button(host, 'Dismiss').click();
    fixture.detectChanges();
    const over = host.querySelector('.over');
    expect(over?.classList.contains('leaving')).toBe(true);
    const out = animations.at(-1)!;
    expect(out.target).toBe(over);
    expect(host.textContent).toContain('Rest is over');

    out.finish();
    await flush();
    expect(host.querySelector('.over')).toBeNull();
    expect(live()).toBe('');
  });
});
