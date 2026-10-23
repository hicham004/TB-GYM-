import { formatNumber } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SheetForm } from '../../core/forms/sheet-form';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { LIBRARY_SEARCH_PAUSE, PagedSearch, type SearchPage } from '../../ui/paged-search';
import { type SegmentOption, SegmentedControl } from '../../ui/segmented-control';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { numeric } from '../training/training-builder.models';
import {
  type Conversion,
  type ConversionField,
  type ConversionForm,
  conversionErrors,
  conversionFromView,
  conversionPreview,
  conversionRefusal,
  conversionRequest,
  conversionWords,
  emptyConversionForm,
  formTyped,
} from './cooking-conversion.models';
import { RecipeApi } from './recipe-api';
import { kcal, type RecipeFood } from './recipe.models';

/** How many conversions a page of the list holds. */
const PAGE = 20;

let nextSheet = 0;

/**
 * Weigh a raw food cooked (NUT-001, audit INV-6): the coach chooses one of the workspace's raw-to-cooked
 * conversions, or adds one with numbers from a source they name, and the recipe line is then weighed
 * cooked through it. The list is searched and paged on the server; a conversion is never changed once
 * saved, so other numbers are a new one under another name or source, as the sheet says.
 */
@Component({
  selector: 'app-cooking-conversion-sheet',
  imports: [Button, Control, EntryActions, Field, FormSummary, SegmentedControl, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="about">
        <strong dir="auto">{{ food().name }}</strong
        >&ngsp;<span class="muted">{{ measure() }}</span>
      </p>
      <p class="muted" i18n>
        Say what 100 g of it raw weighs once cooked, and the recipe counts it from its cooked
        weight. TB Gym has no numbers of its own for this.
      </p>

      @if (state() === 'loading') {
        <app-skeleton [label]="loadingLabel" [lines]="3" />
      } @else {
        @if (state() === 'failed' || hasAny()) {
          <app-segmented-control
            [label]="modeLabel"
            [options]="modeOptions"
            [selected]="mode()"
            (selectedChange)="setMode($event)"
          />
        }
        @if (mode() === 'choose') {
          @if (state() === 'failed') {
            <div class="load-failed">
              <p role="alert" i18n>Your conversions couldn’t be loaded.</p>
              <button appButton type="button" variant="outlined" (click)="load()" i18n>
                Try again
              </button>
            </div>
          } @else {
            <app-field [label]="searchLabel" [help]="searchHelp()">
              <input
                appControl
                type="search"
                name="conversion-search"
                autocomplete="off"
                [value]="list.filter()"
                (input)="list.type($any($event.target).value)"
                (keydown.enter)="$event.preventDefault(); list.choose($any($event.target).value)"
              />
            </app-field>
            @if (list.failed()) {
              <div class="load-failed">
                <p role="alert" i18n>Your conversions couldn’t be searched.</p>
                <button appButton type="button" variant="outlined" (click)="list.retry()" i18n>
                  Try again
                </button>
              </div>
            } @else if (shown().length > 0) {
              <div class="choices" role="radiogroup" [attr.aria-label]="listLabel">
                @for (item of shown(); track item.yieldId) {
                  <label class="choice" [class.chosen]="chosen()?.yieldId === item.yieldId">
                    <input
                      type="radio"
                      [name]="group"
                      [value]="item.yieldId"
                      [checked]="chosen()?.yieldId === item.yieldId"
                      (change)="choose(item)"
                    />
                    <span class="choice-text">
                      <span class="choice-name" dir="auto">{{ item.name }}</span>
                      <!-- The source is the coach's own words, isolated so an Arabic one keeps the
                           line's order. -->
                      <span class="choice-hint" dir="auto"
                        >{{ hint(item) }} · <bdi>{{ item.source }}</bdi></span
                      >
                    </span>
                  </label>
                }
              </div>
            }
            @if (list.hasMore()) {
              <button
                appButton
                type="button"
                variant="text"
                class="more"
                [loading]="list.loadingMore()"
                (click)="more()"
                i18n
              >
                Show more
              </button>
            }
          }
        } @else {
          <app-field [label]="nameLabel" [help]="nameHelp" [errors]="errorsFor('name')">
            <input
              appControl
              name="conversion-name"
              autocomplete="off"
              dir="auto"
              [value]="form().name"
              (input)="setForm({ name: $any($event.target).value })"
              (blur)="attempt.touch('name')"
            />
          </app-field>
          <div class="pair">
            <app-field [label]="cookedLabel" [errors]="errorsFor('cooked')">
              <div class="value-unit">
                <input
                  appControl
                  name="cooked-grams"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.1"
                  [value]="form().cooked ?? ''"
                  (input)="setForm({ cooked: number($any($event.target).valueAsNumber) })"
                  (blur)="attempt.touch('cooked')"
                />
                <span class="unit" i18n>g</span>
              </div>
            </app-field>
            <app-field [label]="keptLabel" [help]="keptHelp" [errors]="errorsFor('kept')">
              <div class="value-unit">
                <input
                  appControl
                  name="kept-percent"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  [value]="form().kept ?? ''"
                  (input)="setForm({ kept: number($any($event.target).valueAsNumber) })"
                  (blur)="attempt.touch('kept')"
                />
                <span class="unit">%</span>
              </div>
            </app-field>
          </div>
          <app-field [label]="sourceLabel" [help]="sourceHelp" [errors]="errorsFor('source')">
            <input
              appControl
              name="conversion-source"
              autocomplete="off"
              dir="auto"
              [value]="form().source"
              (input)="setForm({ source: $any($event.target).value })"
              (blur)="attempt.touch('source')"
            />
          </app-field>
          <!-- In the page from the start, so its first sentence is announced like the ones after it. -->
          <p class="muted preview" aria-live="polite">{{ preview() }}</p>
          <p class="muted" i18n>
            A conversion can’t be changed once saved. For other numbers, save a new one under
            another name or source.
          </p>
        }
      }

      <!-- The server's words first, else the sheet's own pointer (ARCHITECTURE §8). -->
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (mode() === 'choose' && unchosen()) {
          <ng-container i18n>Choose a conversion, or add one.</ng-container>
        } @else if (mode() === 'add' && attempt.wasTried() && problemCount() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
      <app-entry-actions
        [saveLabel]="mode() === 'add' ? saveLabel : useLabel"
        [busyLabel]="savingLabel"
        [busy]="busy()"
        (notNow)="closed.emit(null)"
      />
    </form>
  `,
  styles: [
    SHEET_STYLES,
    `
      .pair {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      }

      .value-unit {
        align-items: center;
        display: grid;
        gap: 0.5rem;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .unit {
        color: var(--tb-muted);
        font-weight: 600;
      }

      // Empty, the preview is still a live region, but takes no room in the form's gap.
      .preview:empty {
        block-size: 1px;
        clip-path: inset(50%);
        inline-size: 1px;
        overflow: hidden;
        position: absolute;
        white-space: nowrap;
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

      .choice-text {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-inline-size: 0;
      }

      // A label's direct span is bold in the legacy global styles; these are not.
      .choice-name {
        color: var(--tb-ink);
        font-weight: 600;
        overflow-wrap: anywhere;
      }

      .choice-hint {
        color: var(--tb-muted);
        font-size: 0.8125rem;
        font-weight: 400;
        overflow-wrap: anywhere;
      }

      .more {
        align-self: flex-start;
      }

      .load-failed {
        align-items: flex-start;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      input {
        scroll-margin-block-end: 5rem;
      }
    `,
  ],
})
export class CookingConversionSheet extends SheetForm {
  private readonly api = inject(RecipeApi);
  private readonly toast = inject(UiToast);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly rendering = inject(Injector);

  /** The raw food weighed cooked, as the editor's line holds it. */
  readonly food = input.required<RecipeFood>();
  /** The conversion the line is weighed through already, when this is a change of it. */
  readonly current = input<Conversion | null>(null);
  readonly locale = input<string>('en');
  /** The conversion to weigh the line through, or null when the sheet was closed without one. */
  readonly closed = output<Conversion | null>();

  protected readonly group = `tb-conversion-${++nextSheet}`;
  protected readonly loadingLabel = $localize`Loading your conversions…`;
  protected readonly modeLabel = $localize`Raw to cooked`;
  protected readonly modeOptions: readonly SegmentOption[] = [
    { value: 'choose', label: $localize`Choose one` },
    { value: 'add', label: $localize`Add one` },
  ];
  protected readonly searchLabel = $localize`Find a conversion`;
  protected readonly listLabel = $localize`Your conversions`;
  protected readonly nameLabel = $localize`What it is`;
  protected readonly nameHelp = $localize`The food and how it’s cooked, like White rice, boiled.`;
  protected readonly cookedLabel = $localize`Cooked weight of 100 g raw`;
  protected readonly keptLabel = $localize`Protein, carbs and fat kept`;
  protected readonly keptHelp = $localize`100% unless your source says some is lost, as fat dripping from meat.`;
  protected readonly sourceLabel = $localize`Where the numbers come from`;
  protected readonly sourceHelp = $localize`Like USDA cooking yields, or Weighed in my kitchen.`;
  protected readonly useLabel = $localize`Use it`;
  protected readonly saveLabel = $localize`Save and use it`;
  protected readonly savingLabel = $localize`Saving…`;

  protected readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  private readonly firstPage = signal<SearchPage<Conversion> | null>(null);
  protected readonly list = new PagedSearch<Conversion, string>(
    {
      first: () => this.firstPage(),
      isPlain: (query) => query.trim() === '',
      fetch: (query, skip) => this.page(query, skip),
      key: (item) => item.yieldId,
      // The server reads words, so spaces between them are one search however many there are.
      filterKey: (query) => query.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
      pauseMs: inject(LIBRARY_SEARCH_PAUSE),
    },
    '',
  );
  /** Whether the workspace holds any conversion to choose; with none the sheet adds one. */
  protected readonly hasAny = computed(() => (this.firstPage()?.total ?? 0) > 0);
  protected readonly mode = signal<'choose' | 'add'>('choose');
  protected readonly chosen = linkedSignal<Conversion | null>(() => this.current());
  /** Use it was pressed with no conversion chosen: the sheet's own pointer, until one is. */
  protected readonly unchosen = signal(false);
  /** The list, with the conversion the line uses kept on it while nothing is searched. */
  protected readonly shown = computed(() => {
    const items = this.list.items();
    const current = this.current();
    return current &&
      !this.list.answered() &&
      !items.some((item) => item.yieldId === current.yieldId)
      ? [current, ...items]
      : items;
  });
  protected readonly searchHelp = computed(() => {
    if (this.list.searching()) return $localize`Searching…`;
    if (this.list.answered() && !this.list.failed() && this.list.items().length === 0) {
      return $localize`No conversion is called that. Add one instead.`;
    }
    return $localize`Search by what it is or where its numbers come from.`;
  });

  protected readonly form = signal<ConversionForm>(emptyConversionForm());
  /** What the server said of a box, until that box changes. */
  private readonly serverErrors = signal<Partial<Record<ConversionField, string[]>>>({});
  protected readonly errors = computed(() => conversionErrors(this.form()));
  protected readonly problemCount = computed(
    () => Object.values(this.errors()).filter((messages) => messages.length > 0).length,
  );
  protected readonly preview = computed(() => conversionPreview(this.form(), this.locale()));
  protected readonly measure = computed(() => {
    const food = this.food();
    const per100 = food.basisQuantity > 0 ? (food.calories * 100) / food.basisQuantity : 0;
    return $localize`${kcal(per100, this.locale())}:calories: per ${formatNumber(100, this.locale(), '1.0-0')}:quantity: g raw`;
  });

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(formTyped(this.form())));
    // A search still on its way or waiting for the typing to pause goes nowhere once the sheet closes.
    inject(DestroyRef).onDestroy(() => this.list.stop());
    void this.load();
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        const page = await owner.wait(this.page('', 0));
        this.firstPage.set(page);
        // With nothing to choose, the sheet opens on adding the first one.
        if (page.total === 0) this.mode.set('add');
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        this.state.set('failed');
      }
    });
  }

  private async page(query: string, skip: number): Promise<SearchPage<Conversion>> {
    const page = await firstValueFrom(this.api.listConversions(query.trim(), skip, PAGE));
    return { items: page.items.map(conversionFromView), total: numeric(page.total) };
  }

  protected hint(conversion: Conversion): string {
    return conversionWords(conversion, this.locale());
  }

  protected setMode(value: string): void {
    this.mode.set(value === 'add' ? 'add' : 'choose');
    this.unchosen.set(false);
    this.error.set(null);
  }

  protected choose(conversion: Conversion): void {
    this.chosen.set(conversion);
    this.unchosen.set(false);
    this.error.set(null);
  }

  /**
   * Show more stays where it is while there is more; once the last page is in, its button goes, and focus
   * moves to the first conversion it brought rather than falling out of the sheet. A page that could not
   * be read is said in a toast, as the builders' libraries say it, never as the server refusing the sheet.
   */
  protected async more(): Promise<void> {
    const before = this.shown().length;
    if (!(await this.list.more())) {
      this.toast.show($localize`More conversions couldn’t be loaded. Try again.`, {
        tone: 'error',
      });
      return;
    }
    if (this.list.hasMore() || this.shown().length === before) return;
    afterNextRender(
      () =>
        this.element.nativeElement.querySelectorAll<HTMLElement>('.choice input')[before]?.focus(),
      { injector: this.rendering },
    );
  }

  protected number(value: number): number | null {
    return Number.isFinite(value) ? value : null;
  }

  protected setForm(change: Partial<ConversionForm>): void {
    this.form.update((form) => ({ ...form, ...change }));
    const changed = Object.keys(change) as ConversionField[];
    this.serverErrors.update((errors) => {
      const left = { ...errors };
      for (const field of changed) delete left[field];
      return left;
    });
  }

  protected errorsFor(field: ConversionField): readonly string[] | null {
    const local = this.errors()[field];
    if (this.shows(field, local)) return local;
    return this.serverErrors()[field] ?? null;
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.mode() === 'choose') {
      const chosen = this.chosen();
      if (chosen) {
        this.closed.emit(chosen);
        return;
      }
      this.unchosen.set(true);
      this.focusSummary();
      return;
    }
    if (this.problemCount() > 0) {
      this.refuse();
      return;
    }
    let made = null as Conversion | null;
    const ok = await this.send(
      async (owner) => {
        try {
          const view = await owner.wait(
            firstValueFrom(this.api.createConversion(conversionRequest(this.form()))),
          );
          made = conversionFromView(view);
        } catch (error) {
          this.serverErrors.set(conversionRefusal(error).fields);
          throw error;
        }
      },
      (error) => conversionRefusal(error).message,
    );
    if (ok && made) this.closed.emit(made);
  }
}
