import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface InsideItem {
  readonly title: string;
  readonly body: string;
}

/**
 * What's inside: the shipped product in its own words, after the week has shown it. Copy here must
 * stay true to shipped features; no payments inside the app, no branded app store app, no AI claims.
 */
@Component({
  selector: 'app-home-inside',
  imports: [RouterLink],
  templateUrl: './home-inside.html',
  styleUrl: './home-inside.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeInside {
  protected readonly items: readonly InsideItem[] = [
    {
      title: $localize`Programs`,
      body: $localize`Build a program once, drag exercises into the week, and assign each client their own copy. Progression and training maxes are part of it.`,
    },
    {
      title: $localize`Workout logging`,
      body: $localize`Clients log set by set against your prescription, with RPE or RIR and last time beside them. What they lifted never overwrites what you planned.`,
    },
    {
      title: $localize`Meal plans, recipes and foods`,
      body: $localize`Calorie and macro targets worked out in the open, meal plans with options per meal, recipes from a food search, and the day's rings on the client's phone.`,
    },
    {
      title: $localize`Check-ins`,
      body: $localize`Your own questions, one at a time on their phone, read beside last week's answers with every change marked.`,
    },
    {
      title: $localize`Progress`,
      body: $localize`Bodyweight with a smoothed trend, measurements and progress photos, the same dashboard for both of you.`,
    },
    {
      title: $localize`Messages`,
      body: $localize`The conversation inside TB Gym, with the client's plan and last workout beside it, and your saved replies one tap away.`,
    },
    {
      title: $localize`Your brand`,
      body: $localize`Your colours and logo on every client's phone and on the cards they share. TB Gym's own colours stay on sign-in and on your bill.`,
    },
    {
      title: $localize`Teams and plans`,
      body: $localize`Invite your coaches, give every client one coach, and sell your plans with the price options your clients are on.`,
    },
  ];
}
