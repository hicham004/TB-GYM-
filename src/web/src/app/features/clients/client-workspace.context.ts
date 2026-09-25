import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
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
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  /** A former client's record (ADR 0027) is read-only; the API refuses every change regardless. */
  readonly isFormer = computed(() => this.profile()?.release != null);
  /** Presentation only: the API decides who may reassign or release a client. */
  readonly isOwner = this.tenants.isOwner;

  constructor() {
    this.scope.onReset(() => this.reset());
  }

  /** Reads the record and its header context. Plans and calendar are optional to the page. */
  async load(clientId: string): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.clientId.set(clientId);
      this.loading.set(true);
      this.loadError.set(null);
      try {
        const [profile, plans, workspace] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getClient(clientId)),
            firstValueFrom(this.api.getClientCommercialOverview(clientId)).catch(() => null),
            firstValueFrom(this.api.getWorkspace()).catch(() => null),
          ]),
        );
        this.profile.set(profile);
        this.plans.set(plans);
        this.workspace.set(workspace);
      } catch (error) {
        if (!owner.current) return;
        this.loadError.set(
          apiErrorMessage(error, $localize`The client profile could not be loaded.`),
        );
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  /** Re-reads the plans, for the header and the renewal prompt, after the Overview opens. */
  async refreshPlans(): Promise<void> {
    return this.scope.run('plans', async (owner) => {
      const clientId = this.clientId();
      if (!clientId) return;
      try {
        const plans = await owner.wait(
          firstValueFrom(this.api.getClientCommercialOverview(clientId)),
        );
        if (clientId === this.clientId()) this.plans.set(plans);
      } catch {
        // The header keeps what it had; the Service & access tab reports its own failures.
      }
    });
  }

  setProfile(profile: CoachClientDetails): void {
    this.profile.set(profile);
  }

  setPlans(plans: ClientCommercialOverview): void {
    this.plans.set(plans);
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

  private reset(): void {
    this.profile.set(null);
    this.plans.set(null);
    this.workspace.set(null);
    this.loading.set(false);
    this.loadError.set(null);
    this.busy.set(false);
    this.clearMessages();
  }
}
