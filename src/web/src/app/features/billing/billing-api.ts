import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type { WorkspaceBillingView } from '../../core/api/generated';
import { toWorkspaceBilling, WorkspaceBilling } from './billing.models';

/**
 * The workspace's own TB Gym bill (ADR 0028). Loaded only with the Billing page; the API answers the
 * bill to the owner alone.
 */
@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly http = inject(HttpClient);

  getWorkspaceBilling(): Observable<WorkspaceBilling> {
    return this.http.get<WorkspaceBillingView>('/api/billing').pipe(map(toWorkspaceBilling));
  }
}
