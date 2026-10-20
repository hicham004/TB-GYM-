import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import type { AllergenCode } from '../../core/api/generated';
import { GuardedSheets, type Closable } from '../../core/forms/guarded-sheets';
import { UiConfirm } from '../../ui/confirm';
import { dayWords } from '../progress/progress-entries.models';
import { AdjustMacros } from './adjust-macros-sheet';
import { AssignMealPlan } from './assign-plan-sheet';
import { EditAllergens } from './allergens-sheet';
import {
  splitPlans,
  type NutritionCover,
  type PlanRow,
  type Starting,
  type WorkedOut,
} from './client-nutrition.models';
import { StopMealPlan, type StopOutcome } from './stop-plan-sheet';
import { WorkOutTargets } from './targets-sheet';

/** What a sheet changed, so the page reads that part again. */
export type NutritionChange = 'targets' | 'plans' | 'allergens';

/**
 * The sheets of a client's Nutrition tab, opened from one place (R5.3d; A6 added the coach's own macros
 * and stopping a plan). A sheet holding typed work asks before it closes, however it is closed, and one
 * that saved says so in a toast and tells the page which part to read again. Working targets out or
 * adjusting them can lead straight on to assigning a meal plan with them, and an assignment that finds
 * no targets can lead back.
 */
@Component({
  selector: 'app-client-nutrition-sheets',
  imports: [AdjustMacros, AssignMealPlan, EditAllergens, StopMealPlan, UiConfirm, WorkOutTargets],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: none' },
  template: `
    <ng-template #targetsSheet let-sheet>
      <app-work-out-targets
        [clientId]="clientId()"
        [firstName]="firstName()"
        [starting]="starting()"
        [last]="calculations()[0] ?? null"
        [today]="today()"
        [locale]="locale()"
        (dirtyChange)="dirty = $event"
        (recorded)="newest.set($event); changed.emit('targets')"
        (assign)="assignWith($event, sheet)"
        (closed)="targetsClosed($event, sheet)"
      />
    </ng-template>

    <ng-template #assignSheet let-sheet>
      <app-assign-meal-plan
        [clientId]="clientId()"
        [firstName]="firstName()"
        [today]="today()"
        [locale]="locale()"
        [timeZone]="timeZone()"
        [covers]="covers()"
        [existing]="plans()"
        [calculations]="allCalculations()"
        [declared]="declared()"
        (dirtyChange)="dirty = $event"
        (workOut)="workOutFirst(sheet)"
        (closed)="assigned($event, sheet)"
      />
    </ng-template>

    <ng-template #allergensSheet let-sheet>
      <app-edit-allergens
        [clientId]="clientId()"
        [firstName]="firstName()"
        [declared]="declared()"
        [theirWords]="theirWords()"
        (dirtyChange)="dirty = $event"
        (closed)="allergensClosed($event, sheet)"
      />
    </ng-template>

    <ng-template #adjustSheet let-sheet>
      @if (allCalculations()[0]; as latest) {
        <app-adjust-macros
          [clientId]="clientId()"
          [firstName]="firstName()"
          [from]="latest"
          [current]="currentPlan()"
          [today]="today()"
          [locale]="locale()"
          [timeZone]="timeZone()"
          (dirtyChange)="dirty = $event"
          (recorded)="newest.set($event); changed.emit('targets')"
          (assign)="assignWith($event, sheet)"
          (closed)="adjustClosed($event, sheet)"
        />
      }
    </ng-template>

    <ng-template #stopSheet let-sheet>
      @if (stopping(); as plan) {
        <app-stop-meal-plan
          [clientId]="clientId()"
          [firstName]="firstName()"
          [plan]="plan"
          [today]="today()"
          [locale]="locale()"
          (dirtyChange)="dirty = $event"
          (stale)="changed.emit('plans')"
          (closed)="stopped($event, sheet)"
        />
      }
    </ng-template>

    <ng-template #confirmTemplate let-dialog>
      @if (asking(); as question) {
        <app-confirm
          [message]="question.message"
          [confirmLabel]="question.confirm"
          [cancelLabel]="question.cancel"
          (answer)="dialog.close($event)"
        />
      }
    </ng-template>
  `,
})
export class ClientNutritionSheets extends GuardedSheets {
  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<string>();
  readonly locale = input<string>('en');
  readonly timeZone = input<string>('UTC');
  /** What the record already knows, as the calculation starts from it. */
  readonly starting = input.required<Starting>();
  readonly calculations = input<readonly WorkedOut[]>([]);
  readonly plans = input<readonly PlanRow[]>([]);
  readonly covers = input<readonly NutritionCover[]>([]);
  readonly declared = input<readonly AllergenCode[]>([]);
  /** What the client wrote about allergies, if anything. */
  readonly theirWords = input<string | null>(null);
  /** A sheet saved something: read that part again. */
  readonly changed = output<NutritionChange>();

  private readonly targetsSheet = viewChild.required<TemplateRef<unknown>>('targetsSheet');
  private readonly assignSheet = viewChild.required<TemplateRef<unknown>>('assignSheet');
  private readonly allergensSheet = viewChild.required<TemplateRef<unknown>>('allergensSheet');
  private readonly adjustSheet = viewChild.required<TemplateRef<unknown>>('adjustSheet');
  private readonly stopSheet = viewChild.required<TemplateRef<unknown>>('stopSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmTemplate');

  /** The calculation just made, which the page may not have read yet. */
  protected readonly newest = signal<WorkedOut | null>(null);
  protected readonly allCalculations = computed(() => {
    const made = this.newest();
    const read = this.calculations();
    return made && !read.some((item) => item.id === made.id) ? [made, ...read] : read;
  });
  protected readonly currentPlan = computed(() => splitPlans(this.plans()).current);
  /** The plan the stop sheet is about, as the page has it now: a re-read gives it its new version. */
  private readonly stoppingId = signal<string | null>(null);
  protected readonly stopping = computed(
    () => this.plans().find((plan) => plan.id === this.stoppingId()) ?? null,
  );

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  // ---- opening ----

  workOut(): void {
    this.show(this.targetsSheet(), $localize`Work out targets for ${this.firstName()}:name:`);
  }

  assign(): void {
    this.show(this.assignSheet(), $localize`Assign a meal plan to ${this.firstName()}:name:`);
  }

  editAllergens(): void {
    this.show(this.allergensSheet(), $localize`Allergens for ${this.firstName()}:name:`);
  }

  /** The coach's own grams over the latest targets (INV-2); there is nothing to adjust before them. */
  adjustMacros(): void {
    if (!this.allCalculations()[0]) return;
    this.show(this.adjustSheet(), $localize`Adjust macros for ${this.firstName()}:name:`);
  }

  stopPlan(plan: PlanRow): void {
    this.stoppingId.set(plan.id);
    this.show(this.stopSheet(), $localize`Stop ${this.firstName()}:name:’s meal plan`);
  }

  // ---- what the sheets say back ----

  protected targetsClosed(made: WorkedOut | null, sheet: Closable): void {
    if (made === null) return void this.closeAsking(sheet);
    this.dirty = false;
    sheet.close(true);
  }

  /** The result is on screen: close it and open the meal plan sheet with these targets in it. */
  protected assignWith(made: WorkedOut, sheet: Closable): void {
    this.newest.set(made);
    this.dirty = false;
    sheet.close(true);
    this.assign();
  }

  /** The meal plan sheet found no targets: close it (asking first) and open the calculator. */
  protected async workOutFirst(sheet: Closable): Promise<void> {
    if (!(await this.canClose())) return;
    this.dirty = false;
    sheet.close(null);
    this.workOut();
  }

  protected assigned(row: PlanRow | null, sheet: Closable): void {
    if (row === null) return void this.closeAsking(sheet);
    const start = dayWords(row.start, this.today(), this.locale());
    this.done(sheet, $localize`${row.name}:plan: assigned from ${start}:day:.`);
    this.changed.emit('plans');
  }

  protected adjustClosed(made: WorkedOut | null, sheet: Closable): void {
    if (made === null) return void this.closeAsking(sheet);
    this.dirty = false;
    sheet.close(true);
  }

  protected stopped(outcome: StopOutcome | null, sheet: Closable): void {
    if (outcome === null) return void this.closeAsking(sheet);
    this.done(
      sheet,
      outcome.already
        ? $localize`${outcome.row.name}:plan: was already stopped.`
        : $localize`${outcome.row.name}:plan: stopped. Its days are free for another meal plan.`,
    );
    this.changed.emit('plans');
  }

  protected allergensClosed(codes: AllergenCode[] | null, sheet: Closable): void {
    if (codes === null) return void this.closeAsking(sheet);
    this.done(
      sheet,
      codes.length === 0
        ? $localize`No allergens declared for ${this.firstName()}:name:.`
        : $localize`Allergens saved for ${this.firstName()}:name:.`,
    );
    this.changed.emit('allergens');
  }
}
