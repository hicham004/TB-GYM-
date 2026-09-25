import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import type { RenewalStatus } from './renewal.models';

/**
 * Today when the client's whole plan has run out (ADR 0029): who it was with and when it ended, and
 * an "Ask to renew" button that tells the coach in-app. The server keeps asks 7 days apart, so a
 * second tap, or asking again inside the window, shows the first request rather than an error.
 * Messaging stays closed; nothing here opens it.
 */
@Component({
  selector: 'app-today-renewal',
  imports: [Button, DatePipe],
  template: `
    @let current = status();
    <section class="today-card" aria-labelledby="today-renewal-heading">
      <h2 id="today-renewal-heading">
        @if (current.coachName) {
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
      @if (current.canAsk) {
        <button
          appButton
          type="button"
          size="touch"
          class="today-action"
          [loading]="sending()"
          (click)="ask()"
          i18n
        >
          Ask to renew
        </button>
      }
      <!-- Present from the start so the confirmation is announced when it appears. -->
      <p #sent class="renewal-sent" role="status" tabindex="-1">
        @if (!current.canAsk && current.lastRequest; as request) {
          <ng-container i18n
            >Renewal request sent on
            <span class="today-date-value">{{ request.requestedOn | date: 'EEE d MMM' }}</span
            >. You can ask again from
            <span class="today-date-value">{{ request.askAgainFrom | date: 'EEE d MMM' }}</span
            >.</ng-container
          >
        }
      </p>
      <p class="renewal-error" role="alert">{{ error() }}</p>
    </section>
  `,
  styleUrls: ['./today-card.scss'],
  styles: `
    .renewal-sent:empty,
    .renewal-error:empty {
      display: none;
    }

    .renewal-sent:focus {
      outline: none;
    }

    .renewal-error {
      color: var(--color-danger);
    }
  `,
})
export class TodayRenewal {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly sent = viewChild<ElementRef<HTMLElement>>('sent');

  readonly status = input.required<RenewalStatus>();
  /** A new state from the server: after asking, or when the plan turned out not to have ended. */
  readonly statusChange = output<RenewalStatus>();

  protected readonly sending = signal(false);
  protected readonly error = signal('');

  constructor() {
    this.scope.onReset(() => {
      this.sending.set(false);
      this.error.set('');
    });
  }

  protected ask(): Promise<void> {
    return this.scope.run('ask', async (owner) => {
      this.sending.set(true);
      this.error.set('');
      try {
        await owner.wait(this.csrf.refresh());
        const status = await owner.wait(firstValueFrom(this.api.requestRenewal()));
        this.statusChange.emit(status);
        // The button has gone; the confirmation that replaced it takes focus.
        setTimeout(() => this.sent()?.nativeElement.focus());
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && error.status === 409) {
          // The plan is no longer over (renewed or restarted since the page loaded): show it as it is.
          try {
            this.statusChange.emit(
              await owner.wait(firstValueFrom(this.api.getOwnRenewalStatus())),
            );
            return;
          } catch {
            if (!owner.current) return;
          }
        }
        this.error.set($localize`Couldn’t send your request. Try again.`);
      } finally {
        if (owner.current) this.sending.set(false);
      }
    });
  }
}
