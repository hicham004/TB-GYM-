import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  LOCALE_ID,
  output,
  signal,
} from '@angular/core';
import type { FoodItemView } from '../../core/api/generated';
import { Button } from '../../ui/button';
import { foodFacts } from './food.models';

/**
 * One food in full (C7, R4.4c): its nutrients for the amount they are given for, what the label or
 * USDA says, anything USDA left out, and its allergens. The coach's own food is edited; a USDA food is
 * edited as a copy (Cronometer's "Edit a copy"). Either is archived rather than deleted, since recipes
 * keep the versions they copied, and an archived one is restored. Database codes wait behind a switch
 * (plan C7).
 */
@Component({
  selector: 'app-food-details',
  imports: [Button],
  template: `
    @let facts = details();
    <div class="details">
      @if (facts.archived; as archived) {
        <p class="line archived">{{ archived }}</p>
      }
      <p class="source">{{ facts.source }}</p>
      <div class="energy">
        <span class="kcal">{{ facts.kcal }}</span>
        <span class="per">{{ facts.per }}</span>
      </div>
      <dl class="rows">
        @for (row of facts.rows; track row.label) {
          <div class="row" [class.indent]="row.indent">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        }
      </dl>
      @if (facts.label; as label) {
        <p class="line">
          {{ label }}
          @if (facts.discrepancy; as discrepancy) {
            &ngsp;<strong class="warn">{{ discrepancy }}</strong>
          }
        </p>
      }
      @if (facts.unreported; as unreported) {
        <p class="line warn">{{ unreported }}</p>
      }
      @if (facts.reportedCarbs; as reportedCarbs) {
        <p class="line note">{{ reportedCarbs }}</p>
      }
      <p class="line">{{ facts.allergens }}</p>
      @if (facts.database; as database) {
        <label class="switch">
          <input
            type="checkbox"
            [checked]="showDatabase()"
            (change)="showDatabase.set($any($event.target).checked)"
          />
          <ng-container i18n>Database details</ng-container>
        </label>
        @if (showDatabase()) {
          <p class="database">{{ database }}</p>
        }
      }
      <div class="actions">
        @if (facts.archived) {
          <button appButton type="button" [loading]="working()" (click)="restore.emit()" i18n>
            Restore food
          </button>
        } @else {
          @if (facts.own) {
            <button appButton type="button" (click)="edit.emit()" i18n>Edit food</button>
          } @else {
            <button appButton type="button" variant="outlined" (click)="editCopy.emit()" i18n>
              Edit a copy
            </button>
            <p class="hint" i18n>
              USDA’s numbers stay as USDA published them; a copy is yours to change.
            </p>
          }
          <button
            appButton
            type="button"
            variant="text"
            [loading]="working()"
            (click)="archive.emit()"
            i18n
          >
            Archive food
          </button>
          <p class="hint" i18n>
            It leaves Foods and the ingredient search. Recipes and plans that use it keep it.
          </p>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .details {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .source,
    .per,
    .hint,
    .database {
      color: var(--tb-muted);
      font-size: 0.875rem;
      margin: 0;
    }

    .energy {
      align-items: baseline;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .kcal {
      color: var(--tb-ink);
      font-size: 1.75rem;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }

    .rows {
      border-block: 1px solid var(--tb-line);
      margin: 0;
    }

    .row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;

      & + .row {
        border-block-start: 1px solid var(--tb-line);
      }

      &.indent dt {
        color: var(--tb-muted);
        padding-inline-start: 1rem;
      }
    }

    dt {
      color: var(--tb-ink);
    }

    dd {
      color: var(--tb-ink);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      margin: 0;
    }

    .line {
      color: var(--tb-ink);
      margin: 0;
    }

    .warn {
      color: var(--tb-warning);
      font-weight: 600;
    }

    .note {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }

    .archived {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      padding: 0.5rem 0.75rem;
    }

    .switch {
      align-items: center;
      color: var(--tb-ink);
      cursor: pointer;
      display: inline-flex;
      gap: 0.5rem;
      min-block-size: 2.75rem;
    }

    .switch input {
      accent-color: var(--tb-brand);
      block-size: 1.125rem;
      inline-size: 1.125rem;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      align-items: flex-start;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoodDetails {
  private readonly locale = inject(LOCALE_ID);

  readonly food = input.required<FoodItemView>();
  /** The workspace's calorie tolerance, so a flagged food says how far is too far. */
  readonly tolerance = input<number | null>(null);
  /** An archive or restore of this food is on its way. */
  readonly working = input(false);
  readonly edit = output<void>();
  readonly editCopy = output<void>();
  readonly archive = output<void>();
  readonly restore = output<void>();

  protected readonly showDatabase = signal(false);
  protected readonly details = computed(() =>
    foodFacts(this.food(), this.tolerance(), this.locale),
  );
}
