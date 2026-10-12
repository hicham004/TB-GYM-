import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, InjectionToken, PLATFORM_ID, signal } from '@angular/core';

/** The two GSAP modules the homepage story uses, loaded only when the story runs. */
export interface GsapModules {
  readonly gsap: typeof import('gsap').gsap;
  readonly ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger;
}

export type GsapLoader = () => Promise<GsapModules>;

/**
 * Loads GSAP and ScrollTrigger as their own chunk the first time the story starts, so the library
 * is never in the homepage's first download (plan §4: GSAP lazy-loaded per route, and on the
 * website only for the homepage story). Tests provide a fake.
 */
export const GSAP_LOADER = new InjectionToken<GsapLoader>('GSAP_LOADER', {
  providedIn: 'root',
  factory: (): GsapLoader => {
    return async () => {
      const [core, plugin] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')]);
      return { gsap: core.gsap, ScrollTrigger: plugin.ScrollTrigger };
    };
  },
});

/**
 * When the story is scroll-driven: a wide screen, where the stylesheet keeps the stage beside the
 * chapters, and no request for reduced motion. Everywhere else the chapters stack, each with its
 * own pictures, and GSAP is never loaded.
 */
export const WIDE_STORY = '(min-width: 1100px) and (prefers-reduced-motion: no-preference)';

/** How far down the screen a chapter's text has to reach before the stage shows its moment. */
const LINE = '58%';

export interface WeekMotionTargets {
  /** The elements whose turn it is as they reach the line: the hero's copy, then each chapter. */
  readonly moments: readonly HTMLElement[];
  /** The marker on the stage's day strip, moved to the active day. */
  readonly marker: HTMLElement | null;
  /** The day strip's day for each moment, so the marker knows where to go. */
  readonly dayOf: (moment: number) => HTMLElement | null;
  /** Told which moment the stage should show. */
  readonly onMoment: (index: number) => void;
}

export type WeekMotionState = 'idle' | 'loading' | 'running' | 'off';

/**
 * The scroll story's motion (UI plan R6.2b): as the reader scrolls, the chapters pass a line on
 * the screen and the stage beside them changes to that moment of the week. GSAP ScrollTrigger
 * decides *when*; the stage itself changes through the component's state and CSS transitions, so
 * a page without GSAP (narrow, reduced motion, the build-time render) is still the whole story.
 *
 * One instance per story; `stop` reverts everything GSAP touched, which is what the component
 * calls when it is destroyed.
 */
@Injectable()
export class HomeWeekMotion {
  private readonly loader = inject(GSAP_LOADER);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly stateSignal = signal<WeekMotionState>('idle');
  private media: { revert(): void } | null = null;
  private stopped = false;

  /** Where the motion stands: for the page's own checks and the tests. */
  readonly state = this.stateSignal.asReadonly();

  /** Whether the story is scroll-driven on this screen right now. */
  static wide(): boolean {
    return typeof matchMedia === 'function' && matchMedia(WIDE_STORY).matches;
  }

  async start(targets: WeekMotionTargets): Promise<void> {
    if (!this.browser || this.stopped) return;
    if (!HomeWeekMotion.wide()) {
      // CSS tells the stacked story; loading a motion library would be waste.
      this.stateSignal.set('off');
      return;
    }
    this.stateSignal.set('loading');
    const { gsap, ScrollTrigger } = await this.loader();
    if (this.stopped) return;
    gsap.registerPlugin(ScrollTrigger);

    const media = gsap.matchMedia();
    this.media = media;
    // Inside the query only; when the window narrows or the person asks for less motion, GSAP
    // reverts this itself, and sets it up again when the query matches once more.
    media.add(WIDE_STORY, () => {
      let shown = -1;
      const show = (index: number) => {
        if (index === shown) return;
        shown = index;
        targets.onMoment(index);
        const day = targets.dayOf(index);
        if (targets.marker && day) {
          gsap.to(targets.marker, {
            x: day.offsetLeft,
            width: day.offsetWidth,
            duration: 0.55,
            ease: 'power3.out',
          });
        }
      };
      const triggers = targets.moments.map((moment, index) =>
        ScrollTrigger.create({
          trigger: moment,
          start: `top ${LINE}`,
          end: `bottom ${LINE}`,
          onToggle: (self) => {
            if (self.isActive) show(index);
          },
        }),
      );
      // Pictures load after the layout is measured; a late one must not leave the lines stale.
      const refresh = () => ScrollTrigger.refresh();
      window.addEventListener('load', refresh);
      document.fonts?.ready.then(refresh);
      show(0);
      return () => {
        window.removeEventListener('load', refresh);
        triggers.forEach((trigger) => trigger.kill());
      };
    });
    this.stateSignal.set('running');
  }

  stop(): void {
    this.stopped = true;
    this.media?.revert();
    this.media = null;
    this.stateSignal.set('idle');
  }
}
