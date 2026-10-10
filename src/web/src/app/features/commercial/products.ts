import type { DialogRef } from '@angular/cdk/dialog';
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CoachingProductView,
  ProductCatalog,
  ProductOfferView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { UiMenu } from '../../ui/menu';
import type { ModalSurface } from '../../ui/modal-surface';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { ProductSheet, type ProductSheetMode } from './product-sheets';
import { ProductsApi } from './products-api';
import {
  catalogSummary,
  duration,
  type OptionRow,
  type PlanCard,
  planCards,
  productWriteError,
} from './products.models';

/**
 * Plans you sell (C8, R5.1a): each plan a card with its price options, what each includes and how
 * many of the coach's clients are on it (SUB-015). The first thing on the page is New plan (plan §2
 * rule 1); everything else sits in a card's menu or a sheet. Stopping a sale has Undo, and clients
 * already on a plan keep it (SUB-002).
 */
@Component({
  selector: 'app-products',
  imports: [Button, EmptyState, Icon, NgTemplateOutlet, ProductSheet, Skeleton, UiConfirm, UiMenu],
  templateUrl: './products.html',
  styleUrl: './products.scss',
})
export class Products {
  private readonly api = inject(ProductsApi);
  private readonly csrf = inject(CsrfService);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly sheetTemplate = viewChild.required<TemplateRef<unknown>>('productSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenantId: string | null = null;
  private openSheet: DialogRef<unknown, ModalSurface> | null = null;

  protected readonly closeLabel = $localize`Close`;
  protected readonly loadingLabel = $localize`Loading your plans…`;
  protected readonly catalog = signal<ProductCatalog | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  /** The plan or option a write is changing, so its menu waits. */
  protected readonly working = signal<string | null>(null);
  protected readonly sheetMode = signal<ProductSheetMode | null>(null);
  private readonly sheetDirty = signal(false);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );

  protected readonly cards = computed(() => planCards(this.catalog(), this.locale));
  protected readonly summary = computed(() => catalogSummary(this.catalog()));
  protected readonly currency = computed(() => this.catalog()?.workspaceCurrencyCode ?? 'USD');

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.openSheet?.close();
      this.catalog.set(null);
      this.state.set('loading');
      this.working.set(null);
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      if (!this.catalog()) this.state.set('loading');
      try {
        this.catalog.set(await owner.wait(firstValueFrom(this.api.getCatalog())));
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        // A reload after a write keeps the cards on screen; only a first load shows the failure.
        if (!this.catalog()) this.state.set('error');
      }
    });
  }

  // ---------- sheets ----------

  protected newPlan(): void {
    this.open({ kind: 'new' }, $localize`New plan`);
  }

  protected addOption(card: PlanCard): void {
    this.open({ kind: 'option', product: card.product }, $localize`New price option`);
  }

  protected planChosen(card: PlanCard, action: string): void {
    switch (action) {
      case 'edit':
        this.open({ kind: 'details', product: card.product }, $localize`Edit ${card.name}:plan:`);
        return;
      case 'archive':
        void this.setPlanSold(card.product, false);
        return;
      case 'restore':
        void this.setPlanSold(card.product, true);
        return;
    }
  }

  protected optionChosen(card: PlanCard, row: OptionRow, action: string): void {
    switch (action) {
      case 'price':
        this.open(
          { kind: 'price', product: card.product, offer: row.offer },
          $localize`Change price`,
        );
        return;
      case 'retire':
        void this.setOptionSold(card, row.offer, false);
        return;
      case 'restore':
        void this.setOptionSold(card, row.offer, true);
        return;
    }
  }

  private open(mode: ProductSheetMode, title: string): void {
    this.openSheet?.close();
    this.sheetMode.set(mode);
    this.sheetDirty.set(false);
    const sheet = this.sheets.open(this.sheetTemplate(), {
      title,
      closeLabel: this.closeLabel,
      canClose: () => this.mayDiscard(),
    });
    this.openSheet = sheet;
    sheet.closed.subscribe(() => {
      if (this.openSheet === sheet) this.openSheet = null;
      this.sheetMode.set(null);
      this.sheetDirty.set(false);
    });
  }

  protected sheetChanged(dirty: boolean): void {
    this.sheetDirty.set(dirty);
  }

  /** The sheet saved (a plan) or the coach chose Not now (null). */
  protected async sheetClosed(saved: CoachingProductView | null): Promise<void> {
    const mode = this.sheetMode();
    if (!saved) {
      if (await this.mayDiscard()) this.openSheet?.close();
      return;
    }
    this.openSheet?.close();
    await this.load();
    if (mode) this.toast.show(savedMessage(mode, saved), { tone: 'success' });
  }

  /** True when nothing typed would be lost, or the coach chose to lose it. */
  private async mayDiscard(): Promise<boolean> {
    if (!this.sheetDirty()) return true;
    this.asking.set({
      message: $localize`What you typed isn’t saved. If you close it now, it is lost.`,
      confirm: $localize`Close without saving`,
      cancel: $localize`Keep editing`,
    });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title: $localize`Close without saving?`,
      closeLabel: this.closeLabel,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  // ---------- selling and stopping, with Undo ----------

  private async setPlanSold(product: CoachingProductView, sold: boolean): Promise<void> {
    const saved = await this.write(product.id, () =>
      this.api.updateProduct(product.id, {
        name: product.name,
        description: product.description,
        isActive: sold,
        version: product.version,
      }),
    );
    if (!saved) return;
    this.toast.show(
      sold
        ? $localize`${product.name}:plan: is for sale again.`
        : $localize`You no longer sell ${product.name}:plan:. Clients already on it keep their plan.`,
      {
        tone: 'success',
        action: sold
          ? undefined
          : { label: $localize`Undo`, run: () => void this.setPlanSold(saved, true) },
      },
    );
  }

  private async setOptionSold(
    card: PlanCard,
    offer: ProductOfferView,
    sold: boolean,
  ): Promise<void> {
    const saved = await this.write(offer.id, () =>
      this.api.setOfferAvailability(offer.id, sold, Number(offer.version)),
    );
    if (!saved) return;
    const option = $localize`${card.name}:plan: for ${duration(offer)}:length:`;
    const now = saved.offers.find((item) => item.id === offer.id);
    this.toast.show(
      sold
        ? $localize`${option}:option: is for sale again.`
        : $localize`You no longer sell ${option}:option:. Clients already on it keep their plan.`,
      {
        tone: 'success',
        action:
          sold || !now
            ? undefined
            : {
                label: $localize`Undo`,
                run: () => void this.setOptionSold(card, now, true),
              },
      },
    );
  }

  /** One write at a time; the cards reload after it so the counts and versions are the server's. */
  private async write(
    subject: string,
    command: () => ReturnType<ProductsApi['updateProduct']>,
  ): Promise<CoachingProductView | null> {
    if (this.working()) return null;
    return this.scope.run<CoachingProductView | null>(
      'write',
      async (owner) => {
        this.working.set(subject);
        try {
          await owner.wait(this.csrf.refresh());
          const saved = await owner.wait(firstValueFrom(command()));
          await owner.wait(this.load());
          // The menu that started this may have moved between sections, so focus goes to the page.
          this.heading()?.nativeElement.focus();
          return saved;
        } catch (error) {
          if (!owner.current) return null;
          this.toast.show(productWriteError(error), { tone: 'error' });
          void this.load();
          return null;
        } finally {
          if (owner.current) this.working.set(null);
        }
      },
      null,
    );
  }
}

function savedMessage(mode: ProductSheetMode, saved: CoachingProductView): string {
  switch (mode.kind) {
    case 'new':
      return $localize`${saved.name}:plan: is ready to sell. Start it for a client from their profile.`;
    case 'option':
      return $localize`Price option added to ${saved.name}:plan:.`;
    case 'price':
      return $localize`New price saved. Clients already on this option keep their price and payments.`;
    case 'details':
      return $localize`${saved.name}:plan: is saved.`;
  }
}
