import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-client-account',
  imports: [RouterLink],
  template: `
    <section class="surface-section">
      <h1 i18n>Me</h1>
      <nav aria-label="My account" i18n-aria-label>
        <a routerLink="/profile" i18n>My profile</a>
        <a routerLink="/account/security" i18n>Account security</a>
        <a routerLink="/notifications/settings" i18n>Notification settings</a>
        <a routerLink="/progress" i18n>Weight and measurements</a>
      </nav>
      <p i18n>Use the account menu above to switch workspace or sign out.</p>
    </section>
  `,
  styles: `
    nav {
      display: grid;
      gap: 0.5rem;
    }
    a {
      padding: 0.75rem;
      min-height: 44px;
    }
  `,
})
export class ClientAccount {}
