import { ChangeDetectionStrategy, Component, inject, LOCALE_ID } from '@angular/core';
import { RouterLink } from '@angular/router';
import { lastChange } from './home-last-change';

/**
 * The finale (UI plan R6.2f, R6.2j): the last part of the dark ending, after Talk to us, with the
 * closing line at the hero's size, the one lime pill again, and the page's foot. On a wide screen
 * the closing line rises word by word, and for a mouse the hero's green light drifts toward the
 * pointer while the lime pill leans toward it (R6.2k, `startBelow`).
 */
@Component({
  selector: 'app-home-finale',
  imports: [RouterLink],
  templateUrl: './home-finale.html',
  styleUrl: './home-finale.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeFinale {
  protected readonly lastChange = lastChange(inject(LOCALE_ID));
}
