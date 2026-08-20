import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import {
  ClientCommercialOverview,
  ClientEnrollment,
  CoachingFeature,
  CoachClientDetails,
  EffectiveEnrollmentStatus,
  FeatureAccessReason,
  ManualPaymentMethod,
  ProductCatalog,
} from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';

@Component({
  selector: 'app-client-commercial',
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './client-commercial.html',
  styleUrl: './client-commercial.scss',
})
export class ClientCommercial {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly tenants = inject(TenantStore);
  private loadedKey: string | null = null;

  readonly client = input.required<CoachClientDetails>();
  readonly profileChanged = output<CoachClientDetails>();

  protected readonly catalog = signal<ProductCatalog | null>(null);
  protected readonly overview = signal<ClientCommercialOverview | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly paymentEnrollmentId = signal<string | null>(null);
  protected readonly renewalEnrollmentId = signal<string | null>(null);
  protected readonly statusEnrollmentId = signal<string | null>(null);
  protected readonly statusAction = signal<'pause' | 'cancel' | null>(null);
  protected readonly relationshipFormOpen = signal(false);

  protected readonly assignForm = this.formBuilder.nonNullable.group({
    offerId: ['', Validators.required],
    startDate: [todayInput(), Validators.required],
  });

  protected readonly paymentForm = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    currencyCode: ['', [Validators.required, Validators.pattern(/^[A-Z]{3}$/)]],
    receivedAtLocal: [dateTimeLocalInput(), Validators.required],
    method: ['Cash' as ManualPaymentMethod, Validators.required],
    reference: ['', Validators.maxLength(200)],
    note: ['', Validators.maxLength(2000)],
  });

  protected readonly renewalForm = this.formBuilder.nonNullable.group({
    offerId: ['', Validators.required],
    startDate: [todayInput(), Validators.required],
  });

  protected readonly statusForm = this.formBuilder.nonNullable.group({
    reason: ['', [Validators.required, Validators.maxLength(500)]],
  });

  protected readonly relationshipForm = this.formBuilder.nonNullable.group({
    reason: ['', [Validators.required, Validators.maxLength(500)]],
  });

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.client().id;
      const key = tenantId ? `${tenantId}:${clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected activeOffers() {
    return (
      this.catalog()
        ?.products.filter((product) => product.isActive)
        .flatMap((product) =>
          product.offers.filter((offer) => offer.isActive).map((offer) => ({ product, offer })),
        ) ?? []
    );
  }

  protected async assign(): Promise<void> {
    if (this.assignForm.invalid) {
      this.assignForm.markAllAsTouched();
      return;
    }

    const request = this.assignForm.getRawValue();
    await this.run(
      () =>
        firstValueFrom(
          this.api.assignProduct(this.client().id, {
            ...request,
            idempotencyKey: crypto.randomUUID(),
          }),
        ),
      $localize`Service assigned. Access will follow payment and service dates.`,
    );
  }

  protected openPayment(enrollment: ClientEnrollment): void {
    this.paymentEnrollmentId.set(enrollment.id);
    this.renewalEnrollmentId.set(null);
    this.statusEnrollmentId.set(null);
    this.paymentForm.reset({
      amount: enrollment.balanceAmount,
      currencyCode: enrollment.priceCurrency,
      receivedAtLocal: dateTimeLocalInput(),
      method: 'Cash',
      reference: '',
      note: '',
    });
  }

  protected async recordPayment(enrollment: ClientEnrollment): Promise<void> {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }

    const raw = this.paymentForm.getRawValue();
    await this.run(
      () =>
        firstValueFrom(
          this.api.recordManualPayment(enrollment.id, {
            amount: raw.amount,
            currencyCode: raw.currencyCode.toUpperCase(),
            receivedAtUtc: new Date(raw.receivedAtLocal).toISOString(),
            method: raw.method,
            reference: raw.reference || null,
            note: raw.note || null,
            idempotencyKey: crypto.randomUUID(),
          }),
        ),
      $localize`Payment recorded in the immutable payment history.`,
    );
    this.paymentEnrollmentId.set(null);
  }

  protected openRenewal(enrollment: ClientEnrollment): void {
    this.renewalEnrollmentId.set(enrollment.id);
    this.paymentEnrollmentId.set(null);
    this.statusEnrollmentId.set(null);
    this.renewalForm.reset({
      offerId: enrollment.offerId,
      startDate: enrollment.endDateExclusive,
    });
  }

  protected async renew(enrollment: ClientEnrollment): Promise<void> {
    if (this.renewalForm.invalid) {
      this.renewalForm.markAllAsTouched();
      return;
    }

    await this.run(
      () =>
        firstValueFrom(
          this.api.renewEnrollment(enrollment.id, {
            ...this.renewalForm.getRawValue(),
            idempotencyKey: crypto.randomUUID(),
          }),
        ),
      $localize`Renewal created as a new historical enrollment.`,
    );
    this.renewalEnrollmentId.set(null);
  }

  protected openStatus(enrollment: ClientEnrollment, action: 'pause' | 'cancel'): void {
    this.statusEnrollmentId.set(enrollment.id);
    this.statusAction.set(action);
    this.paymentEnrollmentId.set(null);
    this.renewalEnrollmentId.set(null);
    this.statusForm.reset({ reason: '' });
  }

  protected async changeStatus(enrollment: ClientEnrollment): Promise<void> {
    const action = this.statusAction();
    if (!action || this.statusForm.invalid) {
      this.statusForm.markAllAsTouched();
      return;
    }

    const request = { reason: this.statusForm.getRawValue().reason, version: enrollment.version };
    await this.run(
      () =>
        firstValueFrom(
          action === 'pause'
            ? this.api.pauseEnrollment(enrollment.id, request)
            : this.api.cancelEnrollment(enrollment.id, request),
        ),
      action === 'pause' ? $localize`Enrollment paused.` : $localize`Enrollment cancelled.`,
    );
    this.statusEnrollmentId.set(null);
    this.statusAction.set(null);
  }

  protected async resume(enrollment: ClientEnrollment): Promise<void> {
    await this.run(
      () => firstValueFrom(this.api.resumeEnrollment(enrollment.id, enrollment.version)),
      $localize`Enrollment resumed.`,
    );
  }

  protected async changeRelationship(): Promise<void> {
    if (this.relationshipForm.invalid) {
      this.relationshipForm.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      const client = this.client();
      const reason = this.relationshipForm.getRawValue().reason;
      const updated = await firstValueFrom(
        client.isCoachBlocked
          ? this.api.unblockClientRelationship(client.id, reason, client.version)
          : this.api.blockClientRelationship(client.id, reason, client.version),
      );
      this.profileChanged.emit(updated);
      this.relationshipFormOpen.set(false);
      this.relationshipForm.reset({ reason: '' });
      await this.loadOverview();
      this.notice.set(
        updated.isCoachBlocked
          ? $localize`Client access blocked in this workspace only.`
          : $localize`Workspace relationship restored.`,
      );
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`The relationship status could not be changed.`),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected featureLabel(feature: CoachingFeature): string {
    const labels: Record<CoachingFeature, string> = {
      Training: $localize`Training`,
      Nutrition: $localize`Nutrition`,
      CheckIns: $localize`Check-ins`,
      Messaging: $localize`Messaging`,
      ResourceLibrary: $localize`Resources`,
    };
    return labels[feature];
  }

  protected statusLabel(status: EffectiveEnrollmentStatus): string {
    const labels: Record<EffectiveEnrollmentStatus, string> = {
      PendingPayment: $localize`Pending payment`,
      Upcoming: $localize`Upcoming`,
      Active: $localize`Active`,
      Paused: $localize`Paused`,
      Expired: $localize`Expired`,
      Cancelled: $localize`Cancelled`,
      Blocked: $localize`Blocked`,
    };
    return labels[status];
  }

  protected reasonLabel(reason: FeatureAccessReason): string {
    const labels: Record<FeatureAccessReason, string> = {
      Granted: $localize`Available now`,
      MembershipInactive: $localize`Membership inactive`,
      RelationshipBlocked: $localize`Blocked by coach`,
      NoEntitlement: $localize`Not included`,
      PaymentRequired: $localize`Payment required`,
      NotStarted: $localize`Starts later`,
      Expired: $localize`Coverage expired`,
      Paused: $localize`Enrollment paused`,
      Cancelled: $localize`Enrollment cancelled`,
      PlatformBlocked: $localize`Account blocked`,
    };
    return labels[reason];
  }

  protected statusTone(status: EffectiveEnrollmentStatus): 'success' | 'warning' | 'danger' | '' {
    if (status === 'Active') return 'success';
    if (status === 'PendingPayment' || status === 'Upcoming' || status === 'Paused')
      return 'warning';
    if (status === 'Blocked' || status === 'Cancelled') return 'danger';
    return '';
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    try {
      const [catalog, overview] = await Promise.all([
        firstValueFrom(this.api.getProductCatalog()),
        firstValueFrom(this.api.getClientCommercialOverview(this.client().id)),
      ]);
      this.catalog.set(catalog);
      this.overview.set(overview);
      const firstOffer = catalog.products
        .filter((product) => product.isActive)
        .flatMap((product) => product.offers)
        .find((offer) => offer.isActive);
      if (firstOffer && !this.assignForm.controls.offerId.value) {
        this.assignForm.controls.offerId.setValue(firstOffer.id);
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Commercial access could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadOverview(): Promise<void> {
    this.overview.set(await firstValueFrom(this.api.getClientCommercialOverview(this.client().id)));
  }

  private async run(command: () => Promise<ClientEnrollment>, message: string): Promise<void> {
    this.busy.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      await command();
      await this.loadOverview();
      this.notice.set(message);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The commercial change could not be saved.`));
    } finally {
      this.busy.set(false);
    }
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}

function todayInput(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateTimeLocalInput(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
