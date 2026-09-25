import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HomeClosing } from './home-closing';
import { HomeHero } from './home-hero';
import { HomeMethod } from './home-method';
import { HomeMoment } from './home-moment';
import { HomeShift } from './home-shift';
import { HomeTour } from './home-tour';

@Component({
  selector: 'app-home',
  imports: [RouterLink, HomeHero, HomeShift, HomeTour, HomeMethod, HomeMoment, HomeClosing],
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
    $localize`Coach teams`,
  ];
}
