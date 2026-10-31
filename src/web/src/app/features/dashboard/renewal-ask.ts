import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { mapRenewalStatus, type RenewalStatus } from './renewal.models';

/**
 * Ask to renew (ADR 0029): the button that tells the coach in-app and the answer that replaces it, on
 * Today and on My plan (critique B14), which each say around it what it is about. The server keeps
 * asks 7 days apart, so a second tap, or asking again inside the window, shows the first request
 * rather than an error. Messaging stays closed; nothing here opens it.
 */
@Component({
  selector: 'app-renewal-ask',
  imports: [Button, DatePipe],
  host: { '[class.on-brand]': "surface() === 'brand'" },
  template: `
    @let current = status();
    @if (current.canAsk) {
      <button
        appButton
        type="button"
        size="touch"
        class="renewal-button"
        [variant]="surface() === 'brand' ? 'accent' : 'filled'"
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
          <span class="renewal-date">{{ request.requestedOn | date: 'EEE d MMM' }}</span
          >. You can ask again from
          <span class="renewal-date">{{ request.askAgainFrom | date: 'EEE d MMM' }}</span
          >.</ng-container
        >
      }
    </p>
    <p class="renewal-error" role="alert">{{ error() }}</p>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-16);
    }

    .renewal-sent,
    .renewal-error {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .renewal-button {
      inline-size: 100%;
    }

    // On the brand colour the button keeps its own width, as My plan's other actions do.
    :host(.on-brand) {
      gap: var(--space-8);
      justify-items: start;
    }

    :host(.on-brand) .renewal-button {
      inline-size: auto;
    }

    :host(.on-brand) .renewal-sent,
    :host(.on-brand) .renewal-error {
      font-size: 0.9375rem;
      max-inline-size: 34rem;
    }

    // A date is one unit: "Mon 5 Oct" never breaks across lines.
    .renewal-date {
      white-space: nowrap;
    }

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

    // The danger red is unreadable on the brand colour, so there the words carry it.
    :host(.on-brand) .renewal-error {
      color: inherit;
      font-weight: 600;
    }
  `,
})
export class RenewalAsk {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly sent = viewChild<ElementRef<HTMLElement>>('sent');

  readonly status = input.required<RenewalStatus>();
  /** What it sits on: a plain card, or My plan's brand head. */
  readonly surface = input<'card' | 'brand'>('card');
  /** A new state from the server: after asking, or when the plan turned out not to be ending. */
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
        const status = mapRenewalStatus(
          await owner.wait(firstValueFrom(this.api.requestRenewal())),
        );
        this.statusChange.emit(status);
        // The button has gone; the confirmation that replaced it takes focus.
        setTimeout(() => this.sent()?.nativeElement.focus());
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && error.status === 409) {
          // The plan no longer asks for it (renewed or restarted since the page loaded): show it as it is.
          try {
            this.statusChange.emit(
              mapRenewalStatus(await owner.wait(firstValueFrom(this.api.getOwnRenewalStatus()))),
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
