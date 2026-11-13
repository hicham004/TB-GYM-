import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { modalFormId } from '../../ui/modal-footer';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { HousePlansApi } from './house-plans-api';
import {
  collapseSpaces,
  houseRefusal,
  whishNameProblems,
  whishNumberProblems,
  whishNumberValue,
  WHISH_NAME_LIMIT,
  WHISH_NUMBER_LIMIT,
  type HouseAsk,
  type OpenAskCard,
} from './house-plans.models';

interface ServerErrors {
  readonly whishName: string | null;
  readonly whishNumber: string | null;
}

const NO_SERVER_ERRORS: ServerErrors = { whishName: null, whishNumber: null };

/**
 * "I've paid" (notes plan N9c2, SUB-020): the name and number of the Whish account the money came from,
 * so TB Gym can find it. Said once an ask; it books nothing, the staff book the plan once the money is
 * there. The number is checked as the server checks it, and the server's own sentence shows under a
 * field it refuses.
 */
@Component({
  selector: 'app-house-plan-paid-sheet',
  imports: [Control, EntryActions, Field, FormSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [id]="formId" class="body" novalidate (submit)="$event.preventDefault(); submit()">
      <p i18n>
        Tell TB Gym which Whish account the {{ ask().price }} came from, so they can find it.
      </p>
      <app-field [label]="nameLabel" [errors]="nameErrors()">
        <input
          appControl
          name="whishName"
          type="text"
          autocomplete="name"
          dir="auto"
          [attr.maxlength]="nameLimit"
          [value]="name()"
          (input)="setName($any($event.target).value)"
          (blur)="attempt.touch('whishName')"
        />
      </app-field>
      <app-field [label]="numberLabel" [help]="numberHelp" [errors]="numberErrors()">
        <input
          appControl
          name="whishNumber"
          type="text"
          inputmode="tel"
          autocomplete="tel"
          dir="ltr"
          spellcheck="false"
          [attr.maxlength]="numberLimit"
          [value]="number()"
          (input)="setNumber($any($event.target).value)"
          (blur)="attempt.touch('whishNumber')"
        />
      </app-field>
      <p class="muted" i18n>You can say this once for this ask.</p>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problems() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
      <app-entry-actions
        [form]="formId"
        [saveLabel]="sendLabel"
        [busyLabel]="sendingLabel"
        [busy]="busy()"
        (notNow)="notNow()"
      />
    </form>
  `,
  styles: SHEET_STYLES,
})
export class HousePlanPaidSheet {
  private readonly api = inject(HousePlansApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild.required(FormSummary);

  readonly ask = input.required<OpenAskCard>();
  /** The ask as the server keeps it now, or null when the sheet was left without saying anything. */
  readonly closed = output<HouseAsk | null>();
  /** The server's answer means the page's ask is out of date. */
  readonly stale = output<void>();
  /** Whether the word is on its way, so the sheet is not closed under it. */
  readonly busyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('house-plan-paid');
  protected readonly nameLabel = $localize`Name on your Whish account`;
  protected readonly numberLabel = $localize`Your Whish number`;
  protected readonly numberHelp = $localize`6 to 20 digits, with a + in front if you like.`;
  protected readonly sendLabel = $localize`Send`;
  protected readonly sendingLabel = $localize`Sending…`;
  protected readonly nameLimit = WHISH_NAME_LIMIT;
  protected readonly numberLimit = WHISH_NUMBER_LIMIT;

  protected readonly name = signal('');
  protected readonly number = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly server = signal<ServerErrors>(NO_SERVER_ERRORS);

  private readonly nameIssues = computed(() => whishNameProblems(this.name()));
  private readonly numberIssues = computed(() => whishNumberProblems(this.number()));
  protected readonly nameErrors = computed(() =>
    this.shown('whishName', this.nameIssues(), this.server().whishName),
  );
  protected readonly numberErrors = computed(() =>
    this.shown('whishNumber', this.numberIssues(), this.server().whishNumber),
  );
  protected readonly problems = computed(
    () =>
      this.nameIssues().length +
      this.numberIssues().length +
      (this.server().whishName ? 1 : 0) +
      (this.server().whishNumber ? 1 : 0),
  );

  protected setName(value: string): void {
    this.name.set(value);
    if (this.server().whishName) this.server.update((errors) => ({ ...errors, whishName: null }));
  }

  protected setNumber(value: string): void {
    this.number.set(value);
    if (this.server().whishNumber) {
      this.server.update((errors) => ({ ...errors, whishNumber: null }));
    }
  }

  protected notNow(): void {
    if (!this.busy()) this.closed.emit(null);
  }

  protected submit(): Promise<void> {
    if (this.busy()) return Promise.resolve();
    const number = whishNumberValue(this.number());
    if (this.nameIssues().length > 0 || number === null) {
      this.error.set(null);
      this.attempt.attempt();
      this.focusFirstProblem();
      return Promise.resolve();
    }
    const name = collapseSpaces(this.name());
    return this.scope.run('paid', async (owner) => {
      this.setBusy(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const ask = await owner.wait(
          firstValueFrom(this.api.moneySent(this.ask().id, name, number)),
        );
        this.closed.emit(ask);
      } catch (error) {
        if (!owner.current) return;
        const refusal = houseRefusal(error, $localize`Couldn’t tell TB Gym you paid. Try again.`);
        if (refusal.whishName || refusal.whishNumber) {
          this.server.set({ whishName: refusal.whishName, whishNumber: refusal.whishNumber });
          this.attempt.attempt();
          this.focusFirstProblem();
          return;
        }
        this.error.set(refusal.message);
        if (refusal.stale) this.stale.emit();
        this.summary().focus();
      } finally {
        if (owner.current) this.setBusy(false);
      }
    });
  }

  /** The form's own reason while it shows, else what the server said of the field, else nothing. */
  private shown(field: string, issues: string[], server: string | null): string[] | null {
    if (this.attempt.shows(field, issues)) return issues;
    return server ? [server] : null;
  }

  private focusFirstProblem(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      { injector: this.injector },
    );
  }

  private setBusy(busy: boolean): void {
    this.busy.set(busy);
    this.busyChange.emit(busy);
  }
}
