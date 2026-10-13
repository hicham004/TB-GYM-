import { ChangeDetectionStrategy, Component, inject, LOCALE_ID } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PRODUCT_FACTS } from './home-content';
import { lastChange } from './home-last-change';
import { WINDOWS } from './home-pictures';
import { HOME_PLACEHOLDERS, HomePlaceholder } from './home-placeholder';
import { HomeWindow } from './home-window';

/**
 * Proof without a founder, then who it is for (UI plan R6.2f): the product-fact strip with the
 * newest change's date from the changelog, and the story-led split between independent coaches
 * and gyms, each with a real screen and its own button. No quotes, ratings or outcomes. The
 * private pre-launch build (R6.2h) puts the shoot's stand-in of a gym floor above the Team screen.
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
}
