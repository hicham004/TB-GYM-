import { DOCUMENT, formatDate, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  InjectionToken,
  Injector,
  LOCALE_ID,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CreateRecipeDraftRequest,
  RecipeDetail,
  RecipeDraftContent,
  RecipeDraftView,
  RecipeSummary,
} from '../../core/api/generated';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { MediaUploads } from '../../core/system/media-uploads';
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
import {
  AUTOSAVE_TIMING,
  type AutosaveTiming,
  DraftAutosave,
  type SaveOutcome,
} from '../training/program-autosave';
import { numeric } from '../training/training-builder.models';
import { type Conversion, conversionWords } from './cooking-conversion.models';
import { RecipeApi } from './recipe-api';
import { type CookingChoice, RecipeCookingSheets } from './recipe-cooking-sheets';
import { RecipeFoodSearch } from './recipe-food-search';
import {
  allergenText,
  draftFromDetail,
  draftFromStored,
  type EditorLine,
  emptyDraft,
  energySplit,
  grams,
  IN_PROGRESS,
  kcal,
  keepsAmount,
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
  toDraftContent,
  unitWord,
  weighable,
  weighCooked,
  weighedThrough,
  weighRaw,
} from './recipe.models';

/** The photo kinds and size the server takes (MED-004, MED-014); checked here only to answer sooner. */
const PHOTO_TYPES = ['image/jpeg', 'image/png'];
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const AI_PROMPT_MAX = 6000;
/** How long leaving waits for the last changes to reach the server before it asks. */
const LEAVE_WAIT_MS = 8000;

/** The editor's autosave timing; a spec provides its own to save at once or to hold saves back. */
export const RECIPE_AUTOSAVE_TIMING = new InjectionToken<AutosaveTiming>('RECIPE_AUTOSAVE_TIMING', {
  factory: () => AUTOSAVE_TIMING,
});

type SaveKind = 'publish' | 'draft';

/** The coach's draft on the server (NUT-014): its id and the version the next save carries. */
interface StoredDraft {
  id: string;
  version: number;
}

interface SaveProblem {
  kind: 'stale' | 'refused' | 'closed';
  message: string;
}

/**
 * The recipe editor (C7, R4.4b): the ingredients from a food search with each serving's calories and
 * macros adding up as they are typed, the method, a cover photo, and Publish, which puts the recipe
 * in the meal plans' recipe panel. A new recipe can start from an AI suggestion, whose ingredients
 * the coach matches to real foods first (NUT-004).
 *
 * Since critique B5d the coach's changes are kept as they type in their own draft on the server
 * (NUT-014, ADR 0033), which follows them to any device and nobody else sees: unfinished, "In
 * progress". Publish turns it into a new version for meal plans; Save as draft into a complete one
 * the team sees and meal plans do not use. A version already made never changes, so meal plans and
 * clients keep what they were given (ADR 0008).
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
    RecipeCookingSheets,
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
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
})
export class RecipeEditor implements HoldsUnsavedWork {
  private readonly api = inject(RecipeApi);
  private readonly csrf = inject(CsrfService);
  protected readonly uploadsOff = inject(MediaUploads).off;
  private readonly tenants = inject(TenantStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly aiFeedback = viewChild<ElementRef<HTMLElement>>('aiFeedback');
  private readonly totalsCard = viewChild<ElementRef<HTMLElement>>('totalsCard');
  /** The One serving card is on screen, so the phone's bar would only repeat it. */
  protected readonly totalsInView = signal(true);
  /** A line weighed cooked gives every amount its wider room, so they still line up (INV-6). */
  protected readonly hasCookedLine = computed(() =>
    this.draft().lines.some((line) => line.cooked !== null),
  );
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private readonly cookingSheets = viewChild(RecipeCookingSheets);
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private loadedKey: string | null = null;
  private csrfReady: Promise<void> | null = null;
  private stored: StoredDraft | null = null;
  /** Moves whenever the page lets go of its draft, so a save landing afterwards changes nothing. */
  private draftEpoch = 0;
  /** The recipe's newest revision as read, which a new draft of it records (NUT-014). */
  private readNewest = 0;
  private announcedTrouble = false;

  protected readonly closeLabel = $localize`Close`;
  protected readonly loadingLabel = $localize`Loading the recipe…`;
  protected readonly maxName = MAX_RECIPE_NAME;
  protected readonly maxInstructions = MAX_INSTRUCTIONS;
  protected readonly maxMinutes = MAX_MINUTES;
  protected readonly aiPromptMax = AI_PROMPT_MAX;
  protected readonly unitWord = unitWord;
  protected readonly sourceWord = sourceWord;
  protected readonly weighable = weighable;
  protected readonly locale = inject(LOCALE_ID);
  protected readonly weighCookedText = $localize`Weigh it cooked`;
  protected readonly changeConversionText = $localize`Change conversion`;

  /** The recipe in the address, or null for a new one (`/nutrition/recipes/new`). */
  protected readonly recipeId = computed(() => {
    const id = this.params().get('recipeId');
    return id && id !== 'new' ? id : null;
  });
  /** A new recipe not saved yet, reopened from its draft (`/nutrition/recipes/new?draft=`). */
  private readonly requestedDraft = computed(() => this.query().get('draft'));
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly detail = signal<RecipeDetail | null>(null);
  protected readonly draft = signal<RecipeDraft>(emptyDraft());
  protected readonly saving = signal<SaveKind | null>(null);
  protected readonly problem = signal<RecipeProblem | null>(null);
  protected readonly saveError = signal<string | null>(null);
  /** Why the changes stopped reaching the server, and what the coach can do about it. */
  protected readonly saveProblem = signal<SaveProblem | null>(null);
  /** Someone saved a version after these changes began; the next save asks to go on anyway. */
  protected readonly newerVersion = signal<{ message: string; kind: SaveKind } | null>(null);
  protected readonly hasDraft = signal(false);
  protected readonly draftSavedAt = signal<string | null>(null);
  protected readonly draftStartedAt = signal(0);
  protected readonly autosave = new DraftAutosave(
    () => this.sendDraft(),
    inject(RECIPE_AUTOSAVE_TIMING),
  );
  /** A short, polite sentence for screen readers after a change the page shows in place. */
  protected readonly announced = signal('');
  /** What a screen reader is told about saving: a failure, and the save that ends it. */
  protected readonly liveStatus = signal('');
  protected readonly photoUrl = signal<string | null>(null);
  protected readonly photoBusy = signal(false);
  protected readonly photoError = signal<string | null>(null);
  protected readonly asking = signal<{
    title: string;
    message: string;
    confirm: string;
    cancel: string;
  } | null>(null);

  // AI suggestions (a new recipe only).
  protected readonly aiConfigured = signal<boolean | null>(null);
  protected readonly aiOpen = signal(false);
  protected readonly aiPrompt = signal('');
  protected readonly aiBusy = signal(false);
  protected readonly aiError = signal<string | null>(null);
  /** The suggestion this recipe started from; saving approves it as the coach shaped it. */
  protected readonly aiOperationId = signal<string | null>(null);

  protected readonly isNew = computed(() => this.recipeId() === null);
  protected readonly unsaved = computed(() => this.autosave.status() !== 'saved');
  protected readonly troubled = computed(() =>
    ['retrying', 'refused', 'stopped'].includes(this.autosave.status()),
  );
  /** Changes not made a version yet: the coach's draft, or edits on their way to it. */
  protected readonly pending = computed(() => this.hasDraft() || this.unsaved());
  protected readonly inProgressLabel = IN_PROGRESS;
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
  /**
   * Where the recipe stands for the team, said once beside its actions: published, a complete draft
   * version, or a new recipe; the coach's own changes in progress are said beside it (critique B5d).
   */
  protected readonly standing = computed<{
    label: string;
    tone: 'neutral' | 'success' | 'warm';
  } | null>(() => {
    const detail = this.detail();
    if (!detail) return this.pending() ? null : { label: $localize`New recipe`, tone: 'neutral' };
    if (detail.latest.status === 'Published') {
      return { label: $localize`Published`, tone: 'success' };
    }
    return detail.publishedVersionId
      ? { label: $localize`Changes not published`, tone: 'warm' }
      : { label: $localize`Draft`, tone: 'neutral' };
  });
  protected readonly standingNote = computed(() => {
    const detail = this.detail();
    if (this.pending()) {
      if (!detail) return $localize`Only you see it until you publish it.`;
      return detail.publishedVersionId
        ? $localize`Only you see these changes. Meal plans use the published version until you publish them.`
        : $localize`Only you see these changes. Not in meal plans until you publish it.`;
    }
    if (!detail)
      return $localize`Your changes save as you type. Publish it to use it in meal plans.`;
    if (detail.latest.status === 'Published') {
      return $localize`In your meal plans’ recipes. Changes become a new version; plans keep the one they have.`;
    }
    return detail.publishedVersionId
      ? $localize`Meal plans use the published version until you publish these changes.`
      : $localize`Not in meal plans until you publish it.`;
  });
  /** How the coach's changes stand on the server; nothing while there are none. */
  protected readonly statusLine = computed(() => {
    switch (this.autosave.status()) {
      case 'pending':
      case 'saving':
        return $localize`Saving…`;
      case 'retrying':
        return $localize`Not saved yet. Trying again…`;
      case 'refused':
      case 'stopped':
        return $localize`Not saved`;
    }
    return this.hasDraft() ? this.savedLine(this.draftSavedAt()) : null;
  });
  /** A version saved by someone else since these changes began (NUT-014). */
  protected readonly behindLine = computed(() => {
    const detail = this.detail();
    const started = this.draftStartedAt();
    if (!detail || !this.hasDraft() || started === 0 || this.newerVersion()) return null;
    const newest = numeric(detail.currentRevision);
    return newest > started
      ? $localize`Version ${newest}:number: of this recipe was saved after you started these changes. Publishing yours makes it the newest version.`
      : null;
  });
  /** Published and unchanged: Publish has nothing to do, as the status beside it says. */
  protected readonly nothingToPublish = computed(
    () => this.detail()?.latest.status === 'Published' && !this.pending(),
  );
  protected readonly moreItems = computed<UiMenuItem[]>(() => [
    {
      label: $localize`Save as draft`,
      hint: $localize`Your team sees it; meal plans don’t`,
      action: 'draft',
    },
  ]);

  constructor() {
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.autosave.dispose();
    });
    this.scope.onReset(() => {
      this.loadedKey = null;
      this.csrfReady = null;
      this.forgetDraft();
      this.state.set('loading');
    });
    // Autosave runs at every pause, so only a failure, and the save that ends it, is announced.
    effect(() => {
      const troubled = this.troubled();
      const status = this.autosave.status();
      const line = this.statusLine();
      untracked(() => {
        if (troubled) {
          this.announcedTrouble = true;
          this.liveStatus.set(line ?? '');
        } else if (status === 'saved' && this.announcedTrouble) {
          this.announcedTrouble = false;
          this.liveStatus.set($localize`Your changes are saved now.`);
        }
      });
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
      const draftId = id ? null : this.requestedDraft();
      if (!tenantId) return;
      const key = this.addressKey(tenantId, id, draftId);
      if (key !== this.loadedKey) {
        this.loadedKey = key;
        // A sheet left open over the recipe before (Back to another one) would weigh a line no longer here.
        untracked(() => {
          this.cookingSheets()?.close();
          void this.load(id, draftId);
        });
      }
    });
  }

  // ---------- loading ----------

  protected retry(): void {
    void this.load(this.recipeId(), this.recipeId() ? null : this.requestedDraft());
  }

  /**
   * Opens the recipe, with the coach's own draft of it when they have one, or a new recipe's draft, or
   * an empty new recipe. Changes still on their way from what was open go first.
   */
  private async load(recipeId: string | null, draftId: string | null): Promise<void> {
    return this.scope.run('load', async (owner) => {
      // The address changed under the page (Back, a link): changes still on their way go first.
      if (this.autosave.hasUnsaved) await owner.wait(this.sendRemaining());
      this.forgetDraft();
      this.state.set('loading');
      this.problem.set(null);
      this.saveError.set(null);
      try {
        if (recipeId) {
          const detail = await owner.wait(firstValueFrom(this.api.getRecipe(recipeId)));
          this.readNewest = numeric(detail.currentRevision);
          if (detail.draft) {
            // The coach's own changes win over the version: they are never set aside unasked.
            const view = await owner.wait(firstValueFrom(this.api.getDraft(detail.draft.id)));
            this.detail.set(detail);
            this.adoptStored(view);
          } else {
            this.show(detail);
          }
          this.state.set('ready');
          await owner.wait(this.grantPhoto(this.draft().photoId));
        } else if (draftId) {
          const view = await owner.wait(firstValueFrom(this.api.getDraft(draftId)));
          if (view.recipeId) {
            // Changes to a saved recipe open with that recipe.
            await owner.wait(
              this.router.navigate(['/nutrition/recipes', view.recipeId], { replaceUrl: true }),
            );
            return;
          }
          this.detail.set(null);
          this.readNewest = 0;
          this.adoptStored(view);
          this.state.set('ready');
          await owner.wait(Promise.all([this.grantPhoto(this.draft().photoId), this.checkAi()]));
        } else {
          this.detail.set(null);
          this.readNewest = 0;
          this.setDraft(emptyDraft(), null);
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
    this.setDraft(draftFromDetail(detail), null);
    this.state.set('ready');
  }

  /** The coach's stored draft becomes what the editor holds, and the next save carries its version. */
  private adoptStored(view: RecipeDraftView): void {
    this.stored = { id: view.id, version: numeric(view.version) };
    this.hasDraft.set(true);
    this.draftSavedAt.set(view.updatedAtUtc);
    this.draftStartedAt.set(numeric(view.startedAtRevision));
    const stored = draftFromStored(view);
    this.setDraft(stored.draft, stored.aiOperationId);
  }

  private setDraft(draft: RecipeDraft, aiOperationId: string | null): void {
    this.draft.set(draft);
    this.aiOperationId.set(aiOperationId);
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

  /** Every edit, typed or chosen: kept in the coach's draft on the server once they pause (NUT-014). */
  protected change(patch: Partial<RecipeDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...patch }));
    this.clearProblemIfSolved();
    this.saveError.set(null);
    this.autosave.changed();
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
    const retype = [
      offered.some((item) => item.food?.unit !== item.newer?.unit)
        ? $localize`A food is now measured in another unit, so type its amount again.`
        : '',
      offered.some((item) => item.food?.unit === item.newer?.unit && !keepsAmount(item))
        ? $localize`A food weighed cooked is no longer a raw food in grams, so type its amount again.`
        : '',
    ].filter((sentence) => sentence !== '');
    this.announced.set([said, ...retype].join(' '));
  }

  // ---------- weighed cooked (audit INV-6) ----------

  /** Opens the sheet that weighs a raw food's line cooked, or changes the conversion it goes through. */
  protected openCooking(line: EditorLine): void {
    this.cookingSheets()?.weighCooked(line);
  }

  /** The conversion chosen in the sheet: the line is weighed cooked through it, at the same food. */
  protected cookingChosen(choice: CookingChoice): void {
    const line = this.draft().lines.find((item) => item.key === choice.lineKey);
    // The conversion the line is weighed through already changes nothing.
    if (!line?.food || weighedThrough(line, choice.conversion)) return;
    const cooked = weighCooked(line, choice.conversion);
    this.change({
      lines: this.draft().lines.map((item) => (item.key === line.key ? cooked : item)),
    });
    this.announced.set(
      cooked.quantity === null
        ? $localize`${line.food.name}:food: is weighed cooked now.`
        : $localize`${line.food.name}:food: is weighed cooked now: ${grams(cooked.quantity, this.locale)}:grams:.`,
    );
  }

  /** Back to the raw weight the cooked one came from; focus stays on the line's cooking button. */
  protected weighLineRaw(line: EditorLine): void {
    const raw = weighRaw(line);
    this.change({ lines: this.draft().lines.map((item) => (item.key === line.key ? raw : item)) });
    this.announced.set(
      raw.quantity === null
        ? $localize`${line.food?.name ?? ''}:food: is weighed raw again.`
        : $localize`${line.food?.name ?? ''}:food: is weighed raw again: ${grams(raw.quantity, this.locale)}:grams:.`,
    );
    afterNextRender(() => this.document.getElementById(`cook-${line.key}`)?.focus(), {
      injector: this.injector,
    });
  }

  /** "100 g raw makes 290 g cooked", said after the conversion's name on its line. */
  protected conversionText(conversion: Conversion): string {
    return conversionWords(conversion, this.locale);
  }

  protected cookLabel(line: EditorLine): string {
    const food = line.food?.name ?? '';
    return line.cooked
      ? $localize`Change conversion: ${food}:food:`
      : $localize`Weigh it cooked: ${food}:food:`;
  }

  protected rawLabel(line: EditorLine): string {
    return $localize`Weigh it raw: ${line.food?.name ?? ''}:food:`;
  }

  /** The unit after the amount: "g", or "g cooked" for a raw food weighed cooked. */
  protected amountUnit(line: EditorLine): string {
    const food = line.food;
    if (!food) return '';
    return line.cooked ? $localize`g cooked` : unitWord(food.unit);
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

  protected amountLabel(food: string, line?: EditorLine): string {
    return line?.cooked
      ? $localize`Amount of ${food}:food:, weighed cooked`
      : $localize`Amount of ${food}:food:`;
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
        // The CSP's img-src allows data: and not blob: (NCM-2), so the preview is the file itself.
        const preview = await owner.wait(photoDataUrl(file).catch(() => null));
        this.photoUrl.set(preview);
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
    this.photoUrl.set(null);
    this.change({ photoId: null });
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

  /**
   * Drops the suggested ingredients not matched yet, and turns the suggestion down on the server: the
   * draft lets go of it, so the recipe is the coach's own lines (ADR 0035).
   */
  protected async dropSuggestion(): Promise<void> {
    const operationId = this.aiOperationId();
    this.aiOperationId.set(null);
    this.change({ lines: this.draft().lines.filter((line) => line.food || !line.suggestion) });
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

  /**
   * Publish, or Save as draft: everything on screen is stored first, then the coach's draft becomes the
   * recipe's next version, checked by every rule (NUT-014). A draft version opened unchanged is
   * published as it is, with no new version.
   */
  protected async save(kind: SaveKind): Promise<void> {
    if (this.saving()) return;
    const problem = recipeProblem(this.draft());
    this.problem.set(problem);
    this.saveError.set(null);
    if (problem) {
      this.focusProblem(problem);
      return;
    }
    const detail = this.detail();
    const keepAsDraft = kind === 'draft';
    // Asked once already: the coach goes on although someone saved a version since they began.
    const replaceNewer = this.newerVersion() !== null;
    this.newerVersion.set(null);
    if (!this.pending()) {
      if (keepAsDraft) {
        this.toast.show($localize`No changes to save.`);
        return;
      }
      if (detail?.latest.status === 'Published') {
        this.toast.show($localize`This recipe is already published.`);
        return;
      }
    }

    return this.scope.run('save', async (owner) => {
      this.saving.set(kind);
      try {
        let saved: RecipeSummary;
        if (detail && !this.pending()) {
          saved = await this.write(owner, () => this.api.publishVersion(detail.latest.id));
        } else {
          if (!(await owner.wait(this.autosave.flush())) || !this.stored) {
            this.saveError.set(
              this.saveProblem()?.message ??
                (keepAsDraft
                  ? $localize`Your latest changes could not be saved, so nothing was saved as a draft. Check your connection and try again.`
                  : $localize`Your latest changes could not be saved, so nothing was published. Check your connection and try again.`),
            );
            return;
          }
          const stored: StoredDraft = this.stored;
          saved = await this.write(owner, () =>
            this.api.publishDraft(stored.id, {
              version: stored.version,
              replaceNewer,
              keepAsDraft,
            }),
          );
          this.forgetDraft();
        }

        const fresh = await owner.wait(firstValueFrom(this.api.getRecipe(saved.id)));
        this.loadedKey = this.addressKey(owner.tenantId, saved.id, null);
        this.readNewest = numeric(fresh.currentRevision);
        this.show(fresh);
        if (!detail) {
          await owner.wait(
            this.router.navigate(['/nutrition/recipes', saved.id], { replaceUrl: true }),
          );
        }
        this.toast.show(
          keepAsDraft
            ? $localize`Saved as a draft. Your team sees it; meal plans don’t until you publish it.`
            : $localize`Published. It’s in your meal plans’ recipes now.`,
          { tone: 'success' },
        );
      } catch (error) {
        if (!owner.current) return;
        await this.saveRefused(owner, error, kind);
      } finally {
        if (owner.current) this.saving.set(null);
      }
    });
  }

  private async saveRefused(owner: TenantOperation, error: unknown, kind: SaveKind): Promise<void> {
    const body =
      error instanceof HttpErrorResponse
        ? (error.error as { code?: unknown; errors?: Record<string, string[]> } | null)
        : null;
    if (body?.code === 'newer_recipe_version') {
      const id = this.recipeId();
      try {
        if (id) this.detail.set(await owner.wait(firstValueFrom(this.api.getRecipe(id))));
      } catch {
        // The sentence below still holds without the number.
      }
      const newest = numeric(this.detail()?.currentRevision ?? 0);
      this.newerVersion.set({
        kind,
        message:
          newest > 0
            ? $localize`Version ${newest}:number: of this recipe was saved after you started these changes. Make yours the newest version? Version ${newest}:number: stays in the recipe’s history.`
            : $localize`A newer version of this recipe was saved after you started these changes. Make yours the newest version? The other one stays in the recipe’s history.`,
      });
      return;
    }
    if (
      error instanceof HttpErrorResponse &&
      (error.status === 404 || body?.code === 'recipe_draft_stale')
    ) {
      this.saveOutcome(error);
      return;
    }
    if (body?.errors?.['photoMediaAssetId']) {
      this.photoError.set($localize`This photo can’t be used. Choose it again.`);
    }
    this.saveError.set(
      apiErrorMessage(
        error,
        kind === 'draft'
          ? $localize`The recipe could not be saved as a draft. Your changes are kept; try again.`
          : $localize`The recipe could not be published. Your changes are kept; try again.`,
      ),
    );
  }

  // ---------- keeping changes (NUT-014) ----------

  /**
   * One autosave: the recipe as it stands now, to the coach's draft. Its first save starts the draft;
   * every later one carries the version it read, so two tabs never overwrite each other.
   */
  private sendDraft(): Promise<SaveOutcome> {
    return this.scope.run(
      'autosave',
      async (owner) => {
        // Read before anything is awaited, so the content matches the edits the autosave counted.
        const content = toDraftContent(this.draft(), this.aiOperationId());
        const stored = this.stored;
        const epoch = this.draftEpoch;
        try {
          const saved = await this.write(owner, () =>
            stored
              ? this.api.saveDraft(stored.id, { content, version: stored.version })
              : this.api.createDraft(this.startRequest(content)),
          );
          if (epoch !== this.draftEpoch) return 'stopped';
          this.stored = { id: saved.id, version: numeric(saved.version) };
          this.hasDraft.set(true);
          this.draftSavedAt.set(saved.updatedAtUtc);
          this.saveProblem.set(null);
          if (!stored && this.detail() === null) {
            this.showDraftInAddress(saved.id);
          } else if (!stored) {
            this.draftStartedAt.set(this.readNewest);
          }
          return 'saved';
        } catch (error) {
          return owner.current && epoch === this.draftEpoch ? this.saveOutcome(error) : 'stopped';
        }
      },
      'stopped',
    );
  }

  private startRequest(content: RecipeDraftContent): CreateRecipeDraftRequest {
    const detail = this.detail();
    return detail
      ? { recipeId: detail.id, recipeRevision: this.readNewest, content }
      : { recipeId: null, recipeRevision: null, content };
  }

  /** What a failed save means for the next one, said in coach words where the coach must act. */
  private saveOutcome(error: unknown): SaveOutcome {
    if (!(error instanceof HttpErrorResponse)) return 'retry';
    const body = error.error as { code?: unknown; errors?: Record<string, string[]> } | null;
    if (error.status === 0 || error.status === 429 || error.status >= 500) return 'retry';
    if (error.status === 400 || body?.code === 'recipe_draft_limit') {
      if (body?.errors?.['photoMediaAssetId']) {
        this.photoError.set($localize`This photo can’t be used. Choose it again.`);
      }
      this.saveProblem.set({
        kind: 'refused',
        message: apiErrorMessage(error, $localize`Your latest changes could not be saved.`),
      });
      return 'refused';
    }
    if (error.status === 401 || error.status === 403) {
      this.saveProblem.set({
        kind: 'closed',
        message: apiErrorMessage(
          error,
          $localize`Your changes can’t be saved right now. Copy anything you need before you leave.`,
        ),
      });
      return 'stopped';
    }
    // Gone or moved on: published or discarded elsewhere, or saved in another tab since this read.
    this.saveProblem.set({
      kind: 'stale',
      message: $localize`This recipe was changed in another tab or on another device. Reload to continue with the latest changes.`,
    });
    return 'stopped';
  }

  /** Discard: the coach's changes go, and the recipe as last saved comes back. */
  protected async discard(): Promise<void> {
    const isNew = this.detail() === null;
    const agreed = await this.ask({
      title: isNew ? $localize`Discard this recipe?` : $localize`Discard your changes?`,
      message: isNew
        ? $localize`It was never saved, so no meal plan has it. This can’t be undone.`
        : $localize`The recipe goes back to how it was last saved. This can’t be undone.`,
      confirm: isNew ? $localize`Discard recipe` : $localize`Discard changes`,
      cancel: $localize`Keep editing`,
    });
    if (!agreed) return;
    return this.scope.run('discard', async (owner) => {
      await owner.wait(this.autosave.hold());
      const stored = this.stored;
      try {
        if (stored) {
          await this.write(owner, () => this.api.discardDraft(stored.id, stored.version));
        }
      } catch (error) {
        if (!owner.current) return;
        // A draft already gone (made a version or discarded in another tab) needs no discarding.
        if (!(error instanceof HttpErrorResponse && error.status === 404)) {
          this.autosave.release();
          if (
            error instanceof HttpErrorResponse &&
            (error.error as { code?: unknown } | null)?.code === 'recipe_draft_stale'
          ) {
            this.saveOutcome(error);
          } else {
            this.saveError.set(
              apiErrorMessage(error, $localize`Your changes could not be discarded. Try again.`),
            );
          }
          return;
        }
      }
      this.forgetDraft();
      const detail = this.detail();
      if (!detail) {
        this.loadedKey = null;
        // Said before the page goes: once it has, nothing of it is left to say it.
        this.toast.show($localize`Recipe discarded.`);
        await owner.wait(this.router.navigate(['/nutrition/recipes']));
        return;
      }
      try {
        const fresh = await owner.wait(firstValueFrom(this.api.getRecipe(detail.id)));
        this.readNewest = numeric(fresh.currentRevision);
        this.show(fresh);
        this.toast.show($localize`Changes discarded.`);
        await owner.wait(this.grantPhoto(fresh.latest.photoMediaAssetId));
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }

  /** After another tab moved on: the page reads the recipe again, as the server now has it. */
  protected reloadLatest(): void {
    const id = this.recipeId();
    const draftId = id ? null : (this.stored?.id ?? this.requestedDraft());
    this.loadedKey = null;
    this.forgetDraft();
    void this.load(id, draftId);
  }

  /** The page no longer holds a draft: opened afresh, made a version or discarded. */
  private forgetDraft(): void {
    this.draftEpoch += 1;
    this.autosave.reset();
    this.stored = null;
    this.hasDraft.set(false);
    this.draftSavedAt.set(null);
    this.draftStartedAt.set(0);
    this.saveProblem.set(null);
    this.newerVersion.set(null);
    this.announcedTrouble = false;
    this.liveStatus.set('');
  }

  private addressKey(tenant: string, id: string | null, draftId: string | null): string {
    return `${tenant}|${id ?? 'new'}|${draftId ?? ''}`;
  }

  /**
   * A new recipe's draft goes into the address, so a refresh reopens it. Not through the router: a
   * navigation scrolls the page to the top, and this happens mid-edit, at the first autosave.
   */
  private showDraftInAddress(draftId: string): void {
    this.location.replaceState('/nutrition/recipes/new', `draft=${encodeURIComponent(draftId)}`);
  }

  private savedLine(savedAt: string | null): string {
    if (!savedAt) return $localize`Changes saved, not published yet`;
    const day = formatDate(savedAt, 'yyyy-MM-dd', this.locale);
    const today = formatDate(new Date(), 'yyyy-MM-dd', this.locale);
    return day === today
      ? $localize`Saved at ${formatDate(savedAt, 'HH:mm', this.locale)}:time:, not published yet`
      : $localize`Saved on ${formatDate(savedAt, 'EEE d MMM', this.locale)}:date:, not published yet`;
  }

  /** Sends what is not on the server yet, waiting a few seconds at most. */
  private sendRemaining(): Promise<boolean> {
    return Promise.race([
      this.autosave.flush(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LEAVE_WAIT_MS)),
    ]);
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

  /**
   * Asked before the page goes (the route guard, a workspace switch, a sign-out). Changes not on the
   * server yet are sent first; only when that fails does the coach choose.
   */
  async canLeave(): Promise<boolean> {
    if (!this.autosave.hasUnsaved || (await this.sendRemaining())) return true;
    return this.ask({
      title: $localize`Leave without saving?`,
      message:
        this.saveProblem()?.message ??
        $localize`Your latest changes have not reached the server yet. If you leave now, they are lost.`,
      confirm: $localize`Leave without saving`,
      cancel: $localize`Stay`,
    });
  }

  /** A reload or a closed tab cannot wait for a save, so the browser asks first. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.autosave.hasUnsaved) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  /** Changes go as the tab is hidden, while it can still send them (a phone locking, a new tab). */
  protected onVisibilityChange(): void {
    const status = this.autosave.status();
    if (
      this.document.visibilityState === 'hidden' &&
      (status === 'pending' || status === 'retrying')
    ) {
      void this.autosave.flush();
    }
  }

  private async ask(question: {
    title: string;
    message: string;
    confirm: string;
    cancel: string;
  }): Promise<boolean> {
    this.asking.set(question);
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title: question.title,
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

/**
 * A chosen photo as a `data:` URL, the one kind of local picture the CSP lets an img show (its img-src
 * is 'self' data:, never blob:). Shown until the page goes; a saved recipe's photo comes from its grant.
 */
export function photoDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The photo could not be read.'));
    reader.readAsDataURL(file);
  });
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
