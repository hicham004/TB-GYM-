import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  LOCALE_ID,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { PRODUCT_FACTS } from './home-content';
import { lastChange } from './home-last-change';
import { WINDOWS } from './home-pictures';
import { HOME_PLACEHOLDERS, HomePlaceholder } from './home-placeholder';
import { HomeWindow } from './home-window';

/**
 * Proof without a founder, then who it is for (UI plan R6.2f, R6.2j): the product-fact strip with
 * the newest change's date from the changelog, then a dark band where each audience has a half of
 * its own, split by a hairline, with its words, its own button and its real screen whole at 1:1.
 * The band begins the page's dark ending (Talk to us and the finale follow it). No quotes, ratings
 * or outcomes. The private pre-launch build (R6.2h) lifts the Team screen onto the shoot's stand-in
 * of a gym floor.
 */
@Component({
  selector: 'app-home-who',
  imports: [RouterLink, HomePlaceholder, HomeWindow],
  templateUrl: './home-who.html',
  styleUrl: './home-who.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeWho {
  protected readonly facts = PRODUCT_FACTS;
  protected readonly lastChange = lastChange(inject(LOCALE_ID));
  protected readonly builder = WINDOWS.builder;
  protected readonly team = WINDOWS.team;
  protected readonly placeholders = inject(HOME_PLACEHOLDERS);

  private readonly bandRef = viewChild.required<ElementRef<HTMLElement>>('band');

  /** Where the dark ending begins: from its top to the page's end, everything is dark. */
  band(): HTMLElement {
    return this.bandRef().nativeElement;
  }
}
