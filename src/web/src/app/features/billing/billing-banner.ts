import { Component, DestroyRef, effect, inject, LOCALE_ID, signal, untracked } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { BillingAccess, BillingAccessApi, formatBillingDay } from './billing-access';

/** How old an answer may be before a page change reads it again. */
const STALE_AFTER_MINUTES = 10;

/**
 * The coach app's billing banner (ADR 0028). It says the workspace is read-only for an unpaid bill,
 * and warns the owner before that happens. Presentation only: the API refuses the writes whatever this
 * shows. It reads once per workspace, one read at a time (audit UIQ-8). A page change reads again only
 * while the banner says something a recorded payment would clear, so that clears without a reload, or
 * once the answer is ten minutes old, so a bill that falls due meanwhile still shows.
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
              Your coaching space is read-only until the overdue TB Gym invoice is paid. You can
              still view everything, and your clients keep full access.
            </p>
            <a routerLink="/billing" i18n>Open Billing</a>
          } @else {
            <p i18n>
              Your coaching space is read-only until its TB Gym bill is paid. You can still view
              everything, and the owner can settle it.
            </p>
          }
        </div>
      } @else if (access.hasOverdueInvoice && tenants.isOwner()) {
        <div class="banner warning" role="status" data-billing-banner="overdue">
          <p i18n>
            A TB Gym invoice is overdue.
            @if (access.readOnlyFrom; as from) {
              Pay it before {{ day(from) }} to keep editing.
            } @else {
              Pay it to keep editing.
            }
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
  /** When the answer on screen was read, by the clock; 0 before the first. */
  private readAt = 0;
  /** The workspace whose read is on its way, so a second asker waits for it instead. */
  private reading: string | null = null;

  constructor() {
    this.scope.onReset(() => {
      this.access.set(null);
      this.readAt = 0;
      this.reading = null;
    });
    effect(() => {
      this.scope.epoch();
      if (this.tenants.selectedTenantId() && this.tenants.canCoach()) {
        untracked(() => void this.load());
      }
    });
    const navigation = inject(Router)
      .events.pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        if (this.tenants.selectedTenantId() && this.tenants.canCoach() && this.worthReading()) {
          void this.load();
        }
      });
    inject(DestroyRef).onDestroy(() => navigation.unsubscribe());
  }

  protected day(date: string): string {
    return formatBillingDay(date, this.locale);
  }

  /** Whether a page change should ask again: a payment may have cleared the banner, or the answer is old. */
  private worthReading(): boolean {
    const access = this.access();
    const showing =
      access !== null &&
      (access.isReadOnly || (access.hasOverdueInvoice && this.tenants.isOwner()));
    return showing || Date.now() - this.readAt >= STALE_AFTER_MINUTES * 60_000;
  }

  private async load(): Promise<void> {
    const key = `${this.tenants.selectedTenantId()}#${this.scope.epoch()}`;
    if (this.reading === key) return;
    this.reading = key;
    try {
      await this.scope.run('access', async (owner) => {
        try {
          const access = await owner.wait(firstValueFrom(this.api.getAccess()));
          this.access.set(access);
          this.readAt = Date.now();
        } catch {
          // A banner that cannot load says nothing; the API still refuses what it must. The next page asks again.
          if (owner.current) {
            this.access.set(null);
            this.readAt = 0;
          }
        }
      });
    } finally {
      if (this.reading === key) this.reading = null;
    }
  }
}
