import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Motion } from '../../core/motion/motion';
import { fakeMotion } from '../../../testing/motion-fake';
import {
  BAR_DURATION,
  BAR_STAGGER,
  drawProgress,
  fadeProgress,
  FIGURE_DURATION,
  LINE_DURATION,
  lineSpan,
  PROGRESS_MOMENT,
  tipReaches,
} from './progress-moment';

/** A dashboard as it is rendered: the hero's figure and chart, and the training bars. */
function dashboard(): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = `
    <section class="hero-card">
      <div class="weight-figure"><strong><span data-figure>71.2</span> <small>kg</small></strong></div>
      <app-trend-chart>
        <div class="plot">
          <svg viewBox="0 0 720 240" preserveAspectRatio="none">
            <path class="trend-area" d="M160.0 240 L160.0 100.0 L704.0 140.0 L704.0 240 Z"></path>
            <line class="week-band" x1="160" x2="300" y1="120" y2="120"></line>
            <path class="trend-line" d="M160.0 100.0 L360.0 120.0 L704.0 140.0"></path>
          </svg>
          <i class="observation" style="left: 22.22%; top: 40%"></i>
          <i class="observation" style="left: 60%; top: 50%"></i>
          <i class="observation" style="left: 97.78%; top: 58%"></i>
        </div>
      </app-trend-chart>
    </section>
    <app-bar-chart>
      <div class="track"><i style="width: 75%"></i></div>
      <div class="track"><i style="width: 50%"></i></div>
    </app-bar-chart>`;
  document.body.append(host);
  return host;
}

/** Gives `path` a drawing box, as a browser measures one; jsdom measures nothing. */
function boxed(path: SVGGraphicsElement, x: number, width: number): void {
  Object.assign(path, { getBBox: () => ({ x, y: 0, width, height: 40 }) });
}

const name = (element: Element) => {
  const classes = element.getAttribute('class');
  return `${element.tagName.toLowerCase()}${classes ? '.' + classes.split(' ').join('.') : ''}`;
};

describe('progress moment (W13)', () => {
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  let host: HTMLElement;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });
    host = dashboard();
    // The line runs from 160 to 704 of the drawing's 720: from 22.22% to 97.78% of the plot.
    boxed(host.querySelector<SVGPathElement>('.trend-line')!, 160, 544);
  });

  afterEach(() => {
    animate.mockClear();
    delete (Element.prototype as { animate?: unknown }).animate;
    host.remove();
  });

  it('reads the line’s span across its plot from its drawing box', () => {
    const line = host.querySelector<SVGPathElement>('.trend-line')!;
    expect(lineSpan(line)).toEqual({ from: 160 / 720, to: 704 / 720 });
    // A box past the plot is held inside it; no box (jsdom) is the whole plot.
    boxed(line, -20, 800);
    expect(lineSpan(line)).toEqual({ from: 0, to: 1 });
    const bare = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    expect(lineSpan(bare)).toEqual({ from: 0, to: 1 });
  });

  it('places a dot under the pen: the inverse of the line’s ease at both ends', () => {
    expect(tipReaches(0)).toBe(0);
    expect(tipReaches(0.5)).toBe(0.5);
    expect(tipReaches(1)).toBe(1);
    // The line crawls at first (8% of its span by 20% of its time), so the dot waits for it.
    expect(tipReaches(0.08)).toBeCloseTo(0.2, 5);
    expect(tipReaches(0.92)).toBeCloseTo(0.8, 5);
  });

  it('draws the line across its span, grows the bars from their start and counts the figure', () => {
    const motion = fakeMotion({ allowed: true });

    drawProgress(host, motion as unknown as Motion, { to: 71.2, format: String });

    const calls = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][];
    const targets = (animate.mock.contexts as Element[]).map(name);

    // The chart is revealed from the line's first day to its last, eased at both ends.
    const reveal = calls[targets.indexOf('svg')];
    expect(reveal[0]).toEqual([
      { clipPath: 'inset(0 77.78% 0 0)' },
      { clipPath: 'inset(0 2.22% 0 0)' },
    ]);
    expect(reveal[1]).toMatchObject({ duration: LINE_DURATION });

    // The dots appear as the edge reaches them: at once, half way, and at the end.
    const dots = targets.flatMap((target, index) => (target === 'i.observation' ? [index] : []));
    expect(dots.map((index) => Math.round(calls[index][1].delay as number))).toEqual([
      0,
      LINE_DURATION * 0.5,
      LINE_DURATION,
    ]);
    expect(calls[dots[0]][1].fill).toBe('backwards');

    // The area and the weekly averages fade in as the line finishes.
    for (const quiet of ['path.trend-area', 'line.week-band']) {
      const call = calls[targets.indexOf(quiet)];
      expect(call[0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
      expect(call[1].delay).toBe(LINE_DURATION - 200);
    }

    // The bars grow from nothing, one after the other.
    const bars = targets.flatMap((target, index) => (target === 'i' ? [index] : []));
    expect(bars).toHaveLength(2);
    expect(calls[bars[0]][0]).toEqual([{ transform: 'scaleX(0)' }, { transform: 'none' }]);
    expect(calls[bars[0]][1]).toMatchObject({
      duration: BAR_DURATION,
      delay: 0,
      fill: 'backwards',
    });
    expect(calls[bars[1]][1].delay).toBe(BAR_STAGGER);

    // The figure counts to the page's number through the moment's row.
    expect(motion.countUp).toHaveBeenCalledTimes(1);
    const [element, to, , options] = (
      motion.countUp.mock.calls as unknown as [Element, number, unknown, Record<string, unknown>][]
    )[0];
    expect(element).toBe(host.querySelector('[data-figure]'));
    expect(to).toBe(71.2);
    expect(options).toEqual({ moment: PROGRESS_MOMENT, duration: FIGURE_DURATION });
  });

  it('reveals the whole plot where the line’s box cannot be read', () => {
    const motion = fakeMotion({ allowed: true });
    delete (host.querySelector('.trend-line') as unknown as { getBBox?: unknown }).getBBox;

    drawProgress(host, motion as unknown as Motion, null);

    const calls = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][];
    const targets = (animate.mock.contexts as Element[]).map(name);
    expect(calls[targets.indexOf('svg')][0]).toEqual([
      { clipPath: 'inset(0 100% 0 0)' },
      { clipPath: 'inset(0 0% 0 0)' },
    ]);
    expect(motion.countUp).not.toHaveBeenCalled();
  });

  it('ends early on request', () => {
    const motion = fakeMotion({ allowed: true });

    const stop = drawProgress(host, motion as unknown as Motion, null);
    stop();

    expect(animate).toHaveBeenCalled();
    for (const animation of animate.mock.results) {
      expect((animation.value as { cancel: ReturnType<typeof vi.fn> }).cancel).toHaveBeenCalled();
    }
  });

  it('fades the charts in on a later draw and draws nothing twice', () => {
    const motion = fakeMotion({ allowed: true });

    fadeProgress(host, motion as unknown as Motion);

    expect((animate.mock.contexts as Element[]).map(name)).toEqual([
      'app-trend-chart',
      'app-bar-chart',
    ]);
    const calls = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][];
    expect(calls[0][0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(calls[0][1].duration).toBe(200);
    expect(motion.countUp).not.toHaveBeenCalled();
  });

  it('leaves the page as the template drew it where motion is not allowed', () => {
    const motion = fakeMotion();

    drawProgress(host, motion as unknown as Motion, { to: 71.2, format: String });
    fadeProgress(host, motion as unknown as Motion);

    expect(motion.allowed).toHaveBeenCalledWith(PROGRESS_MOMENT);
    expect(animate).not.toHaveBeenCalled();
    expect(motion.countUp).not.toHaveBeenCalled();
    expect(host.querySelector('[data-figure]')?.textContent).toBe('71.2');
  });
});
