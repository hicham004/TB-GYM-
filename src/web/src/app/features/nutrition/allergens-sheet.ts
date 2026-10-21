import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type { AllergenCode } from '../../core/api/generated';
import { SheetForm } from '../../core/forms/sheet-form';
import { Checkbox } from '../../ui/checkbox';
import { Control } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { ClientNutritionApi } from './client-nutrition-api';
import { allergenList, inListOrder, sameAllergens } from './client-nutrition.models';
import { ALLERGEN_LABELS } from './nutrition.models';

/**
 * The allergens declared for a client, in a sheet (R5.3d). Saving replaces the whole list, so the sheet
 * opens with what is declared now, shows what the client wrote in their own words, and before it saves
 * it reads the list again: if someone else changed it meanwhile it says so and asks to check the
 * boxes again, rather than quietly replacing their change.
 */
@Component({
  selector: 'app-edit-allergens',
  imports: [Checkbox, Control, EntryActions, FormSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      @if (theirWords(); as words) {
        <blockquote class="theirs" data-theirs>
          <span class="muted" i18n>What {{ firstName() }} wrote about allergies</span>&ngsp;<span
            dir="auto"
            >{{ words }}</span
          >
        </blockquote>
      }
      <p class="muted" i18n>
        TB Gym warns you when a recipe lists an allergen ticked here. An allergen left unticked
        never proves a recipe is safe.
      </p>
      <fieldset class="boxes">
        <legend class="tb-visually-hidden" i18n>Allergens</legend>
        @for (item of allergens; track item.code) {
          <app-checkbox [label]="item.label">
            <input
              appControl
              type="checkbox"
              [name]="item.code"
              [checked]="selected().has(item.code)"
              (change)="toggle(item.code, $any($event.target).checked)"
            />
          </app-checkbox>
        }
      </fieldset>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        }
      </app-form-summary>
      <app-entry-actions
        [saveLabel]="saveLabel"
        [busyLabel]="savingLabel"
        [busy]="busy()"
        (notNow)="closed.emit(null)"
      />
    </form>
  `,
  styles: [
    SHEET_STYLES,
    `
      .theirs {
        background: var(--tb-surface-2);
        border-inline-start: 3px solid var(--tb-accent-ink);
        border-radius: var(--tb-radius-control);
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        margin: 0;
        padding: 0.625rem 0.875rem;
        overflow-wrap: anywhere;
      }

      .boxes {
        border: 0;
        display: grid;
        gap: 0 1rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 0;
        min-inline-size: 0;
        padding: 0;
      }

      @media (max-width: 26rem) {
        .boxes {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      .sr-only {
        block-size: 1px;
        clip-path: inset(50%);
        inline-size: 1px;
        overflow: hidden;
        position: absolute;
        white-space: nowrap;
      }
    `,
  ],
})
export class EditAllergens extends SheetForm {
  private readonly api = inject(ClientNutritionApi);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** What was declared when the sheet opened. */
  readonly declared = input.required<readonly AllergenCode[]>();
  /** What the client wrote about allergies in their intake, if anything. */
  readonly theirWords = input<string | null>(null);
  /** The list that was saved, or null when the sheet was closed without saving one. */
  readonly closed = output<AllergenCode[] | null>();

  protected readonly allergens = ALLERGEN_LABELS;
  protected readonly saveLabel = $localize`Save allergens`;
  protected readonly savingLabel = $localize`Saving…`;

  /** What the list was when last read: the sheet's start, and then whatever a re-read found. */
  private readonly baseline = linkedSignal<readonly AllergenCode[]>(() => this.declared());
  protected readonly selected = linkedSignal<ReadonlySet<AllergenCode>>(
    () => new Set(this.declared()),
  );
  private readonly changed = computed(() => !sameAllergens([...this.selected()], this.baseline()));

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(this.changed()));
  }

  protected toggle(code: AllergenCode, checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (!this.changed()) {
      this.closed.emit(null);
      return;
    }
    const wanted = inListOrder([...this.selected()]);
    let outcome = 'saved' as 'saved' | 'changed';
    const ok = await this.send(
      async (owner) => {
        // A save replaces the whole list, so look at it once more first.
        const now = await owner.wait(firstValueFrom(this.api.allergens(this.clientId())));
        if (!sameAllergens(now.codes, this.baseline())) {
          this.baseline.set(inListOrder(now.codes));
          outcome = 'changed';
          return;
        }
        await owner.wait(firstValueFrom(this.api.replaceAllergens(this.clientId(), wanted)));
      },
      (error) => apiErrorMessage(error, $localize`The allergens could not be saved. Try again.`),
    );
    if (!ok) return;
    if (outcome === 'changed') {
      const now = allergenList(this.baseline());
      this.error.set(
        now === ''
          ? $localize`The list was changed while you were editing, and no allergen is declared now. Check the boxes and save again.`
          : $localize`The list was changed while you were editing: ${now}:list: declared now. Check the boxes and save again.`,
      );
      this.focusSummary();
      return;
    }
    this.closed.emit(wanted);
  }
}
