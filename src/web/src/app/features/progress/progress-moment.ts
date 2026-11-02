import { EASE, type Motion, type Stop } from '../../core/motion/motion';

/**
 * Progress draws itself (docs/MOTION-PLAN-2026-11.md, W13). The dashboard has all its data before
 * it draws, so the moment runs after the render that drew it and moves only what is there: the
 * trend line draws in from its first day to its last (1.4 s, eased at both ends, the prototype's
 * `draw`), the weigh-ins' dots appear as the edge reaches them, the weekly averages and the soft
 * area under the line fade in once it is drawn, the training bars grow from their start (0.8 s,
 * `power3.out`, 60 ms apart) and the big weight counts up to the string the page already shows. A
 * later draw (a range tap) fades the charts in over 200 ms and draws nothing twice. Everything runs
 * on the Web Animations API through `Motion` (no GSAP); with reduced motion or the switch on the
 * page is as the template drew it, and the scrub in the chart works without motion.
 *
 * The line is drawn by revealing the chart's SVG with a clip-path that sweeps from the line's first
 * day to its last, not by a dash along the path: a day without an estimate breaks the line into
 * subpaths, and a dash restarts at each, so a dash draw would show every piece at once.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W13` turns it off alone. */
export const PROGRESS_MOMENT = 'W13';

/** The line's draw, the prototype's 1.4 s. */
export const LINE_DURATION = 1400;
/** The bars' growth, the prototype's 0.8 s, 60 ms apart. */
export const BAR_DURATION = 800;
export const BAR_STAGGER = 60;
/** The big number's count, the prototype's 1.1 s. */
export const FIGURE_DURATION = 1100;

export interface FigureCount {
  /** The weight the page shows, as a number. */
  readonly to: number;
  /** Draws a value on the way, in the page's locale; the count ends on the page's own string. */
  readonly format: (value: number) => string;
}

/** Where the line starts and ends across its plot, as shares of the plot's width (0 to 1). */
export interface LineSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * The line's span across its plot, from its drawing's box and its SVG's viewBox; the whole plot
 * where the browser cannot measure (jsdom).
 */
export function lineSpan(path: SVGGraphicsElement): LineSpan {
  const box = (path.ownerSVGElement?.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/);
  const width = Number(box[2]);
  if (typeof path.getBBox !== 'function' || !(width > 0)) return { from: 0, to: 1 };
  const bounds = path.getBBox();
  if (!(bounds.width >= 0)) return { from: 0, to: 1 };
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const from = clamp(bounds.x / width);
  const to = clamp((bounds.x + bounds.width) / width);
  return to > from ? { from, to } : { from: 0, to: 1 };
}

/**
 * When the line's edge, eased in and out (the quadratic the prototype's `power2.inOut` draws),
 * reaches a share of its span: the inverse of that easing, so a dot appears under the pen.
 */
export function tipReaches(share: number): number {
  const p = Math.min(1, Math.max(0, share));
  return p < 0.5 ? Math.sqrt(p / 2) : 1 - Math.sqrt((1 - p) / 2);
}

/** Plays the first draw on the rendered dashboard; call it after the render that drew it. */
export function drawProgress(host: HTMLElement, motion: Motion, figure: FigureCount | null): Stop {
  if (!motion.allowed(PROGRESS_MOMENT)) return noop;
  const stops: Stop[] = [];
  const line = host.querySelector<SVGPathElement>('app-trend-chart path.trend-line');
  if (line?.ownerSVGElement) {
    const span = lineSpan(line);
    stops.push(drawLine(line.ownerSVGElement, span));
    stops.push(...riseDots(host, span));
    for (const quiet of host.querySelectorAll(
      'app-trend-chart .trend-area, app-trend-chart .week-band',
    )) {
      stops.push(
        cancel(
          quiet.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 500,
            delay: LINE_DURATION - 200,
            easing: EASE.out,
            fill: 'backwards',
          }),
        ),
      );
    }
  }
  host.querySelectorAll('app-bar-chart .track i').forEach((bar, index) => {
    stops.push(
      cancel(
        bar.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }], {
          duration: BAR_DURATION,
          delay: index * BAR_STAGGER,
          easing: EASE.outStrong,
          fill: 'backwards',
        }),
      ),
    );
  });
  const number = host.querySelector<HTMLElement>('.weight-figure [data-figure]');
  if (number && figure) {
    stops.push(holdSize(number, FIGURE_DURATION));
    stops.push(
      motion.countUp(number, figure.to, figure.format, {
        moment: PROGRESS_MOMENT,
        duration: FIGURE_DURATION,
      }),
    );
  }
  return () => stops.forEach((stop) => stop());
}

/** A later draw: the charts fade in over 200 ms, nothing draws again (a repeat is tiresome). */
export function fadeProgress(host: HTMLElement, motion: Motion): Stop {
  if (!motion.allowed(PROGRESS_MOMENT)) return noop;
  const stops = Array.from(host.querySelectorAll('app-trend-chart, app-bar-chart'), (chart) =>
    cancel(chart.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE.out })),
  );
  return () => stops.forEach((stop) => stop());
}

/**
 * Reveals the chart from the line's first day to its last: a clip on the SVG whose right edge
 * sweeps across the span (the dots are drawn outside the SVG and follow on their own). The clip
 * ends with the animation, so the chart rests whole however the draw ends.
 */
function drawLine(svg: SVGSVGElement, span: LineSpan): Stop {
  const inset = (share: number) => `inset(0 ${round(100 - share * 100)}% 0 0)`;
  return cancel(
    svg.animate([{ clipPath: inset(span.from) }, { clipPath: inset(span.to) }], {
      duration: LINE_DURATION,
      easing: EASE.inOut,
    }),
  );
}

/** Each weigh-in's dot appears (150 ms) as the line's edge reaches its place along the span. */
function riseDots(host: HTMLElement, span: LineSpan): Stop[] {
  const width = span.to - span.from;
  return Array.from(host.querySelectorAll<HTMLElement>('app-trend-chart .observation'), (dot) => {
    const left = (parseFloat(dot.style.left) || 0) / 100;
    const share = width > 0 ? (left - span.from) / width : 1;
    return cancel(
      dot.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 150,
        delay: LINE_DURATION * tipReaches(share),
        easing: EASE.out,
        fill: 'backwards',
      }),
    );
  });
}

/** Holds a number's box at its final size while the digits run, then lets it go. */
function holdSize(element: HTMLElement, duration: number): Stop {
  const { width, height } = element.getBoundingClientRect();
  if (!(width > 0 && height > 0)) return noop;
  element.style.minWidth = `${width}px`;
  element.style.minHeight = `${height}px`;
  const release = () => {
    element.style.minWidth = '';
    element.style.minHeight = '';
  };
  const timer = setTimeout(release, duration + 100);
  return () => {
    clearTimeout(timer);
    release();
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function cancel(animation: Animation): Stop {
  return () => animation.cancel();
}

function noop(): void {
  // Nothing to end: the page is as the template drew it.
}
