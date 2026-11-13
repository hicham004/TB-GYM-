import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { ModalFooter, modalFormId } from '../../ui/modal-footer';
import { REASON_LIMIT, reasonErrors } from './client-service-forms.models';
import { HousePlanAsksApi } from './house-plan-asks-api';
import { askedPlan, askEnded, closingRefusal, type HousePlanAsk } from './house-plan-asks.models';

/**
 * Closing a house trainee's ask without booking it (SUB-020), with the reason the trainee reads on their plan
 * page, never who closed it. Nothing they have changes, and they may ask again.
 */
@Component({
  selector: 'app-house-plan-close',
  imports: [Button, Control, Field, FormSummary, ModalFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [id]="formId" class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="plan-line" dir="auto">{{ planLine() }}</p>
      <app-field [label]="reasonLabel" [help]="reasonHelp()" [errors]="reasonShown()">
        <textarea
          appControl
          name="reason"
          rows="3"
          dir="auto"
          [attr.maxlength]="limit"
          [value]="reason()"
          (input)="setReason($any($event.target).value)"
          (blur)="attempt.touch('reason')"
        ></textarea>
      </app-field>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (reasonShown()) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
    </form>
    <ng-template appModalFooter>
      <button appButton type="button" variant="text" [disabled]="busy()" (click)="notNow()" i18n>
        Not now
      </button>
      <button appButton type="submit" [attr.form]="formId" [loading]="busy()">
        @if (busy()) {
          <ng-container i18n>Closing…</ng-container>
        } @else {
          <ng-container i18n>Close ask</ng-container>
        }
      </button>
    </ng-template>
  `,
  styles: `
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

    .plan-line {
      font-weight: 600;
    }
  `,
})
export class HousePlanClose {
  private readonly api = inject(HousePlanAsksApi);
  private readonly csrf = inject(CsrfService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly summary = viewChild.required(FormSummary);

  readonly clientId = input.required<string>();
  readonly ask = input.required<HousePlanAsk>();
  readonly firstName = input.required<string>();
  /** True when the ask was closed. */
  readonly closed = output<boolean>();
  /** Whether the closing is on its way, so the dialog is not closed under it and its answer is kept. */
  readonly busyChange = output<boolean>();
  /** The ask was booked or closed meanwhile: the page's asks are out of date. */
  readonly stale = output<void>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('house-plan-close');
  protected readonly limit = REASON_LIMIT;
  protected readonly reasonLabel = $localize`Reason`;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly reason = signal('');
  /** The server's word on the reason, shown until it is changed. */
  private readonly refused = signal<string | null>(null);

  protected readonly planLine = computed(() => askedPlan(this.ask()));
  protected readonly reasonHelp = computed(
    () =>
      $localize`${this.firstName()}:name: reads this on their plan page. ${REASON_LIMIT}:limit: characters at most.`,
  );
  private readonly reasonErrors = computed(() => {
    const typed = reasonErrors(this.reason());
    const refused = this.refused();
    return typed.length > 0 ? typed : refused ? [refused] : [];
  });
  protected readonly reasonShown = computed(() =>
    this.attempt.shows('reason', this.reasonErrors()) ? this.reasonErrors() : null,
  );

  protected notNow(): void {
    if (!this.busy()) this.closed.emit(false);
  }

  protected setReason(value: string): void {
    this.reason.set(value);
    this.refused.set(null);
  }

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
    const ask = this.ask();
    this.setBusy(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(this.api.close(this.clientId(), ask.id, this.reason().trim()));
      if (!this.destroyRef.destroyed) this.closed.emit(true);
    } catch (error) {
      // Gone with its page (a sign-out or another space): nothing is left to say it in.
      if (this.destroyRef.destroyed) return;
      const refusal = closingRefusal(error, this.firstName());
      if (refusal.field) {
        this.refused.set(refusal.message);
      } else {
        this.error.set(refusal.message);
      }
      if (askEnded(error)) this.stale.emit();
      this.summary().focus();
    } finally {
      if (!this.destroyRef.destroyed) this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busy.set(busy);
    this.busyChange.emit(busy);
  }
}
