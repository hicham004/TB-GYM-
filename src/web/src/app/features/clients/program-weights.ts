import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  LOCALE_ID,
  signal,
} from '@angular/core';
import type { LiftStandingView } from '../../core/api/generated';
import { Button } from '../../ui/button';
import { standingLine } from '../training/standing-words';
import { applyLabel, applyName, sessionWhere } from './lift-weights';

/**
 * Weights to apply (notes plan N6c, STR-020): every lift of the client whose standing moves a weight in its next
 * workout, with N6b's line, one Apply each and Apply all. The coach's weekly homework for this client, first on
 * their Training tab while there is any (decision 21: the coach applies, never the app or the client).
 */
@Component({
  selector: 'app-program-weights',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" aria-labelledby="weights-title">
      <header class="head">
        <div class="title">
          <h2 id="weights-title" tabindex="-1" i18n>Weights to apply</h2>
          <p class="span" dir="auto" i18n>
            From what {{ firstName() }} logged last time. Each goes to the lift’s next workout.
          </p>
        </div>
        @if (lifts().length > 1) {
          <button
            appButton
            type="button"
            variant="outlined"
            [loading]="busy() === 'all'"
            [attr.aria-label]="applyAllName()"
            (click)="applyAll()"
          >
            @if (busy() === 'all') {
              <ng-container i18n>Applying…</ng-container>
            } @else {
              <ng-container i18n>Apply all</ng-container>
            }
          </button>
        }
      </header>
      <ul class="lifts">
        @for (lift of lifts(); track lift.id) {
          <li class="lift">
            <div class="copy">
              <p class="where">
                <span class="name" dir="auto">{{ lift.name }}</span
                >&ngsp;<span class="when" dir="auto">{{ lift.where }}</span>
              </p>
              <p class="standing" [attr.data-standing]="lift.line.outcome">
                @for (part of lift.line.parts; track $index) {
                  @if (!$first) {
                    {{ separator }}
                  }
                  @if (part.strong) {
                    <strong>{{ part.text }}</strong>
                  } @else {
                    {{ part.text }}
                  }
                }
              </p>
            </div>
            <button
              appButton
              type="button"
              variant="outlined"
              [loading]="busy() === lift.id"
              [attr.aria-label]="lift.accessible"
              (click)="applyOne(lift.view)"
            >
              @if (busy() === lift.id) {
                <ng-container i18n>Applying…</ng-container>
              } @else {
                {{ lift.label }}
              }
            </button>
          </li>
        }
      </ul>
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: 0;
    }

    .panel {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-card);
      box-shadow: var(--tb-shadow-card);
      min-inline-size: 0;
      padding: 1rem 1.25rem 1.25rem;
    }

    .head {
      align-items: flex-start;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      justify-content: space-between;
      margin-block-end: 0.5rem;
    }

    .title {
      display: flex;
      flex: 1 1 16rem;
      flex-direction: column;
      gap: 0.125rem;
      min-inline-size: 0;
    }

    h2 {
      color: var(--tb-ink);
      font-size: 1rem;
      font-weight: 600;
      margin: 0;
    }

    p {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .span {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    .lifts {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .lift {
      align-items: center;
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      justify-content: space-between;
      padding-block: 0.75rem;
    }

    .copy {
      display: flex;
      flex: 1 1 18rem;
      flex-direction: column;
      gap: 0.125rem;
      min-inline-size: 0;
    }

    .where {
      display: flex;
      flex-wrap: wrap;
      gap: 0 0.5rem;
    }

    .name {
      color: var(--tb-ink);
      font-weight: 600;
    }

    .when {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }

    /* N6b's line, as on the session sheet: what happens next in ink, the rest muted. */
    .standing {
      color: var(--tb-muted);
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
      line-height: 1.4;
      text-wrap: pretty;
    }

    .standing strong {
      color: var(--tb-ink);
      font-weight: 600;
    }
  `,
})
export class ProgramWeights {
  private readonly locale = inject(LOCALE_ID);

  /** The client's standings that move a weight (`canApply`), as the program read gave them. */
  readonly standings = input.required<readonly LiftStandingView[]>();
  readonly firstName = input.required<string>();
  /**
   * The page's apply (N6c): it writes, says what happened in its own notice or alert, reads the program again and
   * puts the coach back here or on the program, and resolves once that read is in, so a button is never live on
   * an answer already applied.
   */
  readonly apply = input.required<(views: readonly LiftStandingView[]) => Promise<void>>();

  protected readonly separator = ' · ';
  protected readonly busy = signal<string | null>(null);

  protected readonly lifts = computed(() =>
    this.standings().map((view) => ({
      id: view.exercisePrescriptionId,
      view,
      name: view.exerciseName,
      where: sessionWhere(view, this.locale),
      line: standingLine(view, this.locale),
      label: applyLabel(view, this.locale),
      accessible: applyName(view, this.locale),
    })),
  );

  protected readonly applyAllName = computed(
    () => $localize`Apply all ${this.standings().length}:count: weights`,
  );

  protected applyOne(view: LiftStandingView): Promise<void> {
    return this.run(view.exercisePrescriptionId, [view]);
  }

  protected applyAll(): Promise<void> {
    return this.run('all', this.standings());
  }

  private async run(busy: string, views: readonly LiftStandingView[]): Promise<void> {
    if (this.busy() !== null || views.length === 0) return;
    this.busy.set(busy);
    try {
      await this.apply()(views);
    } finally {
      this.busy.set(null);
    }
  }
}
