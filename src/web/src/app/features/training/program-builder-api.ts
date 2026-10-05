import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  CreateProgramDraftRequest,
  ProgramDraftSaveView,
  ProgramDraftSummary,
  ProgramDraftView,
  ProgramTemplateSummary,
  ProgramTemplateVersionView,
  PublishProgramDraftRequest,
  SaveProgramDraftRequest,
} from '../../core/api/generated';

/**
 * The builder's reads and writes (C4): one program, and the coach's own drafts (TRN-024, R4.2a).
 * Kept out of `ApiClient`, like `ClientProgramApi`, so they load only with the program builder
 * rather than in every page's initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class ProgramBuilderApi {
  private readonly http = inject(HttpClient);

  /** One program with every version, newest first, and the caller's own draft of it, if any. */
  getProgram(templateId: string): Observable<ProgramTemplateSummary> {
    return this.http.get<ProgramTemplateSummary>(`/api/training/templates/${templateId}`);
  }

  /** The caller's own drafts, newest change first: new programs and changes to saved ones. */
  listDrafts(): Observable<ProgramDraftSummary[]> {
    return this.http.get<ProgramDraftSummary[]>('/api/training/program-drafts');
  }

  getDraft(draftId: string): Observable<ProgramDraftView> {
    return this.http.get<ProgramDraftView>(`/api/training/program-drafts/${draftId}`);
  }

  createDraft(request: CreateProgramDraftRequest): Observable<ProgramDraftSaveView> {
    return this.http.post<ProgramDraftSaveView>('/api/training/program-drafts', request);
  }

  saveDraft(draftId: string, request: SaveProgramDraftRequest): Observable<ProgramDraftSaveView> {
    return this.http.put<ProgramDraftSaveView>(`/api/training/program-drafts/${draftId}`, request);
  }

  discardDraft(draftId: string, version: number): Observable<void> {
    return this.http.post<void>(`/api/training/program-drafts/${draftId}/discard`, { version });
  }

  /** The draft becomes the program's next version, published, and is removed. */
  publishDraft(
    draftId: string,
    request: PublishProgramDraftRequest,
  ): Observable<ProgramTemplateVersionView> {
    return this.http.post<ProgramTemplateVersionView>(
      `/api/training/program-drafts/${draftId}/publish`,
      request,
    );
  }
}
