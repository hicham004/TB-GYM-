import { DecimalPipe } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { NutritionChoiceDrafts } from './nutrition-choice-drafts';
import { NutritionDay, NutritionSlot } from './nutrition.models';

@Component({
  selector: 'app-today-nutrition',
  imports: [DecimalPipe, FormsModule],
  templateUrl: './today-nutrition.html',
  styleUrl: './today-nutrition.scss',
})
export class TodayNutrition {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly drafts = new NutritionChoiceDrafts();
  private loadedTenantId: string | null = null;

  protected readonly day = signal<NutritionDay | null>(null);
  protected readonly draftRevision = signal(0);
  protected readonly loading = signal(false);
  protected readonly completing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected selectedDate = '';

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        this.selectedDate = '';
        void this.load();
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

  protected async changeDate(): Promise<void> {
    await this.load();
  }

  protected async save(slot: NutritionSlot): Promise<void> {
    const day = this.day();
    if (!day || day.logStatus === 'Completed') {
      return;
    }

    const draft = this.drafts.beginSave(slot.id);
    this.bumpDrafts();
    const servings = Number(draft.servings);
    if (!draft.choiceId || !Number.isFinite(servings) || servings <= 0) {
      this.drafts.failed(slot.id, $localize`Choose a meal and enter positive servings.`);
      this.bumpDrafts();
      return;
    }

    try {
      await this.csrf.refresh();
      const updated = await firstValueFrom(
        this.api.recordMyNutritionChoice({
          planDayId: day.planDayId,
          planSlotId: slot.id,
          choiceId: draft.choiceId,
          actualServings: servings,
          dailyLogVersion: day.logVersion,
        }),
      );
      this.day.set(updated);
      this.drafts.saved(slot.id, updated);
      this.notice.set($localize`Meal saved.`);
    } catch (error) {
      this.drafts.failed(
        slot.id,
        apiErrorMessage(
          error,
          $localize`This meal could not be saved. Your other edits are still here.`,
        ),
      );
    } finally {
      this.bumpDrafts();
    }
  }

  protected async complete(): Promise<void> {
    const day = this.day();
    if (
      !day?.dailyLogId ||
      day.logVersion === null ||
      this.drafts.values().some((item) => item.dirty || item.saving)
    ) {
      this.error.set($localize`Save every edited meal before completing the day.`);
      return;
    }

    this.completing.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      const updated = await firstValueFrom(
        this.api.completeMyNutritionLog(day.dailyLogId, { version: day.logVersion }),
      );
      this.day.set(updated);
      this.drafts.reconcile(updated);
      this.notice.set($localize`Nutrition day completed.`);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The nutrition day could not be completed.`));
    } finally {
      this.completing.set(false);
      this.bumpDrafts();
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const loaded = await firstValueFrom(
        this.api.getMyNutritionDay(this.selectedDate || undefined),
      );
      this.day.set(loaded);
      this.drafts.reconcile(loaded);
      this.bumpDrafts();
    } catch (error) {
      this.day.set(null);
      this.error.set(
        apiErrorMessage(error, $localize`No authorized nutrition plan was found for this date.`),
      );
    } finally {
      this.loading.set(false);
    }
  }

  private bumpDrafts(): void {
    this.draftRevision.update((value) => value + 1);
  }
}
