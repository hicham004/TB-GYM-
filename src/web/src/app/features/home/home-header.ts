import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { HOME_PLACEHOLDERS } from './home-placeholder';

/**
 * What is under the header: the dark hero, where it is clear (`dark`); the cream body, where it
 * takes a frosted cream fill (`light`); or the dark ending below the hero, where it takes a frosted
 * dark fill (`night`), since there the page's words scroll right under it.
 */
export type HeaderTone = 'dark' | 'light' | 'night';

/** The homepage's three parts its links lead to, by the id each link's fragment names. */
export type HomeSection = 'week' | 'inside' | 'for-gyms';

/**
 * The website's header (the homepage and `/changelog`): the wordmark, three section links, Sign
 * in. It sticks to the top and takes the tone of the section under it: cream text over the dark
 * hero and the dark ending, ink over the cream body. On a wide screen a line under its links marks
 * the part of the page in view and slides from link to link (R6.2k), ink over cream and lime over
 * the night; with less motion it moves without sliding. On a phone the section links sit behind a
 * Menu button, a disclosure the keyboard closes with Escape.
 */
@Component({
  selector: 'app-home-header',
  imports: [RouterLink],
  templateUrl: './home-header.html',
  styleUrl: './home-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeHeader {
  readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The section under the header right now; the changelog's cream page leaves it light. */
  readonly under = input<HeaderTone>('light');

  /** The part of the page in view, which the links mark; none over the hero and the finale. */
  readonly current = input<HomeSection | null>(null);

  protected readonly menuOpen = signal(false);

  private readonly links = viewChild.required<ElementRef<HTMLElement>>('links');
  private readonly sectionLinks = viewChildren<ElementRef<HTMLElement>>('sectionLink');
  private readonly marker = viewChild.required<ElementRef<HTMLElement>>('marker');
  /** Counts the links' size changes, so the line follows a link the window has moved. */
  private readonly linksResized = signal(0);

  constructor() {
    // The private pre-launch build (UI plan R6.2h) is never for Google: every page this header is
    // on says so in its document, besides the header the private server sends.
    if (inject(HOME_PLACEHOLDERS)) {
      inject(Meta).updateTag({ name: 'robots', content: 'noindex, nofollow' });
    }

    // The line under the current link: its place is read from the link, then written to the line.
    afterRenderEffect({
      earlyRead: () => {
        this.linksResized();
        const link = this.sectionLinks().find(
          ({ nativeElement }) => nativeElement.dataset['section'] === this.current(),
        )?.nativeElement;
        return link ? { x: link.offsetLeft, width: link.offsetWidth } : null;
      },
      write: (place) => {
        const marker = this.marker().nativeElement;
        const at = place();
        marker.classList.toggle('links__marker--on', at !== null);
        if (at) {
          marker.style.setProperty('--marker-x', `${at.x}px`);
          marker.style.setProperty('--marker-width', `${at.width}px`);
        }
      },
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.linksResized.update((count) => count + 1));
      observer.observe(this.links().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** The open menu draws its own cream panel, whatever is under it. */
  protected readonly tone = computed<HeaderTone>(() => (this.menuOpen() ? 'light' : this.under()));

  protected toggle(): void {
    this.menuOpen.update((open) => !open);
  }

  protected close(): void {
    this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }
}
