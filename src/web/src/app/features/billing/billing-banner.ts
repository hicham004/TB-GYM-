import { Component, DestroyRef, effect, inject, LOCALE_ID, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { BillingAccess, BillingAccessApi, formatBillingDay } from './billing-access';

/**
 * The coach app's billing banner (ADR 0028). It says the workspace is read-only for an unpaid bill,
 * and warns the owner before that happens. Presentation only: the API refuses the writes whatever this
 * shows, and re-checks on every navigation so a recorded payment clears it without a reload.
 */
@Component({
  selector: 'app-billing-banner',
  imports: [RouterLink],
  template: `
    @if (access(); as access) {
      @if (access.isReadOnly) {
        <div class="banner danger" role="status" data-billing-banner="read-only">
          @if (tenants.isOwner()) {
            <p i18n>
              This workspace is read-only until the overdue TB Gym invoice is paid. You can still
              view everything, and your clients keep full access.
            </p>
            <a routerLink="/billing" i18n>Open Billing</a>
          } @else {
            <p i18n>
              This workspace is read-only until its TB Gym bill is paid. You can still view
              everything; the workspace owner can settle it.
            </p>
          }
        </div>
      } @else if (access.hasOverdueInvoice && tenants.isOwner()) {
        <div class="banner warning" role="status" data-billing-banner="overdue">
          <p i18n>
            A TB Gym invoice is overdue. Pay it before {{ day(access.readOnlyFrom) }} to keep
            editing.
          </p>
          <a routerLink="/billing" i18n>Open Billing</a>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .banner {
      align-items: center;
      border-radius: var(--radius-6);
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-8) var(--space-16);
      margin-block-end: var(--space-16);
      padding: var(--space-8) var(--space-12);
    }

    .banner p {
      flex: 1 1 20rem;
      margin: 0;
    }

    .danger {
      background-color: var(--color-danger-subtle);
      color: var(--color-danger);
    }

    .warning {
      background-color: var(--color-warning-subtle);
      color: var(--color-text-primary);
    }

    a {
      color: inherit;
      font-weight: var(--font-weight-strong);
    }
  `,
})
export class BillingBanner {
  private readonly api = inject(BillingAccessApi);
  private readonly locale = inject(LOCALE_ID);
  protected readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  protected readonly access = signal<BillingAccess | null>(null);

  constructor() {
    this.scope.onReset(() => this.access.set(null));
    effect(() => {
      this.scope.epoch();
      if (this.tenants.selectedTenantId() && this.tenants.canCoach()) {
        void this.load();
      }
    });
    const navigation = inject(Router)
      .events.pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        if (this.tenants.selectedTenantId() && this.tenants.canCoach()) void this.load();
      });
    inject(DestroyRef).onDestroy(() => navigation.unsubscribe());
  }

  protected day(date: string | null): string {
    return date ? formatBillingDay(date, this.locale) : '';
  }

  private async load(): Promise<void> {
    return this.scope.run('access', async (owner) => {
      try {
        const access = await owner.wait(firstValueFrom(this.api.getAccess()));
        this.access.set(access);
      } catch {
        // A banner that cannot load says nothing; the API still refuses what it must.
        if (owner.current) this.access.set(null);
      }
    });
  }
}
