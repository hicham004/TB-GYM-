import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { CoachClientDetails } from '../../core/api/api.models';
import { onboardingStatusLabel } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { deviceToday, isoWeekdayOfName } from '../../ui/calendar';
import { StatusLabel } from '../../ui/status-label';
import { IntakeProfile } from '../intake/intake-profile';
import type { IntakeOutcome, IntakeSaver, IntakeSubject } from '../intake/intake.models';
import { ClientWorkspaceContext } from './client-workspace.context';

/**
 * A client's intake on their record (C3, R5.3b): the same answers the client sees as My profile, in
 * the same words, each group editable in a sheet unless the client has left (ADR 0027). A client who
 * has not finished setting up shows what is still needed and a Finish setting up for their starting
 * weight. Every write is this page's own workspace's: if the coach switches workspace while one is on
 * its way, the answer is dropped, never shown on another client.
 */
@Component({
  selector: 'app-client-intake',
  imports: [IntakeProfile, StatusLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (context.profile(); as client) {
      <div class="intake">
        <header class="head">
          <div class="head-text">
            <h2 i18n>Client intake</h2>
            <p class="lede">
              @if (context.isFormer()) {
                <ng-container i18n>
                  {{ client.firstName }} is a former client, so these answers can be read but not
                  changed.
                </ng-container>
              } @else {
                <ng-container i18n>
                  The answers {{ client.firstName }} gave when setting up. Correct any of them with
                  Edit.
                </ng-container>
              }
            </p>
          </div>
          <app-status-label
            [label]="onboardingStatusLabel(client.onboardingStatus)"
            [tone]="client.onboardingStatus === 'Completed' ? 'success' : 'neutral'"
            [marker]="client.onboardingStatus === 'Completed' ? 'check' : 'dot'"
          />
        </header>
        <app-intake-profile
          [profile]="client"
          [saver]="saver"
          [subject]="subject()"
          [today]="today()"
          [firstDay]="firstDay()"
          [editable]="!context.isFormer()"
        />
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .intake {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .head {
      align-items: flex-start;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      justify-content: space-between;
    }

    .head-text {
      min-inline-size: 0;
    }

    h2 {
      color: var(--tb-ink);
      font-size: 1.125rem;
      font-weight: 600;
      margin: 0;
    }

    .lede {
      color: var(--tb-muted);
      margin: 0.25rem 0 0;
      max-inline-size: 44rem;
    }
  `,
})
export class ClientIntake {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly onboardingStatusLabel = onboardingStatusLabel;

  protected readonly subject = computed<IntakeSubject>(() => ({
    kind: 'client',
    name: this.context.profile()?.firstName ?? '',
  }));
  /** The coaching space's own date and week, never the browser's. */
  protected readonly today = computed(() => this.context.workspace()?.currentDate ?? deviceToday());
  protected readonly firstDay = computed(() =>
    isoWeekdayOfName(this.context.workspace()?.weekStartsOn),
  );

  protected readonly saver: IntakeSaver = {
    save: (request) =>
      this.write(
        () => this.api.updateClientIntake(this.context.clientId(), request),
        $localize`The intake could not be saved. Try again.`,
      ),
    complete: (request) =>
      this.write(
        () => this.api.completeClientOnboarding(this.context.clientId(), request),
        $localize`Setting up could not be finished. Try again.`,
      ),
  };

  private async write(
    request: () => Observable<CoachClientDetails>,
    fallback: string,
  ): Promise<IntakeOutcome> {
    return this.scope.run<IntakeOutcome>(
      'write',
      async (owner) => {
        try {
          await owner.wait(this.csrf.refresh());
          this.context.setProfile(await owner.wait(firstValueFrom(request())));
          return { ok: true };
        } catch (error) {
          if (!owner.current) return { ok: false, message: '' };
          return { ok: false, message: apiErrorMessage(error, fallback) };
        }
      },
      { ok: false, message: '' },
    );
  }
}
