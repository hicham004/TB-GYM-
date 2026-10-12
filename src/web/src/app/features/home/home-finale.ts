import { ChangeDetectionStrategy, Component, ElementRef, inject, LOCALE_ID } from '@angular/core';
import { RouterLink } from '@angular/router';
import { lastChange } from './home-last-change';

/**
 * The finale (UI plan R6.2f): the dark bookend that closes the cream body, with the one lime pill
 * again, and the page's foot.
 */
@Component({
  selector: 'app-home-finale',
  imports: [RouterLink],
  templateUrl: './home-finale.html',
  styleUrl: './home-finale.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeFinale {
  readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly lastChange = lastChange(inject(LOCALE_ID));
}
