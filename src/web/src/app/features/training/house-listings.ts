import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
  type TemplateRef,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ProgramTemplateSummary } from '../../core/api/generated';
import { GuardedSheets, type Closable, type LeaveQuestion } from '../../core/forms/guarded-sheets';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { StatusPill } from '../../ui/status-pill';
import { HouseListingSheet } from './house-listing-sheet';
import { HouseListingsApi, HouseListingsMemo } from './house-listings-api';
import {
  listingRow,
  nothingToOffer,
  notTheHouse,
  withdrawRefusal,
  type HouseListing,
} from './house-listings.models';

/**
 * The programs TB Gym's trainees can start (TRN-034, notes plan N9c4), on the coach's Programs page: each
 * offered or withdrawn program with whom it suits, its block of a run, its weeks, rounding and starts, and
 * Offer a program, Edit, Withdraw and Offer again. Nothing on the web marks TB Gym's own space: the list's
 * 404 says this is another space, which hides the section for the session, so it is read once per space.
 * Any other failure fails the section alone, never the page. The server lets the Owner and Coaches write.
 */
@Component({
  selector: 'app-house-listings',
  imports: [Button, HouseListingSheet, RouterLink, StatusPill, UiConfirm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './house-listings.html',
  styleUrl: './house-listings.scss',
})
export class HouseListings extends GuardedSheets {
  private readonly api = inject(HouseListingsApi);
  private readonly memo = inject(HouseListingsMemo);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly sheetTemplate = viewChild.required<TemplateRef<unknown>>('listingSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('leaveDialog');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedKey: string | null = null;

  protected override readonly leaveQuestion: LeaveQuestion = {
    title: $localize`Close without saving?`,
    message: $localize`What you typed isn’t saved. If you close it now, it is lost.`,
    confirm: $localize`Close without saving`,
    cancel: $localize`Keep editing`,
  };

  /** The page's programs: their names, whether archived, and what Offer a program can choose. */
  readonly templates = input.required<readonly ProgramTemplateSummary[]>();

  /** `hidden` before the first answer and outside the house; `failed` keeps the page and says so here. */
  protected readonly state = signal<'hidden' | 'ready' | 'failed'>('hidden');
  protected readonly listings = signal<readonly HouseListing[]>([]);
  protected readonly retrying = signal(false);
  /** The program a Withdraw is on its way for; one write at a time. */
  protected readonly working = signal<string | null>(null);
  /** The program the open sheet is about; null for a new offer. */
  protected readonly sheetFor = signal<string | null>(null);
  /** A save on its way: its sheet stays open, so its answer is said and acted on. */
  protected readonly sheetBusy = signal(false);

  protected readonly rows = computed(() =>
    this.listings().map((listing) => listingRow(listing, this.templates())),
  );
  /** Why Offer a program has nothing to choose, or null. */
  protected readonly blocked = computed(() => nothingToOffer(this.templates(), this.listings()));

  constructor() {
    super();
    this.scope.onReset(() => {
      this.loadedKey = null;
      this.listings.set([]);
      this.state.set('hidden');
      this.working.set(null);
    });
    effect(() => {
      const epoch = this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (!tenantId) return;
      const key = `${tenantId}#${epoch}`;
      if (key === this.loadedKey) return;
      this.loadedKey = key;
      untracked(() => {
        if (this.memo.isNotTheHouse(tenantId)) this.state.set('hidden');
        else void this.read();
      });
    });
  }

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  /** No sheet closes while its save is on its way: the close button, Escape, the backdrop or Not now. */
  protected override canClose(): boolean | Promise<boolean> {
    return this.sheetBusy() ? false : super.canClose();
  }

  /** Reads the list; the rows on screen stay while it is read again. */
  protected read(): Promise<void> {
    return this.scope.run('read', async (owner) => {
      try {
        const listings = await owner.wait(firstValueFrom(this.api.list()));
        this.listings.set(listings);
        this.state.set('ready');
      } catch (error) {
        if (!owner.current) return;
        if (notTheHouse(error)) {
          this.memo.markNotTheHouse(owner.tenantId);
          this.listings.set([]);
          this.state.set('hidden');
        } else {
          this.state.set('failed');
        }
      }
    });
  }

  protected async retry(): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    try {
      await this.read();
    } finally {
      this.retrying.set(false);
    }
    // Try again went with the failed line: focus waits on the section's heading.
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }

  // ---------- the sheet ----------

  protected openNew(): void {
    if (this.blocked()) return;
    this.openSheet(null, $localize`Offer to trainees`);
  }

  protected openEdit(templateId: string): void {
    const listing = this.listingOf(templateId);
    if (!listing) return;
    this.openSheet(
      templateId,
      listing.isOffered ? $localize`Edit for trainees` : $localize`Offer to trainees`,
    );
  }

  private openSheet(templateId: string | null, title: string): void {
    this.sheetBusy.set(false);
    this.sheetFor.set(templateId);
    this.show(this.sheetTemplate(), title);
  }

  /** The sheet saved (the listing) or the coach chose Not now (null). */
  protected sheetClosed(saved: HouseListing | null, sheet: Closable): void {
    this.sheetBusy.set(false);
    if (!saved) {
      void this.closeAsking(sheet);
      return;
    }
    const wasOffered = this.listingOf(saved.templateId)?.isOffered === true;
    this.done(
      sheet,
      wasOffered ? $localize`Saved.` : $localize`${saved.name}:program: is offered to trainees.`,
    );
    this.replace(saved);
    void this.read();
    // The sheet gave focus back to the button that opened it, which the save can take away: Offer again
    // becomes Edit, and Offer a program is disabled once every program is listed. Focus then waits on
    // the saved row's Edit, or on the section's heading.
    afterNextRender(() => this.focusIfLost(saved.templateId), { injector: this.injector });
  }

  private focusIfLost(templateId: string): void {
    const active = document.activeElement;
    const lost =
      !(active instanceof HTMLElement) ||
      active === document.body ||
      !active.isConnected ||
      active.matches(':disabled');
    if (!lost) return;
    const edit = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('[data-edit]'),
    ).find((button) => button.dataset['edit'] === templateId);
    (edit ?? this.heading()?.nativeElement)?.focus();
  }

  // ---------- withdrawing ----------

  /** Writes at once, no question: Offer again is on the row, and trainees who started it keep their copy. */
  protected async withdraw(templateId: string): Promise<void> {
    const listing = this.listingOf(templateId);
    if (this.working() || !listing?.isOffered) return;
    await this.scope.run('withdraw', async (owner) => {
      this.working.set(templateId);
      try {
        await owner.wait(this.csrf.refresh());
        const saved = await owner.wait(
          firstValueFrom(this.api.withdraw(templateId, { version: listing.version })),
        );
        this.replace(saved);
        this.toast.show(
          $localize`${saved.name}:program: withdrawn. Trainees who started it keep their copy.`,
          { tone: 'success' },
        );
        // Withdraw went with the row's state: its Offer again takes focus.
        afterNextRender(
          () =>
            Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-offer-again]'))
              .find((button) => button.dataset['offerAgain'] === templateId)
              ?.focus(),
          { injector: this.injector },
        );
      } catch (error) {
        if (!owner.current) return;
        const refusal = withdrawRefusal(error);
        this.toast.show(refusal.message, { tone: 'error' });
        if (refusal.stale) void this.read();
      } finally {
        if (owner.current) this.working.set(null);
      }
    });
  }

  private listingOf(templateId: string): HouseListing | null {
    return this.listings().find((listing) => listing.templateId === templateId) ?? null;
  }

  /** The server's answer takes the row's place at once, before the list is read again. */
  private replace(saved: HouseListing): void {
    this.listings.update((items) =>
      items.some((item) => item.templateId === saved.templateId)
        ? items.map((item) => (item.templateId === saved.templateId ? saved : item))
        : [...items, saved],
    );
  }
}
