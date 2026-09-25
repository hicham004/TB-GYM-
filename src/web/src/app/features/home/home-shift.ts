import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Before and after: coaching scattered across chats and files, then the same week in TB Gym. */
@Component({
  selector: 'app-home-shift',
  templateUrl: './home-shift.html',
  styleUrls: ['./home-shift.scss', './home-shift-mess.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeShift {}
