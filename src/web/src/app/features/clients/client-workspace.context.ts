import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter, firstValueFrom, type Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  ClientCommercialOverview,
  CoachClientDetails,
  WorkspaceDetails,
} from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';

/**
 * The client's coach, when that is somebody other than the signed-in person. Only a client's own
 * coach messages them, the owner included (ADR 0026, audit COACH-13), so the owner on a team
 * member's client is told who does instead of being offered a chat the API would refuse.
 */
export function otherCoachName(
  profile: CoachClientDetails | null,
  signedInUserId: string | null,
): string | null {
  return profile !== null &&
    signedInUserId !== null &&
    profile.assignedCoachUserId !== signedInUserId
    ? profile.assignedCoachName
    : null;
}

/**
 * What every tab of one client's record shares: the client, their plans and the workspace
 * calendar, plus the page-level messages. Provided by `ClientWorkspace`, so each record gets its
 * own instance and it is gone when the coach leaves the record. The API decides everything; this
 * only keeps the latest answers in one place so the header and the tabs never disagree.
 */
@Injectable()
export class ClientWorkspaceContext {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  readonly clientId = signal('');
  readonly profile = signal<CoachClientDetails | null>(null);
  /** Plans and feature access; null until read, or when the read was refused. */
  readonly plans = signal<ClientCommercialOverview | null>(null);
  /** The workspace's own date, week start and time zone; never the browser's. */
  readonly workspace = signal<WorkspaceDetails | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  /**
   * The server answered that this client is not here (404): an old link, another workspace, or,
   * for a coach, another coach's client (ADR 0026). Retrying can never help, so it is not an error.
   */
  readonly missing = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  /** A former client's record (ADR 0027) is read-only; the API refuses every change regardless. */
  readonly isFormer = computed(() => this.profile()?.release != null);
  /** Presentation only: the API decides who may reassign or release a client. */
  readonly isOwner = this.tenants.isOwner;

  /** Counts the router's navigations: each one is a new page. */
  private page = 0;
  /** The latest read of the plans and the page it was made for, so a tab on that page shares it. */
  private plansRead: {
    clientId: string;
    page: number;
    request: Promise<ClientCommercialOverview | null>;
  } | null = null;

  constructor() {
    this.scope.onReset(() => this.reset());
    const pages = inject(Router)
      .events.pipe(filter((event) => event instanceof NavigationStart))
      .subscribe(() => ++this.page);
    inject(DestroyRef).onDestroy(() => pages.unsubscribe());
  }

  /** Reads the record and its header context. Plans and calendar are optional to the page. */
  async load(clientId: string): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.clientId.set(clientId);
      this.loading.set(true);
      this.loadError.set(null);
      this.missing.set(false);
      try {
        const [profile, plans, workspace] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getClient(clientId)),
            this.readPlans(clientId),
            firstValueFrom(this.api.getWorkspace()).catch(() => null),
          ]),
        );
        this.profile.set(profile);
        this.plans.set(plans);
        this.workspace.set(workspace);
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.missing.set(true);
          return;
        }
        this.loadError.set(
          apiErrorMessage(error, $localize`The client profile could not be loaded.`),
        );
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  /**
   * The plans for the page on screen, read once per page (audit UIQ-8): a tab that opens with the record takes
   * the record's own read, and a tab opened later reads them afresh, so a change made elsewhere shows. Rejects
   * when they cannot be read.
   */
  async plansForPage(): Promise<ClientCommercialOverview> {
    const clientId = this.clientId();
    const read = this.plansRead;
    const shared =
      read !== null && read.clientId === clientId && read.page === this.page
        ? await read.request
        : null;
    if (shared !== null) return shared;
    const plans = await firstValueFrom(this.api.getClientCommercialOverview(clientId));
    this.plansRead = { clientId, page: this.page, request: Promise.resolve(plans) };
    return plans;
  }

  /** The plans for the header and the renewal prompt when the Overview opens: read again unless this page has them. */
  async refreshPlans(): Promise<void> {
    return this.scope.run('plans', async (owner) => {
      const clientId = this.clientId();
      if (!clientId) return;
      try {
        const plans = await owner.wait(this.plansForPage());
        if (clientId === this.clientId()) this.plans.set(plans);
      } catch {
        // The header keeps what it had; the Service & access tab reports its own failures.
      }
    });
  }

  setProfile(profile: CoachClientDetails): void {
    this.profile.set(profile);
  }

  /** The plans a change answered with: every tab sees them, and this page asks for them no more. */
  setPlans(plans: ClientCommercialOverview): void {
    this.plans.set(plans);
    this.plansRead = {
      clientId: this.clientId(),
      page: this.page,
      request: Promise.resolve(plans),
    };
  }

  /**
   * One change to the client record, with the page's busy state and messages. The request must
   * return the updated record, which replaces the old one so every tab sees the same version.
   */
  async save(request: () => Observable<CoachClientDetails>, success: string): Promise<boolean> {
    return this.scope.run(
      'save',
      async (owner) => {
        this.busy.set(true);
        this.clearMessages();
        try {
          await owner.wait(this.csrf.refresh());
          this.profile.set(await owner.wait(firstValueFrom(request())));
          this.notice.set(success);
          return true;
        } catch (error) {
          if (!owner.current) return false;
          this.error.set(apiErrorMessage(error, $localize`The client profile could not be saved.`));
          return false;
        } finally {
          if (owner.current) this.busy.set(false);
        }
      },
      false,
    );
  }

  clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  /** Reads the plans and keeps the read as this page's; a refusal is null, which the page can do without. */
  private readPlans(clientId: string): Promise<ClientCommercialOverview | null> {
    const request = firstValueFrom(this.api.getClientCommercialOverview(clientId)).catch(
      () => null,
    );
    this.plansRead = { clientId, page: this.page, request };
    return request;
  }

  private reset(): void {
    this.plansRead = null;
    this.profile.set(null);
    this.plans.set(null);
    this.workspace.set(null);
    this.loading.set(false);
    this.loadError.set(null);
    this.missing.set(false);
    this.busy.set(false);
    this.clearMessages();
  }
}
