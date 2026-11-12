import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { WebsiteAnalytics } from '../../core/website/website-analytics';
import { preloadHomeFaces } from './home-faces';
import { HomeFinale } from './home-finale';
import { HomeHeader, type HeaderTone, type HomeSection } from './home-header';
import { HomeHero } from './home-hero';
import { HomeMotion } from './home-motion';
import { HOME_PLACEHOLDERS } from './home-placeholder';
import { HomeRows } from './home-rows';
import { HomeTalk } from './home-talk';
import { HomeWeek } from './home-week';
import { HomeWho } from './home-who';

/**
 * The public homepage (UI plan R6.2f): the hero, the week in four stages, six feature rows, the
 * strip for clients, the product facts, who it is for, Talk to us (R6.2g), and the finale. It is
 * rendered at build time (R6.2a), so everything here is in the HTML Google and link previews read;
 * only the motion (`HomeMotion`, on a wide screen), the header's tone and section mark, the
 * website's settings (the WhatsApp link, analytics) and the visit's one count wait for the browser.
 *
 * The same page opens inside the app at `/about` (notes plan N2), for someone signed in too: there
 * it leads back to Today where it offers signing in, offers no sign-up, keeps its links on its own
 * address, asks search engines not to show that address, and counts nothing.
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
  private readonly analytics = inject(WebsiteAnalytics);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly header = viewChild.required(HomeHeader);
  private readonly hero = viewChild.required(HomeHero);
  private readonly week = viewChild.required(HomeWeek);
  private readonly rows = viewChild.required(HomeRows);
  private readonly who = viewChild.required(HomeWho);
  private readonly auth = inject(AuthStore);

  /**
   * The page's own address: the homepage's, or `/about` inside the app. Every link within the page
   * leads to it, so a section link never leaves the page for Today.
   */
  protected readonly page = `/${inject(ActivatedRoute)
    .snapshot.url.map((part) => part.path)
    .join('/')}`;

  /** A plain fragment would resolve against `<base href="/">`, which is this page at `/` alone. */
  protected readonly skipTo = this.page === '/' ? '#home-content' : `${this.page}#home-content`;

  /** Someone is signed in, which only the address inside the app allows: Today is theirs at `/`. */
  protected readonly signedIn = computed(() => this.auth.user() !== null);

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
    // The address inside the app is never for search engines, which show the homepage's own; nginx
    // says so in a header too. The private pre-launch build already says it on every page, in the
    // tag its header writes and keeps, so nothing is added there. At its own address the homepage
    // must carry none.
    if (this.page !== '/' && !inject(HOME_PLACEHOLDERS)) {
      const meta = inject(Meta);
      if (meta.getTag('name="robots"') === null) {
        const added = meta.addTag({ name: 'robots', content: 'noindex' });
        this.destroyRef.onDestroy(() => added?.remove());
      }
    }
    afterNextRender(() => {
      this.live.set(true);
      // One count per opening (notes plan N1), at the homepage's own address alone, so another
      // address for this page counts nothing; publicHomeGuard lets only a visitor in. A section link
      // reuses this page, so a fragment counts nothing more.
      if (this.document.location.pathname === '/') this.analytics.pageview(this.destroyRef);
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
