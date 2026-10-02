import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ClientOverviewView } from '../../core/api/generated';

/**
 * The coach's client list read (C2, R3.1). Kept out of `ApiClient`, like `FormerClientsApi`, so it
 * loads only with the Clients screen rather than in every page's initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class ClientListApi {
  private readonly http = inject(HttpClient);

  /** Every client the caller coaches, sorted by name, with status and the last seven days. */
  getOverview(): Observable<ClientOverviewView> {
    return this.http.get<ClientOverviewView>('/api/clients/overview');
  }
}
