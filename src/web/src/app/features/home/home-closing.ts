import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home-closing',
  imports: [RouterLink],
  templateUrl: './home-closing.html',
  styleUrls: ['./home-closing.scss', './home-finale.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeClosing {
  // The week's beats, repeated as the backdrop of the last call to action.
  private readonly loop = [
    $localize`Plan`,
    $localize`Train`,
    $localize`Eat`,
    $localize`Check in`,
    $localize`Talk`,
    $localize`Progress`,
    $localize`Share`,
  ];
  protected readonly words = [...this.loop, ...this.loop, ...this.loop];
}
