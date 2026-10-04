import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import type {
  SavedReplyList as ContractSavedReplyList,
  SavedReplyView as ContractSavedReplyView,
} from '../../core/api/generated';
import {
  mapSavedReplies,
  mapSavedReply,
  type SavedReplies,
  type SavedReply,
} from './saved-replies.models';

/**
 * The caller's own saved replies (MSG-023). Kept out of `ApiClient`, like `ClientListApi`, so it
 * loads only with Messages rather than in every page's initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class SavedRepliesApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/messaging/saved-replies';

  list(): Observable<SavedReplies> {
    return this.http.get<ContractSavedReplyList>(this.base).pipe(map(mapSavedReplies));
  }

  create(title: string, body: string): Observable<SavedReply> {
    return this.http
      .post<ContractSavedReplyView>(this.base, { title, body })
      .pipe(map(mapSavedReply));
  }

  edit(id: string, title: string, body: string, version: number): Observable<SavedReply> {
    return this.http
      .post<ContractSavedReplyView>(`${this.base}/${id}/edit`, { title, body, version })
      .pipe(map(mapSavedReply));
  }

  delete(id: string, version: number): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/delete`, { version });
  }
}
