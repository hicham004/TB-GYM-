import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { CheckInToReviewList } from '../../core/api/generated';

/**
 * The read only Check-ins to review makes (critique B3b). Kept out of `ApiClient`, like
 * `SavedRepliesApi`, so it loads only with Check-ins rather than in every page's initial bundle
 * (audit WEB-5).
 */
@Injectable({ providedIn: 'root' })
export class CheckInsToReviewApi {
  private readonly http = inject(HttpClient);

  /** Every sent check-in waiting for its review, of the clients the caller coaches (CHK-014). */
  list(): Observable<CheckInToReviewList> {
    return this.http.get<CheckInToReviewList>('/api/checkins/to-review');
  }
}
