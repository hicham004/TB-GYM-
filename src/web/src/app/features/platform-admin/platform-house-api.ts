import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type {
  ChangeHouseSettingRequest,
  HouseAdminView,
  HouseSetting,
  HouseSettingView,
} from '../../core/api/generated';
import {
  type HouseAdmin,
  type HouseSettingRow,
  toHouseAdmin,
  toHouseSetting,
} from './platform-house.models';

const HOUSE = '/api/platform-admin/house';

/**
 * The platform admin's house (notes plan N9a1's API, N9a2's page): read it, and change one of its settings
 * at the version the page read. The server authorizes the global role on every request and works in the
 * house's own scope, whichever workspace the admin has selected. Kept apart from `PlatformAdminApi`, whose
 * specs mock it whole.
 */
@Injectable({ providedIn: 'root' })
export class PlatformHouseApi {
  private readonly http = inject(HttpClient);

  getHouse(): Observable<HouseAdmin> {
    return this.http.get<HouseAdminView>(HOUSE).pipe(map(toHouseAdmin));
  }

  /** `null` empties the setting, which closes what it governs. */
  changeSetting(
    setting: HouseSetting,
    value: string | null,
    expectedVersion: number,
  ): Observable<HouseSettingRow> {
    const body: ChangeHouseSettingRequest = { value, expectedVersion };
    return this.http
      .put<HouseSettingView>(`${HOUSE}/settings/${encodeURIComponent(setting)}`, body)
      .pipe(map(toHouseSetting));
  }
}
