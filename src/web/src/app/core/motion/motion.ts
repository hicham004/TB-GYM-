import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { MOTION_KEY, readMotionSwitch, readStored, ROWS_KEY } from './motion-switch';

/**
 * The app's motion (docs/MOTION-PLAN-2026-11.md, W1): the reduced-motion read, the kill switch and
 * the moves the signature moments share. Everything runs on the Web Animations API and
 * `requestAnimationFrame`, so nothing downloads at a moment, `document.getAnimations()` can pause and
 * scrub every move (which is how a chat checks itself), and the module stays small enough for
 * `ui/**` to import. GSAP stays on the homepage.
 *
 * Every move writes the DOM directly (no change detection per frame), returns a function that ends
 * it, and sets the final state at once where motion is not allowed: on the server, where the browser
 * has no `matchMedia` or `Element.animate` (jsdom has neither), where the person asked for reduced
 * motion, and while the switch is on.
 *
 * The switch: `?motion=off` in the address writes `tb-motion = off` to local storage (`?motion=on`
 * clears it), and `tb-motion-off = W3,W7` turns single rows off. Both are read per call, so a change
 * needs no rebuild; `<html data-tb-motion="off">` lets the stylesheet's everyday layer follow.
 */
@Injectable({ providedIn: 'root' })
export class Motion {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    if (this.browser) this.readSwitch();
  }

  /**
   * Whether a moment may move right now: in a browser that can, for a person who has not asked for
   * less, with the switch off and `moment`'s row (W3, W7, ...) not switched off on its own.
   */
  allowed(moment?: string): boolean {
    if (!this.browser) return false;
    const view = this.document.defaultView;
    if (
      view === null ||
      typeof view.matchMedia !== 'function' ||
      typeof Element === 'undefined' ||
      typeof Element.prototype.animate !== 'function' ||
      !view.matchMedia('(prefers-reduced-motion: no-preference)').matches
    ) {
      return false;
    }
    if (readStored(view, MOTION_KEY) === 'off') return false;
    if (moment !== undefined) {
      const off = (readStored(view, ROWS_KEY) ?? '').split(',').map((row) => row.trim());
      if (off.includes(moment)) return false;
    }
    return true;
  }

  /** `readMotionSwitch` for this document; a test calls it again after changing the address. */
  readSwitch(): void {
    readMotionSwitch(this.document);
  }

  /**
   * Counts a number up to its final text over 1.1 s, easing out. The element already shows the
   * final string (the server's own), which is captured first and written back at the end, so the
   * count never invents a digit; `format` draws the values on the way.
   */
  countUp(
    element: Element,
    to: number,
    format: (value: number) => string,
    options: MoveOptions & { from?: number; duration?: number } = {},
  ): Stop {
    const final = element.textContent?.trim() ? element.textContent : format(to);
    // Through the element's one text node where it has one: a template binding holds that node,
    // so what the page writes later still lands on what it shows.
    const node =
      element.childNodes.length === 1 && element.firstChild?.nodeType === 3
        ? (element.firstChild as CharacterData)
        : null;
    const write = (value: string) => {
      if (node) node.data = value;
      else element.textContent = value;
    };
    if (!this.allowed(options.moment)) {
      write(final);
      return noop;
    }
    const from = options.from ?? 0;
    const duration = options.duration ?? 1100;
    const view = this.document.defaultView as Window;
    // An empty animation keeps the clock, so pausing or scrubbing it through
    // `document.getAnimations()` moves the digits too.
    const clock = element.animate([{}, {}], { duration, easing: 'linear' });
    let frame = 0;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      view.cancelAnimationFrame(frame);
      write(final);
    };
    const tick = () => {
      if (ended) return;
      const time = Number(clock.currentTime ?? 0);
      const progress = Math.min(1, Math.max(0, time / duration));
      if (progress >= 1) {
        end();
        return;
      }
      write(format(from + (to - from) * easeOutCubic(progress)));
      frame = view.requestAnimationFrame(tick);
    };
    clock.finished.then(end, end);
    frame = view.requestAnimationFrame(tick);
    return () => {
      end();
      clock.cancel();
    };
  }

  /**
   * Sweeps a ring from one `stroke-dashoffset` to another over 1.1 s. The final offset is written
   * to the attribute first (what the template binding writes too), so the ring rests there however
   * the sweep ends.
   */
  ring(circle: SVGElement, from: number, to: number, options: MoveOptions = {}): Stop {
    circle.setAttribute('stroke-dashoffset', String(to));
    if (!this.allowed(options.moment) || from === to) return noop;
    const animation = circle.animate([{ strokeDashoffset: from }, { strokeDashoffset: to }], {
      duration: options.duration ?? 1100,
      easing: EASE.outStrong,
    });
    return () => animation.cancel();
  }

  /** Draws a line along its path over 1.4 s, eased at both ends. */
  drawLine(path: SVGGeometryElement, options: MoveOptions = {}): Stop {
    if (!this.allowed(options.moment) || typeof path.getTotalLength !== 'function') return noop;
    const length = path.getTotalLength();
    if (!(length > 0)) return noop;
    const dash = path.style.strokeDasharray;
    path.style.strokeDasharray = String(length);
    const animation = path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
      duration: options.duration ?? 1400,
      easing: EASE.inOut,
    });
    const restore = () => {
      path.style.strokeDasharray = dash;
    };
    animation.finished.then(restore, restore);
    return () => {
      animation.cancel();
      restore();
    };
  }

  /**
   * Rises elements into place one after another (14 px up and transparent to rest, 450 ms each,
   * 50 ms apart), at most six: anything later is already in place when the eye reaches it.
   */
  rise(elements: Iterable<Element>, options: RiseOptions = {}): Stop {
    const list = Array.from(elements).slice(0, RISE_CAP);
    if (list.length === 0 || !this.allowed(options.moment)) return noop;
    const stagger = options.stagger ?? 50;
    const from = options.from ?? 14;
    const duration = options.duration ?? 450;
    const animations = list.map((element, index) =>
      element.animate(
        [
          { opacity: 0, transform: `translateY(${from}px)` },
          { opacity: 1, transform: 'none' },
        ],
        // Backwards: an element stays hidden through its own delay instead of flashing first.
        { duration, delay: index * stagger, easing: EASE.out, fill: 'backwards' },
      ),
    );
    return () => animations.forEach((animation) => animation.cancel());
  }

  /** Pops an element in from half size, overshooting a little before it rests (550 ms). */
  pop(element: Element, options: MoveOptions = {}): Stop {
    if (!this.allowed(options.moment)) return noop;
    const animation = element.animate([{ transform: 'scale(0.5)' }, { transform: 'none' }], {
      duration: options.duration ?? 550,
      easing: this.overshoot(),
    });
    return () => animation.cancel();
  }

  /** The overshoot curve, where the browser draws `linear()` easings; the classic back-out otherwise. */
  private overshoot(): string {
    const css = this.document.defaultView?.CSS;
    const drawsLinear =
      typeof css?.supports === 'function' &&
      css.supports('animation-timing-function', 'linear(0, 1)');
    return drawsLinear ? EASE.backOut : 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  }
}

/** Ends a move early; the element rests in its final state. */
export type Stop = () => void;

export interface MoveOptions {
  /** The row the moment belongs to (W3, W7, ...), so `tb-motion-off` can turn it off alone. */
  readonly moment?: string;
  readonly duration?: number;
}

export interface RiseOptions extends MoveOptions {
  /** Milliseconds between one element's start and the next (50). */
  readonly stagger?: number;
  /** How far up each element starts, in px (14). */
  readonly from?: number;
}

export { MOTION_KEY, ROWS_KEY, SWITCH_ATTRIBUTE, readMotionSwitch } from './motion-switch';

/** `rise` moves at most this many elements. */
export const RISE_CAP = 6;

/**
 * The prototype's GSAP curves as the Web Animations API takes them: `power2.out`, `power3.out`,
 * `power2.inOut`, and `back.out(2.5)` as a `linear()` curve worked out once (about 300 bytes).
 */
export const EASE = {
  out: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
  outStrong: 'cubic-bezier(0.165, 0.84, 0.44, 1)',
  inOut: 'cubic-bezier(0.645, 0.045, 0.355, 1)',
  backOut: /* @__PURE__ */ linearEasing(backOut(2.5)),
} as const;

/** GSAP's `back.out(overshoot)`. */
export function backOut(overshoot: number): (t: number) => number {
  return (t) => {
    const u = t - 1;
    return u * u * ((overshoot + 1) * u + overshoot) + 1;
  };
}

/** A `linear()` easing that follows `curve` through `steps` evenly spaced points. */
export function linearEasing(curve: (t: number) => number, steps = 24): string {
  const stops: string[] = [];
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    stops.push(`${round(curve(t))} ${round(t * 100)}%`);
  }
  return `linear(${stops.join(', ')})`;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function noop(): void {
  // Nothing to end: the final state was set at once.
}
