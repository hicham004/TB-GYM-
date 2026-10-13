import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
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

/**
 * The website's header (the homepage and `/changelog`): the wordmark, three section links, Sign
 * in. It sticks to the top and takes the tone of the section under it: cream text over the dark
 * hero and the dark ending, ink over the cream body. On a phone the section links sit behind a Menu
 * button, a disclosure the keyboard closes with Escape.
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

  protected readonly menuOpen = signal(false);

  constructor() {
    // The private pre-launch build (UI plan R6.2h) is never for Google: every page this header is
    // on says so in its document, besides the header the private server sends.
    if (inject(HOME_PLACEHOLDERS)) {
      inject(Meta).updateTag({ name: 'robots', content: 'noindex, nofollow' });
    }
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
