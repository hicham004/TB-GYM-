import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  LOCALE_ID,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { ProgressionPreviewView, TrainingLoadUnit } from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control, Field } from '../../ui/field';
import type { BlockCard } from './client-program.models';
import {
  coverageText,
  previewWeeks,
  programWriteError,
  progressionErrors,
  type PreviewWeek,
} from './client-program-forms.models';
import { addDays } from './client-overview.models';

/**
 * "Build next block": repeat the weeks the coach picks, a little harder each time, and append them to
 * the program (STR-006, STR-009). Nothing is added until the coach has seen the result: the preview
 * has no side effect, and adding the weeks sends back the preview's hash and the program's version,
 * so the server refuses anything that changed in between.
 */
@Component({
  selector: 'app-program-next-block',
  imports: [Button, Checkbox, Control, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      <p class="muted" dir="auto" i18n>
        Pick the weeks of {{ block().name }} to repeat. Each copy asks for a little more effort, and
        you see the new weeks before anything is added.
      </p>

      <fieldset class="weeks">
        <legend i18n>Weeks to build on</legend>
        @for (week of block().weeks; track week.id) {
          <app-checkbox [label]="week.title + ' · ' + week.range">
            <input
              type="checkbox"
              appControl
              [checked]="chosen().has(week.id)"
              (change)="toggle(week.id, $any($event.target).checked)"
            />
          </app-checkbox>
        }
      </fieldset>

      <div class="pair">
        <app-field [label]="weeksLabel" [help]="weeksHelp">
          <input
            appControl
            type="number"
            min="1"
            max="12"
            step="1"
            [value]="iterations() ?? ''"
            (input)="setIterations($any($event.target).valueAsNumber)"
          />
        </app-field>
        <app-field [label]="effortLabel" [help]="effortHelp">
          <input
            appControl
            type="number"
            min="-2"
            max="2"
            step="0.5"
            [value]="step() ?? ''"
            (input)="setStep($any($event.target).valueAsNumber)"
          />
        </app-field>
      </div>

      @if (attempt.wasTried() && problems().length > 0) {
        <ul class="problem" role="alert">
          @for (problem of problems(); track problem) {
            <li>{{ problem }}</li>
          }
        </ul>
      }

      @if (preview(); as result) {
        <section class="preview" aria-labelledby="preview-title" aria-live="polite">
          <h3 id="preview-title" i18n>The new weeks</h3>
          <p class="preview-line">{{ previewLine() }}</p>
          @if (!result.isInsideTrainingCoverage) {
            <p class="problem-text" role="alert">{{ coverage() }}</p>
          }
          @for (week of weeks(); track week.number) {
            <div class="preview-week">
              <p class="preview-title">{{ weekTitle(week) }}</p>
              @for (session of week.sessions; track $index) {
                <div class="preview-session">
                  <p class="preview-name" dir="auto">{{ session.name }}</p>
                  <ul>
                    @for (exercise of session.exercises; track exercise.id) {
                      <li dir="auto">
                        <strong>{{ exercise.name }}</strong>
                        <span>{{ exercise.sets.join(' · ') }}</span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          }
        </section>
      }

      @if (error(); as message) {
        <p class="problem-text" role="alert">{{ message }}</p>
      }

      <div class="actions">
        <button appButton type="button" variant="text" (click)="closed.emit(false)" i18n>
          Not now
        </button>
        @if (preview(); as result) {
          <button
            appButton
            type="button"
            [loading]="busy()"
            [disabled]="!result.isInsideTrainingCoverage"
            (click)="apply()"
          >
            @if (busy()) {
              <ng-container i18n>Adding…</ng-container>
            } @else {
              <ng-container i18n>Add these weeks</ng-container>
            }
          </button>
        } @else {
          <button appButton type="button" [loading]="busy()" (click)="previewIt()">
            @if (busy()) {
              <ng-container i18n>Working it out…</ng-container>
            } @else {
              <ng-container i18n>Preview the new weeks</ng-container>
            }
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    p {
      color: var(--tb-ink);
      margin: 0;
      overflow-wrap: anywhere;
    }

    .muted {
      color: var(--tb-muted);
    }

    fieldset {
      border: 0;
      display: flex;
      flex-direction: column;
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    legend {
      color: var(--tb-ink);
      font-weight: 600;
      margin-block-end: 0.25rem;
      padding: 0;
    }

    .pair {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    }

    .problem,
    .problem-text {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-control);
      color: var(--tb-danger);
      font-weight: 600;
      margin: 0;
      padding: 0.625rem 0.875rem;
    }

    .problem {
      list-style: none;
    }

    // The buttons stay in view while a long sheet scrolls under them. The sheet pads its body by
    // 1.5rem, which the bar cancels so it spans the sheet edge to edge.
    .actions {
      background: var(--tb-surface);
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      inset-block-end: 0;
      justify-content: flex-end;
      margin-block-end: -1.5rem;
      margin-inline: -1.5rem;
      padding: 0.75rem 1.5rem;
      position: sticky;
    }

    .preview {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-card-small);
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
    }

    h3 {
      color: var(--tb-ink);
      font-size: 0.9375rem;
      font-weight: 600;
      margin: 0;
    }

    .preview-line {
      color: var(--tb-muted);
    }

    .preview-week {
      border-block-start: 1px solid var(--tb-line);
      padding-block-start: 0.625rem;
    }

    .preview-title {
      color: var(--tb-ink);
      font-weight: 600;
    }

    .preview-session {
      margin-block-start: 0.375rem;
    }

    .preview-name {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    ul {
      font-size: 0.875rem;
      list-style: none;
      margin: 0.125rem 0 0;
      padding: 0;
    }

    li {
      display: flex;
      flex-wrap: wrap;
      gap: 0 0.5rem;
    }

    li span {
      color: var(--tb-muted);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ProgramNextBlock {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  readonly block = input.required<BlockCard>();
  readonly firstName = input.required<string>();
  /** True when the weeks were added, so the page reloads the program. */
  readonly closed = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly weeksLabel = $localize`Weeks to add`;
  protected readonly weeksHelp = $localize`Between 1 and 12.`;
  protected readonly effortLabel = $localize`Effort change per week`;
  protected readonly effortHelp = $localize`RPE, from -2 to 2 in steps of 0.5.`;
  /** Starts from the program's last week, the usual week to build on. */
  protected readonly chosen = linkedSignal<ReadonlySet<string>>(
    () =>
      new Set(
        this.block()
          .weeks.slice(-1)
          .map((week) => week.id),
      ),
  );
  protected readonly iterations = signal<number | null>(3);
  protected readonly step = signal<number | null>(0.5);
  protected readonly preview = signal<ProgressionPreviewView | null>(null);
  protected readonly unit = signal<TrainingLoadUnit>('Kilogram');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly problems = computed(() =>
    progressionErrors({
      weekIds: [...this.chosen()],
      iterations: this.iterations(),
      rpeIncrement: this.step(),
    }),
  );

  protected readonly weeks = computed<PreviewWeek[]>(() => {
    const result = this.preview();
    return result ? previewWeeks(result, this.unit(), this.locale) : [];
  });

  protected readonly previewLine = computed(() => {
    const result = this.preview();
    if (!result) return '';
    const added = result.generatedWeeks.length;
    const end = formatDate(
      addDays(result.resultingEndDateExclusive, -1),
      'EEE d MMM y',
      this.locale,
    );
    return added === 1
      ? $localize`1 new week. The program would end ${end}:date:.`
      : $localize`${added}:count: new weeks. The program would end ${end}:date:.`;
  });

  protected readonly coverage = computed(() =>
    coverageText(this.preview()?.coverageMessage ?? null, this.firstName()),
  );

  constructor() {
    // The unit the loads are in belongs to the program; the preview does not carry it.
    effect(() => {
      this.scope.epoch();
      const id = this.block().id;
      void this.scope.run('unit', async (owner) => {
        try {
          const view = await owner.wait(firstValueFrom(this.api.getTrainingMesocycle(id)));
          this.unit.set(view.loadUnit);
        } catch {
          // Loads then read in kilograms; the preview itself does not depend on it.
        }
      });
    });
  }

  protected weekTitle(week: PreviewWeek): string {
    return $localize`Week ${week.number}:week:`;
  }

  protected toggle(id: string, checked: boolean): void {
    const next = new Set(this.chosen());
    if (checked) next.add(id);
    else next.delete(id);
    this.chosen.set(next);
    this.changed();
  }

  protected setIterations(value: number): void {
    this.iterations.set(Number.isNaN(value) ? null : value);
    this.changed();
  }

  protected setStep(value: number): void {
    this.step.set(Number.isNaN(value) ? null : value);
    this.changed();
  }

  /** Any change to the inputs makes a preview out of date: the coach asks again. */
  private changed(): void {
    this.preview.set(null);
    this.error.set(null);
  }

  protected async previewIt(): Promise<void> {
    if (this.busy()) return;
    this.attempt.attempt();
    if (this.problems().length > 0) return;
    const block = this.block();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      this.preview.set(
        await firstValueFrom(
          this.api.previewTrainingProgression(block.id, {
            sourceWeekIds: [...this.chosen()],
            iterations: this.iterations()!,
            rpeIncrement: this.step()!,
            mesocycleVersion: block.version,
          }),
        ),
      );
    } catch (error) {
      this.error.set(
        programWriteError(
          error,
          $localize`The new weeks could not be worked out.`,
          this.firstName(),
        ),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async apply(): Promise<void> {
    const result = this.preview();
    if (this.busy() || !result || !result.isInsideTrainingCoverage) return;
    const block = this.block();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.applyTrainingProgression(block.id, {
          sourceWeekIds: [...this.chosen()],
          iterations: this.iterations()!,
          rpeIncrement: this.step()!,
          previewHash: result.previewHash,
          mesocycleVersion: block.version,
        }),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        programWriteError(error, $localize`The weeks could not be added.`, this.firstName()),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
