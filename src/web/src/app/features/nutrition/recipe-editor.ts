import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
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
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type { RecipeDetail } from '../../core/api/generated';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink, IconButton } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import { numeric } from '../training/training-builder.models';
import { RecipeApi } from './recipe-api';
import { RecipeFoodSearch } from './recipe-food-search';
import {
  allergenText,
  draftFromDetail,
  draftSignature,
  type EditorLine,
  emptyDraft,
  energySplit,
  grams,
  ingredientRequests,
  kcal,
  lineForFood,
  lineMacros,
  linesFromSuggestion,
  matchLine,
  MAX_INSTRUCTIONS,
  MAX_MINUTES,
  MAX_RECIPE_NAME,
  perServing,
  readSuggestion,
  recipeAllergens,
  type RecipeDraft,
  type RecipeFood,
  useNewerFood,
  type RecipeProblem,
  recipeProblem,
  recipeTotal,
  servingsLabel,
  sourceWord,
  unitWord,
} from './recipe.models';

/** The photo kinds and size the server takes (MED-004, MED-014); checked here only to answer sooner. */
const PHOTO_TYPES = ['image/jpeg', 'image/png'];
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const AI_PROMPT_MAX = 6000;

type SaveKind = 'publish' | 'draft';

/**
 * The recipe editor (C7, R4.4b): the ingredients from a food search with each serving's calories and
 * macros adding up as they are typed, the method, a cover photo, and Publish, which puts the recipe
 * in the meal plans' recipe panel. Save as draft keeps it out of them. A new recipe can start from
 * an AI suggestion, whose ingredients the coach matches to real foods first (NUT-004).
 *
 * Every save is a new version on the server; a version already published never changes, so meal
 * plans and clients keep what they were given (ADR 0008).
 */
@Component({
  selector: 'app-recipe-editor',
  imports: [
    Button,
    ButtonLink,
    Control,
    Field,
    FormsModule,
    Icon,
    IconButton,
    RecipeFoodSearch,
    RouterLink,
    Skeleton,
    StatusPill,
    UiConfirm,
    UiMenu,
  ],
  templateUrl: './recipe-editor.html',
  styleUrl: './recipe-editor.scss',
  host: {
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class RecipeEditor implements HoldsUnsavedWork {
  private readonly api = inject(RecipeApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly document = inject(DOCUMENT);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly aiFeedback = viewChild<ElementRef<HTMLElement>>('aiFeedback');
  private readonly totalsCard = viewChild<ElementRef<HTMLElement>>('totalsCard');
  /** The One serving card is on screen, so the phone's bar would only repeat it. */
  protected readonly totalsInView = signal(true);
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private loadedKey: string | null = null;
  private savedSignature = draftSignature(emptyDraft());
  /** A photo chosen on this device is shown from memory until the page goes. */
  private localPhotoUrl: string | null = null;
  private csrfReady: Promise<void> | null = null;

  protected readonly closeLabel = $localize`Close`;
  protected readonly loadingLabel = $localize`Loading the recipe…`;
  protected readonly maxName = MAX_RECIPE_NAME;
  protected readonly maxInstructions = MAX_INSTRUCTIONS;
  protected readonly maxMinutes = MAX_MINUTES;
  protected readonly aiPromptMax = AI_PROMPT_MAX;
  protected readonly unitWord = unitWord;
  protected readonly sourceWord = sourceWord;

  /** The recipe in the address, or null for a new one (`/nutrition/recipes/new`). */
  protected readonly recipeId = computed(() => {
    const id = this.params().get('recipeId');
    return id && id !== 'new' ? id : null;
  });
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly detail = signal<RecipeDetail | null>(null);
  protected readonly draft = signal<RecipeDraft>(emptyDraft());
  protected readonly saving = signal<SaveKind | null>(null);
  protected readonly problem = signal<RecipeProblem | null>(null);
  protected readonly saveError = signal<string | null>(null);
  /** Someone saved the recipe since it opened here (409 `recipe_changed`). */
  protected readonly stale = signal(false);
  /** A short, polite sentence for screen readers after a change the page shows in place. */
  protected readonly announced = signal('');
  protected readonly photoUrl = signal<string | null>(null);
  protected readonly photoBusy = signal(false);
  protected readonly photoError = signal<string | null>(null);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );

  // AI suggestions (a new recipe only).
  protected readonly aiConfigured = signal<boolean | null>(null);
  protected readonly aiOpen = signal(false);
  protected readonly aiPrompt = signal('');
  protected readonly aiBusy = signal(false);
  protected readonly aiError = signal<string | null>(null);
  /** The suggestion this recipe started from; saving approves it as the coach shaped it. */
  protected readonly aiOperationId = signal<string | null>(null);

  protected readonly isNew = computed(() => this.recipeId() === null);
  protected readonly dirty = computed(() => draftSignature(this.draft()) !== this.savedSignature);
  protected readonly total = computed(() => recipeTotal(this.draft().lines));
  protected readonly serving = computed(() => perServing(this.total(), this.draft().servings));
  /** At least one line counts: a food with an amount. Until then there is no serving to show. */
  protected readonly counted = computed(() =>
    this.draft().lines.some((line) => lineMacros(line) !== null),
  );
  protected readonly split = computed(() => {
    const serving = this.serving();
    return serving ? energySplit(serving) : null;
  });
  protected readonly allergens = computed(() => allergenText(recipeAllergens(this.draft().lines)));
  protected readonly unmatched = computed(
    () => this.draft().lines.filter((line) => !line.food).length,
  );
  /** Lines whose food was edited since the recipe was saved (R4.4c). */
  protected readonly newerCount = computed(
    () => this.draft().lines.filter((line) => line.newer).length,
  );
  protected readonly pageTitle = computed(
    () => this.draft().name.trim() || (this.isNew() ? $localize`New recipe` : $localize`Recipe`),
  );
  /** Where the recipe stands, said once beside its actions. */
  protected readonly standing = computed<{ label: string; tone: 'neutral' | 'success' | 'warm' }>(
    () => {
      const detail = this.detail();
      if (!detail) return { label: $localize`New recipe`, tone: 'neutral' };
      if (detail.latest.status === 'Published') {
        return this.dirty()
          ? { label: $localize`Changes not published`, tone: 'warm' }
          : { label: $localize`Published`, tone: 'success' };
      }
      return detail.publishedVersionId
        ? { label: $localize`Changes not published`, tone: 'warm' }
        : { label: $localize`Draft`, tone: 'neutral' };
    },
  );
  protected readonly standingNote = computed(() => {
    const detail = this.detail();
    if (!detail) return $localize`Publish it to use it in meal plans.`;
    if (detail.latest.status === 'Published' && !this.dirty()) {
      return $localize`In your meal plans’ recipes. Changes become a new version; plans keep the one they have.`;
    }
    return detail.publishedVersionId
      ? $localize`Meal plans use the published version until you publish these changes.`
      : $localize`Not in meal plans until you publish it.`;
  });
  /** Published and unchanged: Publish has nothing to do, as the status beside it says. */
  protected readonly nothingToPublish = computed(
    () => this.detail()?.latest.status === 'Published' && !this.dirty(),
  );
  protected readonly moreItems = computed<UiMenuItem[]>(() => [
    {
      label: $localize`Save as draft`,
      hint: $localize`Kept here, out of meal plans`,
      action: 'draft',
    },
  ]);

  constructor() {
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.forgetLocalPhoto();
    });
    this.scope.onReset(() => {
      this.loadedKey = null;
      this.state.set('loading');
    });
    // The phone's serving bar shows only while the One serving card is scrolled away.
    let observer: IntersectionObserver | null = null;
    effect(() => {
      const card = this.totalsCard()?.nativeElement;
      observer?.disconnect();
      observer = null;
      if (!card || typeof IntersectionObserver === 'undefined') return;
      // A sliver of the card does not show its numbers, so it counts once most of it is on screen.
      observer = new IntersectionObserver(
        ([entry]) => this.totalsInView.set(entry.intersectionRatio >= 0.6),
        { threshold: [0, 0.6, 1] },
      );
      observer.observe(card);
    });
    inject(DestroyRef).onDestroy(() => observer?.disconnect());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const id = this.recipeId();
      const key = `${tenantId}:${id ?? 'new'}`;
      if (tenantId && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load(id);
      }
    });
  }

  // ---------- loading ----------

  protected retry(): void {
    void this.load(this.recipeId());
  }

  private async load(recipeId: string | null): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      this.problem.set(null);
      this.saveError.set(null);
      this.stale.set(false);
      try {
        if (recipeId) {
          const detail = await owner.wait(firstValueFrom(this.api.getRecipe(recipeId)));
          this.show(detail);
          await owner.wait(this.grantPhoto(detail.latest.photoMediaAssetId));
        } else {
          this.detail.set(null);
          this.setDraft(emptyDraft());
          this.photoUrl.set(null);
          this.state.set('ready');
          await owner.wait(this.checkAi());
        }
        this.focusHeading();
      } catch (error) {
        if (!owner.current) return;
        this.state.set(
          error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error',
        );
      }
    });
  }

  private show(detail: RecipeDetail): void {
    this.detail.set(detail);
    this.setDraft(draftFromDetail(detail));
    this.state.set('ready');
  }

  private setDraft(draft: RecipeDraft): void {
    this.draft.set(draft);
    this.savedSignature = draftSignature(draft);
  }

  private async grantPhoto(photoId: string | null): Promise<void> {
    if (!photoId) {
      this.photoUrl.set(null);
      return;
    }
    try {
      await this.freshToken();
      const batch = await firstValueFrom(this.api.grantPhotos([photoId]));
      this.photoUrl.set(batch.items[0]?.url ?? null);
    } catch {
      this.photoUrl.set(null);
    }
  }

  private async checkAi(): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.aiAvailability());
      this.aiConfigured.set(result.isConfigured);
    } catch {
      this.aiConfigured.set(false);
    }
  }

  // ---------- editing ----------

  protected change(patch: Partial<RecipeDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...patch }));
    this.clearProblemIfSolved();
  }

  protected servingsTyped(value: string): void {
    const parsed = value.trim() === '' ? null : Number(value);
    this.change({ servings: parsed === null || Number.isNaN(parsed) ? null : parsed });
  }

  /** A prep or cook time as typed; an empty box means none given. */
  protected minutesTyped(field: 'prepMinutes' | 'cookMinutes', value: string): void {
    const parsed = value.trim() === '' ? null : Number(value);
    this.change({ [field]: parsed === null || Number.isNaN(parsed) ? null : parsed });
  }

  protected addFood(food: RecipeFood): void {
    this.change({ lines: [...this.draft().lines, lineForFood(food)] });
    // The new line is the visible answer; a screen reader hears it said, with no toast to pile up.
    this.announced.set($localize`${food.name}:food: added.`);
  }

  protected matchFood(line: EditorLine, food: RecipeFood): void {
    this.change({
      lines: this.draft().lines.map((item) =>
        item.key === line.key ? matchLine(item, food) : item,
      ),
    });
    this.announced.set($localize`${food.name}:food: chosen.`);
  }

  /** Takes the food's numbers as they are now into one line, or every line offered them. */
  protected useNewer(line: EditorLine | null): void {
    const offered = this.draft().lines.filter(
      (item) => item.newer && (!line || item.key === line.key),
    );
    if (!offered.length) return;
    this.change({
      lines: this.draft().lines.map((item) => (offered.includes(item) ? useNewerFood(item) : item)),
    });
    const said =
      offered.length === 1
        ? $localize`${offered[0].newer?.name ?? ''}:food: now has its new numbers.`
        : $localize`${offered.length}:count: foods now have their new numbers.`;
    const retype = offered.some((item) => item.food?.unit !== item.newer?.unit)
      ? $localize`A food is now measured in another unit, so type its amount again.`
      : '';
    this.announced.set(retype ? `${said} ${retype}` : said);
  }

  protected newerText(line: EditorLine): string {
    return $localize`${line.newer?.name ?? ''}:food: was edited since this recipe was saved.`;
  }

  protected quantityTyped(line: EditorLine, value: string): void {
    const parsed = value.trim() === '' ? null : Number(value);
    this.change({
      lines: this.draft().lines.map((item) =>
        item.key === line.key
          ? { ...item, quantity: parsed === null || Number.isNaN(parsed) ? null : parsed }
          : item,
      ),
    });
  }

  protected removeLine(line: EditorLine): void {
    const lines = this.draft().lines;
    const index = lines.findIndex((item) => item.key === line.key);
    this.change({ lines: lines.filter((item) => item.key !== line.key) });
    this.announced.set(
      $localize`${line.food?.name ?? line.suggestion?.name ?? ''}:ingredient: removed.`,
    );
    // Focus moves to the next line's amount, or to the search, never to the page's top.
    afterNextRender(
      () => {
        const next = lines[index + 1] ?? lines[index - 1];
        const target =
          (next && this.document.getElementById(`amount-${next.key}`)) ??
          this.document.getElementById('add-ingredient');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  protected lineKcal(line: EditorLine): string {
    const macros = lineMacros(line);
    return macros ? kcal(macros.calories, this.locale) : '';
  }

  protected lineDetail(line: EditorLine): string {
    const food = line.food;
    if (!food) return '';
    const macros = lineMacros(line);
    return macros
      ? $localize`${sourceWord(food.source)}:source: · P ${grams(macros.protein, this.locale)}:protein: · C ${grams(macros.carbs, this.locale)}:carbs: · F ${grams(macros.fat, this.locale)}:fat:`
      : sourceWord(food.source);
  }

  protected suggestionText(line: EditorLine): string {
    const suggestion = line.suggestion;
    if (!suggestion) return '';
    return $localize`Suggested: ${suggestion.quantity}:quantity: ${suggestion.unit}:unit: ${suggestion.name}:ingredient:`;
  }

  protected amountLabel(food: string): string {
    return $localize`Amount of ${food}:food:`;
  }

  protected matchLabel(line: EditorLine): string {
    return $localize`Choose a food for ${line.suggestion?.name ?? ''}:ingredient:`;
  }

  protected removeLabel(line: EditorLine): string {
    return $localize`Remove ${line.food?.name ?? line.suggestion?.name ?? ''}:ingredient:`;
  }

  protected dockMacros(): string {
    const one = this.serving();
    return one
      ? $localize`a serving · P ${grams(one.protein, this.locale)}:protein: · C ${grams(one.carbs, this.locale)}:carbs: · F ${grams(one.fat, this.locale)}:fat:`
      : '';
  }

  protected kcalText(value: number): string {
    return kcal(value, this.locale);
  }

  protected gramsText(value: number): string {
    return grams(value, this.locale);
  }

  protected wholeRecipe(): string {
    const servings = this.draft().servings;
    const total = kcal(this.total().calories, this.locale);
    return servings && servings > 0
      ? $localize`Whole recipe: ${total}:calories:, ${servingsLabel(servings, this.locale)}:servings:`
      : $localize`Whole recipe: ${total}:calories:`;
  }

  /** The messages a field shows now: only the problem that stopped the last save, if it is that field's. */
  protected errorsFor(field: RecipeProblem['field'], lineKey?: string): string[] | null {
    const problem = this.problem();
    if (!problem || problem.field !== field) return null;
    if (lineKey !== undefined && problem.lineKey !== lineKey) return null;
    if (lineKey === undefined && problem.lineKey) return null;
    return [problem.message];
  }

  private clearProblemIfSolved(): void {
    const problem = this.problem();
    if (!problem) return;
    const next = recipeProblem(this.draft());
    if (!next || next.field !== problem.field || next.lineKey !== problem.lineKey) {
      this.problem.set(null);
    }
  }

  // ---------- photo ----------

  protected async photoChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoError.set(null);
    if (!PHOTO_TYPES.includes(file.type)) {
      this.photoError.set($localize`Choose a JPEG or PNG photo.`);
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      this.photoError.set($localize`That photo is over 15 MB. Choose a smaller one.`);
      return;
    }
    return this.scope.run('photo', async (owner) => {
      this.photoBusy.set(true);
      try {
        const uploaded = await this.write(owner, () => this.api.uploadPhoto(file));
        this.forgetLocalPhoto();
        this.localPhotoUrl = URL.createObjectURL(file);
        this.photoUrl.set(this.localPhotoUrl);
        this.change({ photoId: uploaded.id });
      } catch (error) {
        if (!owner.current) return;
        this.photoError.set(photoUploadError(error));
      } finally {
        if (owner.current) this.photoBusy.set(false);
      }
    });
  }

  protected removePhoto(): void {
    this.forgetLocalPhoto();
    this.photoUrl.set(null);
    this.change({ photoId: null });
  }

  private forgetLocalPhoto(): void {
    if (this.localPhotoUrl) URL.revokeObjectURL(this.localPhotoUrl);
    this.localPhotoUrl = null;
  }

  // ---------- AI suggestion ----------

  protected async suggest(): Promise<void> {
    const prompt = this.aiPrompt().trim();
    if (!prompt || prompt.length > AI_PROMPT_MAX) {
      this.aiError.set(
        $localize`Describe the meal in a sentence or two, like “chicken shawarma bowl with rice and garlic sauce”.`,
      );
      this.focusAiFeedback();
      return;
    }
    return this.scope.run('suggest', async (owner) => {
      this.aiBusy.set(true);
      this.aiError.set(null);
      try {
        const view = await this.write(owner, () => this.api.suggest(prompt));
        const suggestion = readSuggestion(view.validatedDraftJson);
        if (!suggestion || suggestion.ingredients.length === 0) {
          this.aiError.set(
            $localize`The suggestion came back empty. Try describing the meal differently.`,
          );
          this.focusAiFeedback();
          return;
        }
        this.aiOperationId.set(view.id);
        const draft = this.draft();
        this.change({
          name: draft.name.trim() ? draft.name : suggestion.name,
          lines: [...draft.lines, ...linesFromSuggestion(suggestion.ingredients)],
        });
        this.aiOpen.set(false);
        this.toast.show(
          $localize`Suggestion added. Choose a food for each ingredient, then check the amounts.`,
          { tone: 'success' },
        );
        this.focusFirstUnmatched();
      } catch (error) {
        if (!owner.current) return;
        this.aiError.set(
          apiErrorMessage(
            error,
            $localize`AI suggestions are not available right now. You can still write the recipe yourself.`,
          ),
        );
        this.focusAiFeedback();
      } finally {
        if (owner.current) this.aiBusy.set(false);
      }
    });
  }

  /** Drops the suggested ingredients not matched yet, and turns the suggestion down on the server. */
  protected async dropSuggestion(): Promise<void> {
    const operationId = this.aiOperationId();
    this.change({ lines: this.draft().lines.filter((line) => line.food || !line.suggestion) });
    this.aiOperationId.set(null);
    if (!operationId) return;
    return this.scope.run('reject', async (owner) => {
      try {
        await this.write(owner, () =>
          this.api.review(operationId, {
            approved: false,
            reason: 'Coach turned the suggestion down.',
            recipeName: null,
            instructions: null,
            servings: null,
            ingredientMappings: [],
          }),
        );
      } catch {
        // Nothing was saved from it either way; the operation simply stays awaiting review.
      }
    });
  }

  private focusAiFeedback(): void {
    afterNextRender(() => this.aiFeedback()?.nativeElement.focus(), { injector: this.injector });
  }

  private focusFirstUnmatched(): void {
    afterNextRender(
      () => {
        const line = this.draft().lines.find((item) => !item.food);
        if (line) this.document.getElementById(`match-${line.key}`)?.focus();
      },
      { injector: this.injector },
    );
  }

  // ---------- saving ----------

  protected chosen(action: string): void {
    if (action === 'draft') void this.save('draft');
  }

  protected async save(kind: SaveKind): Promise<void> {
    if (this.saving()) return;
    const draft = this.draft();
    const problem = recipeProblem(draft);
    this.problem.set(problem);
    this.saveError.set(null);
    if (problem) {
      this.focusProblem(problem);
      return;
    }
    const detail = this.detail();
    const publish = kind === 'publish';
    // Nothing changed: publishing an existing draft needs no new version, and a draft is kept already.
    if (detail && !this.dirty()) {
      if (!publish) {
        this.toast.show($localize`No changes to save.`);
        return;
      }
      if (detail.latest.status === 'Published') {
        this.toast.show($localize`This recipe is already published.`);
        return;
      }
    }

    return this.scope.run('save', async (owner) => {
      this.saving.set(kind);
      try {
        let recipeId: string;
        if (detail && !this.dirty()) {
          await this.write(owner, () => this.api.publishVersion(detail.latest.id));
          recipeId = detail.id;
        } else if (detail) {
          const renamed = draft.name.trim() !== detail.name;
          const saved = await this.write(owner, () =>
            this.api.addVersion(detail.id, {
              instructions: draft.instructions.trim(),
              servings: draft.servings ?? 1,
              ingredients: ingredientRequests(draft.lines),
              name: renamed ? draft.name.trim() : null,
              photoMediaAssetId: draft.photoId,
              publish,
              baseRevision: numeric(detail.currentRevision),
              prepMinutes: draft.prepMinutes,
              cookMinutes: draft.cookMinutes,
            }),
          );
          recipeId = saved.id;
        } else if (this.aiOperationId()) {
          const operationId = this.aiOperationId()!;
          const view = await this.write(owner, () =>
            this.api.review(operationId, {
              approved: true,
              reason: 'Coach matched every ingredient to a food and checked the amounts.',
              recipeName: draft.name.trim(),
              instructions: draft.instructions.trim(),
              servings: draft.servings ?? 1,
              ingredientMappings: ingredientRequests(draft.lines),
              photoMediaAssetId: draft.photoId,
              publish,
              prepMinutes: draft.prepMinutes,
              cookMinutes: draft.cookMinutes,
            }),
          );
          recipeId = view.createdRecipeId ?? '';
          this.aiOperationId.set(null);
        } else {
          const saved = await this.write(owner, () =>
            this.api.createRecipe({
              name: draft.name.trim(),
              instructions: draft.instructions.trim(),
              servings: draft.servings ?? 1,
              ingredients: ingredientRequests(draft.lines),
              photoMediaAssetId: draft.photoId,
              publish,
              prepMinutes: draft.prepMinutes,
              cookMinutes: draft.cookMinutes,
            }),
          );
          recipeId = saved.id;
        }

        const fresh = await owner.wait(firstValueFrom(this.api.getRecipe(recipeId)));
        this.loadedKey = `${owner.tenantId}:${recipeId}`;
        this.show(fresh);
        if (!detail) {
          await owner.wait(
            this.router.navigate(['/nutrition/recipes', recipeId], { replaceUrl: true }),
          );
        }
        this.toast.show(
          publish
            ? $localize`Published. It’s in your meal plans’ recipes now.`
            : $localize`Saved as a draft. It stays out of meal plans until you publish it.`,
          { tone: 'success' },
        );
      } catch (error) {
        if (!owner.current) return;
        this.saveRefused(error);
      } finally {
        if (owner.current) this.saving.set(null);
      }
    });
  }

  private saveRefused(error: unknown): void {
    const body =
      error instanceof HttpErrorResponse
        ? (error.error as { code?: unknown; errors?: Record<string, string[]> } | null)
        : null;
    if (body?.code === 'recipe_changed') {
      this.stale.set(true);
      return;
    }
    if (body?.errors?.['photoMediaAssetId']) {
      this.photoError.set($localize`This photo can’t be used. Choose it again.`);
    }
    this.saveError.set(
      apiErrorMessage(
        error,
        $localize`The recipe could not be saved. Your changes are still here; try again.`,
      ),
    );
  }

  /** Reloads the newest version after another save, dropping the changes made here. */
  protected reloadNewest(): void {
    this.loadedKey = null;
    void this.load(this.recipeId());
  }

  private focusProblem(problem: RecipeProblem): void {
    afterNextRender(
      () => {
        const byId = (id: string) => this.document.getElementById(id);
        const line = problem.lineKey
          ? (byId(`match-${problem.lineKey}`) ?? byId(`amount-${problem.lineKey}`))
          : null;
        const target =
          problem.field === 'lines'
            ? (line ?? byId('add-ingredient'))
            : byId(`recipe-${problem.field}`);
        target?.focus();
        target?.scrollIntoView?.({ block: 'center' });
      },
      { injector: this.injector },
    );
  }

  private focusHeading(): void {
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  // ---------- leaving ----------

  async canLeave(): Promise<boolean> {
    if (!this.dirty() || this.state() !== 'ready') return true;
    return this.ask({
      message: $localize`Your changes to this recipe aren’t saved. If you leave now, they are lost.`,
      confirm: $localize`Leave without saving`,
      cancel: $localize`Stay`,
    });
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty() && this.state() === 'ready') {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  private async ask(question: {
    message: string;
    confirm: string;
    cancel: string;
  }): Promise<boolean> {
    this.asking.set(question);
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title: $localize`Leave without saving?`,
      closeLabel: this.closeLabel,
      closeOnNavigation: false,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  // ---------- requests ----------

  /** Sends a write with a fresh antiforgery token, retrying once if the token had expired. */
  private async write<T>(owner: TenantOperation, call: () => Observable<T>): Promise<T> {
    await owner.wait(this.freshToken());
    try {
      return await owner.wait(firstValueFrom(call()));
    } catch (error) {
      const expired =
        error instanceof HttpErrorResponse &&
        error.status === 400 &&
        (error.error as { code?: unknown } | null)?.code === 'antiforgery_token_invalid';
      if (!expired) throw error;
      this.csrfReady = null;
      await owner.wait(this.freshToken());
      return await owner.wait(firstValueFrom(call()));
    }
  }

  private freshToken(): Promise<void> {
    this.csrfReady ??= this.csrf.refresh().catch((error: unknown) => {
      this.csrfReady = null;
      throw error;
    });
    return this.csrfReady;
  }
}

/** Why a photo upload failed, in the coach's words. */
export function photoUploadError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 429)
      return $localize`Another upload is still going. Try again in a moment.`;
    if (error.status === 409) return $localize`Your coaching space has no room left for photos.`;
    if (error.status === 400)
      return $localize`That file couldn’t be read as a photo. Choose a JPEG or PNG.`;
  }
  return $localize`The photo couldn’t be uploaded. Try again.`;
}
