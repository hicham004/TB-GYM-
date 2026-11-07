import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type {
  FoundingBadgeView,
  SetFoundingBadgeVisibilityRequest,
} from '../../core/api/generated';
import { toFoundingBadge, type FoundingBadge } from './founding.models';

/**
 * The owner's own Founding coach badge (notes plan N3a, PBL-009): read it, and show it to their
 * clients or hide it. The API answers only the space's owner and never sends the admin's note or the
 * reason a status ended; the hide switch is a personal setting, open while the space is read-only.
 */
@Injectable({ providedIn: 'root' })
export class FoundingBadgeApi {
  private readonly http = inject(HttpClient);

  getBadge(): Observable<FoundingBadge> {
    return this.http.get<FoundingBadgeView>('/api/billing/founding').pipe(map(toFoundingBadge));
  }

  /** Saves the switch on the space's open founding status and answers the badge as it now reads. */
  setHidden(hidden: boolean): Observable<FoundingBadge> {
    const body: SetFoundingBadgeVisibilityRequest = { hidden };
    return this.http
      .put<FoundingBadgeView>('/api/billing/founding/visibility', body)
      .pipe(map(toFoundingBadge));
  }
}
