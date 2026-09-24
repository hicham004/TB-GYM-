import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
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

interface NutritionDateOwner {
  readonly selectedDate: string;
  readonly generation: number;
}

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
  protected selectedDate = '';

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
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
    this.invalidateDateState();
    return this.scope.run('changeDate', async (owner) => {
      await owner.wait(this.load());
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
          firstValueFrom(
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
        this.notice.set($localize`Meal saved.`);
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
        this.drafts.values().some((item) => item.dirty || item.saving)
      ) {
        this.error.set($localize`Save every edited meal before completing the day.`);
        return;
      }
      const dateOwner = this.captureDateOwner();

      this.completing.set(true);
      this.error.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        if (!this.ownsDate(dateOwner)) return;
        const updated = await owner.wait(
          firstValueFrom(
            this.api.completeMyNutritionLog(day.dailyLogId, { version: day.logVersion }),
          ),
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
      try {
        const loaded = await owner.wait(
          firstValueFrom(this.api.getMyNutritionDay(dateOwner.selectedDate || undefined)),
        );
        if (!this.ownsDate(dateOwner)) return;
        this.day.set(loaded);
        this.drafts.reconcile(loaded);
        this.bumpDrafts();
      } catch (error) {
        if (!owner.current || !this.ownsDate(dateOwner)) return;
        this.day.set(null);
        this.error.set(
          apiErrorMessage(error, $localize`No authorized nutrition plan was found for this date.`),
        );
      } finally {
        if (owner.current && this.ownsDate(dateOwner)) {
          this.loading.set(false);
        }
      }
    });
  }

  private bumpDrafts(): void {
    this.draftRevision.update((value) => value + 1);
  }

  private captureDateOwner(): NutritionDateOwner {
    return { selectedDate: this.selectedDate, generation: this.dateGeneration };
  }

  private ownsDate(owner: NutritionDateOwner): boolean {
    return owner.generation === this.dateGeneration && owner.selectedDate === this.selectedDate;
  }

  private invalidateDateState(): void {
    ++this.dateGeneration;
    this.drafts.clear();
    this.day.set(null);
    this.loading.set(false);
    this.completing.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.bumpDrafts();
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    this.selectedDate = '';
    this.invalidateDateState();
    this.draftRevision.set(0);
  }
}
