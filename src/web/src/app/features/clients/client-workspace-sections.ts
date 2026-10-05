import { Component, inject, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api-client';
import type {
  CompleteClientOnboardingRequest,
  UpdateClientIntakeRequest,
} from '../../core/api/api.models';
import { onboardingStatusLabel } from '../../core/i18n/display-labels';
import { StatusLabel } from '../../ui/status-label';
import { ClientNutrition } from '../nutrition/client-nutrition';
import { ProgressDashboardView } from '../progress/progress-dashboard';
import { ProgressView } from '../progress/progress-view';
import { ClientIntakeForm } from './client-intake-form';
import { ClientProgram } from './client-program';
import { ClientService } from './client-service';
import { ClientWorkspaceContext } from './client-workspace.context';

/**
 * The sections of a client's record other than the Overview. Training, Progress and Service & access
 * are rebuilt (R3.3b, R3.4); Nutrition and the intake render the existing screens unchanged.
 * Check-ins and each check-in's review have their own files (R4.3). Each is its own route under
 * `/clients/:clientId`.
 */

const FORMER_HIDDEN = $localize`This is a former client. Their records are kept but are not shown here.`;

/** A client's Training (C3): the program as a timeline, with what a coach can do about it. */
@Component({
  selector: 'app-client-training-section',
  imports: [ClientProgram],
  template: `
    @if (context.isFormer()) {
      <p class="muted">{{ formerHidden }}</p>
    } @else {
      <app-client-program />
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

/**
 * A client's Progress (C3): charts and a photo compare first, in coach words. Recording a weigh-in
 * or measurement for the client, correcting one, and adding or removing photos stay behind one
 * collapsed "Entries and corrections", and are only loaded once it is opened. That part is the
 * older screen, so it keeps its own light colours inside a dark page.
 */
@Component({
  selector: 'app-client-progress-section',
  imports: [ProgressDashboardView, ProgressView],
  template: `
    <app-progress-dashboard
      [clientId]="context.clientId()"
      [clientName]="context.profile()?.firstName ?? null"
    />
    @if (!context.isFormer()) {
      <details class="entries" (toggle)="entriesToggled($event)">
        <summary>
          <span class="entries-title" i18n>Entries and corrections</span>
          <span class="entries-hint" i18n
            >Record a weigh-in or measurement, fix a mistake, add or remove photos.</span
          >
        </summary>
        @if (entriesOpened()) {
          <div class="entries-body" data-mode="light">
            <app-progress-view [clientId]="context.clientId()" />
          </div>
        }
      </details>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .entries {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card);
      box-shadow: var(--tb-shadow-card);
      margin-block-start: 1rem;
      overflow: hidden;
    }

    summary {
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-block-size: 2.75rem;
      padding: 0.875rem 1.25rem;
    }

    summary:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: -3px;
    }

    .entries-title {
      color: var(--tb-ink);
      font-weight: 600;
    }

    .entries-hint {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }

    // The older entry screen only has light colours, so it keeps a light scope inside a dark page.
    .entries-body {
      background: var(--tb-surface);
      border-block-start: 1px solid var(--tb-line);
      color: var(--tb-ink);
      padding: 1rem 1.25rem 1.25rem;
    }
  `,
})
export class ClientProgressSection {
  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly entriesOpened = signal(false);

  protected entriesToggled(event: Event): void {
    if ((event.target as HTMLDetailsElement).open) this.entriesOpened.set(true);
  }
}

/**
 * Plans and payments, the coach and the client's access (C3, R3.4b). The Overview's and the header's
 * "Renew plan" arrive here with `?renew=<plan id>` and open that renewal.
 */
@Component({
  selector: 'app-client-service-section',
  imports: [ClientService],
  template: `<app-client-service />`,
})
export class ClientServiceSection {}

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
