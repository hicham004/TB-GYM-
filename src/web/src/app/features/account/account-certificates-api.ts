import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type {
  CoachCertificateOwnLineView,
  CoachCertificateOwnView,
  SetCoachCertificateLineShownRequest,
} from '../../core/api/generated';
import {
  toOwnCertificateLine,
  toOwnCertificateLines,
  type OwnCertificateLine,
} from './account-certificates.models';

const OWN = '/api/coach-certificates/me';

/**
 * A coach's own certificate lines in the open coaching space (notes plan N4b, CLI-021): read them, and
 * show a confirmed one to their clients or hide it. The API answers the signed-in owner or coach about
 * themselves alone, in the workspace the tenant header names; the switch is a personal setting, open
 * while the space is read-only for an unpaid bill.
 */
@Injectable({ providedIn: 'root' })
export class AccountCertificatesApi {
  private readonly http = inject(HttpClient);

  /** The caller's lines, waiting, confirmed and taken down, in the order TB Gym recorded them. */
  getOwn(): Observable<readonly OwnCertificateLine[]> {
    return this.http.get<CoachCertificateOwnView>(OWN).pipe(map(toOwnCertificateLines));
  }

  /** The switch, against the version the page read; answers the line as it now stands. */
  setShown(lineId: string, shown: boolean, version: number): Observable<OwnCertificateLine> {
    const body: SetCoachCertificateLineShownRequest = { shown, version };
    return this.http
      .put<CoachCertificateOwnLineView>(`${OWN}/${encodeURIComponent(lineId)}/shown`, body)
      .pipe(map(toOwnCertificateLine));
  }
}
