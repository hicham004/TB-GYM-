import { NutritionDay } from './nutrition.models';

export interface NutritionChoiceDraft {
  slotId: string;
  choiceId: string;
  servings: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

export class NutritionChoiceDrafts {
  private readonly drafts = new Map<string, NutritionChoiceDraft>();

  reconcile(day: NutritionDay): void {
    for (const slot of day.slots) {
      const current = this.drafts.get(slot.id);
      if (current?.dirty || current?.saving) {
        continue;
      }

      const defaultChoice = slot.selectedChoiceId ?? slot.choices[0]?.id ?? '';
      const selected = slot.choices.find((choice) => choice.id === defaultChoice);
      this.drafts.set(slot.id, {
        slotId: slot.id,
        choiceId: defaultChoice,
        servings: String(slot.actualServings ?? selected?.servings ?? 1),
        dirty: false,
        saving: false,
        error: null,
      });
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
