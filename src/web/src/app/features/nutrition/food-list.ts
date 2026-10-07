import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import type { DialogRef } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  FoodItemView,
  FoodSearchResult,
  NutritionWorkspaceSettingsView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import type { ModalSurface } from '../../ui/modal-surface';
import { SectionNav } from '../../ui/section-nav';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { numeric } from '../training/training-builder.models';
import { FoodApi } from './food-api';
import { FoodDetails } from './food-details';
import { FoodEditor } from './food-editor';
import { foodRow, type FoodSheetMode, USDA_MINIMUM, type UsdaKind, usdaRow } from './food.models';
import { NUTRITION_SECTIONS } from './nutrition-sections';

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;

type UsdaState = 'idle' | 'searching' | 'ready' | 'unavailable' | 'error';

/**
 * Foods (C7, R4.4c): one search over the coach's own foods and USDA's. The workspace's foods come
 * first, each with its calories and macros for the amount they are given for; USDA's matches follow,
 * basic foods unless packaged products are asked for, each copied into the foods with one button.
 * Database codes wait behind a switch. A food opens in a sheet, where the coach's own is edited and a
 * USDA food is edited as a copy; New food opens the same sheet empty, and closing it with something
 * typed asks first. A food is archived, with Undo, rather than deleted: recipes keep it, and the
 * archived foods are listed on their own to restore.
 */
@Component({
  selector: 'app-food-list',
  imports: [
    Button,
    EmptyState,
    FoodDetails,
    FoodEditor,
    Icon,
    SectionNav,
    SegmentedControl,
    Skeleton,
    UiConfirm,
  ],
  templateUrl: './food-list.html',
  styleUrl: './food-list.scss',
})
export class FoodList {
  private readonly api = inject(FoodApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly ownHeading = viewChild<ElementRef<HTMLElement>>('ownHeading');
  private readonly detailsSheet = viewChild.required<TemplateRef<unknown>>('detailsSheet');
  private readonly editorSheet = viewChild.required<TemplateRef<unknown>>('editorSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private loadedTenantId: string | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private openSheet: DialogRef<unknown, ModalSurface> | null = null;

  protected readonly sections = NUTRITION_SECTIONS;
  protected readonly loadingLabel = $localize`Loading your foods…`;
  protected readonly closeLabel = $localize`Close`;
  protected readonly kindOptions: readonly SegmentOption[] = [
    { value: 'Basic', label: $localize`Basic foods` },
    { value: 'Packaged', label: $localize`Packaged products` },
  ];

  private readonly foods = signal<FoodItemView[]>([]);
  private readonly total = signal(0);
  private readonly usdaItems = signal<FoodSearchResult[]>([]);
  /** USDA foods copied on this page, so their match says so at once. */
  private readonly copied = signal<ReadonlySet<string>>(new Set());
  protected readonly settings = signal<NutritionWorkspaceSettingsView | null>(null);
  protected readonly search = signal('');
  /** The search the lists on screen answer, so "no match" names what was looked for. */
  protected readonly searched = signal('');
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);
  protected readonly usdaKind = signal<UsdaKind>('Basic');
  protected readonly usdaState = signal<UsdaState>('idle');
  protected readonly adding = signal<string | null>(null);
  protected readonly addError = signal<{ fdcId: string; message: string } | null>(null);
  protected readonly showDatabase = signal(false);
  /** The archived foods instead of those in use. */
  protected readonly showArchived = signal(false);
  protected readonly ownTitle = computed(() =>
    this.showArchived() ? $localize`Archived foods` : $localize`Your foods`,
  );
  protected readonly toggleLabel = computed(() =>
    this.showArchived() ? $localize`Back to your foods` : $localize`Archived foods`,
  );
  /** The food an archive or restore is on its way for. */
  protected readonly working = signal<string | null>(null);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );
  /** The food sheet holds something typed and not saved. */
  private readonly editorDirty = signal(false);
  /** The food a sheet shows, and how the editor sheet opened. */
  protected readonly viewing = signal<FoodItemView | null>(null);
  protected readonly editing = signal<{ mode: FoodSheetMode; food: FoodItemView | null } | null>(
    null,
  );

  protected readonly rows = computed(() => this.foods().map((food) => foodRow(food, this.locale)));
  protected readonly usdaRows = computed(() => {
    const own = new Set(this.rows().flatMap((row) => (row.externalId ? [row.externalId] : [])));
    const copied = this.copied();
    return this.usdaItems().map((item) => ({
      ...usdaRow(item, this.locale),
      added: own.has(item.externalId) || copied.has(item.externalId),
    }));
  });
  protected readonly tolerance = computed(() => {
    const settings = this.settings();
    return settings ? numeric(settings.providerCalorieTolerance) : null;
  });
  protected readonly hasMore = computed(() => this.foods().length < this.total());
  /** No food at all, as opposed to none matching a search. */
  protected readonly foodsEmpty = computed(() => this.total() === 0 && !this.searched());
  protected readonly searchingUsda = computed(
    () => !this.showArchived() && this.searched().length >= USDA_MINIMUM,
  );
  protected readonly summary = computed(() => {
    const count = this.total();
    if (count === 0 || this.searched() || this.showArchived()) return '';
    return count === 1
      ? $localize`1 food, for your recipes`
      : $localize`${count}:count: foods, for your recipes`;
  });

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.foods.set([]);
      this.total.set(0);
      this.usdaItems.set([]);
      this.copied.set(new Set());
      this.settings.set(null);
      this.state.set('loading');
      this.usdaState.set('idle');
      this.openSheet?.close();
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
        void this.loadSettings();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.openSheet?.close();
    });
    // The heading takes focus on arrival, so a screen reader starts at the top of the page.
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  /** Each pause in typing asks the server, which searches every food, and USDA. */
  protected typed(text: string): void {
    this.search.set(text);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      void this.load();
    }, SEARCH_DELAY_MS);
  }

  protected clearSearch(): void {
    this.search.set('');
    void this.load();
  }

  /** Between the foods in use and the archived ones; the search carries over. */
  protected toggleArchived(): void {
    this.showArchived.update((shown) => !shown);
    this.foods.set([]);
    this.total.set(0);
    this.state.set('loading');
    void this.load();
  }

  protected chooseKind(kind: string): void {
    this.usdaKind.set(kind === 'Packaged' ? 'Packaged' : 'Basic');
    void this.searchUsda(this.searched());
  }

  protected async load(): Promise<void> {
    const query = this.search().trim();
    void this.searchUsda(this.showArchived() ? '' : query);
    return this.scope.run('load', async (owner) => {
      if (this.state() !== 'ready') this.state.set('loading');
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.listFoods(query, 0, PAGE_SIZE, this.showArchived())),
        );
        this.foods.set([...page.items]);
        this.total.set(numeric(page.total));
        this.searched.set(query);
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }

  protected async loadMore(): Promise<void> {
    return this.scope.run('more', async (owner) => {
      this.loadingMore.set(true);
      this.moreFailed.set(false);
      try {
        const page = await owner.wait(
          firstValueFrom(
            this.api.listFoods(
              this.searched(),
              this.foods().length,
              PAGE_SIZE,
              this.showArchived(),
            ),
          ),
        );
        this.foods.update((items) => [...items, ...page.items]);
        this.total.set(numeric(page.total));
      } catch {
        if (owner.current) this.moreFailed.set(true);
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  /** Copies a USDA food into the workspace's foods; a food copied before comes back as it was. */
  protected async add(fdcId: string, name: string): Promise<void> {
    if (this.adding()) return;
    return this.scope.run('add', async (owner) => {
      this.adding.set(fdcId);
      this.addError.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const food = await owner.wait(firstValueFrom(this.api.importUsda(fdcId)));
        this.copied.update((current) => new Set(current).add(fdcId));
        this.toast.show($localize`${name}:name: is in your foods now.`, {
          tone: 'success',
          action: { label: $localize`View`, run: () => void this.openFood(food) },
        });
        void this.refreshFoods();
      } catch (error) {
        if (owner.current) {
          this.addError.set({
            fdcId,
            message: apiErrorMessage(
              error,
              $localize`This food couldn’t be added. Try another match.`,
            ),
          });
        }
      } finally {
        if (owner.current) this.adding.set(null);
      }
    });
  }

  /** Archives a food, with Undo; recipes and plans that use it keep it. */
  protected async archive(food: FoodItemView): Promise<void> {
    const saved = await this.setArchived(food, true);
    if (!saved) return;
    this.toast.show($localize`${food.name}:name: is archived.`, {
      tone: 'success',
      action: { label: $localize`Undo`, run: () => void this.setArchived(saved, false) },
    });
  }

  protected async restore(food: FoodItemView): Promise<void> {
    const saved = await this.setArchived(food, false);
    if (!saved) return;
    this.toast.show($localize`${food.name}:name: is back in your foods.`, {
      tone: 'success',
      action: { label: $localize`View`, run: () => void this.openFood(saved) },
    });
  }

  private async setArchived(food: FoodItemView, archived: boolean): Promise<FoodItemView | null> {
    if (this.working()) return null;
    return this.scope.run<FoodItemView | null>(
      'archive',
      async (owner) => {
        this.working.set(food.id);
        try {
          await owner.wait(this.csrf.refresh());
          const saved = await owner.wait(firstValueFrom(this.api.setArchived(food.id, archived)));
          this.openSheet?.close();
          // The food's row leaves this list, so focus goes to the list rather than to nothing.
          this.ownHeading()?.nativeElement.focus();
          void this.refreshFoods();
          return saved;
        } catch (error) {
          if (owner.current) {
            this.toast.show(
              apiErrorMessage(
                error,
                archived
                  ? $localize`The food couldn’t be archived. Try again.`
                  : $localize`The food couldn’t be restored. Try again.`,
              ),
              { tone: 'error' },
            );
          }
          return null;
        } finally {
          if (owner.current) this.working.set(null);
        }
      },
      null,
    );
  }

  // ---------- sheets ----------

  protected async openFood(food: FoodItemView): Promise<void> {
    // A toast's View can be pressed while the food sheet holds something typed.
    if (!(await this.mayDiscard())) return;
    this.openSheet?.close();
    this.viewing.set(food);
    const sheet = this.sheets.open(this.detailsSheet(), {
      title: food.name,
      closeLabel: this.closeLabel,
    });
    this.openSheet = sheet;
    sheet.closed.subscribe(() => {
      if (this.openSheet === sheet) this.openSheet = null;
    });
  }

  protected openRow(id: string): void {
    const food = this.foods().find((item) => item.id === id);
    if (food) void this.openFood(food);
  }

  protected newFood(): void {
    this.openEditor('new', null);
  }

  protected openEditor(mode: FoodSheetMode, food: FoodItemView | null): void {
    this.openSheet?.close();
    this.editing.set({ mode, food });
    const title =
      mode === 'edit'
        ? $localize`Edit ${food?.name ?? ''}:name:`
        : mode === 'copy'
          ? $localize`Your copy of ${food?.name ?? ''}:name:`
          : $localize`New food`;
    this.editorDirty.set(false);
    const sheet = this.sheets.open(this.editorSheet(), {
      title,
      closeLabel: this.closeLabel,
      canClose: () => this.mayDiscard(),
    });
    this.openSheet = sheet;
    sheet.closed.subscribe(() => {
      if (this.openSheet === sheet) this.openSheet = null;
      this.editing.set(null);
      this.editorDirty.set(false);
    });
  }

  protected editorChanged(dirty: boolean): void {
    this.editorDirty.set(dirty);
  }

  /** Cancel in the food sheet: asks first when something is typed. */
  protected async cancelEditor(): Promise<void> {
    if (await this.mayDiscard()) this.openSheet?.close();
  }

  /** True when nothing typed would be lost, or the coach chose to lose it. */
  private async mayDiscard(): Promise<boolean> {
    if (!this.editorDirty()) return true;
    this.asking.set({
      message:
        this.editing()?.mode === 'edit'
          ? $localize`Your changes to this food aren’t saved. If you close it now, they are lost.`
          : $localize`This food isn’t saved. If you close it now, what you typed is lost.`,
      confirm: $localize`Close without saving`,
      cancel: $localize`Keep editing`,
    });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title: $localize`Close without saving?`,
      closeLabel: this.closeLabel,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  protected saved(food: FoodItemView, mode: FoodSheetMode): void {
    this.openSheet?.close();
    this.toast.show(
      mode === 'edit'
        ? $localize`Changes saved.`
        : mode === 'copy'
          ? $localize`Your copy of the food is saved.`
          : $localize`${food.name}:name: is saved.`,
      { tone: 'success', action: { label: $localize`View`, run: () => void this.openFood(food) } },
    );
    void this.refreshFoods();
  }

  private async refreshFoods(): Promise<void> {
    return this.scope.run('refresh', async (owner) => {
      try {
        const page = await owner.wait(
          firstValueFrom(
            this.api.listFoods(
              this.searched(),
              0,
              Math.max(this.foods().length, PAGE_SIZE),
              this.showArchived(),
            ),
          ),
        );
        this.foods.set([...page.items]);
        this.total.set(numeric(page.total));
        this.state.set('ready');
      } catch {
        // The list on screen stays; the next search reloads it.
      }
    });
  }

  private async loadSettings(): Promise<void> {
    return this.scope.run('settings', async (owner) => {
      try {
        this.settings.set(await owner.wait(firstValueFrom(this.api.getSettings())));
      } catch {
        // The sheet's calories as typed fall back to 4/4/9; the server still counts them its way.
      }
    });
  }

  private async searchUsda(query: string): Promise<void> {
    return this.scope.run('usda', async (owner) => {
      this.addError.set(null);
      if (query.length < USDA_MINIMUM) {
        this.usdaItems.set([]);
        this.usdaState.set('idle');
        return;
      }
      this.usdaState.set('searching');
      try {
        const page = await owner.wait(firstValueFrom(this.api.searchUsda(query, this.usdaKind())));
        this.usdaItems.set([...page.items]);
        // Never the server's own sentence, which is written for whoever runs the server.
        this.usdaState.set(page.failureCode ? 'unavailable' : 'ready');
      } catch {
        if (owner.current) {
          this.usdaItems.set([]);
          this.usdaState.set('error');
        }
      }
    });
  }
}
