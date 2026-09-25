import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home-method',
  imports: [RouterLink],
  templateUrl: './home-method.html',
  styleUrl: './home-method.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeMethod {}
