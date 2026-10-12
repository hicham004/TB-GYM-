/**
 * The homepage's pictures of the app (UI plan R6.2d, R6.2f): the real product on the first-name
 * sample demo "Oakline Strength", made by `scripts/home-pictures.mjs` into `public/images/home/`.
 * A phone is the client's screen under Apple's iPhone 17 bezel, at three widths; a window is a 1:1
 * crop of one region of the coach's screen, at 2x and 1x. No person on them is real, so no picture
 * carries a quote, a rating or an outcome, and every group of them says "Shown with sample data".
 */
const BASE = '/images/home';

/** One region of the coach's screen, in CSS px, drawn at that size so its text keeps its size. */
export interface WindowPicture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** The composed phone picture's own size: Apple's bezel. */
export const PHONE_SIZE = { width: 1350, height: 2760 } as const;

/** The widths the phone pictures exist at: 3x and 2x of the widest slot (380 px), 2x of a phone's 300 px slot, and 1x. */
export const PHONE_WIDTHS = [460, 600, 760, 1140] as const;

export function phoneSrcset(screen: string, format: 'avif' | 'webp'): string {
  return PHONE_WIDTHS.map((width) => `${BASE}/${screen}-${width}.${format} ${width}w`).join(', ');
}

export function phoneSrc(screen: string): string {
  return `${BASE}/${screen}-760.webp`;
}

export function windowSrcset(window: WindowPicture, format: 'avif' | 'webp'): string {
  return `${BASE}/${window.name}-1x.${format} 1x, ${BASE}/${window.name}.${format} 2x`;
}

export function windowSrc(window: WindowPicture): string {
  return `${BASE}/${window.name}-1x.webp`;
}

export const WINDOWS = {
  /** The coach's Today in dark mode: the greeting, the day's numbers, who needs her. */
  todayDark: { name: 'today-needs-you-dark', width: 660, height: 668 },
  /** The builder's first week: two sessions and a rest day. */
  builder: { name: 'builder-week', width: 520, height: 560 },
  builderDark: { name: 'builder-week-dark', width: 520, height: 560 },
  /** The activity feed after the workout: finished Lower A in 41 minutes, a back squat record. */
  feedDark: { name: 'feed-after-dark', width: 480, height: 520 },
  /** The check-in review: this week's answers beside last week's. */
  reviewDark: { name: 'checkin-review-dark', width: 700, height: 460 },
  review: { name: 'review', width: 700, height: 520 },
  reviewNarrow: { name: 'review-narrow', width: 380, height: 520 },
  /** Training maxes, where logged sets suggest a new deadlift max. */
  maxesDark: { name: 'maxes-dark', width: 360, height: 580 },
  /** The builder with the program's name and its first week. */
  programs: { name: 'programs', width: 745, height: 680 },
  programsNarrow: { name: 'programs-narrow', width: 380, height: 680 },
  /** The client's week on her overview after the workout: 1 of 4 sessions done. */
  weekDone: { name: 'week-done', width: 707, height: 310 },
  weekDoneNarrow: { name: 'week-done-narrow', width: 380, height: 310 },
  /** Daily targets and the meal plan on the client's Nutrition tab. */
  targets: { name: 'targets', width: 675, height: 520 },
  targetsNarrow: { name: 'targets-narrow', width: 380, height: 520 },
  /** The thread with the client, her plan and last workout beside it. */
  thread: { name: 'messages-thread', width: 620, height: 640 },
  threadNarrow: { name: 'thread-narrow', width: 460, height: 612 },
  /** The Clients list: status, last activity. */
  clients: { name: 'clients', width: 760, height: 520 },
  clientsNarrow: { name: 'clients-narrow', width: 420, height: 460 },
  /** The Team page: the owner and two coaches, each with their own clients. */
  team: { name: 'team-window', width: 640, height: 420 },
} as const satisfies Record<string, WindowPicture>;
