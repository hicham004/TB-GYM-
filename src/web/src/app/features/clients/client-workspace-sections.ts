import { Component, inject, signal } from '@angular/core';
import { ClientNutrition } from '../nutrition/client-nutrition';
import { ProgressDashboardView } from '../progress/progress-dashboard';
import { ProgressEntries } from '../progress/progress-entries';
import { ClientProgram } from './client-program';
import { ClientService } from './client-service';
import { ClientWorkspaceContext } from './client-workspace.context';

/**
 * The sections of a client's record other than the Overview. Training, Progress, Nutrition (R5.3d)
 * and Service & access are rebuilt (R3.3b, R3.4). Check-ins and each check-in's review (R4.3) and the
 * intake (R5.3b) have their own files. Each is its own route under `/clients/:clientId`.
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
      <app-client-nutrition />
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
 * collapsed "Entries and corrections", and are only loaded once it is opened (R5.3c: the same weight,
 * measurement and photo tabs and sheets the client uses on their own page).
 */
@Component({
  selector: 'app-client-progress-section',
  imports: [ProgressDashboardView, ProgressEntries],
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
          <div class="entries-body">
            <app-progress-entries
              [clientId]="context.clientId()"
              [clientName]="context.profile()?.firstName ?? null"
            />
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
