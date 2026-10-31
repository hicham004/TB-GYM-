import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { CoachMonthReportView } from '../../core/api/generated';

/** This month's one read (critique B10d). Kept out of `ApiClient`, so it loads only with its page. */
@Injectable({ providedIn: 'root' })
export class MonthApi {
  private readonly http = inject(HttpClient);

  getMonth(): Observable<CoachMonthReportView> {
    return this.http.get<CoachMonthReportView>('/api/coach-month');
  }
}
