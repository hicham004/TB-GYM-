import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { toWorkspace } from '../../core/api/api-client';
import type { WorkspaceDetails } from '../../core/api/api.models';
import type {
  MediaAssetView,
  UpdateWorkspaceBrandRequest,
  WorkspaceDetails as ContractWorkspaceDetails,
} from '../../core/api/generated';

/**
 * The owner's brand writes (R3.5a, GAM-005, MED-013). Kept out of `ApiClient` so they load only with
 * the Brand page; every member's read of the brand comes with their list of workspaces.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceBrandApi {
  private readonly http = inject(HttpClient);

  /** Both colours or neither, and the logo or none, checked against the workspace's version. */
  saveBrand(request: {
    brandColor: string | null;
    accentColor: string | null;
    logoAssetId: string | null;
    version: number;
  }): Observable<WorkspaceDetails> {
    const body: UpdateWorkspaceBrandRequest = request;
    return this.http
      .put<ContractWorkspaceDetails>('/api/workspace/brand', body)
      .pipe(map(toWorkspace));
  }

  /**
   * Uploads a logo. The server re-encodes it small and keeps it unattached until the brand is
   * saved with it; only the owner can see it before then.
   */
  uploadLogo(file: File): Observable<{ id: string }> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http
      .post<MediaAssetView>('/api/media/workspace-logo', form)
      .pipe(map((asset) => ({ id: asset.id })));
  }
}
