import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import type {
  HouseProgramListingView,
  OfferHouseProgramRequest,
  WithdrawHouseProgramRequest,
} from '../../core/api/generated';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { toHouseListing, type HouseListing } from './house-listings.models';

/**
 * The house's staff offering published programs to its self-directed trainees (TRN-034, notes plans N9c3 and
 * N9c4). Kept out of `ApiClient`, which is in every page's first download, so it loads with Programs alone.
 * Every route answers 404 outside TB Gym's own space; the server lets its Owner and Coaches alone write.
 */
@Injectable({ providedIn: 'root' })
export class HouseListingsApi {
  private readonly http = inject(HttpClient);

  /** Every program the house lists, offered first, then withdrawn ones, in the server's order. */
  list(): Observable<HouseListing[]> {
    return this.http
      .get<HouseProgramListingView[]>('/api/training/house-programs')
      .pipe(map((views) => views.map(toHouseListing)));
  }

  /** Offers a program, changes its terms, or offers a withdrawn one again; the rounding goes by its name. */
  offer(templateId: string, request: OfferHouseProgramRequest): Observable<HouseListing> {
    return this.http
      .put<HouseProgramListingView>(
        `/api/training/templates/${encodeURIComponent(templateId)}/house-listing`,
        request,
      )
      .pipe(map(toHouseListing));
  }

  /** Stops offering it; trainees who started it keep their copy. */
  withdraw(templateId: string, request: WithdrawHouseProgramRequest): Observable<HouseListing> {
    return this.http
      .post<HouseProgramListingView>(
        `/api/training/templates/${encodeURIComponent(templateId)}/house-listing/withdraw`,
        request,
      )
      .pipe(map(toHouseListing));
  }
}

/**
 * Which spaces answered "not the house" this session (notes plan N9c4), so Programs asks a space at most
 * once: nothing on the web marks TB Gym's own space, so the list's 404 is the sign. Kept per space, in
 * memory only, for the whole session: switching workspaces away and back keeps it, while signing out,
 * a session that ended or another account empties it.
 */
@Injectable({ providedIn: 'root' })
export class HouseListingsMemo {
  private readonly elsewhere = new Set<string>();
  private readonly tenants = inject(TenantStore);

  constructor() {
    // A workspace switch selects the next space at once; only a session change leaves none selected
    // (TenantStore's `clear` and `unload`) before the change is announced.
    inject(TenantContext).onChange(() => {
      if (this.tenants.selectedTenantId() === null) this.elsewhere.clear();
    });
  }

  isNotTheHouse(tenantId: string): boolean {
    return this.elsewhere.has(tenantId);
  }

  markNotTheHouse(tenantId: string): void {
    this.elsewhere.add(tenantId);
  }
}
