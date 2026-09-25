import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { WorkspaceBillingAccessView } from '../../core/api/generated';

/** Whether the workspace is read-only for an unpaid bill (ADR 0028). */
export type BillingAccess = WorkspaceBillingAccessView;

/**
 * The one billing call the coach shell makes on every page, kept apart from the Billing page's own
 * API so the shell does not load the invoice mapping with it.
 */
@Injectable({ providedIn: 'root' })
export class BillingAccessApi {
  private readonly http = inject(HttpClient);

  /** Read-only or not, for owner and coaches; only the owner also hears of an overdue invoice. */
  getAccess(): Observable<BillingAccess> {
    return this.http.get<WorkspaceBillingAccessView>('/api/billing/access');
  }
}

/** A UTC calendar date as a short label, without letting the browser's time zone move it a day. */
export function formatBillingDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date.slice(0, 10)}T00:00:00Z`),
  );
}
