import { Component, inject, signal } from '@angular/core';
import { ClientNutrition } from '../nutrition/client-nutrition';
import { ProgressDashboardView } from '../progress/progress-dashboard';
import { ProgressEntries } from '../progress/progress-entries';
import { ClientProgram } from './client-program';
import { ClientService } from './client-service';
import { ClientWorkspaceContext } from './client-workspace.context';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { drawnTogether } from '../../ui/drawn-together';

/**
 * The sections of a client's record other than the Overview. Training, Progress, Nutrition (R5.3d)
 * and Service & access are rebuilt (R3.3b, R3.4). Check-ins and each check-in's review (R4.3) and the
 * intake (R5.3b) have their own files. Each is its own route under `/clients/:clientId`.
 */

const FORMER_HIDDEN = $localize`This is a former client. Their records are kept but are not shown here.`;
const FORMER_STYLES = `.former { color: var(--tb-muted); margin: 0; }`;

/** A client's Training (C3): the program as a timeline, with what a coach can do about it. */
@Component({
  selector: 'app-client-training-section',
  imports: [ClientProgram],
  styles: FORMER_STYLES,
  template: `
    @if (context.isFormer()) {
      <p class="former">{{ formerHidden }}</p>
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
  styles: FORMER_STYLES,
  template: `
    @if (context.isFormer()) {
      <p class="former">{{ formerHidden }}</p>
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
  imports: [ProgressDashboardView, ProgressEntries, UiDisclosure, UiDisclosureContent],
  template: `
    <app-progress-dashboard
      [clientId]="context.clientId()"
      [clientName]="context.profile()?.firstName ?? null"
      (answered)="dashboardAnswered.set(true)"
    />
    @if (!context.isFormer()) {
      <app-disclosure
        class="entries"
        [class.entries--waiting]="!entriesDrawn()"
        variant="panel"
        label="Entries and corrections"
        i18n-label
        hint="Record a weigh-in or measurement, fix a mistake, add or remove photos."
        i18n-hint
      >
        <ng-template appDisclosureContent>
          <app-progress-entries
            [clientId]="context.clientId()"
            [clientName]="context.profile()?.firstName ?? null"
          />
        </ng-template>
      </app-disclosure>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .entries--waiting {
      display: none;
    }

    .entries {
      margin-block-start: 1rem;
    }
  `,
})
export class ClientProgressSection {
  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly dashboardAnswered = signal(false);
  /** The fold waits for the charts above it, which would push it down as they land (audit UIQ-5). */
  protected readonly entriesDrawn = drawnTogether(
    () => true,
    () => this.dashboardAnswered(),
  );
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
