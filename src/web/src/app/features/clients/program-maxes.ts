import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  LOCALE_ID,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { TrainingMaxesView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { ClientProgramApi } from './client-program-api';
import { programWriteError, serverCode } from './client-program-forms.models';
import type { BlockCard } from './client-program.models';
import { maxCards, type MaxCard } from './program-maxes.models';

/**
 * The program's training maxes, at the top right of a client's Training (P2): each lift's number, where
 * it came from and when, and the way to change them for the coming weeks. A program keeps its own
 * maxes; changing one adds a new max beside the old, so the history stays (STR-002). The server says
 * which max is in use; this draws it. A program that works no weight out from a max shows nothing.
 * When the client's logged sets suggest another max (P4b, STR-007), the lift says so and offers the
 * same update, worked out first; nothing changes until the coach applies it. The coach can also keep the
 * max in use (P4c, STR-013): the suggestion goes quiet until the client logs something newer.
 */
@Component({
  selector: 'app-program-maxes',
  imports: [Button, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The page lays itself out around this panel only while it has something to show.
  host: { '[attr.data-filled]': 'cards().length > 0 ? "" : null' },
  template: `
    @switch (state()) {
      @case ('loading') {
        <section class="panel" aria-busy="true">
          <app-skeleton [label]="loadingLabel" [lines]="3" />
        </section>
      }
      @case ('error') {
        <section class="panel">
          <div class="problem-row">
            <p role="alert" i18n>The training maxes could not be loaded.</p>
            <button appButton type="button" variant="outlined" (click)="load()" i18n>
              Try again
            </button>
          </div>
        </section>
      }
      @default {
        @if (cards().length > 0) {
          <section class="panel" aria-labelledby="maxes-title">
            <header class="head">
              <h2 id="maxes-title" tabindex="-1" i18n>Training maxes</h2>
              <p class="span" dir="auto" i18n>
                What {{ block().name }} works its weights out from.
              </p>
            </header>
            @if (problem(); as message) {
              <p class="problem" role="alert" dir="auto">{{ message }}</p>
            }
            <ul class="lifts">
              @for (card of cards(); track card.exerciseId) {
                <li class="lift">
                  <div class="top">
                    <span class="name" dir="auto">{{ card.name }}</span>
                    <span class="value">{{ card.value }}</span>
                  </div>
                  <p class="source" dir="auto">{{ card.source }}</p>
                  @if (card.basis; as basis) {
                    <p class="detail" dir="auto">{{ basis }}</p>
                  }
                  @if (card.change; as change) {
                    <p class="detail" dir="auto">{{ change }}</p>
                  }
                  @if (card.appliesFrom; as applies) {
                    <p class="detail" dir="auto">{{ applies }}</p>
                  }
                  @if (card.suggestion; as suggestion) {
                    @if (!block().terminal) {
                      <div class="suggestion">
                        <p
                          class="suggestion-head"
                          [id]="'suggestion-' + card.exerciseId"
                          tabindex="-1"
                          dir="auto"
                        >
                          {{ suggestion.headline }}
                        </p>
                        <p class="detail" dir="auto">{{ suggestion.from }}</p>
                        <div class="suggestion-actions">
                          <button
                            appButton
                            type="button"
                            variant="outlined"
                            [disabled]="keeping() !== null"
                            [attr.aria-describedby]="'suggestion-' + card.exerciseId"
                            (click)="update.emit(card.exerciseId)"
                            i18n
                          >
                            Review the new weights
                          </button>
                          <button
                            appButton
                            type="button"
                            variant="text"
                            [loading]="keeping() === card.exerciseId"
                            [disabled]="keeping() !== null && keeping() !== card.exerciseId"
                            [attr.aria-describedby]="'suggestion-' + card.exerciseId"
                            (click)="keep(card)"
                          >
                            {{ suggestion.keepLabel }}
                          </button>
                        </div>
                      </div>
                    }
                  }
                  @if (card.kept; as kept) {
                    <p
                      class="detail kept"
                      [id]="'kept-' + card.exerciseId"
                      tabindex="-1"
                      dir="auto"
                    >
                      {{ kept }}
                    </p>
                  }
                  @if (card.earlier.length > 0) {
                    <details class="history">
                      <summary>
                        <ng-container i18n>Earlier maxes</ng-container>&ngsp;<span class="count">{{
                          card.earlier.length
                        }}</span>
                      </summary>
                      <ul>
                        @for (row of card.earlier; track row.id) {
                          <li>
                            <span class="past-value">{{ row.value }}</span>
                            <span class="past-words" dir="auto">{{ row.words }}</span>
                            <span class="past-reason" dir="auto">{{ row.reason }}</span>
                          </li>
                        }
                      </ul>
                    </details>
                  }
                </li>
              }
            </ul>
            <div class="foot">
              @if (block().terminal) {
                <p class="note" i18n>This program is over, so its maxes stay as they were.</p>
              } @else {
                <button appButton type="button" (click)="update.emit(null)" i18n>
                  Update maxes for the coming weeks
                </button>
              }
            </div>
          </section>
        }
      }
    }
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
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      margin-block-end: 0.5rem;
    }

    h2 {
      color: var(--tb-ink);
      font-size: 1rem;
      font-weight: 600;
      margin: 0;
    }

    p {
      color: var(--tb-ink);
      margin: 0;
      overflow-wrap: anywhere;
    }

    .span {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    .problem-row {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .lift {
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      padding-block: 0.75rem;
    }

    .top {
      align-items: baseline;
      display: flex;
      gap: 0.75rem;
      justify-content: space-between;
    }

    .name {
      color: var(--tb-ink);
      font-weight: 600;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .value {
      color: var(--tb-ink);
      font-size: 1.25rem;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      white-space: nowrap;
    }

    .source,
    .detail {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    // What the client's logged sets suggest (P4b): set apart, never applied until the coach reviews it.
    .suggestion {
      align-items: flex-start;
      background: var(--tb-accent-soft);
      border-radius: var(--tb-radius-control);
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-block-start: 0.5rem;
      padding: 0.75rem;
    }

    .suggestion-head {
      font-weight: 600;
    }

    .suggestion-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-block-start: 0.375rem;
    }

    .kept {
      margin-block-start: 0.25rem;
    }

    .kept:focus-visible,
    .suggestion-head:focus-visible,
    h2:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .problem {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-control);
      color: var(--tb-danger);
      font-size: 0.875rem;
      margin-block-end: 0.5rem;
      padding: 0.5rem 0.75rem;
    }

    .history {
      margin-block-start: 0.25rem;
    }

    .history summary {
      align-items: center;
      color: var(--tb-accent-ink);
      cursor: pointer;
      display: inline-flex;
      font-size: 0.8125rem;
      font-weight: 600;
      gap: 0.5rem;
      min-block-size: 2rem;
    }

    .history summary:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .count {
      background: var(--tb-surface-2);
      border-radius: 999px;
      color: var(--tb-ink);
      font-variant-numeric: tabular-nums;
      padding: 0 0.5rem;
    }

    .history li {
      display: grid;
      gap: 0 0.75rem;
      grid-template-columns: auto minmax(0, 1fr);
      padding-block: 0.375rem;
    }

    .past-value {
      color: var(--tb-ink);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }

    .past-words {
      color: var(--tb-muted);
      font-size: 0.8125rem;
    }

    .past-reason {
      color: var(--tb-muted);
      font-size: 0.8125rem;
      grid-column: 2;
    }

    .foot {
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      padding-block-start: 0.875rem;
    }

    .foot button {
      flex: 1 1 auto;
    }

    .note {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }
  `,
})
export class ProgramMaxes {
  private readonly programApi = inject(ClientProgramApi);
  private readonly csrf = inject(CsrfService);
  private readonly toast = inject(UiToast);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  /** The program in front of the coach; its id and version say when to read the maxes again. */
  readonly block = input.required<BlockCard>();
  readonly firstName = input.required<string>();
  /**
   * The coach came here to review maxes (Coach Today's "Review maxes"): once the panel shows, the first
   * suggestion comes into view with the focus on its sentence, or the panel's heading when there is none.
   */
  readonly reveal = input(false);
  /**
   * The coach asked to change the maxes: the page opens the sheet, which shares its data. The exercise id
   * says the coach came from that lift's suggestion, which the sheet then shows worked out; null otherwise.
   */
  readonly update = output<string | null>();

  protected readonly loadingLabel = $localize`Loading the training maxes…`;
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  /** The lift being kept, while the server answers. */
  protected readonly keeping = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  private readonly view = signal<TrainingMaxesView | null>(null);
  private revealedFor: string | null = null;

  protected readonly cards = computed(() => {
    const view = this.view();
    return view ? maxCards(view, this.firstName(), this.locale) : [];
  });

  private readonly key = computed(() => `${this.block().id}:${this.block().version}`);

  constructor() {
    effect(() => {
      this.scope.epoch();
      const id = this.block().id;
      this.key();
      // Untracked: reading and setting the view here must not make this effect run again.
      untracked(() => {
        // Another program's maxes are not shown while this one's load.
        if (this.view()?.mesocycleId !== id) {
          this.view.set(null);
          this.problem.set(null);
        }
        void this.load();
      });
    });

    effect(() => {
      const id = this.block().id;
      if (!this.reveal() || this.cards().length === 0 || this.revealedFor === id) return;
      this.revealedFor = id;
      afterNextRender(
        () => {
          const host = this.host.nativeElement;
          const target =
            host.querySelector<HTMLElement>('.suggestion-head') ??
            host.querySelector<HTMLElement>('#maxes-title');
          target?.scrollIntoView({ block: 'center' });
          target?.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
    });
  }

  /**
   * Keep the max in use over the suggestion (STR-013). Nothing in the program changes; the server records it
   * and answers with the maxes as they now read. A newer set logged since is refused, and the panel reads again.
   */
  protected async keep(card: MaxCard): Promise<void> {
    const suggestion = card.suggestion;
    if (!suggestion || this.keeping() !== null) return;
    const id = this.block().id;
    this.keeping.set(card.exerciseId);
    this.problem.set(null);
    try {
      await this.csrf.refresh();
      const view = await firstValueFrom(
        this.programApi.keepTrainingMax(id, {
          exerciseId: card.exerciseId,
          loggedSetId: suggestion.setId,
        }),
      );
      if (this.block().id !== id) return;
      this.view.set(view);
      this.toast.show($localize`Kept ${card.name}:lift: at ${card.value}:value:.`, {
        tone: 'success',
      });
      // The suggestion and its buttons are gone; the line that replaced them takes the focus.
      afterNextRender(
        () =>
          this.host.nativeElement.querySelector<HTMLElement>(`#kept-${card.exerciseId}`)?.focus(),
        { injector: this.injector },
      );
    } catch (error) {
      this.problem.set(
        programWriteError(
          error,
          $localize`The max could not be kept. Try again.`,
          this.firstName(),
        ),
      );
      if (serverCode(error) === 'training_max_suggestion_changed') void this.load();
    } finally {
      this.keeping.set(null);
    }
  }

  protected load(): Promise<void> {
    const id = this.block().id;
    return this.scope.run('load', async (owner) => {
      if (this.view() === null) this.state.set('loading');
      try {
        this.view.set(await owner.wait(firstValueFrom(this.programApi.getTrainingMaxes(id))));
        this.state.set('ready');
      } catch {
        // A failed reread keeps what is on screen; a first read has nothing to show.
        if (owner.current) this.state.set(this.view() === null ? 'error' : 'ready');
      }
    });
  }
}
