import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  signal,
  type TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, map, type Observable } from 'rxjs';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type { FeatureAccessDecision } from '../../core/api/api.models';
import type { ClientNutritionDayView, FoodQuantityUnit } from '../../core/api/generated';
import { ownNutritionDenialMessage } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Icon } from '../../ui/icon';
import { ProgressRing } from '../../ui/progress-ring';
import { UiSheet } from '../../ui/sheet';
import { addDays } from '../clients/client-overview.models';
import { ClientRecipeSheet } from './client-recipe';
import { NutritionChoiceDrafts } from './nutrition-choice-drafts';
import { mapNutritionDay, NutritionChoice, NutritionDay, NutritionSlot } from './nutrition.models';

/** The server grants at most this many photos a call (MED-004). */
const PHOTO_GRANT_BATCH = 32;

interface NutritionDateOwner {
  readonly selectedDate: string;
  readonly generation: number;
}

/** The day a write answers with, in this page's model. */
function dayOf(answer: Observable<ClientNutritionDayView>): Promise<NutritionDay> {
  return firstValueFrom(answer.pipe(map(mapNutritionDay)));
}

@Component({
  selector: 'app-today-nutrition',
  imports: [ClientRecipeSheet, DatePipe, DecimalPipe, FormsModule, Icon, ProgressRing],
  templateUrl: './today-nutrition.html',
  styleUrl: './today-nutrition.scss',
})
export class TodayNutrition {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly access = inject(ClientAccessStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly sheets = inject(UiSheet);
  private readonly recipeSheet = viewChild.required<TemplateRef<unknown>>('recipeSheet');
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly drafts = new NutritionChoiceDrafts();
  private loadedTenantId: string | null = null;
  private dateGeneration = 0;

  protected readonly day = signal<NutritionDay | null>(null);
  protected readonly draftRevision = signal(0);
  protected readonly loading = signal(false);
  protected readonly completing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly denial = signal<string | null>(null);
  protected readonly missing = signal(false);
  protected readonly editingSlotIds = signal<Set<string>>(new Set());
  protected readonly customOpen = signal(false);
  protected readonly customBusy = signal(false);
  protected readonly reversingFoodId = signal<string | null>(null);
  protected readonly customError = signal<string | null>(null);
  protected readonly selectedDate = signal('');
  /** The recipe its sheet shows, with the option it was opened from (R4.4d). */
  protected readonly openRecipe = signal<{ recipeId: string; choice: NutritionChoice } | null>(
    null,
  );
  /** Meal-card photos by asset once granted (R4.4d); a card whose photo has none shows none. */
  private readonly thumbnails = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly activeDate = computed(
    () => this.selectedDate() || this.day()?.date || this.calendar.today(),
  );
  protected readonly dates = computed(() =>
    Array.from({ length: 7 }, (_, index) => addDays(this.activeDate(), index - 3)),
  );
  protected readonly loggedCount = computed(
    () => this.day()?.slots.filter((slot) => slot.selectedChoiceId !== null).length ?? 0,
  );
  protected readonly caloriesLabel = $localize`Calories`;
  protected readonly proteinLabel = $localize`Protein`;
  protected readonly carbsLabel = $localize`Carbs`;
  protected readonly fatLabel = $localize`Fat`;
  protected customName = '';
  protected customAmount: number | null = null;
  protected customUnit: FoodQuantityUnit = 'Gram';
  protected customCalories: number | null = null;
  protected customProtein: number | null = null;
  protected customCarbohydrate: number | null = null;
  protected customFat: number | null = null;

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      // The access answer first: meals it calls closed are never asked for (see `load`).
      const status = this.access.status();
      if (status === 'idle' || status === 'loading') return;
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        untracked(() => {
          this.selectedDate.set('');
          void this.load();
        });
      }
    });
  }

  protected draft(slotId: string) {
    this.draftRevision();
    return this.drafts.get(slotId);
  }

  protected updateChoice(slotId: string, choiceId: string): void {
    const day = this.day();
    const slot = day?.slots.find((candidate) => candidate.id === slotId);
    const choice = slot?.choices.find((candidate) => candidate.id === choiceId);
    this.drafts.update(slotId, {
      choiceId,
      ...(choice ? { servings: String(choice.servings) } : {}),
    });
    this.bumpDrafts();
  }

  protected updateServings(slotId: string, servings: string): void {
    this.drafts.update(slotId, { servings });
    this.bumpDrafts();
  }

  protected async changeDate(date: string): Promise<void> {
    if (date === this.activeDate()) return;
    this.selectedDate.set(date);
    this.invalidateDateState();
    return this.scope.run('changeDate', async (owner) => {
      await owner.wait(this.load());
    });
  }

  protected shiftWeek(days: number): void {
    void this.changeDate(addDays(this.activeDate(), days));
  }

  protected retry(): void {
    void this.load();
  }

  protected edit(slotId: string): void {
    const next = new Set(this.editingSlotIds());
    if (next.has(slotId)) next.delete(slotId);
    else next.add(slotId);
    this.editingSlotIds.set(next);
  }

  protected isEditing(slotId: string): boolean {
    return this.editingSlotIds().has(slotId);
  }

  protected displayChoice(slot: NutritionSlot) {
    return slot.choices.find((choice) => choice.id === slot.selectedChoiceId) ?? slot.choices[0];
  }

  /** The option's recipe photo for its meal card, once granted. */
  protected thumbnail(choice: NutritionChoice): string | null {
    return choice.photoId ? (this.thumbnails().get(choice.photoId) ?? null) : null;
  }

  /** A grant that lapsed while the page stayed open leaves the card without its photo until a reload. */
  protected dropThumbnail(choice: NutritionChoice): void {
    const photoId = choice.photoId;
    if (!photoId) return;
    this.thumbnails.update((current) => {
      const next = new Map(current);
      next.delete(photoId);
      return next;
    });
  }

  /** Opens the client's copy of an option's recipe in a sheet: what their plan gives them to cook. */
  protected showRecipe(choice: NutritionChoice | undefined): void {
    if (!choice?.recipeId) return;
    this.openRecipe.set({ recipeId: choice.recipeId, choice });
    this.sheets.open(this.recipeSheet(), {
      title: choice.recipeName,
      closeLabel: $localize`Close`,
      printable: true,
    });
  }

  /** The option chosen in a meal's editor, so its recipe can be opened before it is saved. */
  protected draftChoice(slot: NutritionSlot, choiceId: string | null): NutritionChoice | undefined {
    return slot.choices.find((choice) => choice.id === choiceId);
  }

  protected removeFoodLabel(name: string): string {
    return $localize`Remove ${name}:foodName:`;
  }

  protected servingUnit(amount: number | null): string {
    return amount === 1 ? $localize`serving` : $localize`servings`;
  }

  protected async addCustomFood(): Promise<void> {
    if (this.customBusy()) return;
    return this.scope.run('customFood', async (owner) => {
      const day = this.day();
      if (!day || day.logStatus === 'Completed') return;
      if (
        !this.customName.trim() ||
        !this.customAmount ||
        this.customAmount <= 0 ||
        [this.customCalories, this.customProtein, this.customCarbohydrate, this.customFat].some(
          (value) => value === null || !Number.isFinite(value) || value < 0,
        )
      ) {
        this.customError.set($localize`Enter a name, a positive amount, and all nutrition values.`);
        return;
      }
      const dateOwner = this.captureDateOwner();
      this.customBusy.set(true);
      this.customError.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        if (!this.ownsDate(dateOwner)) return;
        const updated = await owner.wait(
          dayOf(
            this.api.addMyNutritionCustomFood({
              planDayId: day.planDayId,
              name: this.customName.trim(),
              amount: this.customAmount,
              unit: this.customUnit,
              calories: this.customCalories!,
              proteinGrams: this.customProtein!,
              carbohydrateGrams: this.customCarbohydrate!,
              fatGrams: this.customFat!,
              dailyLogVersion: day.logVersion,
            }),
          ),
        );
        if (!this.ownsDate(dateOwner)) return;
        this.day.set(updated);
        this.drafts.reconcile(updated);
        this.bumpDrafts();
        this.customOpen.set(false);
        this.clearCustomFood();
        this.notice.set($localize`Extra food logged.`);
      } catch (error) {
        if (!owner.current || !this.ownsDate(dateOwner)) return;
        this.customError.set(apiErrorMessage(error, $localize`This food could not be saved.`));
      } finally {
        if (owner.current && this.ownsDate(dateOwner)) this.customBusy.set(false);
      }
    });
  }

  protected async reverseCustomFood(foodId: string): Promise<void> {
    if (this.reversingFoodId() || this.customBusy()) return;
    return this.scope.run(`reverseFood:${foodId}`, async (owner) => {
      const day = this.day();
      if (!day || day.logStatus === 'Completed' || day.logVersion === null) return;
      const dateOwner = this.captureDateOwner();
      this.reversingFoodId.set(foodId);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        if (!this.ownsDate(dateOwner)) return;
        const updated = await owner.wait(
          dayOf(this.api.reverseMyNutritionCustomFood(foodId, { dailyLogVersion: day.logVersion })),
        );
        if (!this.ownsDate(dateOwner)) return;
        this.day.set(updated);
        this.drafts.reconcile(updated);
        this.bumpDrafts();
        this.notice.set($localize`Extra food removed from today's totals.`);
      } catch (error) {
        if (!owner.current || !this.ownsDate(dateOwner)) return;
        this.error.set(apiErrorMessage(error, $localize`This food could not be removed.`));
      } finally {
        if (owner.current && this.ownsDate(dateOwner)) this.reversingFoodId.set(null);
      }
    });
  }

  protected async save(slot: NutritionSlot): Promise<void> {
    return this.scope.run(`slot:${slot.id}`, async (owner) => {
      const day = this.day();
      if (!day || day.logStatus === 'Completed') {
        return;
      }
      const dateOwner = this.captureDateOwner();

      const draft = this.drafts.beginSave(slot.id);
      this.bumpDrafts();
      const servings = Number(draft.servings);
      if (!draft.choiceId || !Number.isFinite(servings) || servings <= 0) {
        this.drafts.failed(slot.id, $localize`Choose a meal and enter positive servings.`);
        this.bumpDrafts();
        return;
      }

      try {
        await owner.wait(this.csrf.refresh());
        if (!this.ownsDate(dateOwner)) return;
        const updated = await owner.wait(
          dayOf(
            this.api.recordMyNutritionChoice({
              planDayId: day.planDayId,
              planSlotId: slot.id,
              choiceId: draft.choiceId,
              actualServings: servings,
              dailyLogVersion: day.logVersion,
            }),
          ),
        );
        if (!this.ownsDate(dateOwner)) return;
        this.day.set(updated);
        this.drafts.saved(slot.id, updated);
        const next = new Set(this.editingSlotIds());
        next.delete(slot.id);
        this.editingSlotIds.set(next);
        this.notice.set($localize`Meal logged.`);
      } catch (error) {
        if (!owner.current || !this.ownsDate(dateOwner)) return;
        this.drafts.failed(
          slot.id,
          apiErrorMessage(
            error,
            $localize`This meal could not be saved. Your other edits are still here.`,
          ),
        );
      } finally {
        if (owner.current && this.ownsDate(dateOwner)) {
          this.bumpDrafts();
        }
      }
    });
  }

  protected async complete(): Promise<void> {
    return this.scope.run('complete', async (owner) => {
      const day = this.day();
      if (
        !day?.dailyLogId ||
        day.logVersion === null ||
        this.drafts.values().some((item) => item.dirty || item.saving) ||
        this.customBusy() ||
        this.reversingFoodId() !== null ||
        (this.customOpen() && this.customName.trim().length > 0)
      ) {
        this.error.set($localize`Save edited meals and extra food before completing the day.`);
        return;
      }
      const dateOwner = this.captureDateOwner();

      this.completing.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        if (!this.ownsDate(dateOwner)) return;
        const updated = await owner.wait(
          dayOf(this.api.completeMyNutritionLog(day.dailyLogId, { version: day.logVersion })),
        );
        if (!this.ownsDate(dateOwner)) return;
        this.day.set(updated);
        this.drafts.reconcile(updated);
        this.notice.set($localize`Nutrition day completed.`);
      } catch (error) {
        if (!owner.current || !this.ownsDate(dateOwner)) return;
        this.error.set(
          apiErrorMessage(error, $localize`The nutrition day could not be completed.`),
        );
      } finally {
        if (owner.current && this.ownsDate(dateOwner)) {
          this.completing.set(false);
          this.bumpDrafts();
        }
      }
    });
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const dateOwner = this.captureDateOwner();
      this.loading.set(true);
      this.error.set(null);
      this.notice.set(null);
      this.denial.set(null);
      this.missing.set(false);
      try {
        const access = this.access.decision('Nutrition');
        if (access?.isAllowed === false) {
          // The plan has closed meals (ended, paused or never in it): the page says why without
          // asking for a day the client may not see (audit AUTH-12).
          this.day.set(null);
          this.denial.set(ownNutritionDenialMessage(access.reason));
          return;
        }
        const answer = await owner.wait(
          firstValueFrom(this.api.getMyNutritionDay(dateOwner.selectedDate || undefined)),
        );
        const loaded = answer === null ? null : mapNutritionDay(answer);
        if (!this.ownsDate(dateOwner)) return;
        if (loaded === null) {
          // Nothing for this date: no meal plan yet, or the plan does not reach it. When the access
          // answer could not be read before, it is asked for now, so a closed plan still says so.
          this.day.set(null);
          const decision = access ?? (await this.readAccess(owner));
          if (!this.ownsDate(dateOwner)) return;
          if (decision?.isAllowed === false) {
            this.denial.set(ownNutritionDenialMessage(decision.reason));
          } else {
            this.missing.set(true);
          }
          void this.calendar.resolveToday();
          return;
        }
        this.day.set(loaded);
        this.drafts.reconcile(loaded);
        this.bumpDrafts();
        void this.grantPhotos(loaded);
      } catch (error) {
        if (!owner.current || !this.ownsDate(dateOwner)) return;
        this.day.set(null);
        const reason = featureAccessReason(error);
        if (reason !== null) {
          this.denial.set(ownNutritionDenialMessage(reason));
        } else {
          this.error.set(apiErrorMessage(error, $localize`Your meals could not be loaded.`));
        }
      } finally {
        if (owner.current && this.ownsDate(dateOwner)) {
          this.loading.set(false);
        }
      }
    });
  }

  /** The nutrition decision read straight from the API, or null when it cannot be read either. */
  private async readAccess(owner: TenantOperation): Promise<FeatureAccessDecision | null> {
    try {
      const decisions = await owner.wait(firstValueFrom(this.api.getOwnFeatureAccess()));
      return decisions.find((item) => item.feature === 'Nutrition') ?? null;
    } catch (error) {
      if (!owner.current) throw error;
      return null;
    }
  }

  /**
   * Asks for the day's recipe photos, every option's, so a swap shows its photo at once. A photo is
   * not a public address: its route needs a short-lived grant (MED-004), which the server gives a
   * client only for their own active plan's copy (MED-014). A failure leaves the cards without one.
   */
  private grantPhotos(day: NutritionDay): Promise<void> {
    const known = this.thumbnails();
    const ids = [
      ...new Set(
        day.slots.flatMap((slot) =>
          slot.choices.flatMap((choice) => (choice.photoId ? [choice.photoId] : [])),
        ),
      ),
    ].filter((id) => !known.has(id));
    if (ids.length === 0) return Promise.resolve();
    return this.scope.run('grantPhotos', async (owner) => {
      try {
        await owner.wait(this.csrf.refresh());
        for (let start = 0; start < ids.length; start += PHOTO_GRANT_BATCH) {
          const batch = await owner.wait(
            firstValueFrom(
              this.api.createMediaAccessBatch(ids.slice(start, start + PHOTO_GRANT_BATCH)),
            ),
          );
          this.thumbnails.update((current) => {
            const next = new Map(current);
            for (const item of batch.items) next.set(item.assetId, item.thumbnailUrl ?? item.url);
            return next;
          });
        }
      } catch {
        // The cards show no photos; the meals read the same without them.
      }
    });
  }

  private bumpDrafts(): void {
    this.draftRevision.update((value) => value + 1);
  }

  private captureDateOwner(): NutritionDateOwner {
    return { selectedDate: this.selectedDate(), generation: this.dateGeneration };
  }

  private ownsDate(owner: NutritionDateOwner): boolean {
    return owner.generation === this.dateGeneration && owner.selectedDate === this.selectedDate();
  }

  private invalidateDateState(): void {
    ++this.dateGeneration;
    this.drafts.clear();
    this.day.set(null);
    this.loading.set(false);
    this.completing.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.denial.set(null);
    this.missing.set(false);
    this.editingSlotIds.set(new Set());
    this.customOpen.set(false);
    this.customBusy.set(false);
    this.reversingFoodId.set(null);
    this.customError.set(null);
    this.clearCustomFood();
    this.bumpDrafts();
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    this.thumbnails.set(new Map());
    this.selectedDate.set('');
    this.invalidateDateState();
    this.draftRevision.set(0);
  }

  private clearCustomFood(): void {
    this.customName = '';
    this.customAmount = null;
    this.customUnit = 'Gram';
    this.customCalories = null;
    this.customProtein = null;
    this.customCarbohydrate = null;
    this.customFat = null;
  }
}
