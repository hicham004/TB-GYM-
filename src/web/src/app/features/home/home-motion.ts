import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, InjectionToken, PLATFORM_ID, signal } from '@angular/core';

/** The GSAP modules the homepage uses, loaded as one chunk the first time the story starts. */
export interface GsapModules {
  readonly gsap: typeof import('gsap').gsap;
  readonly ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger;
  readonly Flip: typeof import('gsap/Flip').Flip;
  readonly SplitText: typeof import('gsap/SplitText').SplitText;
}

export type GsapLoader = () => Promise<GsapModules>;

/**
 * Loads GSAP, ScrollTrigger, Flip and SplitText as their own chunk when the story starts, so none
 * of them is in the homepage's first download (plan §4: GSAP lazy-loaded per route, and on the
 * website only for the homepage story). Tests provide a fake.
 */
export const GSAP_LOADER = new InjectionToken<GsapLoader>('GSAP_LOADER', {
  providedIn: 'root',
  factory: (): GsapLoader => {
    return async () => {
      const [core, scroll, flip, split] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
        import('gsap/Flip'),
        import('gsap/SplitText'),
      ]);
      return {
        gsap: core.gsap,
        ScrollTrigger: scroll.ScrollTrigger,
        Flip: flip.Flip,
        SplitText: split.SplitText,
      };
    };
  },
});

/**
 * When the story moves: a wide screen, where the stylesheet keeps the week's panel beside the
 * stages, and no request for reduced motion. Everywhere else the stages stack with one asset each,
 * every headline is already in its final state, and GSAP is never loaded.
 */
export const WIDE_STORY = '(min-width: 1100px) and (prefers-reduced-motion: no-preference)';

/** How far down the screen a stage's copy has to reach before the panel shows its composition. */
const LINE = '60%';

/** Where the pinned panel sits: under the sticky header, with the same breathing room as the strip. */
const PIN_TOP = 96;

export interface HomeMotionTargets {
  /** The week section: the panel stays pinned while it scrolls past. */
  readonly week: HTMLElement;
  /** The panel of two screens, pinned beside the stages. */
  readonly panel: HTMLElement;
  /** Each stage's copy, in order; its turn comes as it reaches the line. */
  readonly stages: readonly HTMLElement[];
  /** The panel's two slots, whose composition changes between stages. */
  readonly slots: readonly HTMLElement[];
  /** The marker on the day strip, moved to the stage's day. */
  readonly marker: HTMLElement | null;
  /** The strip's day for each stage, so the marker knows where to go. */
  readonly dayOf: (stage: number) => HTMLElement | null;
  /** The headlines revealed line by line as they come into view. */
  readonly titles: readonly HTMLElement[];
  /**
   * Told which stage the panel should show. It must change the panel's composition before it
   * returns (the panel's `data-stage`), because Flip measures the new layout right after.
   */
  readonly onStage: (index: number) => void;
}

export type HomeMotionState = 'idle' | 'loading' | 'running' | 'off';

/**
 * The homepage's motion (UI plan R6.2f), on a wide screen for a reader who has not asked for less:
 * ScrollTrigger pins the week's panel while the four stages scroll past and says which stage has
 * reached the line; Flip carries the panel's two slots from one composition to the next; SplitText
 * reveals each headline line by line, after the fonts have loaded so the lines are the real ones.
 * The build-time render, a phone and a reader who prefers reduced motion get the finished page
 * from the stylesheet alone.
 *
 * One instance per page; `stop` reverts everything GSAP touched, which is what the page calls when
 * it is destroyed.
 */
@Injectable()
export class HomeMotion {
  private readonly loader = inject(GSAP_LOADER);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly stateSignal = signal<HomeMotionState>('idle');
  private media: { revert(): void } | null = null;
  private stopped = false;

  /** Where the motion stands: for the page's own marks and the tests. */
  readonly state = this.stateSignal.asReadonly();

  /** Whether the story moves on this screen right now. */
  static wide(): boolean {
    return typeof matchMedia === 'function' && matchMedia(WIDE_STORY).matches;
  }

  async start(targets: HomeMotionTargets): Promise<void> {
    if (!this.browser || this.stopped) return;
    if (!HomeMotion.wide()) {
      // CSS tells the still page; loading a motion library would be waste.
      this.stateSignal.set('off');
      return;
    }
    this.stateSignal.set('loading');
    const { gsap, ScrollTrigger, Flip, SplitText } = await this.loader();
    if (this.stopped) return;
    gsap.registerPlugin(ScrollTrigger, Flip, SplitText);

    const media = gsap.matchMedia();
    this.media = media;
    // Inside the query only; when the window narrows or the person asks for less motion, GSAP
    // reverts this itself, and sets it up again when the query matches once more.
    media.add(WIDE_STORY, () => {
      let shown = -1;
      const show = (index: number) => {
        if (index === shown) return;
        const first = shown < 0;
        shown = index;
        // The composition before, then the change, then Flip carries the slots between the two.
        const before = first ? null : Flip.getState(targets.slots);
        targets.onStage(index);
        if (before) Flip.from(before, { duration: 0.8, ease: 'power3.inOut' });
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
      // One pinned element per stage, the panel, held under the header while the week scrolls.
      const pin = ScrollTrigger.create({
        trigger: targets.panel,
        start: `top ${PIN_TOP}px`,
        endTrigger: targets.week,
        end: 'bottom bottom',
        pin: true,
        pinSpacing: false,
        anticipatePin: 1,
      });
      // Which stages are at the line (the stages touch, so at most one, except above the first
      // and below the last). A jump that lands above the week shows Monday again.
      const atLine = new Set<number>();
      const triggers = targets.stages.map((stage, index) =>
        ScrollTrigger.create({
          trigger: stage,
          start: `top ${LINE}`,
          end: `bottom ${LINE}`,
          onToggle: (self) => {
            if (self.isActive) {
              atLine.add(index);
              show(index);
              return;
            }
            atLine.delete(index);
            if (atLine.size === 0 && self.direction < 0) show(0);
          },
        }),
      );
      // The headlines split into their lines once the fonts are in, so the lines are the ones the
      // reader sees; each rises into view behind a mask as it arrives, once.
      let live = true;
      const splits: { revert(): void }[] = [];
      const fonts: Promise<unknown> = document.fonts?.ready ?? Promise.resolve();
      void fonts.then(() => {
        if (!live) return;
        for (const title of targets.titles) {
          splits.push(
            SplitText.create(title, {
              type: 'lines',
              mask: 'lines',
              autoSplit: true,
              onSplit: (self) =>
                gsap.from(self.lines, {
                  yPercent: 110,
                  duration: 0.9,
                  stagger: 0.08,
                  ease: 'power3.out',
                  scrollTrigger: { trigger: title, start: 'top 88%', once: true },
                }),
            }),
          );
        }
        ScrollTrigger.refresh();
      });
      // Pictures load after the layout is measured; a late one must not leave the lines stale.
      const refresh = () => ScrollTrigger.refresh();
      window.addEventListener('load', refresh);
      show(0);
      return () => {
        live = false;
        window.removeEventListener('load', refresh);
        for (const split of splits) split.revert();
        for (const trigger of triggers) trigger.kill();
        pin.kill();
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
