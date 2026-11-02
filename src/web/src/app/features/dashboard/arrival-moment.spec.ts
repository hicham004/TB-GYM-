import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Motion } from '../../core/motion/motion';
import {
  arrivalOf,
  arriveRow,
  closeStrip,
  JUST_NOW_MS,
  leaveRow,
  newArrivals,
  openStrip,
  pulseRing,
} from './arrival-moment';
import type { ActivityRow } from './coach-today.models';

const NOW = Date.parse('2026-11-02T13:00:00Z');

function row(key: string, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    key,
    kind: 'WorkoutCompleted',
    name: 'Maya Fakhoury',
    initials: 'MF',
    sentence: 'Maya Fakhoury finished Lower A in 42 min',
    records: ['Back Squat 52.5 kg × 5'],
    moreRecords: 0,
    occurredAt: new Date(NOW - 20_000).toISOString(),
    ago: 'just now',
    link: '/clients/c-maya/training',
    ...overrides,
  };
}

describe('newArrivals', () => {
  it('names the finished workouts that are new and fresh, never before the first read', () => {
    const known = new Set(['WorkoutCompleted:old']);
    const rows = [
      row('WorkoutCompleted:new'),
      row('WorkoutCompleted:old'),
      row('CheckInSubmitted:c1', { kind: 'CheckInSubmitted' }),
      row('WorkoutCompleted:assigned', {
        occurredAt: new Date(NOW - JUST_NOW_MS - 1000).toISOString(),
      }),
    ];
    expect(newArrivals(known, rows, NOW).map((fresh) => fresh.key)).toEqual([
      'WorkoutCompleted:new',
    ]);
    expect(newArrivals(null, rows, NOW)).toEqual([]);
    expect(newArrivals(new Set(), [], NOW)).toEqual([]);
  });

  it('phrases the strip from the row, with its records counted', () => {
    expect(arrivalOf(row('k'))).toEqual({
      key: 'k',
      initials: 'MF',
      sentence: 'Maya Fakhoury finished Lower A in 42 min',
      records: '1 record',
      link: '/clients/c-maya/training',
    });
    expect(arrivalOf(row('k', { records: ['a', 'b'], moreRecords: 1 })).records).toBe('3 records');
    expect(arrivalOf(row('k', { records: [] })).records).toBe('');
  });
});

describe('the moves', () => {
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  const pop = vi.fn();
  const allowed = { allowed: () => true, pop } as unknown as Motion;
  const still = { allowed: () => false, pop } as unknown as Motion;

  afterEach(() => {
    animate.mockClear();
    pop.mockClear();
    delete (Element.prototype as { animate?: unknown }).animate;
  });

  function browserThatMoves(): void {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });
  }

  it('slides the strip open and closed on its grid rows, and the close reports once it has gone', async () => {
    browserThatMoves();
    const strip = document.createElement('div');
    openStrip(strip, allowed);
    expect(animate).toHaveBeenCalledTimes(1);
    const [openFrames, openOptions] = animate.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(openFrames[0]).toEqual({ gridTemplateRows: '0fr', opacity: 0 });
    expect(openFrames[1]).toEqual({ gridTemplateRows: '1fr', opacity: 1 });
    expect(openOptions.duration).toBe(500);

    const done = vi.fn();
    closeStrip(strip, allowed, done);
    const [, closeOptions] = animate.mock.calls[1] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(closeOptions).toMatchObject({ duration: 350, fill: 'forwards' });
    expect(done).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('pulses the ring twice and slides the row in with its badges popping', () => {
    browserThatMoves();
    const ring = document.createElement('span');
    pulseRing(ring, allowed);
    const [, ringOptions] = animate.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(ringOptions).toMatchObject({ duration: 900, iterations: 2 });

    const li = document.createElement('li');
    li.innerHTML = '<div><span class="pr">PR</span><span class="pr">PR</span></div>';
    arriveRow(li, allowed);
    expect(li.classList.contains('arrived')).toBe(true);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(pop).toHaveBeenCalledTimes(2);
    expect(pop.mock.calls[0][1]).toEqual({ moment: 'W6' });
  });

  it('slides a resolved row out, then collapses it, and reports once it has gone', async () => {
    const settles: (() => void)[] = [];
    const stepped = vi.fn(() => {
      let settle: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        settle = resolve;
      });
      settles.push(settle);
      return { finished, cancel: vi.fn() };
    });
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: stepped,
    });
    const row = document.createElement('li');
    document.body.append(row);
    const done = vi.fn();
    leaveRow(row, allowed, done);
    expect(stepped).toHaveBeenCalledTimes(1);
    const [slideFrames, slideOptions] = stepped.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(slideFrames[1]).toEqual({ transform: 'translateX(30px)', opacity: 0 });
    expect(slideOptions).toMatchObject({ duration: 250, fill: 'forwards' });

    settles[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(stepped).toHaveBeenCalledTimes(2);
    const [collapseFrames] = stepped.mock.calls[1] as unknown as [Keyframe[]];
    expect(collapseFrames).toEqual([{ gridTemplateRows: '1fr' }, { gridTemplateRows: '0fr' }]);
    expect(done).not.toHaveBeenCalled();
    settles[1]();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
    row.remove();

    const quiet = vi.fn();
    leaveRow(document.createElement('li'), still, quiet);
    expect(quiet).toHaveBeenCalledTimes(1);
  });

  it('lands everything at once where motion is not allowed, keeping the highlight', () => {
    const strip = document.createElement('div');
    const done = vi.fn();
    openStrip(strip, still);
    closeStrip(strip, still, done);
    expect(done).toHaveBeenCalledTimes(1);
    pulseRing(document.createElement('span'), still);
    const li = document.createElement('li');
    li.innerHTML = '<span class="pr">PR</span>';
    arriveRow(li, still);
    expect(li.classList.contains('arrived')).toBe(true);
    expect(pop).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    expect(() => closeStrip(undefined, allowed, done)).not.toThrow();
    expect(done).toHaveBeenCalledTimes(2);
  });
});
