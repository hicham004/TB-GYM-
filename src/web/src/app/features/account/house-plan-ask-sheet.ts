import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { FormSummary } from '../../ui/form-summary';
import { modalFormId } from '../../ui/modal-footer';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { HousePlansApi } from './house-plans-api';
import { houseRefusal, type HouseAsk, type HouseAskChoice } from './house-plans.models';

/**
 * "Ask for" a plan of the house's, confirmed (notes plan N9c2, SUB-020): the option, its length and its
 * price as the house sells it, then what happens next. Asking books nothing and Free keeps running; only
 * "Ask for it" calls the API. A refusal stays here in the server's words, and one that means the page is
 * out of date asks it to read the house's plans again once this closes. While every place on Max is taken
 * (N9c5a), it says the ask waits in line and no money is sent yet.
 */
@Component({
  selector: 'app-house-plan-ask-sheet',
  imports: [EntryActions, FormSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let picked = choice().option;
    <form [id]="formId" class="body" novalidate (submit)="$event.preventDefault(); submit()">
      <!-- Words alone, the buttons being in the footer: focusable, so a keyboard can scroll the sheet
           at 200% text (axe scrollable-region-focusable). -->
      <div
        class="words"
        data-ask-words
        tabindex="0"
        role="region"
        aria-label="The plan you ask for"
        i18n-aria-label
      >
        <p class="about" data-ask-choice>
          <strong>
            @if (picked.length; as length) {
              <ng-container i18n
                ><bdi dir="auto">{{ picked.label }}</bdi> · {{ length }} ·
                {{ picked.price }}</ng-container
              >
            } @else {
              <ng-container i18n
                ><bdi dir="auto">{{ picked.label }}</bdi> · {{ picked.price }}</ng-container
              >
            }
          </strong>
        </p>
        @if (choice().waitingForPlace) {
          <!-- Every place on Max is taken (N9c5a): the ask waits in line, and no money is sent yet. -->
          <p data-ask-waits i18n>
            Every place on Max is taken right now, so your ask waits in line, in the order asked.
            Don’t send money yet: once a place opens for you, this page shows where to send it. Free
            keeps running underneath.
          </p>
        } @else {
          <p i18n>
            You pay TB Gym by Whish, then tell us here. The plan starts once TB Gym has your money,
            or when your current plan ends if that is later. Free keeps running underneath.
          </p>
        }
        <p class="muted" i18n>
          You can ask for something else once TB Gym books or closes this ask.
        </p>
      </div>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        }
      </app-form-summary>
      <app-entry-actions
        [form]="formId"
        [saveLabel]="askLabel"
        [busyLabel]="askingLabel"
        [busy]="busy()"
        (notNow)="notNow()"
      />
    </form>
  `,
  styles: [
    SHEET_STYLES,
    `
      .words {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .words:focus-visible {
        border-radius: var(--tb-radius-control);
        outline: 3px solid var(--tb-focus);
        outline-offset: 2px;
      }
    `,
  ],
})
export class HousePlanAskSheet {
  private readonly api = inject(HousePlansApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly summary = viewChild.required(FormSummary);

  readonly choice = input.required<HouseAskChoice>();
  /** The ask the server made, or null when the sheet was left without one. */
  readonly closed = output<HouseAsk | null>();
  /** The server's answer means the page's plans and asks are out of date. */
  readonly stale = output<void>();
  /** Whether the ask is on its way, so the sheet is not closed under it. */
  readonly busyChange = output<boolean>();

  protected readonly formId = modalFormId('house-plan-ask');
  protected readonly askLabel = $localize`Ask for it`;
  protected readonly askingLabel = $localize`Asking…`;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected notNow(): void {
    if (!this.busy()) this.closed.emit(null);
  }

  protected submit(): Promise<void> {
    if (this.busy()) return Promise.resolve();
    return this.scope.run('ask', async (owner) => {
      this.setBusy(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const ask = await owner.wait(firstValueFrom(this.api.ask(this.choice().option.offerId)));
        this.closed.emit(ask);
      } catch (error) {
        if (!owner.current) return;
        const refusal = houseRefusal(error, $localize`Your ask couldn’t be sent. Try again.`);
        this.error.set(refusal.message);
        if (refusal.stale) this.stale.emit();
        this.summary().focus();
      } finally {
        if (owner.current) this.setBusy(false);
      }
    });
  }

  private setBusy(busy: boolean): void {
    this.busy.set(busy);
    this.busyChange.emit(busy);
  }
}
