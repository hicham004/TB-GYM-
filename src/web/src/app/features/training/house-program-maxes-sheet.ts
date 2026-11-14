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
import { SheetForm } from '../../core/forms/sheet-form';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { HouseProgramsApi } from './house-programs-api';
import {
  maxHelp,
  maxProblem,
  maxRefusal,
  type HouseProgram,
  type HouseProgramMax,
} from './house-programs.models';
import { unitLabel } from './training-program.models';

/** What the sheet may send for one lift: a number typed, or nothing (the box left empty). */
type Typed = Readonly<Record<string, number | null>>;

/**
 * The trainee types their own training max for a program of TB Gym's (notes plan N9c4, N9c3's
 * `POST /api/strength/me/maxes`): one box per lift the program reads, in the program's unit, never a kg/lb
 * switch and never a conversion. Only the lifts whose number changed are sent, one after the other, and a
 * max is only ever added (append-only, no key), so nothing is retried by itself. The server checks every
 * number again and decides whether typing is open (a Pro+ pass); the page reads its programs again after.
 */
@Component({
  selector: 'app-house-program-maxes',
  imports: [Control, EntryActions, Field, FormSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [id]="formId" class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="muted" i18n>
        Your training max: the weight the program’s percentages read. In {{ unit() }} for this
        program.
      </p>
      <fieldset class="maxes">
        <legend class="tb-visually-hidden" i18n>
          Maxes for <bdi dir="auto">{{ program().name }}</bdi>
        </legend>
        @for (row of rows(); track row.max.exerciseId) {
          <app-field
            [label]="row.max.exerciseName"
            [help]="row.help"
            [errors]="row.errors.length > 0 ? row.errors : null"
            [attr.data-max]="row.max.exerciseId"
          >
            <div class="value-unit">
              <input
                appControl
                type="number"
                inputmode="decimal"
                step="any"
                min="0"
                autocomplete="off"
                [attr.name]="'max-' + row.max.exerciseId"
                [value]="row.value ?? ''"
                (input)="type(row.max.exerciseId, $any($event.target).valueAsNumber)"
                (blur)="attempt.touch(row.key)"
              />
              <span class="unit">{{ unit() }}</span>
            </div>
          </app-field>
        }
      </fieldset>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problems() > 0) {
          <ng-container i18n>Check the max marked above.</ng-container>
        }
      </app-form-summary>
      <app-entry-actions
        [form]="formId"
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
      .maxes {
        border: 0;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin: 0;
        min-inline-size: 0;
        padding: 0;
      }

      // Assign program's fixed-unit box (R2): the number, then the unit it is in, never a switch.
      .value-unit {
        align-items: center;
        grid-template-columns: minmax(0, 1fr) 2rem;
      }

      @media (max-width: 26rem) {
        .value-unit {
          grid-template-columns: minmax(0, 1fr) 2rem;
        }
      }

      .unit {
        color: var(--tb-muted);
        font-weight: 600;
      }
    `,
  ],
})
export class HouseProgramMaxes extends SheetForm {
  private readonly api = inject(HouseProgramsApi);
  private readonly locale = inject(LOCALE_ID);

  readonly program = input.required<HouseProgram>();
  /** The house's day, never the browser's: where a max came from is said against it. */
  readonly today = input.required<string>();
  /** True once every changed lift was saved; null when the sheet closed without saving. */
  readonly closed = output<true | null>();
  /** A lift was saved: the page's programs are out of date whatever happens next. */
  readonly savedSome = output<void>();
  /** The server said the page is out of date (no pass any more, Training closed, not the house's lift). */
  readonly stale = output<void>();
  /** A save is on its way: the sheet stays open until it answers. */
  readonly busyChange = output<boolean>();

  protected readonly saveLabel = $localize`Save maxes`;
  protected readonly savingLabel = $localize`Saving…`;

  protected readonly unit = computed(() => unitLabel(this.program().loadUnit));
  /** The maxes on record when the sheet opened: what the boxes start from. */
  private readonly onRecord = computed<Typed>(() =>
    Object.fromEntries(this.program().maxes.map((max) => [max.exerciseId, max.value])),
  );
  /** What the server holds for each lift, moved on as each one is saved. */
  private readonly saved = linkedSignal<Typed>(() => this.onRecord());
  private readonly typed = linkedSignal<Typed>(() => this.onRecord());
  /** The server's words for a lift it would not take, until that box is typed in again. */
  private readonly serverErrors = signal<Readonly<Record<string, string>>>({});

  protected readonly rows = computed(() =>
    this.program().maxes.map((max) => {
      const key = `max:${max.exerciseId}`;
      const value = this.typed()[max.exerciseId] ?? null;
      const problem = value === null ? null : maxProblem(value, this.program().loadUnit);
      const server = this.serverErrors()[max.exerciseId];
      const messages = problem ? [problem] : [];
      return {
        max,
        key,
        value,
        help: this.helpOf(max),
        problem,
        errors: server ? [server] : this.shows(key, messages) ? messages : [],
      };
    }),
  );
  protected readonly problems = computed(
    () => this.rows().filter((row) => row.problem !== null).length,
  );
  /** The lifts to send, in the program's order: a number typed that differs from the one on record. */
  private readonly changes = computed(() =>
    this.rows()
      .filter(
        (row) => row.value !== null && row.value !== (this.saved()[row.max.exerciseId] ?? null),
      )
      .map((row) => ({ exerciseId: row.max.exerciseId, value: row.value as number })),
  );

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(this.changes().length > 0));
    effect(() => this.busyChange.emit(this.busy()));
  }

  protected type(exerciseId: string, value: number): void {
    this.typed.update((typed) => ({ ...typed, [exerciseId]: Number.isNaN(value) ? null : value }));
    // The server's words were about what was there before: typing again forgets them.
    if (this.serverErrors()[exerciseId]) {
      const rest = { ...this.serverErrors() };
      delete rest[exerciseId];
      this.serverErrors.set(rest);
    }
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const changes = this.changes();
    if (changes.length === 0) {
      this.closed.emit(null);
      return;
    }
    const unit = this.program().loadUnit;
    let sending: string | null = null;
    const ok = await this.send(
      async (owner) => {
        for (const change of changes) {
          sending = change.exerciseId;
          await owner.wait(
            firstValueFrom(
              this.api.recordMax({ exerciseId: change.exerciseId, value: change.value, unit }),
            ),
          );
          // Saved: a second Save after a later lift's refusal never adds this one again.
          this.saved.update((saved) => ({ ...saved, [change.exerciseId]: change.value }));
          this.savedSome.emit();
        }
      },
      (error) => {
        const refused = maxRefusal(error);
        if (refused.stale) this.stale.emit();
        if (refused.field !== null && sending !== null) {
          this.serverErrors.update((errors) => ({
            ...errors,
            [sending as string]: refused.field!,
          }));
          return $localize`Check the max marked above.`;
        }
        return refused.message;
      },
    );
    if (ok) this.closed.emit(true);
  }

  private helpOf(max: HouseProgramMax): string {
    return maxHelp(max, this.today(), this.locale);
  }
}
