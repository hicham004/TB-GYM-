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
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CoachingFeature,
  CoachingProductView,
  ProductOfferView,
} from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { IntentIdempotencyKey } from '../training/training-assignment-state';
import { ProductsApi } from './products-api';
import {
  duration,
  emptyOption,
  FEATURES,
  featureChip,
  type FieldMessages,
  optionErrors,
  optionRequest,
  type OptionValues,
  planErrors,
  price,
  priceErrors,
  productWriteError,
} from './products.models';

/**
 * The sheets of Plans you sell (C8, R5.1a): a new plan with its first price option, another price
 * option, a new price, and the plan's name and description. Each asks only for what the server needs,
 * says what will happen in a sentence, and keeps a refusal on screen in coach words. A price change
 * retried with the same entry reuses its idempotency key (SUB-011).
 */
export type ProductSheetMode =
  | { readonly kind: 'new' }
  | { readonly kind: 'option'; readonly product: CoachingProductView }
  | {
      readonly kind: 'price';
      readonly product: CoachingProductView;
      readonly offer: ProductOfferView;
    }
  | { readonly kind: 'details'; readonly product: CoachingProductView };

@Component({
  selector: 'app-product-sheet',
  imports: [Button, Checkbox, Control, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      @if (mode().kind === 'new' || mode().kind === 'details') {
        <app-field [label]="nameLabel" [errors]="shows('name') ? errors()['name'] : null">
          <input
            appControl
            name="plan-name"
            autocomplete="off"
            maxlength="160"
            [value]="name()"
            (input)="name.set($any($event.target).value); dirtyChange.emit(true)"
            (blur)="attempt.touch('name')"
          />
        </app-field>
        <app-field
          [label]="descriptionLabel"
          [help]="descriptionHelp"
          [errors]="shows('description') ? errors()['description'] : null"
        >
          <textarea
            appControl
            name="plan-description"
            rows="3"
            maxlength="2000"
            [value]="description()"
            (input)="description.set($any($event.target).value); dirtyChange.emit(true)"
            (blur)="attempt.touch('description')"
          ></textarea>
        </app-field>
      }

      @if (mode().kind === 'option') {
        <p class="plan-line">
          <span class="caption" i18n>Plan</span>
          <span dir="auto">{{ productName() }}</span>
        </p>
      }

      @if (mode().kind === 'new' || mode().kind === 'option') {
        @if (mode().kind === 'new') {
          <h3 class="group-title" i18n>First price option</h3>
        }
        <div class="pair">
          <app-field [label]="weeksLabel" [errors]="shows('weeks') ? errors()['weeks'] : null">
            <input
              appControl
              name="weeks"
              autocomplete="off"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              [value]="option().weeks ?? ''"
              (input)="setOption({ weeks: number($any($event.target).valueAsNumber) })"
              (blur)="attempt.touch('weeks')"
            />
          </app-field>
          <app-field [label]="priceLabel" [errors]="shows('price') ? errors()['price'] : null">
            <div class="value-unit">
              <input
                appControl
                name="price"
                autocomplete="off"
                type="number"
                inputmode="decimal"
                min="0"
                step="0.01"
                [value]="option().price ?? ''"
                (input)="setOption({ price: number($any($event.target).valueAsNumber) })"
                (blur)="attempt.touch('price')"
              />
              <input
                appControl
                class="currency"
                name="currency"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                maxlength="3"
                [attr.aria-label]="currencyLabel"
                [value]="option().currency"
                (input)="setOption({ currency: $any($event.target).value })"
                (blur)="attempt.touch('currency')"
              />
            </div>
          </app-field>
        </div>
        @if (shows('currency')) {
          <p class="warn-text">{{ errors()['currency'][0] }}</p>
        }
        <app-field
          [label]="optionNameLabel"
          [help]="optionNameHelp()"
          [errors]="shows('label') ? errors()['label'] : null"
        >
          <input
            appControl
            name="option-name"
            autocomplete="off"
            maxlength="120"
            [value]="option().label"
            (input)="setOption({ label: $any($event.target).value })"
            (blur)="attempt.touch('label')"
          />
        </app-field>
        <fieldset
          class="features"
          [attr.aria-describedby]="shows('features') ? 'plan-features-error' : null"
        >
          <legend i18n>What's included</legend>
          @for (chip of featureChips; track chip.feature) {
            <app-checkbox [label]="chip.label">
              <input
                appControl
                type="checkbox"
                [checked]="option().features.includes(chip.feature)"
                (change)="toggleFeature(chip.feature, $any($event.target).checked)"
              />
            </app-checkbox>
          }
        </fieldset>
        @if (shows('features')) {
          <p id="plan-features-error" class="warn-text">{{ errors()['features'][0] }}</p>
        }
        @if (sellLine(); as text) {
          <p class="muted" dir="auto" aria-live="polite">{{ text }}</p>
        }
      }

      @if (mode().kind === 'price') {
        <p class="plan-line">
          <span class="caption" i18n>Price option</span>
          <span dir="auto">{{ optionLine() }}</span>
        </p>
        <app-field [label]="newPriceLabel" [errors]="shows('price') ? priceProblems() : null">
          <div class="value-unit">
            <input
              appControl
              name="new-price"
              autocomplete="off"
              type="number"
              inputmode="decimal"
              min="0"
              step="0.01"
              [value]="newPrice() ?? ''"
              (input)="
                newPrice.set(number($any($event.target).valueAsNumber)); dirtyChange.emit(true)
              "
              (blur)="attempt.touch('price')"
            />
            <span class="unit">{{ currentCurrency() }}</span>
          </div>
        </app-field>
        <p class="muted" i18n>
          New plans use the new price. Clients already on this option keep their price, dates and
          payments.
        </p>
      }

      @if (attempt.wasTried() && problemCount() > 0) {
        <p class="problem-text" role="alert" i18n>Check the fields marked above.</p>
      }
      @if (error(); as message) {
        <p class="problem-text" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(null)" i18n>
          Not now
        </button>
        <button appButton type="submit" [loading]="busy()">
          @if (busy()) {
            <ng-container i18n>Saving…</ng-container>
          } @else {
            @switch (mode().kind) {
              @case ('new') {
                <app-icon name="plus" />
                <ng-container i18n>Create plan</ng-container>
              }
              @case ('option') {
                <ng-container i18n>Add price option</ng-container>
              }
              @case ('price') {
                <ng-container i18n>Change price</ng-container>
              }
              @default {
                <ng-container i18n>Save</ng-container>
              }
            }
          }
        </button>
      </div>
    </form>
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

    .muted {
      color: var(--tb-muted);
    }

    .group-title {
      color: var(--tb-ink);
      font-size: 1rem;
      font-weight: 600;
      margin: 0.25rem 0 -0.25rem;
    }

    .plan-line {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .caption {
      color: var(--tb-muted);
      font-size: 0.8125rem;
      font-weight: 600;
    }

    .pair {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    }

    .value-unit {
      align-items: center;
      display: grid;
      gap: 0.5rem;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .currency {
      inline-size: 4.5rem;
      text-transform: uppercase;
    }

    .unit {
      color: var(--tb-muted);
      font-weight: 600;
    }

    .features {
      border: 0;
      display: grid;
      gap: 0.25rem 1rem;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr));
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    .features legend {
      color: var(--tb-ink);
      font-weight: 600;
      margin-block-end: 0.5rem;
      padding: 0;
    }

    .warn-text {
      color: var(--tb-warning);
      font-size: 0.875rem;
      margin-block-start: -0.5rem;
    }

    .problem-text {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-control);
      color: var(--tb-danger);
      font-weight: 600;
      padding: 0.625rem 0.875rem;
    }

    // Kept above the keyboard and the end of a long form, as on Service & access; a focused field
    // scrolls clear of it.
    .actions {
      background: var(--tb-surface);
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      inset-block-end: -1.5rem;
      justify-content: flex-end;
      margin-block-end: -1.5rem;
      margin-inline: -1.5rem;
      padding: 0.75rem 1.5rem;
      position: sticky;
    }

    input,
    textarea {
      scroll-margin-block-end: 5rem;
    }
  `,
})
export class ProductSheet {
  private readonly api = inject(ProductsApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly priceIntent = new IntentIdempotencyKey();

  readonly mode = input.required<ProductSheetMode>();
  /** The workspace's currency, for a new plan's first option. */
  readonly currency = input.required<string>();
  /** The saved plan, or null when the coach closed the sheet without saving. */
  readonly closed = output<CoachingProductView | null>();
  /** Whether anything was typed, so closing can ask first. */
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly featureChips = FEATURES.map(featureChip);

  protected readonly nameLabel = $localize`Plan name`;
  protected readonly descriptionLabel = $localize`What clients get (optional)`;
  protected readonly descriptionHelp = $localize`One or two sentences, as you would say it to a new client.`;
  protected readonly weeksLabel = $localize`Length in weeks`;
  protected readonly priceLabel = $localize`Price`;
  protected readonly currencyLabel = $localize`Currency`;
  protected readonly optionNameLabel = $localize`Option name (optional)`;
  protected readonly newPriceLabel = $localize`New price`;

  private readonly product = computed(() => {
    const mode = this.mode();
    return mode.kind === 'new' ? null : mode.product;
  });
  protected readonly productName = computed(() => this.product()?.name ?? '');

  protected readonly name = linkedSignal(() => this.product()?.name ?? '');
  protected readonly description = linkedSignal(() => this.product()?.description ?? '');
  protected readonly option = linkedSignal<OptionValues>(() => emptyOption(this.currency()));
  protected readonly newPrice = linkedSignal<number | null>(() => {
    const mode = this.mode();
    return mode.kind === 'price' ? Number(mode.offer.priceAmount) : null;
  });

  protected readonly currentCurrency = computed(() => {
    const mode = this.mode();
    return mode.kind === 'price' ? mode.offer.priceCurrency : '';
  });
  protected readonly optionLine = computed(() => {
    const mode = this.mode();
    return mode.kind === 'price'
      ? $localize`${mode.product.name}:plan: · ${duration(mode.offer)}:length:, now ${price(mode.offer.priceAmount, mode.offer.priceCurrency, this.locale)}:price:`
      : '';
  });
  protected readonly optionNameHelp = computed(() => {
    const weeks = this.option().weeks;
    const length =
      weeks && weeks > 0 ? duration({ durationCount: weeks, durationUnit: 'Week' }) : '';
    return length
      ? $localize`Left empty, clients see “${length}:length:”.`
      : $localize`Left empty, clients see its length.`;
  });

  protected readonly priceProblems = computed(() => {
    const mode = this.mode();
    return mode.kind === 'price' ? priceErrors(this.newPrice(), mode.offer.priceAmount) : [];
  });
  protected readonly errors = computed<FieldMessages>(() => {
    const kind = this.mode().kind;
    const errors: FieldMessages = {};
    if (kind === 'new' || kind === 'details') {
      Object.assign(errors, planErrors(this.name(), this.description()));
    }
    if (kind === 'new' || kind === 'option') Object.assign(errors, optionErrors(this.option()));
    if (kind === 'price' && this.priceProblems().length > 0) errors['price'] = this.priceProblems();
    return errors;
  });
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);

  /** What a client would be sold, in one line. */
  protected readonly sellLine = computed(() => {
    const values = this.option();
    if (Object.keys(optionErrors(values)).length > 0) return null;
    const amount = price(values.price ?? 0, values.currency.trim().toUpperCase(), this.locale);
    const length = duration({ durationCount: values.weeks ?? 0, durationUnit: 'Week' });
    return values.price === 0
      ? $localize`Clients get ${length}:length: for free, from the day you start their plan.`
      : $localize`Clients pay ${amount}:price: for ${length}:length:. You record each payment on their profile.`;
  });

  protected number(value: number): number | null {
    return Number.isFinite(value) ? value : null;
  }

  protected setOption(change: Partial<OptionValues>): void {
    this.option.update((values) => ({ ...values, ...change }));
    this.dirtyChange.emit(true);
  }

  protected toggleFeature(feature: CoachingFeature, on: boolean): void {
    const features = this.option().features.filter((item) => item !== feature);
    this.setOption({ features: on ? [...features, feature] : features });
    this.attempt.touch('features');
  }

  protected shows(field: string): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      this.attempt.attempt();
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-describedby] input')
            ?.focus(),
        { injector: this.injector },
      );
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      const saved = await firstValueFrom(this.request());
      this.priceIntent.complete();
      this.closed.emit(saved);
    } catch (error) {
      this.error.set(productWriteError(error));
    } finally {
      this.busy.set(false);
    }
  }

  private request() {
    const mode = this.mode();
    switch (mode.kind) {
      case 'new':
        return this.api.createProduct({
          name: this.name().trim(),
          description: this.description().trim() || null,
          initialOffer: optionRequest(this.option()),
        });
      case 'option':
        return this.api.addOffer(mode.product.id, optionRequest(this.option()));
      case 'details':
        return this.api.updateProduct(mode.product.id, {
          name: this.name().trim(),
          description: this.description().trim() || null,
          isActive: mode.product.isActive,
          version: mode.product.version,
        });
      case 'price': {
        const payload = {
          offerId: mode.offer.id,
          priceAmount: this.newPrice() ?? 0,
          version: Number(mode.offer.version),
        };
        return this.api.changePrice(mode.offer.id, {
          priceAmount: payload.priceAmount,
          version: payload.version,
          idempotencyKey: this.priceIntent.forPayload(payload),
        });
      }
    }
  }
}
