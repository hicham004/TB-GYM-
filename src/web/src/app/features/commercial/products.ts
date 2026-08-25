import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import {
  CoachingFeature,
  CoachingProduct,
  CreateProductOfferRequest,
  ProductCatalog,
} from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';

@Component({
  selector: 'app-products',
  imports: [ReactiveFormsModule],
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class Products {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly tenants = inject(TenantStore);
  private loadedTenantId: string | null = null;

  protected readonly catalog = signal<ProductCatalog | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly createOpen = signal(false);
  protected readonly offerProductId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly features: CoachingFeature[] = [
    'Training',
    'Nutrition',
    'CheckIns',
    'Messaging',
    'ResourceLibrary',
  ];

  protected readonly createForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(160)]],
    description: ['', Validators.maxLength(2000)],
    offerLabel: ['', [Validators.required, Validators.maxLength(120)]],
    durationCount: [8, [Validators.required, Validators.min(1), Validators.max(3650)]],
    durationUnit: ['Week' as const, Validators.required],
    priceAmount: [0, [Validators.required, Validators.min(0)]],
    // Either case: `toOfferRequest` uppercases before sending, so an uppercase-only pattern only
    // dead-ended the form.
    currencyCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    training: [true],
    nutrition: [false],
    checkIns: [true],
    messaging: [false],
    resourceLibrary: [false],
  });

  protected readonly offerForm = this.formBuilder.nonNullable.group({
    offerLabel: ['', [Validators.required, Validators.maxLength(120)]],
    durationCount: [8, [Validators.required, Validators.min(1), Validators.max(3650)]],
    durationUnit: ['Week' as const, Validators.required],
    priceAmount: [0, [Validators.required, Validators.min(0)]],
    // Either case: `toOfferRequest` uppercases before sending, so an uppercase-only pattern only
    // dead-ended the form.
    currencyCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    training: [true],
    nutrition: [false],
    checkIns: [true],
    messaging: [false],
    resourceLibrary: [false],
  });

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  protected async createProduct(): Promise<void> {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    const raw = this.createForm.getRawValue();
    const offer = this.toOfferRequest(raw);
    if (offer.features.length === 0) {
      this.error.set($localize`Select at least one coaching feature.`);
      return;
    }

    await this.run(
      async () => {
        await firstValueFrom(
          this.api.createCoachingProduct({
            name: raw.name,
            description: raw.description || null,
            initialOffer: offer,
          }),
        );
        this.createForm.reset({
          name: '',
          description: '',
          offerLabel: '',
          durationCount: 8,
          durationUnit: 'Week',
          priceAmount: 0,
          currencyCode: this.catalog()?.workspaceCurrencyCode ?? '',
          training: true,
          nutrition: false,
          checkIns: true,
          messaging: false,
          resourceLibrary: false,
        });
        this.createOpen.set(false);
      },
      $localize`Coaching product created.`,
    );
  }

  protected openOffer(product: CoachingProduct): void {
    this.offerProductId.set(product.id);
    this.offerForm.reset({
      offerLabel: '',
      durationCount: 8,
      durationUnit: 'Week',
      priceAmount: 0,
      currencyCode: this.catalog()?.workspaceCurrencyCode ?? '',
      training: true,
      nutrition: false,
      checkIns: true,
      messaging: false,
      resourceLibrary: false,
    });
  }

  protected async addOffer(): Promise<void> {
    const productId = this.offerProductId();
    if (!productId || this.offerForm.invalid) {
      this.offerForm.markAllAsTouched();
      return;
    }

    const offer = this.toOfferRequest(this.offerForm.getRawValue());
    if (offer.features.length === 0) {
      this.error.set($localize`Select at least one coaching feature.`);
      return;
    }

    await this.run(
      async () => {
        await firstValueFrom(this.api.addProductOffer(productId, offer));
        this.offerProductId.set(null);
      },
      $localize`New offer added. Existing enrollments were left unchanged.`,
    );
  }

  protected async toggleProduct(product: CoachingProduct): Promise<void> {
    await this.run(
      async () => {
        await firstValueFrom(
          this.api.updateCoachingProduct(product.id, {
            name: product.name,
            description: product.description,
            isActive: !product.isActive,
            version: product.version,
          }),
        );
      },
      product.isActive ? $localize`Product archived.` : $localize`Product restored.`,
    );
  }

  protected async toggleOffer(product: CoachingProduct, offerId: string): Promise<void> {
    const offer = product.offers.find((item) => item.id === offerId);
    if (!offer) {
      return;
    }

    await this.run(
      async () => {
        await firstValueFrom(
          this.api.setOfferAvailability(offer.id, !offer.isActive, offer.version),
        );
      },
      offer.isActive ? $localize`Offer retired.` : $localize`Offer restored.`,
    );
  }

  protected featureLabel(feature: CoachingFeature): string {
    const labels: Record<CoachingFeature, string> = {
      Training: $localize`Training`,
      Nutrition: $localize`Nutrition`,
      CheckIns: $localize`Check-ins`,
      Messaging: $localize`Messaging`,
      ResourceLibrary: $localize`Resource library`,
    };
    return labels[feature];
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    try {
      const catalog = await firstValueFrom(this.api.getProductCatalog());
      this.catalog.set(catalog);
      this.createForm.controls.currencyCode.setValue(catalog.workspaceCurrencyCode);
      if (catalog.products.length === 0) {
        this.createOpen.set(true);
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Coaching products could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The confirmation is set after the reload, not by the command. `load` clears messages, so a
   * notice set inside `command` was wiped by the refresh that followed it in the same turn and no
   * success confirmation ever reached the screen.
   */
  private async run(command: () => Promise<void>, message: string): Promise<void> {
    this.busy.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      await command();
      await this.load();
      this.notice.set(message);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The commercial change could not be saved.`));
    } finally {
      this.busy.set(false);
    }
  }

  private toOfferRequest(raw: {
    offerLabel: string;
    durationCount: number;
    durationUnit: 'Week';
    priceAmount: number;
    currencyCode: string;
    training: boolean;
    nutrition: boolean;
    checkIns: boolean;
    messaging: boolean;
    resourceLibrary: boolean;
  }): CreateProductOfferRequest {
    const selected: [CoachingFeature, boolean][] = [
      ['Training', raw.training],
      ['Nutrition', raw.nutrition],
      ['CheckIns', raw.checkIns],
      ['Messaging', raw.messaging],
      ['ResourceLibrary', raw.resourceLibrary],
    ];
    return {
      label: raw.offerLabel,
      durationCount: raw.durationCount,
      durationUnit: raw.durationUnit,
      priceAmount: raw.priceAmount,
      priceCurrency: raw.currencyCode.toUpperCase(),
      features: selected
        .filter(([, enabled]) => enabled)
        .map(([feature]) => ({ feature, allowsConcurrentCoverage: false })),
    };
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}
