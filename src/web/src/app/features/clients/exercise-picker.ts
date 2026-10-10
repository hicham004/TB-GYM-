import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Control, Field } from '../../ui/field';

export interface ExerciseChoice {
  readonly id: string;
  readonly name: string;
}

let nextPicker = 0;

/** How many matches the list shows; a longer name narrows the rest down. */
const MATCHES = 8;

/**
 * Chooses one exercise (R5.3d): the lifts that already have something on record first, as plain
 * choices, then a search of the library for any other. The library is searched on the server, so a
 * large one is never loaded whole; two letters are enough to start.
 */
@Component({
  selector: 'app-exercise-picker',
  imports: [Control, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="picker">
      <legend>{{ label() }}</legend>
      @if (suggested().length > 0) {
        <div class="choices" role="radiogroup" [attr.aria-label]="label()">
          @for (item of suggested(); track item.id) {
            <label class="choice" [class.chosen]="chosen()?.id === item.id">
              <input
                type="radio"
                [name]="group"
                [value]="item.id"
                [checked]="chosen()?.id === item.id"
                [attr.aria-invalid]="errors()?.length ? 'true' : null"
                (change)="chosen.set(item)"
              />
              <span class="choice-text">{{ item.name }}</span>
            </label>
          }
        </div>
      }
      <app-field [label]="searchLabel" [help]="searchHelp()">
        <input
          appControl
          type="search"
          autocomplete="off"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
        />
      </app-field>
      @if (extra().length > 0) {
        <div class="choices" role="radiogroup" [attr.aria-label]="searchLabel" data-matches>
          @for (item of extra(); track item.id) {
            <label class="choice" [class.chosen]="chosen()?.id === item.id">
              <input
                type="radio"
                [name]="group"
                [value]="item.id"
                [checked]="chosen()?.id === item.id"
                [attr.aria-invalid]="errors()?.length ? 'true' : null"
                (change)="chosen.set(item)"
              />
              <span class="choice-text">{{ item.name }}</span>
            </label>
          }
        </div>
      }
      @if (errors()?.length) {
        <p class="problem" role="status">{{ errors()![0] }}</p>
      }
    </fieldset>
  `,
  styles: `
    :host {
      display: block;
    }

    .picker {
      border: 0;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    legend {
      color: var(--tb-ink);
      font-size: 1rem;
      font-weight: 600;
      margin-block-end: 0.5rem;
      padding: 0;
    }

    .choices {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .choice {
      align-items: center;
      background: var(--tb-surface);
      border: 1px solid var(--tb-line-strong);
      border-radius: var(--tb-radius-control);
      color: var(--tb-ink);
      cursor: pointer;
      display: flex;
      gap: 0.625rem;
      min-block-size: 2.75rem;
      padding: 0.5rem 0.875rem;
    }

    .choice:hover {
      border-color: var(--tb-ink);
    }

    .choice.chosen {
      background: var(--tb-accent-soft);
      border-color: var(--tb-accent-ink);
    }

    .choice:has(input:focus-visible) {
      outline: 2px solid var(--tb-focus);
      outline-offset: 2px;
    }

    .choice input[type='radio'] {
      accent-color: var(--tb-accent-ink);
      block-size: 1.125rem;
      flex: none;
      inline-size: 1.125rem;
      margin: 0;
    }

    // A label's direct span is bold in the legacy global styles; a name here is not.
    .choice-text {
      color: var(--tb-ink);
      font-weight: 400;
      overflow-wrap: anywhere;
    }

    .problem {
      color: var(--tb-danger);
      font-size: 0.875rem;
      margin: 0;
    }
  `,
})
export class ExercisePicker {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  readonly label = input.required<string>();
  /** The lifts that already have something on record, offered before any search. */
  readonly suggested = input<readonly ExerciseChoice[]>([]);
  readonly chosen = model<ExerciseChoice | null>(null);
  /** The messages due on screen now. */
  readonly errors = input<readonly string[] | null>(null);

  protected readonly group = `tb-exercise-${++nextPicker}`;
  protected readonly searchLabel = $localize`Another exercise`;
  protected readonly query = signal('');
  private readonly found = signal<readonly ExerciseChoice[]>([]);
  private readonly state = signal<'idle' | 'searching' | 'none' | 'failed'>('idle');

  /** What the search shows: a pick from an earlier search stays on the list while the coach searches on. */
  protected readonly extra = computed(() => {
    const known = new Set(this.suggested().map((item) => item.id));
    const list = this.found().filter((item) => !known.has(item.id));
    const pick = this.chosen();
    return pick && !known.has(pick.id) && !list.some((item) => item.id === pick.id)
      ? [pick, ...list]
      : list;
  });

  protected readonly searchHelp = computed(() => {
    switch (this.state()) {
      case 'searching':
        return $localize`Searching…`;
      case 'none':
        return $localize`Nothing in your library is called that.`;
      case 'failed':
        return $localize`The library could not be searched. Try again.`;
      default:
        return $localize`Type two letters or more of its name.`;
    }
  });

  constructor() {
    this.scope.onReset(() => {
      this.found.set([]);
      this.state.set('idle');
    });
    effect((onCleanup) => {
      const text = this.query().trim();
      if (text.length < 2) {
        this.found.set([]);
        this.state.set('idle');
        return;
      }
      const timer = setTimeout(() => void this.search(text), 300);
      onCleanup(() => clearTimeout(timer));
    });
  }

  private async search(text: string): Promise<void> {
    return this.scope.run('search', async (owner) => {
      this.state.set('searching');
      try {
        const result = await owner.wait(firstValueFrom(this.api.searchExercises({ query: text })));
        if (text !== this.query().trim()) return;
        const items = result.items
          .filter((item) => !item.isArchived)
          .slice(0, MATCHES)
          .map((item) => ({ id: item.id, name: item.name }));
        this.found.set(items);
        this.state.set(items.length === 0 ? 'none' : 'idle');
      } catch {
        if (owner.current) this.state.set('failed');
      }
    });
  }
}
