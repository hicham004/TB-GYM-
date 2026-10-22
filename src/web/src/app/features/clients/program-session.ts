import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injector,
  input,
  LOCALE_ID,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { SavedSessionView, TrainingMesocycleView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { FormSummary } from '../../ui/form-summary';
import { UiSelect, type SelectOption } from '../../ui/select';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { sessionFromSaved, toTrainingSessionRequest } from '../training/training-builder.models';
import { CoachWorkout } from '../training/coach-workout';
import { ExerciseDemo } from '../training/exercise-demo';
import {
  exerciseLines,
  markTone,
  type BlockCard,
  type ExerciseLine,
  type SessionCard,
  type WeekColumn,
} from './client-program.models';
import { programWriteError } from './client-program-forms.models';
import { ClientWorkspaceContext } from './client-workspace.context';

/**
 * One session of a program, opened from the timeline: what the coach prescribed and, when the client
 * started it, what they did. A session that is still to come can be swapped for one of the coach's
 * saved sessions; one that has happened, or been started, cannot (the server refuses both).
 */
@Component({
  selector: 'app-program-session',
  imports: [Button, CoachWorkout, ExerciseDemo, FormSummary, Skeleton, StatusPill, UiSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sheet">
      <p class="when">
        <span class="day">{{ session().day }} · {{ week().title }}</span>
        <app-status-pill [label]="session().markLabel" [tone]="tone()" />
      </p>

      @if (session().workoutId; as workoutId) {
        <section aria-labelledby="did-title">
          <h3 id="did-title" dir="auto" i18n>What {{ firstName() }} did</h3>
          <app-coach-workout
            [clientId]="clientId()"
            [workoutId]="workoutId"
            [clientName]="firstName()"
            [canReply]="!isFormer()"
          />
        </section>
      }

      <section aria-labelledby="prescribed-title">
        <h3 id="prescribed-title" i18n>Prescribed</h3>
        @switch (load()) {
          @case ('loading') {
            <app-skeleton [label]="loadingLabel" [lines]="3" />
          }
          @case ('error') {
            <div class="problem">
              <p role="alert" i18n>The session could not be loaded.</p>
              <button appButton type="button" variant="outlined" (click)="reload()" i18n>
                Try again
              </button>
            </div>
          }
          @default {
            @if (notes(); as text) {
              <p class="notes" dir="auto">{{ text }}</p>
            }
            <ol class="exercises">
              @for (exercise of exercises(); track exercise.id) {
                <li>
                  <div class="exercise-head">
                    <p class="exercise-name" dir="auto">{{ exercise.name }}</p>
                    <app-exercise-demo [assetIds]="exercise.media" [exerciseName]="exercise.name" />
                  </div>
                  <ul class="sets">
                    @for (line of exercise.sets; track $index) {
                      <li>{{ line }}</li>
                    }
                  </ul>
                  @if (exercise.notes) {
                    <p class="exercise-note" dir="auto">{{ exercise.notes }}</p>
                  }
                </li>
              } @empty {
                <li class="muted" i18n>No exercises in this session.</li>
              }
            </ol>
          }
        }
      </section>

      @if (canSwap()) {
        <details class="swap" (toggle)="swapToggled($event)">
          <summary i18n>Swap this session</summary>
          <div class="swap-body">
            <p class="muted" i18n>
              Replace it with one of your saved sessions. It stays on {{ session().day }}: only this
              session changes, and the rest of the program stays as it is.
            </p>
            <app-select
              [label]="savedLabel"
              [placeholder]="savedPlaceholder"
              [options]="savedOptions()"
              [errors]="swapError() ? [swapError()!] : null"
              [(value)]="chosenId"
            />
            @if (savedLoaded() && saved().length === 0) {
              <p class="muted" i18n>
                You have no saved sessions yet. Save one from the program builder first.
              </p>
            }
            <app-form-summary>
              @if (error(); as message) {
                {{ message }}
              }
            </app-form-summary>
            <div class="actions">
              <button
                appButton
                type="button"
                [loading]="busy()"
                [disabled]="saved().length === 0"
                (click)="swap()"
              >
                @if (busy()) {
                  <ng-container i18n>Swapping…</ng-container>
                } @else {
                  <ng-container i18n>Swap session</ng-container>
                }
              </button>
            </div>
          </div>
        </details>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .sheet {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    h3 {
      color: var(--tb-ink);
      font-size: 0.9375rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
    }

    p {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .when {
      align-items: center;
      color: var(--tb-muted);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 0.75rem;
    }

    .muted {
      color: var(--tb-muted);
    }

    .notes {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      color: var(--tb-ink);
      margin-block-end: 0.75rem;
      padding: 0.625rem 0.875rem;
      white-space: pre-wrap;
    }

    .exercises {
      display: flex;
      flex-direction: column;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .exercises > li {
      border-block-start: 1px solid var(--tb-line);
      padding-block: 0.625rem;
    }

    .exercises > li:first-child {
      border-block-start: 0;
      padding-block-start: 0;
    }

    .exercise-head {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.75rem;
      justify-content: space-between;
    }

    .exercise-name {
      color: var(--tb-ink);
      font-weight: 600;
    }

    .sets {
      color: var(--tb-ink);
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
      list-style: none;
      margin: 0.25rem 0 0;
      padding: 0;
    }

    .exercise-note {
      color: var(--tb-muted);
      font-size: 0.8125rem;
      margin-block-start: 0.25rem;
    }

    .problem {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
    }

    .swap {
      border-block-start: 1px solid var(--tb-line);
      padding-block-start: 0.75rem;
    }

    .swap summary {
      color: var(--tb-accent-ink);
      cursor: pointer;
      font-weight: 600;
      min-block-size: 2.75rem;
      padding-block: 0.625rem;
    }

    .swap summary:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .swap-body {
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
      padding-block: 0.5rem;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
    }
  `,
})
export class ProgramSession {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly injector = inject(Injector);
  private readonly summary = viewChild(FormSummary);

  readonly block = input.required<BlockCard>();
  readonly week = input.required<WeekColumn>();
  readonly session = input.required<SessionCard>();
  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** The workspace's own date: a session before it has happened and cannot be swapped. */
  readonly today = input.required<string>();
  /** True when the session was swapped, so the page reloads the program. */
  readonly closed = output<boolean>();

  protected readonly loadingLabel = $localize`Loading the session…`;
  protected readonly savedLabel = $localize`Saved session`;
  protected readonly savedPlaceholder = $localize`Choose a saved session…`;
  protected readonly load = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly view = signal<TrainingMesocycleView | null>(null);
  protected readonly saved = signal<SavedSessionView[]>([]);
  protected readonly savedLoaded = signal(false);
  protected readonly chosenId = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly swapError = signal<string | null>(null);
  protected readonly savedOptions = computed<SelectOption[]>(() =>
    this.saved().map((saved) => ({ value: saved.id, label: saved.name })),
  );
  private readonly savedField = viewChild(UiSelect);

  protected readonly tone = computed(() => markTone(this.session().mark));
  /** A former client's record is read-only (ADR 0027), so it takes no new note. */
  private readonly record = inject(ClientWorkspaceContext, { optional: true });
  protected readonly isFormer = computed(() => this.record?.isFormer() ?? false);

  private readonly detail = computed(() => {
    const view = this.view();
    const id = this.session().id;
    return view?.weeks.flatMap((week) => week.sessions).find((item) => item.id === id) ?? null;
  });

  protected readonly notes = computed(() => this.detail()?.coachNotes ?? null);

  protected readonly exercises = computed<ExerciseLine[]>(() => {
    const detail = this.detail();
    const view = this.view();
    return detail && view ? exerciseLines(detail, view.loadUnit, this.locale) : [];
  });

  /** Still to come and never started, in a program that is still open: the server's conditions. */
  protected readonly canSwap = computed(
    () =>
      !this.block().terminal &&
      this.session().workoutId === null &&
      this.session().date >= this.today(),
  );

  constructor() {
    // Reading the program's id inside `reload` is what makes this run again for another program.
    effect(() => {
      this.scope.epoch();
      void this.reload();
    });
  }

  protected reload(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.load.set('loading');
      try {
        this.view.set(
          await owner.wait(firstValueFrom(this.api.getTrainingMesocycle(this.block().id))),
        );
        this.load.set('ready');
      } catch {
        if (owner.current) this.load.set('error');
      }
    });
  }

  /** The saved sessions are read the first time the swap is opened, not for every session looked at. */
  protected swapToggled(event: Event): void {
    if (!(event.target as HTMLDetailsElement).open || this.savedLoaded()) return;
    void this.scope.run('saved', async (owner) => {
      try {
        this.saved.set(await owner.wait(firstValueFrom(this.api.listSavedSessions())));
        this.savedLoaded.set(true);
      } catch {
        if (owner.current) this.error.set($localize`Your saved sessions could not be loaded.`);
      }
    });
  }

  protected async swap(): Promise<void> {
    if (this.busy()) return;
    const saved = this.saved().find((item) => item.id === this.chosenId());
    if (!saved) {
      this.swapError.set($localize`Choose a saved session.`);
      this.error.set(null);
      afterNextRender(() => this.savedField()?.focus(), { injector: this.injector });
      return;
    }
    const block = this.block();
    this.swapError.set(null);
    this.error.set(null);
    this.busy.set(true);
    try {
      // The swap keeps this session's own day (TRAIN-3): the saved session's day is only where it
      // sat in its own program. The server keeps the day whatever is sent.
      const request = toTrainingSessionRequest(sessionFromSaved(saved));
      const dayOffset = this.detail()?.dayOffset ?? request.dayOffset;
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.replaceFutureTrainingSession(block.id, this.session().id, {
          session: { ...request, dayOffset },
          version: block.version,
        }),
      );
      this.closed.emit(true);
    } catch (error) {
      this.error.set(
        programWriteError(error, $localize`The session could not be swapped.`, this.firstName()),
      );
      this.summary()?.focus();
    } finally {
      this.busy.set(false);
    }
  }
}
