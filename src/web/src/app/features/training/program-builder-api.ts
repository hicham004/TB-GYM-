import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ProgramTemplateSummary } from '../../core/api/generated';

/**
 * The builder's read of one program (C4, R4.1). Kept out of `ApiClient`, like `ClientProgramApi`,
 * so it loads only with the program builder rather than in every page's initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class ProgramBuilderApi {
  private readonly http = inject(HttpClient);

  /** One program with every version, newest first, and the token its next save carries. */
  getProgram(templateId: string): Observable<ProgramTemplateSummary> {
    return this.http.get<ProgramTemplateSummary>(`/api/training/templates/${templateId}`);
  }
}
