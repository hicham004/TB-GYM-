import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import type { ConversationReadState as ContractReadState } from '../../core/api/generated';
import { mapReadState, type ConversationReadState } from './messaging.models';

/**
 * The calls only Messages makes. Kept out of `ApiClient`, like `SavedRepliesApi`, so they load only
 * with Messages rather than in every page's initial bundle (audit WEB-5).
 */
@Injectable({ providedIn: 'root' })
export class MessagesApi {
  private readonly http = inject(HttpClient);

  /** Mark as unread (MSG-022, critique B3b): the caller's own mark, until they next read the chat. */
  markUnread(conversationId: string): Observable<ConversationReadState> {
    return this.http
      .post<ContractReadState>(`/api/messaging/conversations/${conversationId}/unread`, {})
      .pipe(map(mapReadState));
  }
}
