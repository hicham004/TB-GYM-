import { vi } from 'vitest';
import { Motion } from '../app/core/motion/motion';

/**
 * A `Motion` for Vitest: jsdom has no `Element.animate`, so every move sets its final state at
 * once, as the real one does where motion is not allowed, and records that it was asked for. A spec
 * that wants to see a move run passes `allowed: true` and reads `calls`.
 */
export function fakeMotion(options: { allowed?: boolean } = {}) {
  const calls: string[] = [];
  const stop = vi.fn();
  const fake = {
    calls,
    stop,
    allowed: vi.fn(() => options.allowed ?? false),
    readSwitch: vi.fn(),
    countUp: vi.fn((element: Element, to: number, format: (value: number) => string) => {
      calls.push('countUp');
      if (!element.textContent?.trim()) element.textContent = format(to);
      return stop;
    }),
    ring: vi.fn((circle: SVGElement, _from: number, to: number) => {
      calls.push('ring');
      circle.setAttribute('stroke-dashoffset', String(to));
      return stop;
    }),
    drawLine: vi.fn(() => {
      calls.push('drawLine');
      return stop;
    }),
    rise: vi.fn(() => {
      calls.push('rise');
      return stop;
    }),
    pop: vi.fn(() => {
      calls.push('pop');
      return stop;
    }),
  } satisfies Partial<Record<keyof Motion, unknown>> & { calls: string[]; stop: unknown };
  return fake;
}

export type FakeMotion = ReturnType<typeof fakeMotion>;

/** `providers: [provideFakeMotion(fake)]` puts the fake where `inject(Motion)` looks. */
export function provideFakeMotion(fake: FakeMotion = fakeMotion()) {
  return { provide: Motion, useValue: fake };
}
