import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  LOCALE_ID,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import { clientRecipe, type ClientRecipe, type RecipeAmounts } from './client-recipe.models';
import type { NutritionChoice } from './nutrition.models';

/**
 * A recipe in the client's plan (M4, R4.4d), in the sheet their day opens: the photo, prep and cook
 * time, what the plan gives them of it, the ingredients and the method. It reads the copy made when
 * the plan was assigned (NUT-006), so the coach's later edits never change it. The ingredients list
 * the client's own portion first, and the whole recipe the method is written for on request; the
 * sheet prints alone (its opener marks it printable).
 */
@Component({
  selector: 'app-client-recipe',
  imports: [Button, Icon, SegmentedControl, Skeleton],
  templateUrl: './client-recipe.html',
  styleUrl: './client-recipe.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientRecipeSheet {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly document = inject(DOCUMENT);
  private generation = 0;

  readonly recipeId = input.required<string>();
  /** The option the client opened it from: their servings and that portion's numbers. */
  readonly choice = input.required<NutritionChoice>();

  protected readonly recipe = signal<ClientRecipe | null>(null);
  protected readonly failed = signal(false);
  protected readonly photoUrl = signal<string | null>(null);
  /** The amounts asked for; a recipe whose portion is the whole of it lists the whole recipe's. */
  protected readonly amounts = signal<RecipeAmounts>('portion');
  protected readonly shownAmounts = computed<RecipeAmounts>(() =>
    this.recipe()?.scaled ? this.amounts() : 'whole',
  );
  protected readonly amountOptions: readonly SegmentOption[] = [
    { value: 'portion', label: $localize`Your portion` },
    { value: 'whole', label: $localize`Whole recipe` },
  ];

  constructor() {
    effect(() => {
      const id = this.recipeId();
      untracked(() => void this.load(id));
    });
  }

  protected retry(): void {
    void this.load(this.recipeId());
  }

  protected showAmounts(value: string): void {
    this.amounts.set(value === 'whole' ? 'whole' : 'portion');
  }

  /** The browser's print dialog, which also saves a PDF; the page prints this sheet alone. */
  protected print(): void {
    this.document.defaultView?.print();
  }

  protected photoAlt(name: string): string {
    return $localize`${name}:recipeName:, as your coach made it`;
  }

  private async load(id: string): Promise<void> {
    const generation = ++this.generation;
    this.recipe.set(null);
    this.photoUrl.set(null);
    this.failed.set(false);
    this.amounts.set('portion');
    try {
      const view = await firstValueFrom(this.api.getMyPlanRecipe(id));
      if (generation !== this.generation) return;
      this.recipe.set(clientRecipe(view, this.choice(), this.locale));
      if (view.photoMediaAssetId) void this.loadPhoto(view.photoMediaAssetId, generation);
    } catch {
      if (generation === this.generation) this.failed.set(true);
    }
  }

  /** A photo is a short-lived grant, not a public address; the recipe reads fine without it. */
  private async loadPhoto(assetId: string, generation: number): Promise<void> {
    try {
      await this.csrf.refresh();
      const access = await firstValueFrom(this.api.createMediaAccess(assetId));
      if (generation === this.generation) this.photoUrl.set(access.url);
    } catch {
      // The photo's place stays empty; nothing else depends on it.
    }
  }
}
