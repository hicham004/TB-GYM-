import { Injector, runInInjectionContext, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAWN_TOGETHER_PATIENCE_MS, drawnTogether } from './drawn-together';

/** Two parts of a page, each loading until it answers. */
function page() {
  const first = signal<'loading' | 'ready'>('loading');
  const second = signal<'loading' | 'ready'>('loading');
  const drawn: Signal<boolean> = runInInjectionContext(TestBed.inject(Injector), () =>
    drawnTogether(
      () => first() !== 'loading' || second() !== 'loading',
      () => first() !== 'loading' && second() !== 'loading',
    ),
  );
  return { first, second, drawn };
}

describe('drawnTogether', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('draws the parts once every one has answered, and not before', () => {
    const { first, second, drawn } = page();
    expect(drawn()).toBe(false);

    first.set('ready');
    TestBed.tick();
    expect(drawn()).toBe(false);

    second.set('ready');
    TestBed.tick();
    expect(drawn()).toBe(true);
  });

  it('stops waiting for a slow part a moment after the first has answered', () => {
    const { first, drawn } = page();
    first.set('ready');
    TestBed.tick();

    vi.advanceTimersByTime(DRAWN_TOGETHER_PATIENCE_MS - 1);
    TestBed.tick();
    expect(drawn()).toBe(false);

    vi.advanceTimersByTime(1);
    TestBed.tick();
    expect(drawn()).toBe(true);
  });

  it('stays drawn when a part reads again, and starts over once nothing has answered', () => {
    const { first, second, drawn } = page();
    first.set('ready');
    second.set('ready');
    TestBed.tick();
    expect(drawn()).toBe(true);

    // A part reading again (a Retry) does not take the page back to its skeleton.
    second.set('loading');
    TestBed.tick();
    expect(drawn()).toBe(true);

    // A workspace switch: every part is loading again, so the page waits again.
    first.set('loading');
    TestBed.tick();
    expect(drawn()).toBe(false);
    first.set('ready');
    TestBed.tick();
    expect(drawn()).toBe(false);
  });
});
