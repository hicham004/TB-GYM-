import type { DialogRef } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { RenewalAsk } from '../dashboard/renewal-ask';
import { mapRenewalStatus, type RenewalStatus } from '../dashboard/renewal.models';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import type { ModalSurface } from '../../ui/modal-surface';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import {
  freePlan,
  ownPlans,
  type FreePlan,
  type OwnPlan,
  type OwnSession,
} from './client-plan.models';
import { HousePlanAskSheet } from './house-plan-ask-sheet';
import { HousePlanPaidSheet } from './house-plan-paid-sheet';
import { HousePlansApi } from './house-plans-api';
import {
  earlierAsk,
  earlierAsksOf,
  openAskCard,
  openAskOf,
  planGroups,
  type HouseAsk,
  type HouseAskChoice,
  type HouseOption,
  type HousePlanGroup,
  type HousePlans,
  type OpenAskCard,
} from './house-plans.models';
import { firstName } from './own-sessions.models';

/** Where the house's part of the page stands: none outside it (the server's 404), or its read. */
type HouseState = 'none' | 'loading' | 'ready' | 'error';

/** The sheet a template is given as `let-sheet`. */
interface Closable {
  close(result?: unknown): void;
}

/**
 * My plan (critique B10a): where a client reads what they agreed with their coach, its name, what's
 * included, the dates and the coach's description, and for a pack what is left and what happened to
 * each session (B10c). Reached from Me, and from the notices about a plan (B14). Ask to renew sits
 * on the plan it is about, as on Today; no price or payment shows here.
 *
 * For a self-directed trainee of TB Gym's own space (notes plan N9c2, SUB-020), whom the server gives
 * Free, the page is also where they buy: the ask waiting on TB Gym first, then their paid plans, Free,
 * the plans TB Gym sells with "Ask for" on each option, and the asks TB Gym booked or closed. The
 * house's prices and words come from `GET /api/house-plans/me` alone; a coach's client never reads it.
 */
@Component({
  selector: 'app-client-plan-page',
  imports: [
    Button,
    ButtonLink,
    DatePipe,
    EmptyState,
    HousePlanAskSheet,
    HousePlanPaidSheet,
    Icon,
    RenewalAsk,
    RouterLink,
    Skeleton,
    StatusPill,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-plan.html',
  styleUrl: './client-plan.scss',
})
export class ClientPlanPage {
  private readonly api = inject(ApiClient);
  private readonly housePlans = inject(HousePlansApi);
  private readonly sheets = inject(UiSheet);
  private readonly toast = inject(UiToast);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly askStatus = viewChild<ElementRef<HTMLElement>>('askStatus');
  private readonly injector = inject(Injector);
  private readonly askSheet = viewChild.required<TemplateRef<unknown>>('askSheet');
  private readonly paidSheet = viewChild.required<TemplateRef<unknown>>('paidSheet');
  private loadedTenantId: string | null = null;
  private openSheet: DialogRef<unknown, ModalSurface> | null = null;
  /** A refusal said the page is out of date: the house's part is read again once the sheet closes. */
  private rereadOnClose = false;
  private destroyed = false;

  protected readonly firstName = firstName;
  protected readonly loadingLabel = $localize`Loading your plan…`;
  protected readonly houseLoadingLabel = $localize`Loading the plans TB Gym sells…`;
  /** A pack's newest sessions; the rest on request, as Today's feed does. */
  protected readonly preview = 5;

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly plans = signal<readonly OwnPlan[]>([]);
  /** The server's answer on asking to renew, for the plan it is about. */
  protected readonly renewal = signal<RenewalStatus | null>(null);
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  /** Free, which only a self-directed trainee of the house has; it makes the page theirs. */
  protected readonly free = signal<FreePlan | null>(null);
  protected readonly trainee = computed(() => this.free() !== null);
  protected readonly houseState = signal<HouseState>('none');
  protected readonly house = signal<HousePlans | null>(null);
  /** What the page says of the open ask after asking for it here. */
  protected readonly askNews = signal<string | null>(null);
  /** The option the ask sheet confirms, and the ask the "I've paid" sheet is about. */
  protected readonly choice = signal<HouseAskChoice | null>(null);
  protected readonly paying = signal<OpenAskCard | null>(null);
  protected readonly sheetBusy = signal(false);

  protected readonly openAsk = computed(() => {
    const house = this.house();
    const ask = house ? openAskOf(house.asks) : null;
    return house && ask ? openAskCard(ask, house.today, this.locale) : null;
  });
  /** The plans on sale, while asks are open and none waits on TB Gym. */
  protected readonly groups = computed<readonly HousePlanGroup[]>(() => {
    const house = this.house();
    if (!house?.asksOpen || openAskOf(house.asks) !== null) return [];
    return planGroups(house.plans, this.locale);
  });
  protected readonly earlier = computed(() => {
    const house = this.house();
    return house
      ? earlierAsksOf(house.asks).map((ask) => earlierAsk(ask, house.today, this.locale))
      : [];
  });

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.openSheet?.close();
      this.plans.set([]);
      this.renewal.set(null);
      this.opened.set(new Set());
      this.free.set(null);
      this.house.set(null);
      this.houseState.set('none');
      this.askNews.set(null);
      this.state.set('loading');
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.openSheet?.close();
    });
  }

  /** The renewal state of the plan it is about, and of no other. */
  protected renewalOf(planId: string): RenewalStatus | null {
    const status = this.renewal();
    return status?.planId === planId ? status : null;
  }

  protected isOpen(planId: string): boolean {
    return this.opened().has(planId);
  }

  protected shown(planId: string, history: readonly OwnSession[]): readonly OwnSession[] {
    return this.isOpen(planId) ? history : history.slice(0, this.preview);
  }

  protected toggle(planId: string): void {
    const opened = new Set(this.opened());
    if (!opened.delete(planId)) opened.add(planId);
    this.opened.set(opened);
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        const view = await owner.wait(firstValueFrom(this.api.getOwnPlans()));
        // Only a trainee of the house has Free, and only they may read what the house sells.
        const house = view.free ? await this.readHouse(owner) : null;
        this.plans.set(ownPlans(view, this.locale));
        this.renewal.set(view.renewal ? mapRenewalStatus(view.renewal) : null);
        this.free.set(view.free ? freePlan(view.free, view.today, this.locale) : null);
        this.showHouse(house);
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }

  /**
   * Reads the house's part again, leaving the rest of the page as it is: on Try again, and once a sheet
   * whose refusal said the page is out of date closes. Either can take away the button that had focus.
   */
  protected async rereadHouse(): Promise<void> {
    await this.scope.run('house', async (owner) => {
      // Asks already shown stay until the new read replaces them; only an empty part shows the skeleton.
      if (this.house() === null) this.houseState.set('loading');
      this.showHouse(await this.readHouse(owner));
    });
    this.keepFocus();
  }

  protected openAskSheet(group: HousePlanGroup, option: HouseOption): void {
    this.choice.set({ planName: group.name, option });
    this.show(this.askSheet(), $localize`Ask for ${group.name}:plan:`);
  }

  protected openPaidSheet(ask: OpenAskCard): void {
    this.paying.set(ask);
    this.show(this.paidSheet(), $localize`I’ve paid`);
  }

  /** The ask sheet closed: with the new ask, the card takes the top of the page and focus. */
  protected asked(ask: HouseAsk | null, sheet: Closable): void {
    sheet.close();
    if (!ask) return;
    this.putAsk(ask);
    this.askNews.set($localize`Asked. Send the money by Whish, then tell TB Gym here.`);
    this.focusAskNews();
  }

  /** The "I've paid" sheet closed: with the ask said paid, its card says so and takes focus. */
  protected paid(ask: HouseAsk | null, sheet: Closable): void {
    sheet.close();
    if (!ask) return;
    this.putAsk(ask);
    this.askNews.set(null);
    this.focusAskNews();
  }

  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.toast.show($localize`Copied the Whish number.`, { tone: 'success' });
    } catch {
      this.toast.show($localize`Couldn’t copy. Select it and copy it yourself.`, { tone: 'error' });
    }
  }

  /** The house's plans and asks, or why there are none: a 404 means this is no trainee of the house. */
  private async readHouse(
    owner: TenantOperation,
  ): Promise<{ state: HouseState; plans: HousePlans | null }> {
    try {
      return { state: 'ready', plans: await owner.wait(firstValueFrom(this.housePlans.plans())) };
    } catch (error) {
      owner.check();
      const absent = error instanceof HttpErrorResponse && error.status === 404;
      return { state: absent ? 'none' : 'error', plans: null };
    }
  }

  private showHouse(read: { state: HouseState; plans: HousePlans | null } | null): void {
    this.house.set(read?.plans ?? null);
    this.houseState.set(read?.state ?? 'none');
  }

  private putAsk(ask: HouseAsk): void {
    this.house.update((house) =>
      house ? { ...house, asks: [ask, ...house.asks.filter((item) => item.id !== ask.id)] } : house,
    );
  }

  /** The sheet gave focus back as it closed; once the card is drawn, its status line takes it. */
  private focusAskNews(): void {
    afterNextRender(() => this.askStatus()?.nativeElement.focus(), { injector: this.injector });
  }

  /**
   * A new read of the house's part can take away the button that had focus (the option asked for, "I've
   * paid", Try again): the open ask's status line takes it, else the h1, never the document's body.
   */
  private keepFocus(): void {
    // A page left before its read answered has nothing to focus, and no injector to ask.
    if (this.destroyed) return;
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        // The status line is hidden while it has nothing to say, and a hidden line takes no focus.
        const status = this.askStatus()?.nativeElement;
        const target = status?.textContent?.trim() ? status : this.heading()?.nativeElement;
        target?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  private show(template: TemplateRef<unknown>, title: string): void {
    this.openSheet?.close();
    this.rereadOnClose = false;
    this.sheetBusy.set(false);
    const sheet = this.sheets.open(template, {
      title,
      closeLabel: $localize`Close`,
      // While a write is on its way, its answer must arrive with the sheet still open.
      canClose: () => !this.sheetBusy(),
    });
    this.openSheet = sheet;
    sheet.closed.subscribe(() => {
      if (this.openSheet === sheet) this.openSheet = null;
      this.sheetBusy.set(false);
      if (this.rereadOnClose) {
        this.rereadOnClose = false;
        void this.rereadHouse();
      }
    });
  }

  /** Set by a sheet whose refusal means the page is out of date. */
  protected markStale(): void {
    this.rereadOnClose = true;
  }
}
