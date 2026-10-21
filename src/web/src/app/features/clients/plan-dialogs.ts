import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { CoachClientDetails } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { REASON_LIMIT, reasonErrors, serviceWriteError } from './client-service-forms.models';
import { shortDate, type PlanCard } from './client-service.models';

/**
 * The short changes of Service & access, each confirmed in a dialog that says what will happen and
 * asks for the one thing the server keeps on record: why. Pausing or cancelling a plan (SUB-006), and
 * blocking or unblocking the client in this coaching space only (SUB-010).
 */

const DIALOG_STYLES = `
  :host {
    display: block;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  p {
    color: var(--tb-ink);
    margin: 0;
    overflow-wrap: anywhere;
  }

  .muted {
    color: var(--tb-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }
`;

const REASON_HELP = $localize`Kept on the record. ${REASON_LIMIT}:limit: characters at most.`;

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-plan-status-change',
  imports: [Button, Control, Field, FormSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      @if (mode() === 'pause') {
        <p dir="auto">{{ pauseLine() }}</p>
        <p class="muted" i18n>Resume it at any time from Manage plan.</p>
      } @else {
        <p dir="auto">{{ cancelLine() }}</p>
        <p class="muted" i18n>
          Payments stay on record. You can’t undo this; renew or start another plan instead.
        </p>
      }
      <app-field
        [label]="reasonLabel()"
        [help]="reasonHelp"
        [errors]="attempt.shows('reason', reasonErrors()) ? reasonErrors() : null"
      >
        <textarea
          appControl
          rows="3"
          dir="auto"
          [attr.maxlength]="limit"
          [value]="reason()"
          (input)="reason.set($any($event.target).value)"
          (blur)="attempt.touch('reason')"
        ></textarea>
      </app-field>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        }
      </app-form-summary>
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Keep plan
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (busy()) {
            <ng-container i18n>Saving…</ng-container>
          } @else if (mode() === 'pause') {
            <ng-container i18n>Pause plan</ng-container>
          } @else {
            <ng-container i18n>Cancel plan</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class PlanStatusChange {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly summary = viewChild.required(FormSummary);

  readonly plan = input.required<PlanCard>();
  readonly mode = input.required<'pause' | 'cancel'>();
  readonly firstName = input.required<string>();
  /** True when the plan was paused or cancelled. */
  readonly closed = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly limit = REASON_LIMIT;
  protected readonly reasonHelp = REASON_HELP;
  protected readonly reason = signal('');
  protected readonly reasonErrors = computed(() => reasonErrors(this.reason()));

  protected readonly reasonLabel = computed(() =>
    this.mode() === 'pause'
      ? $localize`Why are you pausing it?`
      : $localize`Why are you cancelling it?`,
  );

  /** A pause does not move the last day (SUB-006): say so, or a coach expects the weeks back. */
  protected readonly pauseLine = computed(
    () =>
      $localize`Pause ${this.plan().name}:plan:? ${this.firstName()}:name: can’t use anything it includes while it is paused. It still ends on ${shortDate(this.plan().lastActiveDate, this.locale)}:date:.`,
  );

  protected readonly cancelLine = computed(
    () =>
      $localize`Cancel ${this.plan().name}:plan:? ${this.firstName()}:name: loses what it includes from today.`,
  );

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.attempt.attempt();
    if (this.reasonErrors().length > 0) {
      this.error.set(null);
      afterNextRender(() => this.host.nativeElement.querySelector('textarea')?.focus(), {
        injector: this.injector,
      });
      return;
    }
    const plan = this.plan();
    const request = { reason: this.reason().trim(), version: plan.version };
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.mode() === 'pause'
          ? this.api.pauseEnrollment(plan.id, request)
          : this.api.cancelEnrollment(plan.id, request),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        serviceWriteError(
          error,
          this.mode() === 'pause'
            ? $localize`The plan could not be paused. Try again.`
            : $localize`The plan could not be cancelled. Try again.`,
          this.firstName(),
        ),
      );
      this.summary().focus();
    } finally {
      this.busy.set(false);
    }
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-access-change',
  imports: [Button, Control, Field, FormSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      @if (blocking()) {
        <p dir="auto" i18n>
          Block {{ client().firstName }}? They can’t use anything their plans include in your
          coaching space until you unblock them.
        </p>
        <p class="muted" i18n>
          Their plans keep their dates, and nothing is deleted. Other coaching spaces aren’t
          affected.
        </p>
      } @else {
        <p dir="auto" i18n>
          Unblock {{ client().firstName }}? They get back everything their plans include.
        </p>
      }
      <app-field
        [label]="reasonLabel"
        [help]="reasonHelp"
        [errors]="attempt.shows('reason', reasonErrors()) ? reasonErrors() : null"
      >
        <textarea
          appControl
          rows="3"
          dir="auto"
          [attr.maxlength]="limit"
          [value]="reason()"
          (input)="reason.set($any($event.target).value)"
          (blur)="attempt.touch('reason')"
        ></textarea>
      </app-field>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        }
      </app-form-summary>
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(null)" i18n>
          Not now
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (busy()) {
            <ng-container i18n>Saving…</ng-container>
          } @else if (blocking()) {
            <ng-container i18n>Block access</ng-container>
          } @else {
            <ng-container i18n>Unblock</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class AccessChange {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild.required(FormSummary);

  readonly client = input.required<CoachClientDetails>();
  /** The updated client when access changed, or null when the coach closed it. */
  readonly closed = output<CoachClientDetails | null>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly limit = REASON_LIMIT;
  protected readonly reasonLabel = $localize`Reason`;
  protected readonly reasonHelp = REASON_HELP;
  protected readonly reason = signal('');
  protected readonly reasonErrors = computed(() => reasonErrors(this.reason()));
  protected readonly blocking = computed(() => !this.client().isCoachBlocked);

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.attempt.attempt();
    if (this.reasonErrors().length > 0) {
      this.error.set(null);
      afterNextRender(() => this.host.nativeElement.querySelector('textarea')?.focus(), {
        injector: this.injector,
      });
      return;
    }
    const client = this.client();
    const reason = this.reason().trim();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      const updated = await firstValueFrom(
        client.isCoachBlocked
          ? this.api.unblockClientRelationship(client.id, reason, client.version)
          : this.api.blockClientRelationship(client.id, reason, client.version),
      );
      this.closed.emit(updated);
    } catch (error) {
      this.error.set(
        serviceWriteError(
          error,
          $localize`Access could not be changed. Reload the page and try again.`,
          client.firstName,
        ),
      );
      this.summary().focus();
    } finally {
      this.busy.set(false);
    }
  }
}
