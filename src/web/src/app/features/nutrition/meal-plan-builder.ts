import {
  CdkDrag,
  type CdkDragDrop,
  CdkDragHandle,
  CdkDragPlaceholder,
  CdkDragPreview,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { DOCUMENT, formatDate, formatNumber, Location } from '@angular/common';
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
  CreateMealPlanDraftRequest,
  MealPlanDraftContent,
  MealPlanDraftView,
  MealPlanTemplateDetail,
} from '../../core/api/generated';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import { UiSheet } from '../../ui/sheet';
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
import { MealPlanApi } from './meal-plan-api';
import {
  acceptsDrop,
  addChoice,
  addDay,
  addMeal,
  addWeek,
  applyPlanDrop,
  choiceMacros,
  clearDay,
  copyDayToAll,
  dayTotal,
  duplicateDay,
  emptyPlan,
  findMeal,
  kcalText,
  macroLine,
  macroSplit,
  MAX_CHOICES_PER_MEAL,
  MAX_DAYS,
  MAX_MEALS_PER_DAY,
  type MealPlanModel,
  type MealRef,
  mealTotal,
  type PlanDragItem,
  type PlanDropTarget,
  type PlanProblem,
  type PlanRecipe,
  planFromDraft,
  planFromVersion,
  planProblem,
  planRecipe,
  planVersionRows,
  planVersionToOpen,
  type RecipeBook,
  recipeBook,
  removeChoice,
  removeDay,
  removeMeal,
  servingsText,
  shiftMeal,
  standing,
  type TargetStanding,
  toDraftContent,
  versionRecipes,
  weeksOf,
} from './meal-plan-builder.models';
import { MealPlanLibrary } from './meal-plan-library';
import { MealPlanMealEditor } from './meal-plan-meal-editor';

/** The builder's autosave timing; a spec provides its own to save at once or to hold saves back. */
export const MEAL_PLAN_AUTOSAVE_TIMING = new InjectionToken<AutosaveTiming>(
  'MEAL_PLAN_AUTOSAVE_TIMING',
  { factory: () => AUTOSAVE_TIMING },
);

/** An open sheet, as far as the page needs it. */
interface Closable {
  close(): void;
}

/** Where the recipe sheet adds what the coach picks: a new meal on a day, or an option of a meal. */
type PickTarget = { kind: 'day'; dayKey: string } | { kind: 'meal'; ref: MealRef };

/** The coach's draft on the server (NUT-013): its id and the version the next save carries. */
interface StoredDraft {
  id: string;
  version: number;
}

interface SaveProblem {
  kind: 'stale' | 'refused' | 'closed';
  message: string;
}

interface OptionCell {
  key: string;
  name: string;
  line: string;
  missing: boolean;
}

interface MealCell {
  key: string;
  ref: MealRef;
  name: string;
  kcal: string;
  listId: string;
  target: PlanDropTarget;
  drag: PlanDragItem;
  options: OptionCell[];
  openLabel: string;
  menuLabel: string;
  menu: UiMenuItem[];
}

interface DayCell {
  key: string;
  number: number;
  title: string;
  listId: string;
  newMealId: string;
  target: PlanDropTarget;
  newMealTarget: PlanDropTarget;
  meals: MealCell[];
  menu: UiMenuItem[];
  menuLabel: string;
  addLabel: string;
  kcal: string;
  against: string | null;
  macros: string;
  standing: TargetStanding;
  /** How much of the ring is drawn, 0 to 1. */
  fill: number;
  isProblem: boolean;
}

interface WeekRow {
  key: string;
  number: number;
  title: string;
  days: DayCell[];
}

type TargetField = 'calories' | 'protein' | 'carbs' | 'fat';

/** How long leaving waits for the last changes to reach the server before it asks instead. */
const LEAVE_WAIT_MS = 8000;

/** The circumference of the day ring (r = 16). */
const RING = 2 * Math.PI * 16;

/**
 * The meal-plan builder (C7): the recipes beside a grid of days, each day with its meals and a ring
 * against the daily target. Recipes are dragged onto a meal (another option) or under a day (a new
 * meal), and meals between days (CDK drag and drop); every drag also has a button path, through the
 * recipe sheet, the meal sheet and each card's menu.
 *
 * Changes keep themselves (NUT-013, ADR 0033): a moment after the coach stops, the plan is sent to
 * their own draft on the server, which follows them to any device and nobody else sees. Publish
 * turns the draft into a new version the coach can assign; clients already on the plan keep their
 * own copy (NUT-006). Leaving with changes the server does not have yet saves them first and asks
 * only when that fails.
 */
@Component({
  selector: 'app-meal-plan-builder',
  imports: [
    Button,
    ButtonLink,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
    CdkDragPreview,
    CdkDropList,
    CdkScrollable,
    Control,
    Field,
    FormsModule,
    Icon,
    MealPlanLibrary,
    MealPlanMealEditor,
    RouterLink,
    Skeleton,
    StatusPill,
    UiConfirm,
    UiMenu,
  ],
  templateUrl: './meal-plan-builder.html',
  styleUrls: ['./meal-plan-builder.scss', './meal-plan-days.scss'],
  host: {
    '(window:beforeunload)': 'onBeforeUnload($event)',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
})
export class MealPlanBuilder implements HoldsUnsavedWork {
  private readonly api = inject(MealPlanApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly document = inject(DOCUMENT);
  private readonly location = inject(Location);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  private readonly params = toSignal(this.route.paramMap, { requireSync: true });
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly mealSheet = viewChild.required<TemplateRef<unknown>>('mealSheet');
  private readonly pickerSheet = viewChild.required<TemplateRef<unknown>>('pickerSheet');
  private readonly historySheet = viewChild.required<TemplateRef<unknown>>('historySheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private libraryTenant: string | null = null;
  private loadedKey: string | null = null;
  private pickerRef: Closable | null = null;
  private stored: StoredDraft | null = null;
  /** Moves whenever the page lets go of its draft, so a save landing afterwards changes nothing. */
  private draftEpoch = 0;
  /** The plan's newest revision as read, which a new draft of it records (NUT-013). */
  private readNewest = 0;
  private csrfReady: Promise<void> | null = null;

  /** The plan in the address, or null for a new one (`/nutrition/plans/new`). */
  protected readonly planId = computed(() => {
    const id = this.params().get('planId');
    return id && id !== 'new' ? id : null;
  });
  private readonly requestedVersion = computed(() => this.query().get('version'));
  /** A new plan not published yet, reopened from its draft (`/nutrition/plans/new?draft=`). */
  private readonly requestedDraft = computed(() => this.query().get('draft'));

  protected readonly plan = signal<MealPlanModel>(emptyPlan());
  protected readonly detail = signal<MealPlanTemplateDetail | null>(null);
  protected readonly openVersionId = signal<string | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly publishing = signal(false);
  protected readonly problem = signal<PlanProblem | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saveProblem = signal<SaveProblem | null>(null);
  protected readonly newerVersion = signal<string | null>(null);
  protected readonly hasDraft = signal(false);
  protected readonly draftSavedAt = signal<string | null>(null);
  protected readonly draftStartedAt = signal(0);
  /** Increases on every change, so the open meal sheet redraws edits made around it. */
  protected readonly revision = signal(0);

  protected readonly autosave = new DraftAutosave(
    () => this.sendDraft(),
    inject(MEAL_PLAN_AUTOSAVE_TIMING),
  );

  /** The library's published recipes, each at its newest published version. */
  protected readonly recipes = signal<PlanRecipe[]>([]);
  /** The recipes the opened draft or version names, in whatever state they are now. */
  private readonly planRecipes = signal<PlanRecipe[]>([]);
  protected readonly book = computed(() => recipeBook(this.planRecipes(), this.recipes()));
  protected readonly libraryState = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly libraryOpen = signal(true);
  /** The week a phone shows; null until one is chosen, then the first. */
  protected readonly phoneWeek = signal<string | null>(null);
  /** The day a phone shows, one at a time; null until one is chosen, then the week's first. */
  protected readonly phoneDay = signal<string | null>(null);

  protected readonly editing = signal<MealRef | null>(null);
  protected readonly picking = signal<PickTarget | null>(null);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );
  /** What a screen reader is told about saving: a failure, and the save that ends it. */
  protected readonly liveStatus = signal('');
  private announcedTrouble = false;

  protected readonly loadingLabel = $localize`Loading the meal plan…`;
  protected readonly closeLabel = $localize`Close`;
  protected readonly dragDelay = { touch: 250, mouse: 0 };
  protected readonly maxDays = MAX_DAYS;
  protected readonly ring = RING;

  /** Each list takes only its own kind of item, so nested lists never take each other's drops. */
  protected readonly canEnter = (drag: CdkDrag<PlanDragItem>, drop: CdkDropList<PlanDropTarget>) =>
    acceptsDrop(drag.data, drop.data);

  protected readonly isNew = computed(() => this.planId() === null);
  protected readonly unsaved = computed(() => this.autosave.status() !== 'saved');
  protected readonly troubled = computed(() =>
    ['retrying', 'refused', 'stopped'].includes(this.autosave.status()),
  );
  protected readonly pageTitle = computed(
    () =>
      this.plan().name.trim() || (this.isNew() ? $localize`New meal plan` : $localize`Meal plan`),
  );
  protected readonly counts = computed(() => {
    const days = this.plan().days;
    const meals = days.reduce((sum, day) => sum + day.meals.length, 0);
    const dayText = days.length === 1 ? $localize`1 day` : $localize`${days.length}:count: days`;
    const mealText = meals === 1 ? $localize`1 meal` : $localize`${meals}:count: meals`;
    return `${dayText} · ${mealText}`;
  });
  protected readonly split = computed(() => macroSplit(this.plan().targets));
  /** When the macros' own calories differ from the calorie target by more than 5%, it says so. */
  protected readonly splitWarning = computed(() => {
    const split = this.split();
    const target = this.plan().targets.calories;
    if (!split || target === null || !(target > 0)) return null;
    const difference = Math.round(split.calories - target);
    if (Math.abs(difference) <= target * 0.05) return null;
    const amount = formatNumber(Math.abs(difference), this.locale, '1.0-0');
    return difference > 0
      ? $localize`Protein, carbs and fat add up to ${formatNumber(split.calories, this.locale, '1.0-0')}:total: kcal, ${amount}:difference: more than the calorie target.`
      : $localize`Protein, carbs and fat add up to ${formatNumber(split.calories, this.locale, '1.0-0')}:total: kcal, ${amount}:difference: less than the calorie target.`;
  });

  protected readonly grid = computed(() => this.rows(this.plan(), this.book(), this.problem()));
  protected readonly shownWeek = computed(() => {
    const weeks = this.grid();
    const chosen = this.phoneWeek();
    return weeks.some((week) => week.key === chosen) ? chosen : (weeks[0]?.key ?? null);
  });
  /** The days of the week a phone shows, as its day chips. */
  protected readonly shownWeekDays = computed(
    () => this.grid().find((week) => week.key === this.shownWeek())?.days ?? [],
  );
  protected readonly shownDay = computed(() => {
    const days = this.shownWeekDays();
    const chosen = this.phoneDay();
    return days.some((day) => day.key === chosen) ? chosen : (days[0]?.key ?? null);
  });
  /**
   * Every list on the grid, by id. The lists are connected by name rather than by a
   * `cdkDropListGroup`, because the CDK keeps a list nested in another (a meal's options inside its
   * day) out of the outer list's group.
   */
  protected readonly dropIds = computed(() =>
    this.grid().flatMap((week) =>
      week.days.flatMap((day) => [
        day.listId,
        day.newMealId,
        ...day.meals.map((meal) => meal.listId),
      ]),
    ),
  );

  private readonly isLatest = computed(
    () => this.detail()?.versions[0]?.id === this.openVersionId(),
  );
  protected readonly olderLine = computed(() => {
    const detail = this.detail();
    const open = this.openVersionId();
    if (!detail || !open || this.isLatest() || this.hasDraft()) return null;
    const row = planVersionRows(detail, open, this.locale).find((item) => item.id === open);
    return $localize`You’re looking at an earlier version (${row?.title}:version:, ${row?.date}:date:). Publishing makes it the newest version.`;
  });
  protected readonly behindLine = computed(() => {
    const detail = this.detail();
    const started = this.draftStartedAt();
    if (!detail || !this.hasDraft() || started === 0) return null;
    const newest = numeric(detail.currentRevision);
    return newest > started
      ? $localize`Version ${newest}:number: was published after you started these changes. Publishing yours makes it the newest version; version ${newest}:number: stays in Versions.`
      : null;
  });
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
    if (this.hasDraft()) return this.savedLine(this.draftSavedAt());
    const detail = this.detail();
    const open = detail?.versions.find((version) => version.id === this.openVersionId());
    if (!open) return $localize`Your changes save as you work`;
    return open.status === 'Published'
      ? $localize`Published: you can assign it`
      : $localize`Not published: publish it to assign it`;
  });
  protected readonly canPublish = computed(() => {
    const open = this.detail()?.versions.find((version) => version.id === this.openVersionId());
    return (
      this.isNew() ||
      this.hasDraft() ||
      this.unsaved() ||
      !this.isLatest() ||
      open?.status !== 'Published'
    );
  });
  protected readonly canDiscard = computed(() => this.hasDraft() || this.unsaved());
  protected readonly historyRows = computed(() => {
    const detail = this.detail();
    return detail ? planVersionRows(detail, this.openVersionId(), this.locale) : [];
  });
  protected readonly editingMeal = computed(() => {
    this.revision();
    const ref = this.editing();
    return ref ? (findMeal(this.plan(), ref) ?? null) : null;
  });
  protected readonly editingDayNumber = computed(() => {
    const ref = this.editing();
    return ref ? this.plan().days.findIndex((day) => day.key === ref.dayKey) + 1 : 0;
  });
  /** The recipes the meal in the recipe sheet already offers. */
  protected readonly pickedAlready = computed<ReadonlySet<string>>(() => {
    const target = this.picking();
    if (target?.kind !== 'meal') return new Set();
    return new Set(
      findMeal(this.plan(), target.ref)?.choices.map((choice) => choice.recipeVersionId),
    );
  });
  protected readonly pickerTitle = computed(() => {
    const target = this.picking();
    if (!target) return '';
    const number = this.plan().days.findIndex(
      (day) => day.key === (target.kind === 'day' ? target.dayKey : target.ref.dayKey),
    );
    return target.kind === 'day'
      ? $localize`Add a meal to day ${number + 1}:day:`
      : $localize`Add a recipe to ${findMeal(this.plan(), target.ref)?.name.trim() || $localize`the meal`}:meal:`;
  });

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.autosave.dispose();
    });
    effect(() => {
      const troubled = this.troubled();
      const status = this.autosave.status();
      const line = this.statusLine();
      untracked(() => {
        if (troubled) {
          this.announcedTrouble = true;
          this.liveStatus.set(line);
        } else if (status === 'saved' && this.announcedTrouble) {
          this.announcedTrouble = false;
          this.liveStatus.set($localize`Your changes are saved now.`);
        }
      });
    });
    effect(() => {
      this.scope.epoch();
      const tenant = this.tenants.selectedTenantId();
      if (tenant && tenant !== this.libraryTenant) {
        this.libraryTenant = tenant;
        untracked(() => void this.loadLibrary());
      }
    });
    effect(() => {
      this.scope.epoch();
      const tenant = this.tenants.selectedTenantId();
      const id = this.planId();
      const version = this.requestedVersion();
      const draftId = this.requestedDraft();
      if (!tenant) return;
      const key = this.addressKey(tenant, id, version, draftId);
      if (key === this.loadedKey) return;
      this.loadedKey = key;
      untracked(() => void this.loadPlan(id, version, draftId, false));
    });
  }

  // ---------- loading ----------

  protected async loadPlan(
    id: string | null,
    version: string | null,
    draftId: string | null,
    quiet: boolean,
  ): Promise<void> {
    return this.scope.run('plan', async (owner) => {
      // The address changed under the page (Back, a link): changes still on their way go first.
      if (this.autosave.hasUnsaved) await owner.wait(this.sendRemaining());
      this.forgetDraft();
      if (id === null && draftId === null) {
        this.detail.set(null);
        this.openVersionId.set(null);
        this.readNewest = 0;
        this.planRecipes.set([]);
        this.adopt(emptyPlan());
        this.state.set('ready');
        this.focusHeading();
        return;
      }
      if (!quiet) this.state.set('loading');
      try {
        if (id === null) {
          const view = await owner.wait(firstValueFrom(this.api.getDraft(draftId!)));
          if (view.mealPlanTemplateId) {
            // Changes to a saved plan open with that plan.
            await owner.wait(
              this.router.navigate(['/nutrition/plans', view.mealPlanTemplateId], {
                replaceUrl: true,
              }),
            );
            return;
          }
          this.detail.set(null);
          this.openVersionId.set(null);
          this.readNewest = 0;
          this.adoptStored(view);
        } else {
          const detail = await owner.wait(firstValueFrom(this.api.getPlan(id)));
          this.readNewest = numeric(detail.currentRevision);
          if (detail.draft) {
            // The coach's own changes win over a version named in the address: they are never set
            // aside without asking.
            const view = await owner.wait(firstValueFrom(this.api.getDraft(detail.draft.id)));
            this.detail.set(detail);
            this.openVersionId.set(view.sourceVersionId ?? null);
            this.adoptStored(view);
            if (version) this.dropVersionFromAddress(owner.tenantId, id);
          } else {
            const versionId = planVersionToOpen(detail, version);
            if (!versionId) {
              this.state.set('missing');
              return;
            }
            const view = await owner.wait(firstValueFrom(this.api.getVersion(versionId)));
            this.detail.set(detail);
            this.openVersionId.set(versionId);
            this.planRecipes.set(versionRecipes(view));
            this.adopt(planFromVersion(view, detail.name));
          }
        }
        this.state.set('ready');
        if (!quiet) this.focusHeading();
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.state.set('missing');
        } else if (quiet) {
          this.saveError.set(
            $localize`Published, but the newest version could not be opened. Reload the page.`,
          );
        } else {
          this.state.set('error');
        }
      }
    });
  }

  protected retryPlan(): void {
    void this.loadPlan(this.planId(), this.requestedVersion(), this.requestedDraft(), false);
  }

  protected async loadLibrary(): Promise<void> {
    return this.scope.run('library', async (owner) => {
      this.libraryState.set('loading');
      try {
        // A page holds 100; a big library is read to the end, up to a thousand recipes.
        const first = await owner.wait(firstValueFrom(this.api.listPublishedRecipes(0)));
        const items = [...first.items];
        const total = numeric(first.total);
        while (items.length < Math.min(total, 1000)) {
          const page = await owner.wait(
            firstValueFrom(this.api.listPublishedRecipes(items.length)),
          );
          if (page.items.length === 0) break;
          items.push(...page.items);
        }
        this.recipes.set(
          items.map(planRecipe).sort((a, b) => a.name.localeCompare(b.name, this.locale)),
        );
        this.libraryState.set('ready');
      } catch {
        if (owner.current) this.libraryState.set('error');
      }
    });
  }

  // ---------- changing the plan ----------

  /** A new plan from a drop, a menu or a sheet. */
  private commit(next: MealPlanModel): void {
    if (next === this.plan()) return;
    this.plan.set(next);
    this.changed();
  }

  /** An edit made in place, by a field or the meal sheet. */
  protected touched(): void {
    this.plan.set({ ...this.plan() });
    this.changed();
  }

  private changed(): void {
    this.problem.set(null);
    this.saveError.set(null);
    this.revision.update((value) => value + 1);
    this.autosave.changed();
  }

  protected setTarget(field: TargetField, value: number | string | null): void {
    const number = value === null || value === '' ? null : Number(value);
    this.plan().targets[field] = number !== null && Number.isFinite(number) ? number : null;
    this.touched();
  }

  protected dropped(event: CdkDragDrop<PlanDropTarget, unknown, PlanDragItem>): void {
    if (event.previousContainer === event.container && event.previousIndex === event.currentIndex) {
      return;
    }
    const before = this.plan();
    const next = applyPlanDrop(before, event.item.data, event.container.data, event.currentIndex);
    if (next === before && event.item.data.kind === 'recipe') {
      this.toast.show(
        event.container.data.kind === 'options'
          ? $localize`That meal already offers this recipe, or holds as many as it can.`
          : $localize`That day holds as many meals as it can.`,
      );
      return;
    }
    this.commit(next);
  }

  protected addDay(): void {
    this.commit(addDay(this.plan()));
    this.focusDay(this.plan().days.at(-1)?.key);
  }

  protected addWeek(): void {
    const before = this.plan();
    this.commit(addWeek(before));
    this.focusDay(this.plan().days[before.days.length]?.key);
  }

  protected onDayAction(dayKey: string, action: string): void {
    const before = this.plan();
    const index = before.days.findIndex((day) => day.key === dayKey);
    const number = index + 1;
    switch (action) {
      case 'duplicate':
        this.commit(duplicateDay(before, dayKey));
        this.focusDay(this.plan().days[index + 1]?.key);
        this.announce($localize`Day ${number}:day: copied to day ${number + 1}:next:.`);
        return;
      case 'everyday':
        this.commit(copyDayToAll(before, dayKey));
        this.offerUndo($localize`Every day now has day ${number}:day:’s meals.`, before);
        return;
      case 'clear':
        this.commit(clearDay(before, dayKey));
        this.offerUndo($localize`Day ${number}:day:’s meals removed.`, before);
        return;
      case 'delete':
        this.commit(removeDay(before, dayKey));
        this.focusDay(this.plan().days[Math.max(0, index - 1)]?.key);
        this.offerUndo($localize`Day ${number}:day: deleted.`, before);
        return;
    }
  }

  protected onMealAction(ref: MealRef, action: string): void {
    const before = this.plan();
    switch (action) {
      case 'edit':
        return this.openMeal(ref);
      case 'up':
        return this.commit(shiftMeal(before, ref, -1));
      case 'down':
        return this.commit(shiftMeal(before, ref, 1));
      case 'option':
        return this.openPicker({ kind: 'meal', ref });
      case 'delete':
        return this.deleteMeal(ref, null);
    }
  }

  protected deleteMeal(ref: MealRef, sheet: Closable | null): void {
    const before = this.plan();
    const name = findMeal(before, ref)?.name.trim() || $localize`The meal`;
    sheet?.close();
    this.commit(removeMeal(before, ref));
    this.focusDay(ref.dayKey);
    this.offerUndo($localize`${name}:meal: deleted.`, before);
  }

  private offerUndo(message: string, before: MealPlanModel): void {
    this.toast.show(message, {
      durationMs: 8000,
      action: {
        label: $localize`Undo`,
        run: () => {
          this.plan.set(before);
          this.changed();
        },
      },
    });
  }

  // ---------- sheets ----------

  protected openMeal(ref: MealRef): void {
    this.editing.set(ref);
    const sheet = this.sheets.open(this.mealSheet(), {
      title: $localize`Edit meal`,
      closeLabel: this.closeLabel,
    });
    sheet.closed.subscribe(() => this.editing.set(null));
  }

  protected openPicker(target: PickTarget): void {
    this.picking.set(target);
    const sheet = this.sheets.open(this.pickerSheet(), {
      title: this.pickerTitle(),
      closeLabel: this.closeLabel,
    });
    this.pickerRef = sheet;
    sheet.closed.subscribe(() => {
      this.picking.set(null);
      if (this.pickerRef === sheet) this.pickerRef = null;
    });
  }

  protected addToEditing(): void {
    const ref = this.editing();
    if (ref) this.openPicker({ kind: 'meal', ref });
  }

  protected deleteEditing(sheet: Closable): void {
    const ref = this.editing();
    if (ref) this.deleteMeal(ref, sheet);
  }

  /** An option taken out in the meal sheet, with an Undo like a deleted meal's. */
  protected removeFromEditing(choiceKey: string): void {
    const ref = this.editing();
    if (!ref) return;
    const before = this.plan();
    const choice = findMeal(before, ref)?.choices.find((item) => item.key === choiceKey);
    const name = (choice && this.book().get(choice.recipeVersionId)?.name) || $localize`The recipe`;
    this.commit(removeChoice(before, ref, choiceKey));
    this.offerUndo($localize`${name}:recipe: removed.`, before);
  }

  /** A recipe picked in the recipe sheet: a new meal on the day, or another option of the meal. */
  protected pickRecipe(recipe: PlanRecipe): void {
    const target = this.picking();
    if (!target) return;
    if (target.kind === 'day') {
      const added = addMeal(this.plan(), target.dayKey, recipe);
      if (!added.mealKey) return;
      this.commit(added.plan);
      const meal = findMeal(added.plan, { dayKey: target.dayKey, mealKey: added.mealKey });
      this.pickerRef?.close();
      this.announce($localize`${meal?.name ?? ''}:meal: added: ${recipe.name}:recipe:.`);
      return;
    }
    this.commit(addChoice(this.plan(), target.ref, recipe));
    this.pickerRef?.close();
    this.announce($localize`${recipe.name}:recipe: added.`);
  }

  protected openHistory(): void {
    this.sheets.open(this.historySheet(), {
      title: $localize`Versions`,
      closeLabel: this.closeLabel,
    });
  }

  /** Another version from the Versions sheet; changes not published are discarded first, if asked. */
  protected async openOtherVersion(versionId: string | null, sheet: Closable): Promise<void> {
    sheet.close();
    const id = this.planId();
    if (!id) return;
    if (this.canDiscard()) {
      const agreed = await this.ask({
        title: $localize`Open another version?`,
        message: $localize`Your changes that are not published will be discarded. This can’t be undone.`,
        confirm: $localize`Discard and open`,
        cancel: $localize`Keep my changes`,
      });
      if (agreed) await this.discardThenOpen(id, versionId);
      return;
    }
    await this.router.navigate(['/nutrition/plans', id], {
      queryParams: versionId ? { version: versionId } : {},
    });
  }

  // ---------- keeping changes ----------

  /**
   * One autosave: the plan as it stands now, to the coach's draft. Its first save starts the draft;
   * every later one carries the version it read, so two tabs never overwrite each other.
   */
  private sendDraft(): Promise<SaveOutcome> {
    return this.scope.run(
      'autosave',
      async (owner) => {
        // Read before anything is awaited, so the content matches the edits the autosave counted.
        const content = toDraftContent(this.plan());
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

  private startRequest(content: MealPlanDraftContent): CreateMealPlanDraftRequest {
    const detail = this.detail();
    return detail
      ? {
          mealPlanTemplateId: detail.id,
          sourceVersionId: this.openVersionId(),
          templateRevision: this.readNewest,
          content,
        }
      : { mealPlanTemplateId: null, sourceVersionId: null, templateRevision: null, content };
  }

  /** What a failed save means for the next one, said in coach words where the coach must act. */
  private saveOutcome(error: unknown): SaveOutcome {
    if (!(error instanceof HttpErrorResponse)) return 'retry';
    const code = (error.error as { code?: unknown } | null)?.code;
    if (error.status === 0 || error.status === 429 || error.status >= 500) return 'retry';
    if (error.status === 400 || code === 'meal_plan_draft_limit') {
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
      message: $localize`This meal plan was changed in another tab or on another device. Reload to continue with the latest changes.`,
    });
    return 'stopped';
  }

  /** Publish: everything on screen is stored first, then the stored draft becomes the version. */
  protected async publish(replaceNewer = false): Promise<void> {
    if (this.publishing()) return;
    const problem = planProblem(this.plan(), this.book());
    this.problem.set(problem);
    this.saveError.set(null);
    this.newerVersion.set(null);
    if (problem) {
      this.showProblem(problem);
      return;
    }

    return this.scope.run('publish', async (owner) => {
      this.publishing.set(true);
      const isFirst = this.detail() === null;
      try {
        // An untouched plan (an earlier version, or one never published) gets its draft now.
        if (!this.stored && !this.autosave.hasUnsaved) this.autosave.changed();
        if (!(await owner.wait(this.autosave.flush())) || !this.stored) {
          this.saveError.set(
            this.saveProblem()?.message ??
              $localize`Your latest changes could not be saved, so nothing was published. Check your connection and try again.`,
          );
          return;
        }
        const stored: StoredDraft = this.stored;
        const published = await this.write(owner, () =>
          this.api.publishDraft(stored.id, { version: stored.version, replaceNewer }),
        );
        this.forgetDraft();
        // The address names the plan, and no longer a draft or an older version; the page stays.
        this.loadedKey = this.addressKey(owner.tenantId, published.id, null, null);
        await owner.wait(
          this.router.navigate(['/nutrition/plans', published.id], { replaceUrl: true }),
        );
        await owner.wait(this.loadPlan(published.id, null, null, true));
        this.toast.show(
          isFirst
            ? $localize`Published. You can assign it to clients now.`
            : $localize`Published. Clients already on this plan keep their own copy.`,
          { tone: 'success' },
        );
      } catch (error) {
        if (!owner.current) return;
        await this.publishRefused(owner, error);
      } finally {
        if (owner.current) this.publishing.set(false);
      }
    });
  }

  private async publishRefused(owner: TenantOperation, error: unknown): Promise<void> {
    const code =
      error instanceof HttpErrorResponse ? (error.error as { code?: unknown } | null)?.code : null;
    if (code === 'newer_version_published') {
      const id = this.planId();
      try {
        if (id) this.detail.set(await owner.wait(firstValueFrom(this.api.getPlan(id))));
      } catch {
        // The sentence below still holds without the number.
      }
      const newest = numeric(this.detail()?.currentRevision ?? 0);
      this.newerVersion.set(
        newest > 0
          ? $localize`Version ${newest}:number: of this meal plan was published after you started these changes. Publish yours as the newest version? Version ${newest}:number: stays in Versions.`
          : $localize`A newer version of this meal plan was published after you started these changes. Publish yours as the newest version? The other one stays in Versions.`,
      );
      return;
    }
    if (
      error instanceof HttpErrorResponse &&
      (error.status === 404 || code === 'meal_plan_draft_stale')
    ) {
      this.saveOutcome(error);
      return;
    }
    this.saveError.set(
      apiErrorMessage(
        error,
        $localize`The meal plan could not be published. Your changes are kept; try again.`,
      ),
    );
  }

  /** Takes the coach to what stops Publish: the name, the targets, a day or a meal. */
  protected showProblem(problem: PlanProblem | null = this.problem()): void {
    if (!problem) return;
    if (problem.focus === 'meal' && problem.dayKey && problem.mealKey) {
      this.focusDay(problem.dayKey);
      this.openMeal({ dayKey: problem.dayKey, mealKey: problem.mealKey });
      return;
    }
    if (problem.focus === 'day') {
      this.focusDay(problem.dayKey);
      return;
    }
    const selector = problem.focus === 'name' ? '.name-input' : '.targets input';
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLInputElement>(selector)?.focus(),
      { injector: this.injector },
    );
  }

  /** Discard: the coach's changes go, and the plan as last saved comes back. */
  protected async discard(): Promise<void> {
    const id = this.planId();
    const agreed = await this.ask({
      title: id ? $localize`Discard your changes?` : $localize`Discard this meal plan?`,
      message: id
        ? $localize`The meal plan goes back to how it was last published. This can’t be undone.`
        : $localize`It was never published, so no client has it. This can’t be undone.`,
      confirm: id ? $localize`Discard changes` : $localize`Discard meal plan`,
      cancel: $localize`Keep editing`,
    });
    if (agreed) await this.discardThenOpen(id, null);
  }

  /** Removes the coach's draft, then opens a version of the plan (the newest when null). */
  private async discardThenOpen(id: string | null, versionId: string | null): Promise<void> {
    return this.scope.run('discard', async (owner) => {
      await owner.wait(this.autosave.hold());
      const stored = this.stored;
      try {
        if (stored) {
          await this.write(owner, () => this.api.discardDraft(stored.id, stored.version));
        }
      } catch (error) {
        if (!owner.current) return;
        // A draft already gone (published or discarded in another tab) needs no discarding.
        if (!(error instanceof HttpErrorResponse && error.status === 404)) {
          this.autosave.release();
          if (
            error instanceof HttpErrorResponse &&
            (error.error as { code?: unknown } | null)?.code === 'meal_plan_draft_stale'
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
      if (id === null) {
        this.loadedKey = null;
        await owner.wait(this.router.navigate(['/nutrition/plans']));
        this.toast.show($localize`Meal plan discarded.`);
        return;
      }
      this.loadedKey = this.addressKey(owner.tenantId, id, versionId, null);
      await owner.wait(
        this.router.navigate(['/nutrition/plans', id], {
          queryParams: versionId ? { version: versionId } : {},
          replaceUrl: true,
        }),
      );
      await owner.wait(this.loadPlan(id, versionId, null, false));
      if (!versionId) this.toast.show($localize`Changes discarded.`);
    });
  }

  /** After another tab moved on: the page reads the plan again, as the server now has it. */
  protected reloadLatest(): void {
    this.loadedKey = null;
    this.forgetDraft();
    this.retryPlan();
  }

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

  // ---------- drawing the grid ----------

  private rows(plan: MealPlanModel, book: RecipeBook, problem: PlanProblem | null): WeekRow[] {
    const target = plan.targets.calories;
    const single = plan.days.length <= 1;
    return weeksOf(plan).map((week) => ({
      key: week.key,
      number: week.number,
      title: $localize`Week ${week.number}:number:`,
      days: week.days.map(({ day, number }) => {
        const total = dayTotal(day, book);
        const kcal = kcalText(total.macros.calories, this.locale);
        const place = standing(total, target);
        const difference = target !== null ? Math.round(total.macros.calories - target) : 0;
        return {
          key: day.key,
          number,
          title: $localize`Day ${number}:day:`,
          listId: `meals-${day.key}`,
          newMealId: `new-meal-${day.key}`,
          target: { kind: 'meals', dayKey: day.key },
          newMealTarget: { kind: 'new-meal', dayKey: day.key },
          menuLabel: $localize`More for day ${number}:day:`,
          addLabel: $localize`Add a meal to day ${number}:day:`,
          kcal: total.isAverage ? `≈ ${kcal}` : kcal,
          against: this.againstLine(place, difference),
          macros: macroLine(total.macros, this.locale),
          standing: place,
          fill: target !== null && target > 0 ? Math.min(total.macros.calories / target, 1) : 0,
          isProblem: problem?.dayKey === day.key,
          menu: [
            {
              label: $localize`Duplicate day`,
              action: 'duplicate',
              hint:
                plan.days.length >= MAX_DAYS
                  ? $localize`A meal plan holds up to ${MAX_DAYS}:count: days.`
                  : $localize`A copy right after it`,
              disabled: plan.days.length >= MAX_DAYS,
            },
            {
              label: $localize`Use for every day`,
              action: 'everyday',
              hint: $localize`Every other day gets these meals`,
              disabled: single || day.meals.length === 0,
            },
            { label: $localize`Clear meals`, action: 'clear', disabled: day.meals.length === 0 },
            {
              label: $localize`Delete day`,
              action: 'delete',
              danger: true,
              disabled: single,
              hint: single ? $localize`A meal plan keeps at least one day.` : undefined,
            },
          ],
          meals: day.meals.map((meal, index) => {
            const ref = { dayKey: day.key, mealKey: meal.key };
            const name = meal.name.trim() || $localize`Unnamed meal`;
            const mealKcal = kcalText(mealTotal(meal, book).macros.calories, this.locale);
            return {
              key: meal.key,
              ref,
              name,
              kcal: meal.choices.length > 1 ? `≈ ${mealKcal}` : mealKcal,
              listId: `options-${meal.key}`,
              target: { kind: 'options', ref },
              drag: { kind: 'meal', ref },
              openLabel: $localize`Edit ${name}:meal: on day ${number}:day:`,
              menuLabel: $localize`More for ${name}:meal: on day ${number}:day:`,
              menu: [
                { label: $localize`Edit meal`, action: 'edit' },
                {
                  label: $localize`Add another option`,
                  action: 'option',
                  disabled: meal.choices.length >= MAX_CHOICES_PER_MEAL,
                },
                { label: $localize`Move up`, action: 'up', disabled: index === 0 },
                {
                  label: $localize`Move down`,
                  action: 'down',
                  disabled: index === day.meals.length - 1,
                },
                { label: $localize`Delete meal`, action: 'delete', danger: true },
              ],
              options: meal.choices.map((choice) => {
                const recipe = book.get(choice.recipeVersionId);
                const macros = choiceMacros(choice, book);
                return {
                  key: choice.key,
                  name: recipe?.name ?? $localize`Missing recipe`,
                  line:
                    choice.servings !== null && macros
                      ? `${servingsText(choice.servings, this.locale)} · ${kcalText(macros.calories, this.locale)}`
                      : $localize`Set the servings`,
                  missing: !recipe?.isPublished,
                };
              }),
            };
          }),
        };
      }),
    }));
  }

  private againstLine(place: TargetStanding, difference: number): string | null {
    const amount = formatNumber(Math.abs(difference), this.locale, '1.0-0');
    switch (place) {
      case 'unset':
        return null;
      case 'empty':
        return $localize`No meals yet`;
      case 'on':
        return $localize`On target`;
      case 'under':
        return $localize`${amount}:amount: kcal under`;
      case 'over':
        return $localize`${amount}:amount: kcal over`;
    }
  }

  protected canAddMealTo(dayKey: string): boolean {
    return (
      (this.plan().days.find((day) => day.key === dayKey)?.meals.length ?? 0) < MAX_MEALS_PER_DAY
    );
  }

  protected ringOffset(fill: number): string {
    return (RING * (1 - fill)).toFixed(2);
  }

  // ---------- helpers ----------

  private sendRemaining(): Promise<boolean> {
    return Promise.race([
      this.autosave.flush(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LEAVE_WAIT_MS)),
    ]);
  }

  private savedLine(savedAt: string | null): string {
    if (!savedAt) return $localize`Changes saved, not published yet`;
    const day = formatDate(savedAt, 'yyyy-MM-dd', this.locale);
    const today = formatDate(new Date(), 'yyyy-MM-dd', this.locale);
    return day === today
      ? $localize`Saved at ${formatDate(savedAt, 'HH:mm', this.locale)}:time:, not published yet`
      : $localize`Saved on ${formatDate(savedAt, 'EEE d MMM', this.locale)}:date:, not published yet`;
  }

  /**
   * A write with the antiforgery token refreshed once per page (a write straight after sign-in is
   * refused otherwise), and refreshed again when the server says it expired.
   */
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

  private addressKey(
    tenant: string,
    id: string | null,
    version: string | null,
    draftId: string | null,
  ): string {
    return `${tenant}|${id ?? 'new'}|${version ?? ''}|${draftId ?? ''}`;
  }

  private dropVersionFromAddress(tenant: string, id: string): void {
    this.loadedKey = this.addressKey(tenant, id, null, null);
    void this.router.navigate(['/nutrition/plans', id], { replaceUrl: true });
  }

  /**
   * A new plan's draft goes into the address, so a refresh reopens it. Not through the router: a
   * navigation scrolls the page to the top, and this happens mid-edit, at the first autosave.
   */
  private showDraftInAddress(draftId: string): void {
    this.location.replaceState('/nutrition/plans/new', `draft=${encodeURIComponent(draftId)}`);
  }

  private adopt(plan: MealPlanModel): void {
    this.plan.set(plan);
    this.problem.set(null);
    this.saveError.set(null);
    this.newerVersion.set(null);
    this.revision.update((value) => value + 1);
  }

  private adoptStored(view: MealPlanDraftView): void {
    this.stored = { id: view.id, version: numeric(view.version) };
    this.hasDraft.set(true);
    this.draftSavedAt.set(view.updatedAtUtc);
    this.draftStartedAt.set(numeric(view.startedAtRevision));
    this.planRecipes.set(view.recipes.map(planRecipe));
    this.adopt(planFromDraft(view));
  }

  /** The page no longer holds a draft: opened afresh, published or discarded. */
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

  private focusHeading(): void {
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  /** After a day changes, focus lands on it (and a phone shows its week) rather than on the page. */
  private focusDay(dayKey: string | undefined): void {
    if (!dayKey) return;
    const week = this.grid().find((row) => row.days.some((day) => day.key === dayKey));
    if (week) this.phoneWeek.set(week.key);
    this.phoneDay.set(dayKey);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-day="${dayKey}"]`)
          ?.focus({ preventScroll: false }),
      { injector: this.injector },
    );
  }

  private announce(message: string): void {
    this.toast.show(message, { tone: 'success' });
  }

  private resetTenantState(): void {
    this.libraryTenant = null;
    this.loadedKey = null;
    this.csrfReady = null;
    this.phoneWeek.set(null);
    this.phoneDay.set(null);
    this.pickerRef = null;
    this.detail.set(null);
    this.openVersionId.set(null);
    this.readNewest = 0;
    this.forgetDraft();
    this.plan.set(emptyPlan());
    this.planRecipes.set([]);
    this.state.set('loading');
    this.publishing.set(false);
    this.problem.set(null);
    this.saveError.set(null);
    this.recipes.set([]);
    this.libraryState.set('loading');
    this.editing.set(null);
    this.picking.set(null);
  }
}
