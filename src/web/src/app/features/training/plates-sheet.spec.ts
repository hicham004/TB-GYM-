import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrainingLoadUnit } from '../../core/api/generated';
import { button, press, query, settle } from '../../../testing/dom';
import { fakeMotion, provideFakeMotion } from '../../../testing/motion-fake';
import { PlatesSheet } from './plates-sheet';

@Component({
  imports: [PlatesSheet],
  template: `<app-plates-sheet [weight]="weight()" [unit]="unit()" />`,
})
class Host {
  readonly weight = signal<number | null>(52.5);
  readonly unit = signal<TrainingLoadUnit | null>('Kilogram');
}

/** What `Element.animate` hands back here: a promise a test can settle. */
function fakeAnimation() {
  let settle: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { cancel: vi.fn(), finished, settle };
}

type FakeAnimation = ReturnType<typeof fakeAnimation>;

/** jsdom has no `Element.animate`: a browser that moves is stubbed on. */
function browserThatMoves() {
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
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    writable: true,
    value: () => [],
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

async function mount(options: { allowed?: boolean } = {}) {
  const motion = fakeMotion({ allowed: options.allowed ?? false });
  TestBed.configureTestingModule({ imports: [Host], providers: [provideFakeMotion(motion)] });
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, motion };
}

/** The steppers carry their name as an aria-label; their text is a sign. */
const stepper = (host: HTMLElement, label: string) =>
  query<HTMLButtonElement>(host, `button[aria-label="${label}"]`);
const tap = (host: HTMLElement, label: string) => {
  const target = label.startsWith('Use ') ? button(host, label) : stepper(host, label);
  if (target.disabled) throw new Error(`The "${label}" button is disabled.`);
  target.click();
};

const perSide = (host: HTMLElement) => query(host, '.per-side').textContent?.trim();
const drawn = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.plate'), (plate) => plate.textContent?.trim());
const note = (host: HTMLElement) => host.querySelector('.note')?.textContent?.trim() ?? null;
const live = (host: HTMLElement) => query(host, '[aria-live]').textContent?.trim();
const weight = (host: HTMLElement) =>
  query(host, '.weight').textContent?.replace(/\s+/g, ' ').trim();

describe('PlatesSheet (motion plan W11)', () => {
  let browser: ReturnType<typeof browserThatMoves> | null = null;

  afterEach(() => {
    browser?.restore();
    browser = null;
  });

  it("draws Maya's 52.5 kg as 15 and 1.25 a side on the 20 kg bar, with the words and the guide", async () => {
    const { host } = await mount();
    expect(weight(host)).toBe('52.5 kg');
    expect(perSide(host)).toBe('Per side: 15, 1.25');
    expect(drawn(host)).toEqual(['15', '1.25']);
    expect(query(host, '.bar-line span').textContent?.trim()).toBe('20 kg bar');
    expect(button(host, 'Use 15 kg bar')).toBeTruthy();
    expect(note(host)).toBeNull();
    expect(live(host)).toBe('52.5 kg. Per side: 15, 1.25.');
    expect(query(host, '.guide').textContent?.trim()).toBe(
      "Standard plates 25 to 1.25 kg on a 20 kg bar; your gym's may differ.",
    );
    // The drawing is for the eye; the words carry it.
    expect(query(host, '.bar').getAttribute('aria-hidden')).toBe('true');
    const thin = host.querySelectorAll('.plate.thin');
    expect(thin.length).toBe(1);
    expect((thin[0] as HTMLElement).style.getPropertyValue('--h')).toBe('0.36');
  });

  it('steps to the next loadable weight either way and stops at the bar', async () => {
    const { host, fixture } = await mount();
    tap(host, 'More weight');
    await settle(fixture);
    expect(weight(host)).toBe('55 kg');
    expect(perSide(host)).toBe('Per side: 15, 2.5');
    expect(drawn(host)).toEqual(['15', '2.5']);
    tap(host, 'Less weight');
    tap(host, 'Less weight');
    await settle(fixture);
    expect(weight(host)).toBe('50 kg');
    expect(perSide(host)).toBe('Per side: 15');
    expect(drawn(host)).toEqual(['15']);
    for (let count = 0; count < 12; count++) tap(host, 'Less weight');
    await settle(fixture);
    expect(weight(host)).toBe('20 kg');
    expect(perSide(host)).toBe('Just the bar');
    expect(drawn(host)).toEqual([]);
    expect(stepper(host, 'Less weight').disabled).toBe(true);
    expect(stepper(host, 'More weight').disabled).toBe(false);
  });

  it('switches to the 15 kg bar with one tap, and back', async () => {
    const { host, fixture } = await mount();
    press(host, 'Use 15 kg bar');
    await settle(fixture);
    expect(query(host, '.bar-line span').textContent?.trim()).toBe('15 kg bar');
    expect(perSide(host)).toBe('Per side: 15, 2.5, 1.25');
    expect(drawn(host)).toEqual(['15', '2.5', '1.25']);
    expect(weight(host)).toBe('52.5 kg');
    press(host, 'Use 20 kg bar');
    await settle(fixture);
    expect(perSide(host)).toBe('Per side: 15, 1.25');
  });

  it('says a weight no plate makes, shows the nearest below and steps to the one above', async () => {
    const { host, fixture } = await mount();
    fixture.componentInstance.weight.set(21);
    await settle(fixture);
    expect(note(host)).toBe(
      '21 kg is not loadable with these plates; the bar shows 20 kg. Next up: 22.5 kg.',
    );
    expect(perSide(host)).toBe('Just the bar');
    expect(drawn(host)).toEqual([]);
    expect(live(host)).toBe(
      '21 kg. Just the bar. 21 kg is not loadable with these plates; the bar shows 20 kg. Next up: 22.5 kg.',
    );
    tap(host, 'More weight');
    await settle(fixture);
    expect(weight(host)).toBe('22.5 kg');
    expect(note(host)).toBeNull();
    expect(drawn(host)).toEqual(['1.25']);
  });

  it('says a weight under the bar is lighter than the bar, and + brings the bar', async () => {
    const { host, fixture } = await mount();
    fixture.componentInstance.weight.set(15);
    await settle(fixture);
    expect(note(host)).toBe('Lighter than the bar');
    expect(drawn(host)).toEqual([]);
    expect(stepper(host, 'Less weight').disabled).toBe(true);
    // On the lighter bar the same weight is the bar alone.
    tap(host, 'Use 15 kg bar');
    await settle(fixture);
    expect(note(host)).toBeNull();
    expect(perSide(host)).toBe('Just the bar');
    tap(host, 'Use 20 kg bar');
    await settle(fixture);
    expect(note(host)).toBe('Lighter than the bar');
    tap(host, 'More weight');
    await settle(fixture);
    expect(weight(host)).toBe('20 kg');
    expect(note(host)).toBeNull();
  });

  it('loads pounds in their own plates on the 45 lb bar, never converted', async () => {
    const { host, fixture } = await mount();
    fixture.componentInstance.unit.set('Pound');
    fixture.componentInstance.weight.set(135);
    await settle(fixture);
    expect(weight(host)).toBe('135 lb');
    expect(perSide(host)).toBe('Per side: 45');
    expect(query(host, '.bar-line span').textContent?.trim()).toBe('45 lb bar');
    expect(button(host, 'Use 35 lb bar')).toBeTruthy();
    expect(query(host, '.guide').textContent?.trim()).toBe(
      "Standard plates 45 to 2.5 lb on a 45 lb bar; your gym's may differ.",
    );
    tap(host, 'More weight');
    await settle(fixture);
    expect(weight(host)).toBe('140 lb');
    expect(perSide(host)).toBe('Per side: 45, 2.5');
  });

  it('opens on the bar alone where the set has no weight yet', async () => {
    const { host, fixture } = await mount();
    fixture.componentInstance.weight.set(null);
    await settle(fixture);
    expect(weight(host)).toBe('20 kg');
    expect(perSide(host)).toBe('Just the bar');
  });

  describe('in a browser that moves', () => {
    it('slides the plates on from the collar out when the sheet opens', async () => {
      browser = browserThatMoves();
      const { host } = await mount({ allowed: true });
      expect(drawn(host)).toEqual(['15', '1.25']);
      expect(browser.animate).toHaveBeenCalledTimes(2);
      expect(browser.animate.mock.calls[0]?.[1]).toMatchObject({ delay: 0, fill: 'backwards' });
      expect(browser.animate.mock.calls[1]?.[1]).toMatchObject({ delay: 60 });
    });

    it('slides a leaving plate off before the new one slides on, the words changing at once', async () => {
      browser = browserThatMoves();
      const { host, fixture } = await mount({ allowed: true });
      browser.animate.mockClear();
      tap(host, 'More weight');
      await settle(fixture);
      // The words say 55 kg already; the 1.25 plate is on its way off and the bar still shows it.
      expect(perSide(host)).toBe('Per side: 15, 2.5');
      expect(drawn(host)).toEqual(['15', '1.25']);
      expect(browser.animate).toHaveBeenCalledTimes(1);
      expect(browser.animate.mock.calls[0]?.[0]).toEqual([
        { transform: 'none', opacity: 1 },
        { transform: 'translateX(48px)', opacity: 0 },
      ]);
      browser.animations.at(-1)!.settle();
      await settle(fixture);
      expect(drawn(host)).toEqual(['15', '2.5']);
      // Only the new plate slides on; the 15 stays where it is.
      expect(browser.animate).toHaveBeenCalledTimes(2);
      expect(browser.animate.mock.calls[1]?.[1]).toMatchObject({ delay: 0, fill: 'backwards' });
    });

    it('catches up with the latest weight when taps come faster than the plates move', async () => {
      browser = browserThatMoves();
      const { host, fixture } = await mount({ allowed: true });
      browser.animate.mockClear();
      tap(host, 'More weight');
      tap(host, 'More weight');
      await settle(fixture);
      expect(perSide(host)).toBe('Per side: 15, 2.5, 1.25');
      expect(browser.animate).toHaveBeenCalledTimes(1);
      browser.animations.at(-1)!.settle();
      await settle(fixture);
      // The first redraw ends on the latest ask, with the two new plates sliding on.
      expect(drawn(host)).toEqual(['15', '2.5', '1.25']);
      expect(browser.animate).toHaveBeenCalledTimes(3);
    });
  });

  it('moves nothing with reduced motion or the switch: the plates and the words change at once', async () => {
    browser = browserThatMoves();
    const { host, fixture, motion } = await mount({ allowed: false });
    expect(motion.allowed).toHaveBeenCalledWith('W11');
    expect(drawn(host)).toEqual(['15', '1.25']);
    tap(host, 'More weight');
    await settle(fixture);
    expect(drawn(host)).toEqual(['15', '2.5']);
    expect(live(host)).toBe('55 kg. Per side: 15, 2.5.');
    expect(browser.animate).not.toHaveBeenCalled();
  });
});
