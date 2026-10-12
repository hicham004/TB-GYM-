import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HomeFinale } from './home-finale';
import { HomeHeader } from './home-header';
import { HomeHero } from './home-hero';
import { HomeMotion } from './home-motion';
import { HomeRows } from './home-rows';
import { HomeWeek } from './home-week';
import { HomeWho } from './home-who';

/**
 * The public homepage (UI plan R6.2f): the hero, the week in four stages, six feature rows, the
 * strip for clients, the product facts, who it is for, and the finale. It is rendered at build
 * time (R6.2a), so everything here is in the HTML Google and link previews read; only the motion
 * (`HomeMotion`, on a wide screen) and the header's tone wait for the browser.
 */
@Component({
  selector: 'app-home',
  imports: [HomeHeader, HomeHero, HomeWeek, HomeRows, HomeWho, HomeFinale],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  providers: [HomeMotion],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly motion = inject(HomeMotion);
  private readonly destroyRef = inject(DestroyRef);
  private readonly header = viewChild.required(HomeHeader);
  private readonly hero = viewChild.required(HomeHero);
  private readonly week = viewChild.required(HomeWeek);
  private readonly rows = viewChild.required(HomeRows);
  private readonly finale = viewChild.required(HomeFinale);

  /** Whether a dark section (the hero, the finale) is under the sticky header right now. */
  protected readonly overDark = signal(true);

  /**
   * True once the app is live in the browser. The numerals' serif face waits for it: they sit
   * below the first screen, so the face is fetched after the headline has painted rather than
   * beside the fonts the first screen needs.
   */
  protected readonly live = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => this.motion.stop());
    afterNextRender(() => {
      this.live.set(true);
      this.watchTone();
      void this.motion.start({
        ...this.week().motionTargets(),
        titles: [...this.week().titles(), ...this.rows().titles()],
      });
    });
  }

  // The header takes the tone of the section under its bottom edge: dark while the hero still
  // reaches below it, and again once the finale has risen up to it. Read on scroll, one frame at
  // a time, from two rectangles; nothing else is laid out.
  private watchTone(): void {
    const update = () => {
      const edge = this.header().host.getBoundingClientRect().bottom;
      const hero = this.hero().host.getBoundingClientRect();
      const finale = this.finale().host.getBoundingClientRect();
      this.overDark.set(hero.bottom > edge || finale.top < edge);
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
