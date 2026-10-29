import { NutritionDay, NutritionSlot } from './nutrition.models';

export interface NutritionChoiceDraft {
  slotId: string;
  choiceId: string;
  servings: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

/**
 * A meal as it stands: the option logged, or the coach's option 1 when nothing is (NUT-005), at the
 * servings logged or planned.
 */
function settled(slot: NutritionSlot): NutritionChoiceDraft {
  const choiceId = slot.selectedChoiceId ?? slot.choices[0]?.id ?? '';
  const chosen = slot.choices.find((choice) => choice.id === choiceId);
  return {
    slotId: slot.id,
    choiceId,
    servings: String(slot.actualServings ?? chosen?.servings ?? 1),
    dirty: false,
    saving: false,
    error: null,
  };
}

export class NutritionChoiceDrafts {
  private readonly drafts = new Map<string, NutritionChoiceDraft>();

  clear(): void {
    this.drafts.clear();
  }

  reconcile(day: NutritionDay): void {
    for (const slot of day.slots) {
      const current = this.drafts.get(slot.id);
      if (current?.dirty || current?.saving) {
        continue;
      }

      this.drafts.set(slot.id, settled(slot));
    }

    const valid = new Set(day.slots.map((slot) => slot.id));
    for (const slotId of this.drafts.keys()) {
      if (!valid.has(slotId)) {
        this.drafts.delete(slotId);
      }
    }
  }

  update(
    slotId: string,
    patch: Partial<Pick<NutritionChoiceDraft, 'choiceId' | 'servings'>>,
  ): void {
    const current = this.require(slotId);
    this.drafts.set(slotId, { ...current, ...patch, dirty: true, error: null });
  }

  /** The meal back as it stands, when the option it already has is chosen again: nothing to save. */
  restore(slot: NutritionSlot): void {
    this.require(slot.id);
    this.drafts.set(slot.id, settled(slot));
  }

  beginSave(slotId: string): NutritionChoiceDraft {
    const current = this.require(slotId);
    const saving = { ...current, saving: true, error: null };
    this.drafts.set(slotId, saving);
    return saving;
  }

  saved(slotId: string, day: NutritionDay): void {
    const slot = day.slots.find((candidate) => candidate.id === slotId);
    if (!slot) {
      return;
    }

    this.drafts.set(slotId, {
      slotId,
      choiceId: slot.selectedChoiceId ?? '',
      servings: String(slot.actualServings ?? 1),
      dirty: false,
      saving: false,
      error: null,
    });
    this.reconcile(day);
  }

  failed(slotId: string, message: string): void {
    const current = this.require(slotId);
    this.drafts.set(slotId, { ...current, saving: false, dirty: true, error: message });
  }

  get(slotId: string): NutritionChoiceDraft | undefined {
    return this.drafts.get(slotId);
  }

  values(): NutritionChoiceDraft[] {
    return [...this.drafts.values()];
  }

  private require(slotId: string): NutritionChoiceDraft {
    const value = this.drafts.get(slotId);
    if (!value) {
      throw new Error(`No nutrition draft exists for slot ${slotId}.`);
    }
    return value;
  }
}
