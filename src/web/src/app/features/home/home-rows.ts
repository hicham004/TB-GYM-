import { ChangeDetectionStrategy, Component, ElementRef, viewChildren } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FEATURE_ROWS } from './home-content';
import { HomePhone } from './home-phone';
import { HomeWindow } from './home-window';

/**
 * What's inside (UI plan R6.2f): six feature rows in the premium grammar, each pairing the coach's
 * screen and the client's phone for the same moment, with a short outcome, one sentence and one
 * quiet link; then the thin strip for clients. Copy here must stay true to shipped features: no
 * payments inside the app, no branded app store app, no AI claims. On a wide screen each row's
 * screens arrive as it comes in (R6.2k, `startBelow`).
 */
@Component({
  selector: 'app-home-rows',
  imports: [RouterLink, HomePhone, HomeWindow],
  templateUrl: './home-rows.html',
  styleUrl: './home-rows.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeRows {
  protected readonly rows = FEATURE_ROWS;

  private readonly introTitle = viewChildren<ElementRef<HTMLElement>>('introTitle');
  private readonly rowTitles = viewChildren<ElementRef<HTMLElement>>('rowTitle');

  /** The headlines the page reveals line by line. */
  titles(): HTMLElement[] {
    return [...this.introTitle(), ...this.rowTitles()].map((title) => title.nativeElement);
  }
}
