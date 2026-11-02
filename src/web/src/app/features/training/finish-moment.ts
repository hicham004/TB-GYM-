import type { WorkoutFinishSummaryView } from '../../core/api/generated';
import { EASE, type Motion } from '../../core/motion/motion';

/**
 * The finish (docs/MOTION-PLAN-2026-11.md, W4). The finish summary replaces the workout in one
 * render, complete from the server's answer, so the moment runs after that render and moves only
 * what is already there: the panel rises, its parts follow one after another with the records one
 * by one, the four numbers count up to the strings the page shows (the server's own, never
 * invented) and the share card lands last with its own spring (the summary's stylesheet sets its
 * delay, so there is one entrance, not two). Everything runs on the Web Animations API through
 * `Motion` (no GSAP), nothing blocks Back to Today or Share, and with reduced motion or the switch
 * on the summary and its numbers appear at once, as the template drew them.
 *
 * `planFinishCounts` reads what each number counts to (pure, tested); `playFinishMoment` plays the
 * moment on the rendered summary after the next render.
 */

/** The row of the motion plan this moment belongs to, so `tb-motion-off = W4` turns it off alone. */
export const FINISH_MOMENT = 'W4';

export interface FinishFormats {
  /** The header's clock: seconds to "m:ss". */
  readonly time: (seconds: number) => string;
  /** The page's volume: `DecimalPipe` '1.0-1' in the page's locale. */
  readonly volume: (value: number) => string;
}

export interface FinishCount {
  /** Which stat, as the template marks it with `data-stat`; volumes come in the summary's order. */
  readonly stat: 'time' | 'sets' | 'records' | 'volume';
  readonly to: number;
  /** The prototype's lengths: 0.9 s, and 1.3 s for the volume. */
  readonly duration: number;
  /** Draws a value on the way; the count ends on the string the page already shows. */
  readonly format: (value: number) => string;
}

/** What each number counts to, from the summary's fields (a number or a string on the wire). */
export function planFinishCounts(
  summary: WorkoutFinishSummaryView,
  formats: FinishFormats,
): FinishCount[] {
  const total = Number(summary.totalSetCount);
  return [
    {
      stat: 'time',
      to: Number(summary.durationSeconds),
      duration: 900,
      format: (value) => formats.time(Math.round(value)),
    },
    {
      stat: 'sets',
      to: Number(summary.completedSetCount),
      duration: 900,
      // One text node holds both figures, so only the first moves inside it.
      format: (value) => `${Math.round(value)} / ${total}`,
    },
    {
      stat: 'records',
      to: summary.personalRecords.length,
      duration: 900,
      format: (value) => String(Math.round(value)),
    },
    ...summary.volume.map((volume): FinishCount => ({
      stat: 'volume',
      to: Number(volume.loadTimesRepetitions),
      duration: 1300,
      format: (value) => formats.volume(value),
    })),
  ];
}

/**
 * Plays the moment on the rendered summary: the panel rises from 30 px down (500 ms), its parts
 * from 18 px one after another (500 ms each, 60 ms apart, from 150 ms), the records one by one and
 * the share card left to its own landing, and each number counts up through its own text node
 * with its box held at its final size, so the two-column grid never jumps. Nothing here blocks a
 * tap: Back to Today and Share work from the first frame.
 */
export function playFinishMoment(
  host: HTMLElement,
  summary: WorkoutFinishSummaryView,
  motion: Motion,
  formats: FinishFormats,
): void {
  const panel = host.querySelector<HTMLElement>('.finish-summary');
  if (!panel) return;
  showFromTop(panel);
  if (!motion.allowed(FINISH_MOMENT)) return;
  panel.animate(
    [
      { opacity: 0, transform: 'translateY(30px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 500, easing: EASE.outStrong },
  );
  risingParts(panel).forEach((part, index) =>
    part.animate(
      [
        { opacity: 0, transform: 'translateY(18px)' },
        { opacity: 1, transform: 'none' },
      ],
      // Backwards: a part stays hidden through its own delay instead of flashing first.
      { duration: 500, delay: 150 + index * 60, easing: EASE.outStrong, fill: 'backwards' },
    ),
  );
  const seen = new Map<FinishCount['stat'], number>();
  for (const count of planFinishCounts(summary, formats)) {
    const index = seen.get(count.stat) ?? 0;
    seen.set(count.stat, index + 1);
    const number = panel.querySelectorAll<HTMLElement>(
      `.summary-stats [data-stat="${count.stat}"] strong`,
    )[index];
    if (!number) continue;
    holdSize(number, count.duration);
    motion.countUp(number, count.to, count.format, {
      moment: FINISH_MOMENT,
      duration: count.duration,
    });
  }
}

/**
 * The summary replaces the player where the page was scrolled, so it is shown from its top, as the
 * prototype opens it; the moment then plays in view, with or without motion.
 */
function showFromTop(panel: HTMLElement): void {
  for (let node = panel.parentElement; node; node = node.parentElement) {
    if (node.scrollTop > 0) node.scrollTop = 0;
  }
  const view = panel.ownerDocument.defaultView;
  if (view && view.scrollY > 0) view.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

/**
 * The summary's parts in order: a record's row each, the share teaser's button but not its card
 * (the card has its own landing).
 */
function risingParts(panel: HTMLElement): Element[] {
  const parts: Element[] = [];
  for (const part of Array.from(panel.children)) {
    if (part.matches('app-share-teaser')) {
      parts.push(...Array.from(part.children).filter((child) => !child.matches('.card')));
    } else if (part.matches('.pr-list')) {
      parts.push(...Array.from(part.children));
    } else {
      parts.push(part);
    }
  }
  return parts;
}

/** Holds a number's box at its final size while the digits run, then lets it go. */
function holdSize(element: HTMLElement, duration: number): void {
  const { width, height } = element.getBoundingClientRect();
  if (!(width > 0 && height > 0)) return;
  element.style.minWidth = `${width}px`;
  element.style.minHeight = `${height}px`;
  setTimeout(() => {
    element.style.minWidth = '';
    element.style.minHeight = '';
  }, duration + 100);
}
