import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ProgramTemplateSummary, TrainingLoadRoundingMode } from '../../core/api/generated';
import { SheetForm } from '../../core/forms/sheet-form';
import { Button } from '../../ui/button';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { ModalFooter } from '../../ui/modal-footer';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { UiSelect, type SelectOption } from '../../ui/select';
import { HouseListingsApi } from './house-listings-api';
import {
  LISTING_LIMITS,
  listingTerms,
  offerableTemplates,
  offerRefusal,
  offerRequest,
  roundingHint,
  termsErrors,
  weeksWords,
  type HouseListing,
  type ListingErrors,
  type ListingTerms,
} from './house-listings.models';
import { unitLabel } from './training-program.models';

/** A box's value from its stored term, kept as typed until that stored term itself changes. */
function kept<T>(stored: () => T) {
  return linkedSignal<T, T>({
    source: stored,
    computation: (value, previous) =>
      previous && Object.is(previous.source, value) ? previous.value : value,
  });
}

/**
 * Offering a published program to TB Gym's trainees, or changing its terms (TRN-034, notes plan N9c4): whom
 * it suits, its run and block, and how its loads round. A listing that exists, withdrawn too, sends its
 * version; a new one sends none. The server checks every term again and its words go under their field.
 */
@Component({
  selector: 'app-house-listing-sheet',
  imports: [
    Button,
    Control,
    Field,
    FormSummary,
    ModalFooter,
    SegmentedControl,
    UiDisclosure,
    UiDisclosureContent,
    UiSelect,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [id]="formId" class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <p class="copy-note" i18n>
        A trainee’s copy shows every week, even weeks not shared with clients. Trainees also read
        the program’s description.
      </p>

      @if (fixedTemplate(); as program) {
        <p class="program-line">
          <bdi dir="auto">{{ program.name }}</bdi>
          @if (programFacts(); as facts) {
            &ngsp;<span class="facts">{{ facts }}</span>
          }
        </p>
      } @else {
        <app-select
          [label]="programLabel"
          [placeholder]="programPlaceholder"
          [options]="programOptions()"
          [value]="chosen()"
          [errors]="shows('templateId') ? errors()['templateId'] : null"
          (valueChange)="choose($event)"
          (touched)="attempt.touch('templateId')"
        />
      }

      <app-field
        [label]="suitsLabel"
        [help]="suitsHelp"
        [errors]="shows('suits') ? errors()['suits'] : null"
      >
        <input
          appControl
          name="suits"
          type="text"
          autocomplete="off"
          dir="auto"
          [attr.maxlength]="limits.suits"
          [value]="prefill().suits"
          (input)="setSuits($any($event.target).value)"
          (blur)="attempt.touch('suits')"
        />
      </app-field>

      <app-field
        [label]="runLabel"
        [help]="runHelp"
        [errors]="shows('runName') ? errors()['runName'] : null"
      >
        <input
          appControl
          name="runName"
          type="text"
          autocomplete="off"
          dir="auto"
          [attr.maxlength]="limits.runName"
          [value]="prefill().runName"
          (input)="setRun($any($event.target).value)"
          (blur)="attempt.touch('runName')"
        />
      </app-field>

      <app-field
        [label]="blockLabel"
        [help]="blockHelp"
        [errors]="shows('runPosition') ? errors()['runPosition'] : null"
      >
        <input
          appControl
          name="runPosition"
          type="number"
          inputmode="numeric"
          min="1"
          [attr.max]="limits.maxRunPosition"
          step="1"
          [value]="prefill().runPosition ?? ''"
          (input)="setPlace($any($event.target).valueAsNumber)"
          (blur)="attempt.touch('runPosition')"
        />
      </app-field>

      <app-disclosure
        [label]="roundingLabel"
        [hint]="roundingSummary()"
        [open]="roundingOpen()"
        (openChange)="roundingOpen.set($event)"
      >
        <ng-template appDisclosureContent>
          <div class="rounding">
            <app-field
              [label]="incrementLabel"
              [help]="incrementHelp()"
              [errors]="shows('loadIncrement') ? errors()['loadIncrement'] : null"
            >
              <div class="value-unit">
                <input
                  appControl
                  name="loadIncrement"
                  type="number"
                  inputmode="decimal"
                  min="0.01"
                  [attr.max]="limits.maxIncrement"
                  step="0.25"
                  [value]="prefill().loadIncrement ?? ''"
                  (input)="setIncrement($any($event.target).valueAsNumber)"
                  (blur)="attempt.touch('loadIncrement')"
                />
                @if (unitWord(); as unit) {
                  <span class="unit">{{ unit }}</span>
                }
              </div>
            </app-field>
            <app-segmented-control
              [label]="directionLabel"
              [options]="roundingOptions"
              [selected]="rounding()"
              (selectedChange)="setRounding($any($event))"
            />
            @if (shows('loadRoundingMode')) {
              <p class="refused">{{ errors()['loadRoundingMode']?.[0] }}</p>
            }
          </div>
        </ng-template>
      </app-disclosure>

      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problemCount() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
    </form>
    <ng-template appModalFooter>
      <button appButton type="button" variant="text" [disabled]="busy()" (click)="notNow()" i18n>
        Not now
      </button>
      <button appButton type="submit" [attr.form]="formId" [loading]="busy()">
        @if (busy()) {
          @if (offering()) {
            <ng-container i18n>Offering…</ng-container>
          } @else {
            <ng-container i18n>Saving…</ng-container>
          }
        } @else if (offering()) {
          <ng-container i18n>Offer to trainees</ng-container>
        } @else {
          <ng-container i18n>Save</ng-container>
        }
      </button>
    </ng-template>
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

    .copy-note {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      padding: 0.75rem 0.875rem;
    }

    .program-line {
      display: flex;
      flex-wrap: wrap;
      font-weight: 600;
      gap: 0.25rem 0.75rem;
    }

    .facts {
      color: var(--tb-muted);
      font-weight: 400;
    }

    .rounding {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding-block-start: 0.5rem;
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

    .refused {
      color: var(--tb-danger);
      font-size: 0.875rem;
    }
  `,
})
export class HouseListingSheet extends SheetForm {
  private readonly api = inject(HouseListingsApi);

  /** The page's programs: the choice for a new offer, and the fixed one's name. */
  readonly templates = input.required<readonly ProgramTemplateSummary[]>();
  /** The house's listings as last read, so an existing one sends its version. */
  readonly listings = input.required<readonly HouseListing[]>();
  /** The program whose terms are changed or offered again; null to choose one. */
  readonly fixed = input<string | null>(null);
  /** The listing as saved, or null when the sheet was closed without saving. */
  readonly closed = output<HouseListing | null>();
  /** Whether the save is on its way, so the sheet is not closed under it and its answer is kept. */
  readonly busyChange = output<boolean>();
  /** The listing changed or went meanwhile: the section reads the list again. */
  readonly stale = output<void>();

  protected readonly limits = LISTING_LIMITS;
  protected readonly programLabel = $localize`Program`;
  protected readonly programPlaceholder = $localize`Choose a program…`;
  protected readonly suitsLabel = $localize`Whom it suits`;
  protected readonly suitsHelp = $localize`For example: Beginners who can train three days a week.`;
  protected readonly runLabel = $localize`Run (optional)`;
  protected readonly runHelp = $localize`Programs that follow each other share a run’s name.`;
  protected readonly blockLabel = $localize`Block number`;
  protected readonly blockHelp = $localize`Its place in the run: 1 for the first block. Empty for a program on its own.`;
  protected readonly roundingLabel = $localize`Rounding`;
  protected readonly incrementLabel = $localize`Round loads to`;
  protected readonly directionLabel = $localize`Round`;
  protected readonly roundingOptions: SegmentOption[] = [
    { value: 'Nearest', label: $localize`Nearest` },
    { value: 'Down', label: $localize`Down` },
    { value: 'Up', label: $localize`Up` },
  ];

  /** The program the terms are for: the fixed one, or the one chosen. */
  protected readonly chosen = linkedSignal(() => this.fixed() ?? '');
  protected readonly fixedTemplate = computed(() => {
    const fixed = this.fixed();
    if (!fixed) return null;
    return (
      this.templates().find((template) => template.id === fixed) ?? {
        id: fixed,
        name: this.listing()?.name ?? '',
      }
    );
  });
  /** Its listing, offered or withdrawn, as last read; null for a program never listed. */
  protected readonly listing = computed(
    () => this.listings().find((listing) => listing.templateId === this.chosen()) ?? null,
  );
  /** Offering it now (new, or withdrawn): the PUT offers it either way. */
  protected readonly offering = computed(() => !this.listing()?.isOffered);
  protected readonly programOptions = computed<SelectOption[]>(() => {
    const choices = offerableTemplates(this.templates(), this.listings());
    // The one chosen stays a choice when a read meanwhile finds it listed.
    const chosen = this.templates().find((template) => template.id === this.chosen());
    const all = chosen && !choices.includes(chosen) ? [chosen, ...choices] : choices;
    return all.map((template) => ({ value: template.id, label: template.name }));
  });
  protected readonly programFacts = computed(() => {
    const listing = this.listing();
    if (!listing || listing.weeks === null) return null;
    const weeks = weeksWords(listing.weeks);
    return listing.loadUnit ? `${weeks} · ${unitLabel(listing.loadUnit)}` : weeks;
  });
  protected readonly unitWord = computed(() => {
    const unit = this.listing()?.loadUnit;
    return unit ? unitLabel(unit) : null;
  });
  protected readonly incrementHelp = computed(() =>
    this.unitWord()
      ? $localize`Every weight is rounded to a multiple of this.`
      : $localize`Every weight is rounded to a multiple of this, in the program’s own unit.`,
  );

  /** What the boxes start from: the listing's stored terms, or the defaults. */
  protected readonly prefill = computed(() => listingTerms(this.listing()));
  // Each keeps what was typed unless its stored term changed (a read after a conflict brings the new one).
  protected readonly suits = kept(() => this.prefill().suits);
  protected readonly runName = kept(() => this.prefill().runName);
  protected readonly runPosition = kept(() => this.prefill().runPosition);
  protected readonly increment = kept(() => this.prefill().loadIncrement);
  protected readonly rounding = kept<TrainingLoadRoundingMode>(
    () => this.prefill().loadRoundingMode,
  );
  protected readonly roundingOpen = signal(false);
  /** The server's word on a field, shown under it until that field is changed. */
  private readonly refused = signal<Record<string, string[]>>({});

  private readonly terms = computed<ListingTerms>(() => ({
    suits: this.suits(),
    runName: this.runName(),
    runPosition: this.runPosition(),
    loadIncrement: this.increment(),
    loadRoundingMode: this.rounding(),
  }));
  protected readonly errors = computed<ListingErrors>(() => {
    const errors: Record<string, readonly string[]> = {
      ...this.refused(),
      ...termsErrors(this.terms()),
    };
    if (!this.fixed() && this.chosen() === '') {
      errors['templateId'] = [$localize`Choose the program to offer.`];
    }
    return errors;
  });
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);
  protected readonly roundingSummary = computed(() =>
    roundingHint(this.increment(), this.rounding(), this.listing()?.loadUnit ?? null),
  );

  constructor() {
    super();
    effect(() => this.busyChange.emit(this.busy()));
    effect(() => {
      const stored = this.prefill();
      const terms = this.terms();
      this.dirtyChange.emit(
        (!this.fixed() && this.chosen() !== '') ||
          terms.suits !== stored.suits ||
          terms.runName !== stored.runName ||
          terms.runPosition !== stored.runPosition ||
          terms.loadIncrement !== stored.loadIncrement ||
          terms.loadRoundingMode !== stored.loadRoundingMode,
      );
    });
  }

  protected override shows(field: string): boolean {
    return super.shows(field, this.errors()[field] ?? []);
  }

  protected choose(templateId: string): void {
    this.chosen.set(templateId);
    this.forget('templateId');
  }

  protected setSuits(value: string): void {
    this.suits.set(value);
    this.forget('suits');
  }

  protected setRun(value: string): void {
    this.runName.set(value);
    this.forget('runName');
    // A place taken in one run is free in another.
    this.forget('runPosition');
  }

  protected setPlace(value: number): void {
    this.runPosition.set(Number.isFinite(value) ? value : null);
    this.forget('runPosition');
  }

  protected setIncrement(value: number): void {
    this.increment.set(Number.isFinite(value) ? value : null);
    this.forget('loadIncrement');
  }

  protected setRounding(mode: TrainingLoadRoundingMode): void {
    this.rounding.set(mode);
    this.forget('loadRoundingMode');
  }

  protected notNow(): void {
    if (!this.busy()) this.closed.emit(null);
  }

  private forget(field: string): void {
    if (!(field in this.refused())) return;
    this.refused.update((current) => {
      const rest = { ...current };
      delete rest[field];
      return rest;
    });
  }

  /** A box inside the folded rounding must be on screen to show its words and take focus. */
  private revealRounding(): void {
    const errors = this.errors();
    if (errors['loadIncrement'] || errors['loadRoundingMode']) this.roundingOpen.set(true);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.attempt.attempt();
    if (this.problemCount() > 0) {
      this.revealRounding();
      this.refuse();
      return;
    }
    const templateId = this.chosen();
    const offering = this.offering();
    const request = offerRequest(this.terms(), this.listing()?.version ?? null);
    let saved: HouseListing | null = null;
    const sent = await this.send(
      async (owner) => {
        saved = await owner.wait(firstValueFrom(this.api.offer(templateId, request)));
      },
      (error) => {
        const refusal = offerRefusal(error, offering);
        if (refusal.stale) this.stale.emit();
        // A refused program goes under its select; with the program fixed there is none, so the summary says it.
        if (refusal.field && (refusal.field !== 'templateId' || !this.fixed())) {
          this.refused.set({ [refusal.field]: [refusal.message] });
          this.revealRounding();
          return '';
        }
        return refusal.message;
      },
    );
    if (sent && saved) this.closed.emit(saved);
  }
}
