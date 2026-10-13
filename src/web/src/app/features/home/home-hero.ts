import { ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WINDOWS } from './home-pictures';
import { HomePhone } from './home-phone';
import { HOME_PLACEHOLDERS, HomePlaceholder } from './home-placeholder';
import { HomeWindow } from './home-window';

/**
 * The hero (UI plan R6.2f, hero B of the R6.2d mockups): a full-screen dark stage, one promise
 * line, one sentence, the lime pill and the quiet link, and the proof beside them: the coach's
 * Today in dark mode at 1:1 and the client's Today on a lit phone. Everything is painted in full by
 * the build-time render; nothing here waits for a script. The private pre-launch build (R6.2h)
 * puts the shoot's stand-in photograph behind it all, and the phone alone in front.
 */
@Component({
  selector: 'app-home-hero',
  imports: [RouterLink, HomePhone, HomePlaceholder, HomeWindow],
  templateUrl: './home-hero.html',
  styleUrl: './home-hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeHero {
  readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly window = WINDOWS.todayDark;
  protected readonly placeholders = inject(HOME_PLACEHOLDERS);
}
