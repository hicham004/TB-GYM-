import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type { NotificationDeadLetterPage } from '../../core/api/generated';
import { toUndeliveredNoticePage, type UndeliveredNoticePage } from './undelivered-notices.models';

/**
 * The notices the dispatcher gave up on in the open coaching space (ADR 0018). Loaded only with the
 * Settings page that lists them; the API answers the owner alone.
 */
@Injectable({ providedIn: 'root' })
export class UndeliveredNoticesApi {
  private readonly http = inject(HttpClient);

  /** One newest-first page, `skip` rows into the list. */
  getPage(skip: number, take: number): Observable<UndeliveredNoticePage> {
    return this.http
      .get<NotificationDeadLetterPage>('/api/workspace/notification-dead-letters', {
        params: { skip, take },
      })
      .pipe(map(toUndeliveredNoticePage));
  }
}
