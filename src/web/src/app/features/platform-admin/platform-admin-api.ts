import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import type {
  AdminWorkspaceDetail as ContractAdminWorkspaceDetail,
  AdminWorkspaceSummary,
  ContactKind,
  ContactRequestAdminView,
  InvoiceRunOutcome,
  LegalDocumentAdminView,
  PricePlanView,
  PublishLegalDocumentRequest,
  PublishPricePlanRequest,
} from '../../core/api/generated';
import { toNumber } from '../../core/api/api-client';
import {
  AdminWorkspace,
  AdminWorkspaceDetail,
  PricePlan,
  toAdminWorkspace,
  toAdminWorkspaceDetail,
  toPricePlan,
} from '../billing/billing.models';
import {
  type LegalVersion,
  type PublishLegalRequest,
  toLegalVersion,
} from './legal-documents.models';

export interface InvoiceRun {
  periodStart: string;
  issued: number;
  alreadyIssued: number;
  inTrial: number;
}

/** A Talk-to-us request whose email to the admin has not gone out (audit BEB-1). */
export interface GymRequest {
  id: string;
  name: string;
  gymName: string;
  contact: string;
  contactKind: ContactKind;
  message: string | null;
  receivedAtUtc: string;
  deadLettered: boolean;
  sending: boolean;
  attemptCount: number;
}

export interface PublishPlan {
  seatPrice: number;
  includedClientsPerSeat: number;
  extraClientPrice: number;
  gymFee: number;
  gymFeeMinimumSeats: number;
  trialDays: number;
  paymentTermDays: number;
  graceDays: number;
  expectedCurrentVersion: number;
  note: string | null;
}

/**
 * The platform admin's billing endpoints (ADR 0028). They send no workspace header: the admin is not
 * acting as a member of any workspace, and the API authorizes the global role on every request.
 */
@Injectable({ providedIn: 'root' })
export class PlatformAdminApi {
  private readonly http = inject(HttpClient);

  getWorkspaces(): Observable<AdminWorkspace[]> {
    return this.http
      .get<AdminWorkspaceSummary[]>('/api/platform-admin/workspaces')
      .pipe(map((items) => items.map(toAdminWorkspace)));
  }

  getWorkspace(tenantId: string): Observable<AdminWorkspaceDetail> {
    return this.http
      .get<ContractAdminWorkspaceDetail>(`/api/platform-admin/workspaces/${tenantId}`)
      .pipe(map(toAdminWorkspaceDetail));
  }

  /** Talk-to-us requests not yet emailed: waiting for email, or given up after their attempts. */
  getGymRequests(): Observable<GymRequest[]> {
    return this.http
      .get<ContactRequestAdminView[]>('/api/platform-admin/contact-requests')
      .pipe(
        map((items) =>
          items.map((item) => ({ ...item, attemptCount: toNumber(item.attemptCount) })),
        ),
      );
  }

  getPricePlans(): Observable<PricePlan[]> {
    return this.http
      .get<PricePlanView[]>('/api/platform-admin/price-plans')
      .pipe(map((items) => items.map(toPricePlan)));
  }

  publishPricePlan(request: PublishPlan): Observable<PricePlan> {
    const body: PublishPricePlanRequest = request;
    return this.http
      .post<PricePlanView>('/api/platform-admin/price-plans', body)
      .pipe(map(toPricePlan));
  }

  /** Issues last month's invoices now. Safe to repeat: an issued month is never issued twice. */
  issueInvoices(): Observable<InvoiceRun> {
    return this.http
      .post<InvoiceRunOutcome>('/api/platform-admin/invoices/issue', { periodStart: null })
      .pipe(
        map((value) => ({
          periodStart: value.periodStart,
          issued: toNumber(value.issued),
          alreadyIssued: toNumber(value.alreadyIssued),
          inTrial: toNumber(value.inTrial),
        })),
      );
  }

  /** `receivedOn` is the day the money arrived (PBL-007); null lets the server use today. */
  recordPayment(
    invoiceId: string,
    amount: number,
    reference: string,
    note: string | null,
    receivedOn: string | null,
  ): Observable<unknown> {
    return this.http.post(`/api/platform-admin/invoices/${invoiceId}/payments`, {
      amount,
      reference,
      note,
      receivedOn,
    });
  }

  voidInvoice(invoiceId: string, reason: string, reissue: boolean): Observable<unknown> {
    return this.http.post(`/api/platform-admin/invoices/${invoiceId}/void`, { reason, reissue });
  }

  grantDiscount(
    tenantId: string,
    percent: number,
    startsOn: string,
    endsOnExclusive: string,
    note: string,
  ): Observable<unknown> {
    return this.http.post(`/api/platform-admin/workspaces/${tenantId}/discounts`, {
      percent,
      startsOn,
      endsOnExclusive,
      note,
    });
  }

  revokeDiscount(discountId: string): Observable<unknown> {
    return this.http.post(`/api/platform-admin/discounts/${discountId}/revoke`, null);
  }

  /** Every version of the legal documents, in force or replaced, with how often each was accepted. */
  getLegalDocuments(): Observable<LegalVersion[]> {
    return this.http
      .get<LegalDocumentAdminView[]>('/api/platform-admin/legal-documents')
      .pipe(map((items) => items.map(toLegalVersion)));
  }

  /** Stops asking for a version published by mistake; its words and acceptances stay. */
  withdrawLegalDocument(id: string): Observable<LegalVersion> {
    return this.http
      .post<LegalDocumentAdminView>(
        `/api/platform-admin/legal-documents/${encodeURIComponent(id)}/withdraw`,
        null,
      )
      .pipe(map(toLegalVersion));
  }

  /** Publishes reviewed text at once (audit INV-3); it replaces the version in force the admin saw. */
  publishLegalDocument(request: PublishLegalRequest): Observable<LegalVersion> {
    const body: PublishLegalDocumentRequest = request;
    return this.http
      .post<LegalDocumentAdminView>('/api/platform-admin/legal-documents', body)
      .pipe(map(toLegalVersion));
  }
}
