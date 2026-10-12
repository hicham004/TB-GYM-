import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HomeClosing } from './home-closing';
import { HomeInside } from './home-inside';
import { HomeWeek } from './home-week';

/**
 * The public homepage (UI plan R6.2b): the week with Maya told from both sides, what's inside,
 * who it's for. It is rendered at build time (R6.2a), so everything here is in the HTML Google
 * and link previews read; only the story's motion waits for the browser.
 */
@Component({
  selector: 'app-home',
  imports: [RouterLink, HomeWeek, HomeInside, HomeClosing],
  templateUrl: './home.html',
  styleUrls: ['./home.scss', './home-header.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  // Real product capabilities only; the ribbon is a promise the rest of the page has to keep.
  protected readonly ribbon = [
    $localize`Training programs`,
    $localize`Workout logging`,
    $localize`RPE and RIR`,
    $localize`Meal plans`,
    $localize`Calorie and macro targets`,
    $localize`Custom check-ins`,
    $localize`Bodyweight trends`,
    $localize`Progress photos`,
    $localize`Direct messages`,
    $localize`Share cards`,
    $localize`Your brand`,
    $localize`Coach teams`,
  ];
}
