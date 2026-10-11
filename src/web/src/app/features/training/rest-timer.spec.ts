import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button } from '../../../testing/dom';
import { RestTimer } from './rest-timer';

/** Web Audio as far as the timer uses it: it counts the beeps it was asked to play. */
class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  state: AudioContextState = 'suspended';
  readonly currentTime = 0;
  readonly destination = {};
  beeps = 0;

  constructor() {
    FakeAudioContext.last = this;
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  createOscillator() {
    this.beeps += 1;
    return {
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: vi.fn(),
      stop: vi.fn(),
    };
  }

  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: (node: unknown) => node,
    };
  }
}

describe('RestTimer', () => {
  let fixture: ComponentFixture<RestTimer>;
  let timer: RestTimer;
  let host: HTMLElement;
  let vibrate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    vi.stubGlobal('AudioContext', FakeAudioContext);
    FakeAudioContext.last = null;
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
    vi.unstubAllGlobals();
    delete (navigator as { vibrate?: unknown }).vibrate;
    TestBed.resetTestingModule();
  });

  function pass(milliseconds: number): void {
    vi.advanceTimersByTime(milliseconds);
    fixture.detectChanges();
  }

  const live = () => host.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? '';

  it('counts down, then says the rest is over on screen, to a screen reader and with a buzz', () => {
    timer.prepareSound();
    timer.start(60);
    fixture.detectChanges();
    expect(host.querySelector('[role="timer"]')?.textContent).toContain('1:00');

    pass(30_000);
    expect(host.querySelector('[role="timer"]')?.textContent).toContain('0:30');
    expect(live()).toBe('');

    pass(30_000);
    expect(host.querySelector('[role="timer"]')).toBeNull();
    expect(host.textContent).toContain('Rest is over');
    expect(host.textContent).toContain('Next set when you’re ready.');
    expect(live()).toBe('Rest is over.');
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200]);
    // Two short beeps, since the tap that logged the set allowed sound.
    expect(FakeAudioContext.last?.beeps).toBe(2);
  });

  it('ends a skipped rest without a word, a buzz or a tone', () => {
    timer.prepareSound();
    timer.start(60);
    fixture.detectChanges();

    button(host, 'Skip').click();
    pass(61_000);

    expect(host.textContent).not.toContain('Rest is over');
    expect(live()).toBe('');
    expect(vibrate).not.toHaveBeenCalled();
    expect(FakeAudioContext.last?.beeps).toBe(0);
  });

  it('adds fifteen seconds to the rest in progress', () => {
    timer.start(60);
    fixture.detectChanges();
    button(host, '+15 s').click();

    pass(60_000);
    expect(host.querySelector('[role="timer"]')?.textContent).toContain('0:15');

    pass(15_000);
    expect(host.textContent).toContain('Rest is over');
  });

  it('takes Rest is over away after a few seconds, or at once on Dismiss', () => {
    timer.start(10);
    pass(10_000);
    expect(host.textContent).toContain('Rest is over');

    pass(6_000);
    expect(host.textContent).not.toContain('Rest is over');
    expect(live()).toBe('');

    timer.start(10);
    pass(10_000);
    button(host, 'Dismiss').click();
    fixture.detectChanges();
    expect(host.textContent).not.toContain('Rest is over');
  });

  /** A phone left locked through the rest wakes to the message, not to a stale buzz. */
  it('shows a rest that ended long ago without buzzing', () => {
    timer.prepareSound();
    timer.start(60);
    fixture.detectChanges();

    vi.setSystemTime(Date.now() + 5 * 60_000);
    pass(250);

    expect(host.textContent).toContain('Rest is over');
    expect(vibrate).not.toHaveBeenCalled();
    expect(FakeAudioContext.last?.beeps).toBe(0);
  });

  it('plays no tone where no tap prepared one, and still buzzes', () => {
    timer.start(5);
    pass(5_000);

    expect(FakeAudioContext.last).toBeNull();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  /** WCAG 2.4.11: a control focused at the foot of the page scrolls clear of the card. */
  it('keeps room for the card at the foot of the page while it shows', () => {
    const root = document.documentElement;
    timer.start(10);
    fixture.detectChanges();
    expect(root.style.scrollPaddingBlockEnd).toBe('8rem');

    pass(10_000);
    expect(root.style.scrollPaddingBlockEnd).toBe('8rem');

    pass(6_000);
    expect(root.style.scrollPaddingBlockEnd).toBe('');
  });

  it('stops quietly when the player asks, as at the end of the workout', () => {
    timer.start(30);
    fixture.detectChanges();

    timer.stop();
    pass(31_000);

    expect(host.querySelector('[role="timer"]')).toBeNull();
    expect(host.textContent).not.toContain('Rest is over');
    expect(vibrate).not.toHaveBeenCalled();
  });
});
