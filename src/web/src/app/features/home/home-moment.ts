import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A full-width photograph: the human reason the software exists. */
@Component({
  selector: 'app-home-moment',
  templateUrl: './home-moment.html',
  styleUrl: './home-moment.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeMoment {}
