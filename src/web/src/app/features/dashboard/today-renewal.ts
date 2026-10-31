import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { firstName } from '../account/own-sessions.models';
import { RenewalAsk } from './renewal-ask';
import type { RenewalStatus } from './renewal.models';

/**
 * Today's card for asking to renew (ADR 0029): who the plan is with and when it ended, in place of
 * training once the whole plan has run out, or when it ends, under the day's workout from the day
 * its ending-soon notice goes out (critique B14), with Ask to renew.
 */
@Component({
  selector: 'app-today-renewal',
  imports: [DatePipe, RenewalAsk],
  template: `
    @let current = status();
    <section class="today-card" aria-labelledby="today-renewal-heading">
      <h2 id="today-renewal-heading">
        @if (current.endsOn; as endsOn) {
          @if (firstName(current.coachName); as coach) {
            <ng-container i18n
              >Your coaching plan with <bdi dir="auto">{{ coach }}</bdi> ends on
              <span class="today-date-value">{{ endsOn | date: 'EEE d MMM' }}</span
              >.</ng-container
            >
          } @else {
            <ng-container i18n
              >Your coaching plan ends on
              <span class="today-date-value">{{ endsOn | date: 'EEE d MMM' }}</span
              >.</ng-container
            >
          }
        } @else if (current.coachName) {
          <ng-container i18n
            >Your coaching plan with <bdi dir="auto">{{ current.coachName }}</bdi> ended on
            <span class="today-date-value">{{ current.endedOn | date: 'EEE d MMM' }}</span
            >.</ng-container
          >
        } @else {
          <ng-container i18n
            >Your coaching plan ended on
            <span class="today-date-value">{{ current.endedOn | date: 'EEE d MMM' }}</span
            >.</ng-container
          >
        }
      </h2>
      <app-renewal-ask [status]="current" (statusChange)="statusChange.emit($event)" />
    </section>
  `,
  styleUrls: ['./today-card.scss'],
})
export class TodayRenewal {
  protected readonly firstName = firstName;

  readonly status = input.required<RenewalStatus>();
  /** A new state from the server: after asking, or when the plan turned out not to be ending. */
  readonly statusChange = output<RenewalStatus>();
}
