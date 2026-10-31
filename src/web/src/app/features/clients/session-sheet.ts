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
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ClientEnrollment, ManualPaymentMethod } from '../../core/api/api.models';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { isoWeekdayOfName } from '../../ui/calendar';
import { DateField } from '../../ui/date-field';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { ModalFooter, modalFormId } from '../../ui/modal-footer';
import { type SegmentOption, SegmentedControl } from '../../ui/segmented-control';
import { selectOptions, type SelectOption, UiSelect } from '../../ui/select';
import { IntentIdempotencyKey } from '../training/training-assignment-state';
import {
  chargeReason,
  serviceWriteError,
  sessionErrors,
  sessionRequest,
  type SessionKind,
} from './client-service-forms.models';
import { paymentMethodLabel, sessionTarget } from './client-service.models';
import { ClientWorkspaceContext } from './client-workspace.context';

const METHODS: readonly ManualPaymentMethod[] = [
  'Cash',
  'BankTransfer',
  'MobileWallet',
  'Card',
  'Other',
];

/**
 * Record a session (critique B10b): what happened, the day and a note or the reason a charge carries,
 * with the money in the same sheet when the pack still waits for it. It says which pack the session
 * goes on; the server chooses again and refuses in words (SES-004, SES-005). The gym owner also says
 * who held a session (critique B12); a coach's are their own, so they have no box, and a charge is no
 * session held. A retry of the same entry reuses its idempotency key, so a double tap records one
 * session (SUB-011).
 */
@Component({
  selector: 'app-session-sheet',
  imports: [
    Button,
    Control,
    DateField,
    Field,
    FormSummary,
    ModalFooter,
    SegmentedControl,
    UiSelect,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [id]="formId" class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <app-segmented-control
        [label]="kindLabel"
        [options]="kinds"
        [selected]="kind()"
        (selectedChange)="setKind($event)"
      />

      <app-date-field
        [label]="dayLabel"
        [errors]="shows('day') ? errors()['day'] : null"
        [today]="today()"
        [firstDay]="firstDay()"
        [max]="today()"
        [value]="day()"
        (valueChange)="day.set($event); dirtyChange.emit(true)"
        (touched)="attempt.touch('day')"
      />

      @if (kind() === 'Held' && holders().length > 0) {
        <app-select
          [label]="holderLabel"
          [options]="holders()"
          [value]="holder()"
          (valueChange)="holder.set($any($event)); dirtyChange.emit(true)"
        />
      }

      <!-- In the page from the start, so a change of day is announced, its going too. -->
      <p class="target" dir="auto" aria-live="polite">{{ target()?.line }}</p>
      @if (target()?.receipt) {
        <app-select
          [label]="methodLabel"
          [options]="methods"
          [value]="method()"
          (valueChange)="method.set($any($event)); dirtyChange.emit(true)"
        />
      }

      @if (kind() === 'Held') {
        <app-field
          [label]="noteLabel"
          [help]="noteHelp"
          [errors]="shows('note') ? errors()['note'] : null"
        >
          <textarea
            appControl
            name="session-note"
            autocomplete="off"
            rows="2"
            maxlength="500"
            dir="auto"
            [value]="note()"
            (input)="note.set($any($event.target).value); dirtyChange.emit(true)"
            (blur)="attempt.touch('note')"
          ></textarea>
        </app-field>
      } @else {
        <app-field
          [label]="reasonLabel"
          [help]="reasonHelp()"
          [errors]="shows('reason') ? errors()['reason'] : null"
        >
          <textarea
            appControl
            name="session-reason"
            autocomplete="off"
            rows="2"
            maxlength="500"
            dir="auto"
            [value]="reason()"
            (input)="reason.set($any($event.target).value); dirtyChange.emit(true)"
            (blur)="attempt.touch('reason')"
          ></textarea>
        </app-field>
      }

      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problemCount() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
    </form>
    <ng-template appModalFooter>
      <button appButton type="button" variant="text" (click)="closed.emit(null)" i18n>
        Not now
      </button>
      <button appButton type="submit" [attr.form]="formId" [loading]="busy()">
        @if (busy()) {
          <ng-container i18n>Saving…</ng-container>
        } @else if (target()?.receipt) {
          <ng-container i18n>Record session and payment</ng-container>
        } @else {
          <ng-container i18n>Record session</ng-container>
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

    .target {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      color: var(--tb-ink);
      margin: 0;
      overflow-wrap: anywhere;
      padding: 0.75rem 0.875rem;
    }

    // Empty, it is still a live region, but takes no room in the form's gap.
    .target:empty {
      block-size: 1px;
      clip-path: inset(50%);
      inline-size: 1px;
      overflow: hidden;
      padding: 0;
      position: absolute;
      white-space: nowrap;
    }
  `,
})
export class SessionSheet {
  private readonly record = inject(ClientWorkspaceContext, { optional: true });
  /** The workspace's week start, as the record's other calendars have it; the locale's without one. */
  protected readonly firstDay = computed(() =>
    isoWeekdayOfName(this.record?.workspace()?.weekStartsOn),
  );
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly locale = inject(LOCALE_ID);
  private readonly intent = new IntentIdempotencyKey();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild.required(FormSummary);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  readonly today = input.required<string>();
  readonly plans = input.required<readonly ClientEnrollment[]>();
  /** Who the owner can say held it, the client's coach first; none for a coach, or anyone alone. */
  readonly holders = input<readonly SelectOption[]>([]);
  /** The pack the session went on, or null when the coach closed the sheet without one. */
  readonly closed = output<ClientEnrollment | null>();
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('session');
  protected readonly kindLabel = $localize`What happened`;
  protected readonly kinds: readonly SegmentOption[] = [
    { value: 'Held', label: $localize`Held` },
    { value: 'NoShow', label: $localize`No-show` },
    { value: 'LateCancel', label: $localize`Late cancel` },
  ];
  protected readonly dayLabel = $localize`Day of the session`;
  protected readonly holderLabel = $localize`Who held it`;
  protected readonly methodLabel = $localize`How it was paid`;
  protected readonly methods = selectOptions(METHODS, paymentMethodLabel);
  protected readonly noteLabel = $localize`Note (optional)`;
  protected readonly noteHelp = $localize`Only your team sees it.`;
  protected readonly reasonLabel = $localize`Reason`;
  protected readonly reasonHelp = computed(
    () => $localize`${this.firstName()}:name: reads this. The session comes off their pack.`,
  );

  protected readonly kind = signal<SessionKind>('Held');
  protected readonly day = linkedSignal(() => this.today());
  protected readonly holder = linkedSignal(() => this.holders()[0]?.value ?? '');
  protected readonly note = signal('');
  protected readonly reason = signal('');
  protected readonly method = signal<ManualPaymentMethod>('Cash');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly target = computed(() =>
    this.day() ? sessionTarget(this.plans(), this.day(), this.locale) : null,
  );
  private readonly values = computed(() => ({
    kind: this.kind(),
    day: this.day(),
    heldBy: this.holder() || null,
    note: this.note(),
    reason: this.reason(),
  }));
  protected readonly errors = computed(() =>
    sessionErrors(this.values(), this.today(), this.firstName()),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  protected setKind(value: string): void {
    const kind = value as SessionKind;
    // The reason follows the choice until the coach has made it their own.
    if (this.reason() === chargeReason(this.kind())) this.reason.set(chargeReason(kind));
    this.kind.set(kind);
    this.dirtyChange.emit(true);
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    return this.scope.run('submit', async (owner) => {
      if (this.problemCount() > 0) {
        this.error.set(null);
        this.attempt.attempt();
        afterNextRender(
          () =>
            this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
          { injector: this.injector },
        );
        return;
      }
      const target = this.target();
      const entry = sessionRequest(this.values(), target, this.method(), '');
      const key = this.intent.forPayload({ ...entry, client: this.clientId() });
      this.busy.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const pack = await owner.wait(
          firstValueFrom(
            this.api.recordSession(this.clientId(), { ...entry, idempotencyKey: key }),
          ),
        );
        this.intent.complete();
        this.closed.emit(pack);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          serviceWriteError(
            error,
            $localize`The session could not be recorded. Try again.`,
            this.firstName(),
          ),
        );
        this.summary().focus();
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }
}
