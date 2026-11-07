import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { toNumber } from '../../core/api/api-client';
import type {
  AddCoachCertificateLineRequest,
  CoachCertificateCoachView,
  CoachCertificateDropView,
  CoachCertificateErasureView,
  CoachCertificateLineChangeRequest,
  CoachCertificateLinesView,
  CoachCertificateLineView,
  ConfirmCoachCertificateLineRequest,
  EraseCoachCertificateLinesRequest,
} from '../../core/api/generated';
import {
  toCertificateCoach,
  toCertificateLine,
  toCertificateLines,
  type AddedLine,
  type CertificateCoach,
  type CertificateErasure,
  type CertificateLine,
  type CertificateLines,
} from './platform-coaches.models';

const COACHES = '/api/platform-admin/coaches';

/** The routes of one coach in one coaching space. */
function space(userId: string, tenantId: string): string {
  return `${COACHES}/${encodeURIComponent(userId)}/spaces/${encodeURIComponent(tenantId)}`;
}

function line(userId: string, tenantId: string, lineId: string): string {
  return `${space(userId, tenantId)}/lines/${encodeURIComponent(lineId)}`;
}

/**
 * The platform admin's certificate record (notes plan N4a, CLI-021): every coach of every coaching
 * space, a coach's lines in one space, and the five writes on them. Like the rest of the platform
 * admin's screens they need no workspace; the API authorizes the global role on every request. Kept
 * apart from `PlatformAdminApi`, as the founding calls are, so the Coaches page carries only what it
 * uses.
 */
@Injectable({ providedIn: 'root' })
export class PlatformCoachesApi {
  private readonly http = inject(HttpClient);

  /** One row per membership, ordered by name then space by the server. */
  getCoaches(): Observable<CertificateCoach[]> {
    return this.http
      .get<CoachCertificateCoachView[]>(COACHES)
      .pipe(map((items) => items.map(toCertificateCoach)));
  }

  /** The coach's lines in the space, newest first, with the space's today. */
  getLines(userId: string, tenantId: string): Observable<CertificateLines> {
    return this.http
      .get<CoachCertificateLinesView>(`${space(userId, tenantId)}/lines`)
      .pipe(map(toCertificateLines));
  }

  /**
   * Adds a waiting line. The same words and day already on the record answer that line (200), so a
   * second press adds nothing twice; a new line answers 201.
   */
  addLine(userId: string, tenantId: string, what: string, shownOn: string): Observable<AddedLine> {
    const body: AddCoachCertificateLineRequest = { what, shownOn };
    return this.http
      .post<CoachCertificateLineView>(`${space(userId, tenantId)}/lines`, body, {
        observe: 'response',
      })
      .pipe(
        map((response) => {
          if (!response.body) throw new Error('The line was not in the answer.');
          return { line: toCertificateLine(response.body), created: response.status === 201 };
        }),
      );
  }

  /** Marks a waiting line confirmed by `confirmedByName`, against the version the admin saw. */
  confirmLine(
    userId: string,
    tenantId: string,
    lineId: string,
    confirmedByName: string,
    version: number,
  ): Observable<CertificateLine> {
    const body: ConfirmCoachCertificateLineRequest = { confirmedByName, version };
    return this.http
      .post<CoachCertificateLineView>(`${line(userId, tenantId, lineId)}/confirm`, body)
      .pipe(map(toCertificateLine));
  }

  /** Drops a waiting line outright: nothing about it is kept. Answers the dropped line's id. */
  dropLine(userId: string, tenantId: string, lineId: string, version: number): Observable<string> {
    const body: CoachCertificateLineChangeRequest = { version };
    return this.http
      .post<CoachCertificateDropView>(`${line(userId, tenantId, lineId)}/drop`, body)
      .pipe(map((value) => value.lineId));
  }

  /** Takes a confirmed line down; its words are kept for the keeping period. */
  takeDownLine(
    userId: string,
    tenantId: string,
    lineId: string,
    version: number,
  ): Observable<CertificateLine> {
    const body: CoachCertificateLineChangeRequest = { version };
    return this.http
      .post<CoachCertificateLineView>(`${line(userId, tenantId, lineId)}/take-down`, body)
      .pipe(map(toCertificateLine));
  }

  /** Erases every line of the coach in the space on their request; the answer is counts only. */
  erase(userId: string, tenantId: string, requestedOn: string): Observable<CertificateErasure> {
    const body: EraseCoachCertificateLinesRequest = { requestedOn };
    return this.http
      .post<CoachCertificateErasureView>(`${space(userId, tenantId)}/erase`, body)
      .pipe(map((value) => ({ erased: toNumber(value.erased), dropped: toNumber(value.dropped) })));
  }
}
