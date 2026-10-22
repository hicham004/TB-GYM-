import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type { LegalDocumentText, LegalDocumentToAccept } from '../../core/api/generated';
import { type LegalAudience, type LegalToAccept, toLegalToAccept } from './legal.models';

/**
 * The public legal reads (audit INV-3): what a person joining is asked to accept, and a published
 * version's text. Both answer anyone, signed in or not; the server decides what applies.
 */
@Injectable({ providedIn: 'root' })
export class LegalApi {
  private readonly http = inject(HttpClient);

  /** One version per document that applies; a signed-in person is not asked again for what they accepted. */
  toAccept(audience: LegalAudience): Observable<LegalToAccept[]> {
    return this.http
      .get<LegalDocumentToAccept[]>('/api/legal/documents/to-accept', { params: { audience } })
      .pipe(map((documents) => documents.map(toLegalToAccept)));
  }

  document(id: string): Observable<LegalDocumentText> {
    return this.http.get<LegalDocumentText>(`/api/legal/documents/${encodeURIComponent(id)}`);
  }
}
