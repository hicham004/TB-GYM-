import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The signed-out layout shared by sign-in, registration, password recovery, email confirmation and
 * invitation acceptance. It carries the homepage's brand (wordmark, cream page, serif accent,
 * coaching photo), so moving from the homepage to sign-in stays one product; the page projects its
 * heading and form, which use the design-system primitives.
 *
 * Phones get the wordmark and the form only. From 64rem a photo panel fills the inline end, loaded
 * as a CSS background inside that media query so a phone never downloads it. Presentation only:
 * every route keeps its own guards, and the app shell draws no top bar for signed-out visitors.
 *
 * `embedded` is for the one route a signed-in person can also reach (an invitation): the app's own
 * shell is already on screen, so the frame drops its wordmark and photo and keeps just the column.
 */
@Component({
  selector: 'app-auth-frame',
  imports: [RouterLink],
  template: `
    <div class="auth tb-theme" [class.auth--embedded]="embedded()" [class.auth--wide]="wide()">
      @if (!embedded()) {
        <header class="auth__header">
          <a class="auth__brand" routerLink="/">
            <span class="auth__mark" aria-hidden="true" dir="ltr"
              >TB<span class="auth__dot">.</span></span
            >
            <span i18n>TB Gym</span>
          </a>
        </header>
      }
      <div class="auth__content"><ng-content /></div>
      @if (!embedded()) {
        <div class="auth__panel">
          <div class="auth__scene">
            <p class="auth__tagline" i18n>The work behind <em>every win.</em></p>
            <p class="auth__summary" i18n>
              Training, meals, check-ins and messages for every client, in one place.
            </p>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './auth-frame.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthFrame {
  /** A wider column, for registration's paired fields. */
  readonly wide = input(false, { transform: booleanAttribute });
  readonly embedded = input(false, { transform: booleanAttribute });
}
