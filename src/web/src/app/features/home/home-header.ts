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
import { RouterLink } from '@angular/router';

/**
 * The website's header (the homepage and `/changelog`): the wordmark, three section links, Sign
 * in. It sticks to the top and takes the tone of the section under it: cream text over the dark
 * hero and finale, ink over the cream body. On a phone the section links sit behind a Menu button,
 * a disclosure the keyboard closes with Escape.
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

  /** Whether the section under the header is dark right now. */
  readonly dark = input(false);

  protected readonly menuOpen = signal(false);
  /** Over the dark hero the header is clear; the open menu draws its own panel either way. */
  protected readonly tone = computed(() => (this.dark() && !this.menuOpen() ? 'dark' : 'light'));

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
