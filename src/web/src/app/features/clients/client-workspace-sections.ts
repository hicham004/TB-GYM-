import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type {
  CompleteClientOnboardingRequest,
  UpdateClientIntakeRequest,
} from '../../core/api/api.models';
import type { CheckInAssignmentListItem } from '../../core/api/generated';
import { clientCheckInDenialMessage, onboardingStatusLabel } from '../../core/i18n/display-labels';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ButtonLink, Button } from '../../ui/button';
import { StatusLabel, type StatusMarker, type StatusTone } from '../../ui/status-label';
import { ClientCommercial } from '../commercial/client-commercial';
import { ClientNutrition } from '../nutrition/client-nutrition';
import { ProgressDashboardView } from '../progress/progress-dashboard';
import { ProgressView } from '../progress/progress-view';
import { ClientTraining } from '../training/client-training';
import { ClientCoach } from './client-coach';
import { ClientIntakeForm } from './client-intake-form';
import { ClientRelease } from './client-release';
import { ClientWorkspaceContext } from './client-workspace.context';
import type { CoachClientDetails } from '../../core/api/api.models';

/**
 * The sections of a client's record other than the Overview. Training, Nutrition, Progress, the
 * intake and Service & access render the existing screens unchanged; Check-ins is a short list
 * that opens the existing review screen. Each is its own route under `/clients/:clientId`.
 */

const FORMER_HIDDEN = $localize`This is a former client. Their records are kept but are not shown here.`;

@Component({
  selector: 'app-client-training-section',
  imports: [ClientTraining],
  template: `
    @if (context.isFormer()) {
      <p class="muted">{{ formerHidden }}</p>
    } @else {
      <app-client-training [clientId]="context.clientId()" />
    }
  `,
})
export class ClientTrainingSection {
  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly formerHidden = FORMER_HIDDEN;
}

@Component({
  selector: 'app-client-nutrition-section',
  imports: [ClientNutrition],
  template: `
    @if (context.isFormer()) {
      <p class="muted">{{ formerHidden }}</p>
    } @else {
      <app-client-nutrition [clientId]="context.clientId()" />
    }
  `,
})
export class ClientNutritionSection {
  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly formerHidden = FORMER_HIDDEN;
}

@Component({
  selector: 'app-client-progress-section',
  imports: [ProgressDashboardView, ProgressView],
  template: `
    <app-progress-dashboard [clientId]="context.clientId()" />
    @if (!context.isFormer()) {
      <app-progress-view [clientId]="context.clientId()" />
    }
  `,
})
export class ClientProgressSection {
  protected readonly context = inject(ClientWorkspaceContext);
}

/**
 * Plans and payments, and for the owner the assigned coach and releasing the client. The
 * Overview's "Renew plan" arrives here with `?renew=<enrollment id>` and opens that renewal.
 */
@Component({
  selector: 'app-client-service-section',
  imports: [ClientCoach, ClientCommercial, ClientRelease],
  template: `
    @if (context.profile(); as client) {
      @if (!context.isFormer() && context.isOwner()) {
        <app-client-coach [client]="client" (profileChanged)="context.setProfile($event)" />
      }
      <app-client-commercial
        [client]="client"
        [readOnly]="context.isFormer()"
        [renewEnrollmentId]="renewEnrollmentId"
        (profileChanged)="context.setProfile($event)"
        (plansChanged)="context.setPlans($event)"
      />
      @if (!context.isFormer() && context.isOwner()) {
        <section class="surface-section release-section">
          <div class="section-heading">
            <div>
              <h2 i18n>End this client’s relationship</h2>
              <p class="muted" i18n>
                Only the owner can release a client. Their record is kept read-only.
              </p>
            </div>
          </div>
          <app-client-release [client]="client" (released)="released($event)" />
        </section>
      }
    }
  `,
})
export class ClientServiceSection {
  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly renewEnrollmentId =
    inject(ActivatedRoute).snapshot.queryParamMap.get('renew') ?? null;

  /** The owner released this client; the record turns into the read-only former-client record. */
  protected released(profile: CoachClientDetails): void {
    this.context.setProfile(profile);
    this.context.error.set(null);
    this.context.notice.set(
      $localize`${profile.firstName}:name: was released. Their access has ended and they are being emailed.`,
    );
  }
}

/** The intake form and onboarding, reached from the header's "Edit intake". */
@Component({
  selector: 'app-client-intake-section',
  imports: [ClientIntakeForm, StatusLabel],
  template: `
    @if (context.profile(); as client) {
      <!-- Disabled as a whole for a former client, so nothing can be edited or submitted. -->
      <fieldset class="record-fields" [disabled]="context.isFormer()">
        <section class="surface-section">
          <div class="section-heading">
            <div>
              <h2 i18n>Client intake</h2>
              <p class="muted" i18n>Contact, training, nutrition, and health details.</p>
            </div>
            <app-status-label
              class="tb-theme"
              [label]="onboardingStatusLabel(client.onboardingStatus)"
              [tone]="client.onboardingStatus === 'Completed' ? 'success' : 'neutral'"
              [marker]="client.onboardingStatus === 'Completed' ? 'check' : 'dot'"
            />
          </div>
          <app-client-intake-form
            [profile]="client"
            [busy]="context.busy()"
            (saveIntake)="saveIntake($event)"
            (completeOnboarding)="completeOnboarding($event)"
          />
        </section>
      </fieldset>
    }
  `,
  styles: `
    .record-fields {
      border: 0;
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }
  `,
})
export class ClientIntakeSection {
  private readonly api = inject(ApiClient);
  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly onboardingStatusLabel = onboardingStatusLabel;

  protected saveIntake(request: UpdateClientIntakeRequest): Promise<boolean> {
    return this.context.save(
      () => this.api.updateClientIntake(this.context.clientId(), request),
      $localize`Client intake saved.`,
    );
  }

  protected completeOnboarding(request: CompleteClientOnboardingRequest): Promise<boolean> {
    return this.context.save(
      () => this.api.completeClientOnboarding(this.context.clientId(), request),
      $localize`Client onboarding completed.`,
    );
  }
}

interface CheckInRow {
  item: CheckInAssignmentListItem;
  status: { label: string; tone: StatusTone; marker: StatusMarker };
  /** Opens the existing review screen on this check-in, or null while nothing was submitted. */
  canOpen: boolean;
}

/**
 * This client's check-ins, newest due first, each with its workflow state. Reading, reviewing and
 * comparing answers stay on the Client check-ins screen, which this links into.
 */
@Component({
  selector: 'app-client-checkins-section',
  imports: [Button, ButtonLink, DatePipe, RouterLink, StatusLabel],
  templateUrl: './client-checkins-section.html',
  styleUrl: './client-checkins-section.scss',
})
export class ClientCheckInsSection {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly pageSize = 50;
  protected readonly items = signal<CheckInAssignmentListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly denial = signal<string | null>(null);

  protected readonly rows = computed<CheckInRow[]>(() => {
    const today = this.context.workspace()?.currentDate ?? null;
    return this.items().map((item) => ({
      item,
      status: checkInStatus(item, today),
      canOpen: item.response !== null && item.response.status !== 'Draft',
    }));
  });

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const key =
        tenantId && clientId && !this.context.isFormer() ? `${tenantId}:${clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      this.denial.set(null);
      try {
        const list = await owner.wait(
          firstValueFrom(
            this.api.listClientCheckInAssignments(this.context.clientId(), 0, this.pageSize),
          ),
        );
        this.items.set(list.items);
        this.total.set(Number(list.total));
      } catch (error) {
        if (!owner.current) return;
        const reason = featureAccessReason(error);
        if (reason !== null) {
          this.denial.set(clientCheckInDenialMessage(reason));
        } else {
          this.error.set(
            apiErrorMessage(error, $localize`This client’s check-ins could not be loaded.`),
          );
        }
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  private reset(): void {
    this.loadedKey = null;
    this.items.set([]);
    this.total.set(0);
    this.loading.set(false);
    this.error.set(null);
    this.denial.set(null);
  }
}

/** The workflow state only; it never reads or rates an answer (CHK-012). */
export function checkInStatus(
  item: CheckInAssignmentListItem,
  today: string | null,
): { label: string; tone: StatusTone; marker: StatusMarker } {
  switch (item.response?.status) {
    case 'Submitted':
      return { label: $localize`Needs review`, tone: 'danger', marker: 'dot' };
    case 'Reviewed':
      return { label: $localize`Reviewed`, tone: 'success', marker: 'check' };
    default:
      if (today !== null && item.assignment.dueDate < today) {
        return { label: $localize`Overdue`, tone: 'warning', marker: 'dot' };
      }
      return item.response?.status === 'Draft'
        ? { label: $localize`In progress`, tone: 'neutral', marker: 'dot' }
        : { label: $localize`Not started`, tone: 'neutral', marker: 'dot' };
  }
}
