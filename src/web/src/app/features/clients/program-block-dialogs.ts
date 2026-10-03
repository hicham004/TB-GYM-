import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  LOCALE_ID,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import type { BlockCard } from './client-program.models';
import {
  CANCEL_REASON_LIMIT,
  cancelReasonErrors,
  lastDayOf,
  programWriteError,
  rescheduleErrors,
} from './client-program-forms.models';

/**
 * The three small changes a coach makes to a whole program: move it, close it, stop it. Each opens in
 * a dialog from the Actions menu, says what will happen in a sentence, and asks for nothing it does
 * not need. The server decides every one of them (coverage, overlap, who may change what), so a
 * refusal comes back as a sentence in the dialog rather than a closed dialog and a lost change.
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

  .run {
    color: var(--tb-ink);
    font-weight: 600;
  }

  .problem {
    background: var(--tb-danger-soft);
    border-radius: var(--tb-radius-control);
    color: var(--tb-danger);
    font-weight: 600;
    padding: 0.625rem 0.875rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }
`;

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-program-reschedule',
  imports: [Button, Control, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted" dir="auto" i18n>
        Every week of {{ block().name }} moves with it. Nothing has been started, so no workout
        changes date.
      </p>
      <app-field
        [label]="startLabel"
        [errors]="attempt.shows('startDate', startErrors()) ? startErrors() : null"
      >
        <input
          appControl
          type="date"
          [value]="startDate()"
          (input)="startDate.set($any($event.target).value)"
          (blur)="attempt.touch('startDate')"
        />
      </app-field>
      @if (movedRun(); as run) {
        <p class="run" aria-live="polite">{{ run }}</p>
      }
      @if (error(); as message) {
        <p class="problem" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Not now
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (busy()) {
            <ng-container i18n>Moving…</ng-container>
          } @else {
            <ng-container i18n>Reschedule</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class ProgramReschedule {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);

  readonly block = input.required<BlockCard>();
  readonly firstName = input.required<string>();
  /** True when the program was moved. */
  readonly closed = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly startLabel = $localize`New start date`;
  /** Starts on the program's own first day, and follows it if the program is reloaded. */
  protected readonly startDate = linkedSignal(() => this.block().startDate);

  protected readonly startErrors = computed(() => rescheduleErrors(this.startDate()));

  /** Where it would run, from the date typed; the server checks the dates against the plan. */
  protected readonly movedRun = computed(() => {
    const start = this.startDate();
    if (rescheduleErrors(start).length > 0) return null;
    const last = lastDayOf(start, this.block().weekCount);
    return $localize`Runs ${formatDate(start, 'EEE d MMM', this.locale)}:from: – ${formatDate(last, 'EEE d MMM', this.locale)}:to:`;
  });

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.attempt.attempt();
    if (this.startErrors().length > 0) return;
    const block = this.block();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.rescheduleMesocycle(block.id, {
          startDate: this.startDate(),
          version: block.version,
        }),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        programWriteError(error, $localize`The program could not be moved.`, this.firstName()),
      );
    } finally {
      this.busy.set(false);
    }
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-program-complete',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      @if (ready()) {
        <p dir="auto" i18n>
          Mark {{ block().name }} complete? Every session is done, and {{ firstName() }}’s workouts
          stay in their history.
        </p>
        <p class="muted" i18n>You can’t undo this.</p>
      } @else {
        <p dir="auto" i18n>
          {{ block().name }} can be marked complete once every session is finished.
          {{ remaining() }} still to go.
        </p>
      }
      @if (error(); as message) {
        <p class="problem" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Not now
        </button>
        @if (ready()) {
          <button appButton type="button" [loading]="busy()" (click)="submit()">
            @if (busy()) {
              <ng-container i18n>Marking complete…</ng-container>
            } @else {
              <ng-container i18n>Mark complete</ng-container>
            }
          </button>
        }
      </div>
    </div>
  `,
  styles: DIALOG_STYLES,
})
export class ProgramComplete {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);

  readonly block = input.required<BlockCard>();
  readonly firstName = input.required<string>();
  /** True when the program was marked complete. */
  readonly closed = output<boolean>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Whether every session is done; the server asks the same before it closes the program. */
  protected readonly ready = computed(() => this.block().doneCount === this.block().sessionCount);

  protected readonly remaining = computed(() => {
    const left = this.block().sessionCount - this.block().doneCount;
    return left === 1 ? $localize`1 session is` : $localize`${left}:count: sessions are`;
  });

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    const block = this.block();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.completeTrainingMesocycle(block.id, { version: block.version }),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        programWriteError(
          error,
          $localize`The program could not be marked complete.`,
          this.firstName(),
        ),
      );
    } finally {
      this.busy.set(false);
    }
  }
}

// ------------------------------------------------------------------------------------------------

@Component({
  selector: 'app-program-cancel',
  imports: [Button, Control, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p dir="auto" i18n>
        Cancel {{ block().name }}? {{ firstName() }} stops seeing the sessions still to come.
        Workouts already finished stay in their history.
      </p>
      <p class="muted" i18n>You can’t undo this. Assign a program again to start another.</p>
      <app-field
        [label]="reasonLabel"
        [help]="reasonHelp"
        [errors]="attempt.shows('reason', reasonErrors()) ? reasonErrors() : null"
      >
        <textarea
          appControl
          rows="3"
          [attr.maxlength]="limit"
          [value]="reason()"
          (input)="reason.set($any($event.target).value)"
          (blur)="attempt.touch('reason')"
        ></textarea>
      </app-field>
      @if (error(); as message) {
        <p class="problem" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Keep program
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (busy()) {
            <ng-container i18n>Cancelling…</ng-container>
          } @else {
            <ng-container i18n>Cancel program</ng-container>
          }
        </button>
      </div>
    </form>
  `,
  styles: DIALOG_STYLES,
})
export class ProgramCancel {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);

  readonly block = input.required<BlockCard>();
  readonly firstName = input.required<string>();
  /** True when the program was cancelled. */
  readonly closed = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly limit = CANCEL_REASON_LIMIT;
  protected readonly reasonLabel = $localize`Why are you cancelling it?`;
  protected readonly reasonHelp = $localize`Kept on the program’s record. ${CANCEL_REASON_LIMIT}:limit: characters at most.`;
  protected readonly reason = signal('');

  protected readonly reasonErrors = computed(() => cancelReasonErrors(this.reason()));

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.attempt.attempt();
    if (this.reasonErrors().length > 0) return;
    const block = this.block();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.cancelTrainingMesocycle(block.id, {
          reason: this.reason().trim(),
          version: block.version,
        }),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        programWriteError(error, $localize`The program could not be cancelled.`, this.firstName()),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
