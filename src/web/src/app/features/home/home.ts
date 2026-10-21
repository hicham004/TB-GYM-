import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { preloadHomeFaces } from './home-faces';
import { HomeFinale } from './home-finale';
import { HomeHeader, type HeaderTone, type HomeSection } from './home-header';
import { HomeHero } from './home-hero';
import { HomeMotion } from './home-motion';
import { HomeRows } from './home-rows';
import { HomeTalk } from './home-talk';
import { HomeWeek } from './home-week';
import { HomeWho } from './home-who';

/**
 * The public homepage (UI plan R6.2f): the hero, the week in four stages, six feature rows, the
 * strip for clients, the product facts, who it is for, Talk to us (R6.2g), and the finale. It is
 * rendered at build time (R6.2a), so everything here is in the HTML Google and link previews read;
 * only the motion (`HomeMotion`, on a wide screen), the header's tone and section mark, and the
 * website's settings (the WhatsApp link, analytics) wait for the browser.
 */
@Component({
  selector: 'app-home',
  imports: [HomeHeader, HomeHero, HomeWeek, HomeRows, HomeWho, HomeTalk, HomeFinale],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  providers: [HomeMotion],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly motion = inject(HomeMotion);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly header = viewChild.required(HomeHeader);
  private readonly hero = viewChild.required(HomeHero);
  private readonly week = viewChild.required(HomeWeek);
  private readonly rows = viewChild.required(HomeRows);
  private readonly who = viewChild.required(HomeWho);

  /** What is under the sticky header right now: the hero, the cream body or the dark ending. */
  protected readonly headerTone = signal<HeaderTone>('dark');

  /** The part of the page the header's links mark: none over the hero and the finale. */
  protected readonly section = signal<HomeSection | null>(null);

  /**
   * True once the app is live in the browser. The numerals' serif face waits for it: they sit
   * below the first screen, so the face is fetched after the headline has painted rather than
   * beside the fonts the first screen needs.
   */
  protected readonly live = signal(false);

  constructor() {
    preloadHomeFaces();
    this.destroyRef.onDestroy(() => this.motion.stop());
    afterNextRender(() => {
      this.live.set(true);
      this.watchTone();
      void this.motion.start({
        ...this.week().motionTargets(),
        titles: [...this.week().titles(), ...this.rows().titles()],
        page: this.host,
      });
    });
  }

  // The header takes the tone of the section under its bottom edge: clear while the hero still
  // reaches below it, cream over the body, and night from the moment the dark ending (who it's
  // for, Talk to us, the finale, down to the page's end) has risen up to it. Its links mark the
  // part of the page that has reached the reading line, 40 % down the screen (or the header's
  // edge, when that is lower), so a link that jumps to its section marks it at once. Read on
  // scroll, one frame at a time, from a handful of rectangles; nothing else is laid out.
  private watchTone(): void {
    const top = (selector: string) =>
      this.host.querySelector(selector)?.getBoundingClientRect().top ?? Infinity;
    const update = () => {
      const edge = this.header().host.getBoundingClientRect().bottom;
      const hero = this.hero().host.getBoundingClientRect();
      const ending = this.who().band().getBoundingClientRect();
      this.headerTone.set(hero.bottom > edge ? 'dark' : ending.top < edge ? 'night' : 'light');

      const line = Math.max(edge, innerHeight * 0.4);
      this.section.set(
        hero.bottom > line || top('app-home-finale') <= line
          ? null
          : ending.top <= line
            ? 'for-gyms'
            : top('#inside') <= line
              ? 'inside'
              : top('#week') <= line
                ? 'week'
                : null,
      );
    };
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    });
  }
}
