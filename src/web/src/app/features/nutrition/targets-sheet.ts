import { formatNumber } from '@angular/common';
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
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  FormulaSex,
  OccupationActivityType,
  PreviewEnergyRequest,
} from '../../core/api/generated';
import { SheetForm } from '../../core/forms/sheet-form';
import { Button } from '../../ui/button';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { ClientNutritionApi } from './client-nutrition-api';
import {
  calculationRefusal,
  calculationRequest,
  chosenPalOf,
  ENERGY_VERSION_ONE,
  FAT_PICKS,
  FORMULAS,
  GOAL_PICKS,
  isVersionTwo,
  macroShares,
  mapWorkedOut,
  numberOrNull,
  palWords,
  perKilogram,
  problemCount,
  PROTEIN_PER_KG,
  proteinFor,
  signedKcal,
  startingTargets,
  targetErrors,
  type EnergyModel,
  type FormulaKey,
  type PalMode,
  type Starting,
  type WorkedOut,
} from './client-nutrition.models';
import {
  mapPreview,
  pickSentence,
  previewRequest,
  type EnergyPreview,
} from './energy-preview.models';
import { dayWords } from '../progress/progress-entries.models';
import { TargetsResult } from './targets-result';

const SEXES: readonly SegmentOption[] = [
  { value: 'Female' satisfies FormulaSex, label: $localize`Female` },
  { value: 'Male' satisfies FormulaSex, label: $localize`Male` },
];

/** How long typing pauses before the server is asked for the sheet's numbers so far. */
const PREVIEW_PAUSE_MS = 300;

/**
 * Work out a client's calories and macros, in a sheet (R5.3d). It starts from what the record already
 * knows (age from the birth date, height and steps from the intake, weight from the latest weigh-in)
 * and says where each came from; sex and the kind of work are chosen, never assumed. Every press records
 * a calculation on the server and shows it in the same sheet, ready to assign a meal plan with.
 *
 * It asks what the energy model in force takes (critique B8b): under version 2 four kinds of work and the
 * workouts a week (filled in from their program), the server's words for the multiplier as the coach
 * types, each goal pick's rate and share, and the coach's own multiplier; under version 1 what it always
 * asked. No number is worked out in the browser.
 */
@Component({
  selector: 'app-work-out-targets',
  imports: [
    Button,
    Control,
    EntryActions,
    Field,
    FormSummary,
    SegmentedControl,
    TargetsResult,
    UiDisclosure,
    UiDisclosureContent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './targets-sheet.html',
  styles: [SHEET_STYLES],
  styleUrls: ['./targets-sheet.scss', './targets-activity.scss'],
})
export class WorkOutTargets extends SheetForm {
  private readonly api = inject(ClientNutritionApi);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** What the record already knows, with where each number came from. */
  readonly starting = input.required<Starting>();
  /** The targets worked out before, whose choices carry over; null for the first. */
  readonly last = input<WorkedOut | null>(null);
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<string>();
  readonly locale = input<string>('en');
  /** What the energy model new calculations use takes, as the server said. */
  readonly model = input<EnergyModel>(ENERGY_VERSION_ONE);
  /** The calculation that was recorded, or null when the sheet was closed without one. */
  readonly closed = output<WorkedOut | null>();
  /** The result is on screen and the coach wants to assign a meal plan with it. */
  readonly assign = output<WorkedOut>();
  /** A calculation was recorded, so the page reads its list again. */
  readonly recorded = output<WorkedOut>();

  protected readonly weightLabel = $localize`Weight (kg)`;
  protected readonly heightLabel = $localize`Height (cm)`;
  protected readonly ageLabel = $localize`Age (years)`;
  protected readonly sexLabel = $localize`Sex used by the formula`;
  protected readonly workLabel = $localize`Kind of work`;
  protected readonly stepsLabel = $localize`Steps a day, on average`;
  protected readonly workoutsLabel = $localize`Workouts a week`;
  protected readonly palLabel = $localize`Multiplier`;
  protected readonly typedPalLabel = $localize`Their multiplier`;
  protected readonly palReasonLabel = $localize`Why this multiplier? (optional)`;
  protected readonly goalLabel = $localize`Calories a day, above or below what they burn`;
  protected readonly goalPicksLabel = $localize`Common goals`;
  protected readonly proteinPicksLabel = $localize`Protein for each kilogram of body weight`;
  protected readonly proteinLabel = $localize`Protein (grams a day)`;
  protected readonly fatPicksLabel = $localize`Share of calories from fat`;
  protected readonly fatLabel = $localize`Fat (percent of calories)`;
  protected readonly formulaLabel = $localize`Formula`;
  protected readonly bodyFatLabel = $localize`Body fat (percent)`;
  protected readonly saveLabel = $localize`Work out targets`;
  protected readonly workingLabel = $localize`Working it out…`;
  protected readonly sexes = SEXES;
  protected readonly goalPicks = GOAL_PICKS;
  /** "20 · 25 · 30 · 35", captioned "% of calories". */
  protected readonly fatOptions: readonly SegmentOption[] = FAT_PICKS.map((share) => ({
    value: String(share),
    label: String(share),
  }));
  protected readonly formulas = FORMULAS;
  protected readonly numberOrNull = numberOrNull;
  protected readonly signed = signedKcal;
  protected readonly pickSentence = pickSentence;

  protected readonly versionTwo = computed(() => isVersionTwo(this.model()));
  protected readonly kinds = computed(() => this.model().kinds);
  protected readonly picks = computed(() => this.model().chosen?.picks ?? []);

  private readonly start = computed(() =>
    startingTargets(this.starting(), this.last(), this.model()),
  );
  protected readonly weight = linkedSignal<number | null>(() => this.start().weight);
  protected readonly height = linkedSignal<number | null>(() => this.start().height);
  protected readonly age = linkedSignal<number | null>(() => this.start().age);
  protected readonly sex = linkedSignal<FormulaSex | null>(() => this.start().sex);
  protected readonly work = linkedSignal<OccupationActivityType | null>(() => this.start().work);
  protected readonly steps = linkedSignal<number | null>(() => this.start().steps);
  protected readonly workouts = linkedSignal<number | null>(() => this.start().workouts);
  protected readonly palMode = linkedSignal<PalMode>(() => this.start().palMode);
  /** The pick chosen, and the multiplier typed, each kept while the other is tried. */
  protected readonly pickedPal = linkedSignal<number | null>(() =>
    this.start().palMode === 'pick' ? this.start().chosenPal : null,
  );
  protected readonly typedPal = linkedSignal<number | null>(() =>
    this.start().palMode === 'typed' ? this.start().chosenPal : null,
  );
  protected readonly palReason = linkedSignal<string>(() => this.start().palReason);
  protected readonly goal = linkedSignal<number | null>(() => this.start().goal);
  protected readonly protein = linkedSignal<number | null>(() => this.start().protein);
  protected readonly fat = linkedSignal<number | null>(() => this.start().fat);
  protected readonly formula = linkedSignal<FormulaKey>(() => this.start().formula);
  protected readonly bodyFat = linkedSignal<number | null>(() => this.start().bodyFat);
  /**
   * Formula starts folded on the usual one and open on any other, and a refused body fat opens it. A
   * choice made inside never closes it, which would hide the radio a keyboard's arrows are on.
   */
  protected readonly formulaOpen = linkedSignal(() => this.start().formula !== 'MifflinStJeor');
  /** The coach's own multiplier opens on a multiplier chosen last time, and on a refused one. */
  protected readonly palOpen = linkedSignal(() => this.start().palMode !== 'table');

  protected readonly result = signal<WorkedOut | null>(null);

  protected readonly values = computed(() => {
    const palMode = this.palMode();
    return {
      weight: this.weight(),
      height: this.height(),
      age: this.age(),
      sex: this.sex(),
      work: this.work(),
      steps: this.steps(),
      workouts: this.workouts(),
      palMode,
      chosenPal:
        palMode === 'pick' ? this.pickedPal() : palMode === 'typed' ? this.typedPal() : null,
      palReason: this.palReason(),
      goal: this.goal(),
      protein: this.protein(),
      fat: this.fat(),
      formula: this.formula(),
      bodyFat: this.bodyFat(),
    };
  });
  protected readonly issues = computed(() => targetErrors(this.values(), this.model()));
  protected readonly problems = computed(() => problemCount(this.issues()));
  protected readonly formulaName = computed(
    () => FORMULAS.find((item) => item.value === this.formula())?.label ?? '',
  );

  protected readonly weightHelp = computed(() => {
    const given = this.starting().weight;
    if (!given || this.weight() !== given.value) return null;
    const day = dayWords(given.on, this.today(), this.locale());
    return $localize`From their weigh-in on ${day}:day:.`;
  });
  protected readonly heightHelp = computed(() =>
    this.starting().height !== null && this.height() === this.starting().height
      ? $localize`From their profile.`
      : null,
  );
  protected readonly ageHelp = computed(() =>
    this.starting().age !== null && this.age() === this.starting().age
      ? $localize`Counted from their birth date.`
      : null,
  );
  /** What the number means, and that it is never added on top (critique B8b, T47). */
  protected readonly stepsHelp = computed(() =>
    this.starting().steps !== null && this.steps() === this.starting().steps
      ? $localize`From their profile. Steps from a phone or watch on a normal day, work included. Walking is counted inside the multiplier, never added on top.`
      : $localize`From their phone or watch on a normal day, work included. Walking is counted inside the multiplier, never added on top.`,
  );
  protected readonly workoutsHelp = computed(() => {
    const workouts = this.workouts();
    const fromProgram = this.starting().workouts ?? null;
    if (fromProgram !== null && workouts === fromProgram) {
      return $localize`From their program’s current week.`;
    }
    const lastTime = this.last()?.inputs?.workouts ?? null;
    if (fromProgram === null && lastTime !== null && workouts === lastTime) {
      return $localize`From their last targets.`;
    }
    return $localize`How many times a week they train, from 0 to ${this.model().maxWorkouts ?? 7}:max:.`;
  });
  protected readonly typedHint = computed(() => {
    const chosen = this.model().chosen;
    if (!chosen) return '';
    const low = formatNumber(chosen.min, this.locale(), '1.2-2');
    const high = formatNumber(chosen.max, this.locale(), '1.2-2');
    return $localize`Type one from ${low}:low: to ${high}:high:.`;
  });
  protected readonly palReasonHelp = computed(
    () =>
      $localize`Kept with these targets, where you and your team see it. ${this.firstName()}:name: sees only the numbers.`,
  );
  protected readonly proteinPicksOff = computed(
    () => this.weight() === null || this.issues().weight.length > 0,
  );
  /** "1.6 · 1.8 · 2.0 · 2.2", captioned "g per kg"; they need the weight above. */
  protected readonly proteinOptions = computed<readonly SegmentOption[]>(() =>
    PROTEIN_PER_KG.map((perKg) => ({
      value: String(perKg),
      label: formatNumber(perKg, this.locale(), '1.1-1'),
      disabled: this.proteinPicksOff(),
    })),
  );
  protected readonly proteinPick = computed(() => {
    const weight = this.weight();
    const grams = this.protein();
    if (weight === null || grams === null || this.proteinPicksOff()) return null;
    return PROTEIN_PER_KG.find((perKg) => proteinFor(weight, perKg) === grams) ?? null;
  });
  protected readonly proteinPickValue = computed(() => {
    const pick = this.proteinPick();
    return pick === null ? '' : String(pick);
  });
  protected readonly fatPickValue = computed(() => {
    const fat = this.fat();
    return fat !== null && FAT_PICKS.includes(fat) ? String(fat) : '';
  });
  /** The box says grams, the help the grams for each kilogram: the figure both ways. */
  protected readonly proteinHelp = computed(() => {
    const weight = this.weight();
    const grams = this.protein();
    if (this.proteinPicksOff()) {
      return $localize`Type the grams. With their weight above, you can pick grams for each kilogram.`;
    }
    const perKg = weight !== null && grams !== null ? perKilogram(grams, weight) : null;
    return perKg === null
      ? $localize`Type the grams, or pick grams for each kilogram below.`
      : $localize`That is ${perKg}:perKg: g for each kilogram of their weight.`;
  });
  /**
   * The targets last worked out, while every number here is still one they were worked out from:
   * their grams are the server's own answer (NUT-008), which the sheet never works out itself.
   */
  private readonly answered = computed(() => {
    const last = this.last();
    const given = last?.inputs;
    if (!last || !given || last.adjustment) return null;
    const now = this.values();
    const same =
      now.weight === given.weight &&
      now.height === given.height &&
      now.age === given.age &&
      now.sex === given.sex &&
      now.work === given.work &&
      now.steps === given.steps &&
      now.workouts === given.workouts &&
      chosenPalOf(now) === given.chosenPal &&
      now.goal === last.goalAdjustment &&
      now.protein === last.protein &&
      now.fat === given.fatPercent &&
      now.formula === given.formula &&
      (now.formula !== 'KatchMcArdle' || now.bodyFat === given.bodyFat);
    return same ? last : null;
  });
  protected readonly fatHelp = computed(() => {
    const answered = this.answered();
    return answered
      ? $localize`That is ${formatNumber(answered.fat, this.locale(), '1.0-0')}:grams: g of fat a day.`
      : $localize`A share of the day’s calories: the grams come with the calories, once worked out.`;
  });
  /** "Carbs: the rest": the figures once Work out has answered for these very numbers. */
  protected readonly carbsLine = computed(() => {
    const answered = this.answered();
    if (!answered) return $localize`Carbs: the rest of the calories, after protein and fat.`;
    const grams = formatNumber(answered.carbohydrate, this.locale(), '1.0-0');
    return $localize`Carbs: the rest, ${grams}:grams: g (${macroShares(answered).carbohydrate}:share:%).`;
  });

  /** What the preview is asked now, under energy version 2; nothing is asked under version 1. */
  private readonly previewAsk = computed<PreviewEnergyRequest | null>(() =>
    this.versionTwo() ? previewRequest(this.values(), this.issues()) : null,
  );
  private readonly previewKey = computed(() => {
    const ask = this.previewAsk();
    return ask ? JSON.stringify(ask) : null;
  });
  /** The server's last answer, kept until a newer one comes: its words name what it was worked out from. */
  private readonly answer = signal<(EnergyPreview & { readonly key: string }) | null>(null);
  protected readonly preview = computed(() => this.answer());
  protected readonly previewFailed = signal(false);
  /** What the line under How active they are waits for, or that the server is working it out. */
  protected readonly waitingWords = computed(() => {
    if (this.palMode() !== 'table' && this.issues().pal.length > 0) {
      return $localize`Their multiplier shows here once you choose or type it.`;
    }
    const ask = this.previewAsk();
    return ask?.occupationType && ask.averageDailySteps != null && ask.workoutsPerWeek != null
      ? $localize`Working out the multiplier…`
      : $localize`The multiplier shows here once their work, steps and workouts are in.`;
  });
  /** The goal's own sentence under the box, once the server has it. */
  protected readonly goalHelp = computed(() => {
    const goal = this.goal();
    const line = goal !== null ? this.preview()?.goals.get(goal) : undefined;
    return line
      ? $localize`${line.words}:rate:.`
      : $localize`Minus eats less than they burn, plus eats more. 0 holds their weight.`;
  });

  constructor() {
    super();
    effect(() => {
      const start = this.start();
      const now = this.values();
      const same =
        now.weight === start.weight &&
        now.height === start.height &&
        now.age === start.age &&
        now.sex === start.sex &&
        now.work === start.work &&
        now.steps === start.steps &&
        now.workouts === start.workouts &&
        now.palMode === start.palMode &&
        now.chosenPal === start.chosenPal &&
        now.palReason === start.palReason &&
        now.goal === start.goal &&
        now.protein === start.protein &&
        now.fat === start.fat &&
        now.formula === start.formula &&
        now.bodyFat === start.bodyFat;
      this.dirtyChange.emit(!same && this.result() === null);
    });
    // Asks the server once typing pauses; a newer question replaces an answer still on its way (one lane).
    effect((onCleanup) => {
      const ask = this.previewAsk();
      const key = this.previewKey();
      if (ask === null || key === null || untracked(() => this.answer()?.key) === key) return;
      const timer = setTimeout(() => void this.askPreview(ask, key), PREVIEW_PAUSE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  /** The words for a pick's multiplier: "× 1.725". */
  protected palWords(pal: number): string {
    return palWords(pal, this.locale());
  }

  /** A goal pick's rate and share, once the server has said them. */
  protected rateOf(kcal: number) {
    return this.preview()?.goals.get(kcal) ?? null;
  }

  protected choosePick(pal: number): void {
    this.pickedPal.set(pal);
    this.palMode.set('pick');
  }

  protected pickProtein(value: string): void {
    const weight = this.weight();
    const perKg = Number(value);
    if (weight !== null && PROTEIN_PER_KG.includes(perKg))
      this.protein.set(proteinFor(weight, perKg));
  }

  protected pickFat(value: string): void {
    const share = Number(value);
    if (FAT_PICKS.includes(share)) this.fat.set(share);
  }

  private askPreview(request: PreviewEnergyRequest, key: string): Promise<void> {
    return this.scope.run('preview', async (owner) => {
      try {
        // The preview is a POST like every other and checks the token (audit SEC-4).
        await owner.wait(this.csrf.refresh());
        const view = await owner.wait(firstValueFrom(this.api.energyPreview(request)));
        this.answer.set({ key, ...mapPreview(view, this.locale()) });
        this.previewFailed.set(false);
      } catch {
        if (!owner.current) return;
        // Nothing is said rather than an old answer; Work out still works the numbers out.
        this.answer.set(null);
        this.previewFailed.set(true);
      }
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      if (this.issues().bodyFat.length > 0) this.formulaOpen.set(true);
      if (this.issues().pal.length > 0 || this.issues().palReason.length > 0) {
        this.palOpen.set(true);
      }
      this.refuse();
      return;
    }
    const model = this.model();
    const request = calculationRequest(this.values(), model);
    let made = null as WorkedOut | null;
    const ok = await this.send(
      async (owner) => {
        const view = await owner.wait(firstValueFrom(this.api.calculate(this.clientId(), request)));
        made = mapWorkedOut({
          result: view,
          inputs: request,
          calculatedAtUtc: new Date().toISOString(),
        });
      },
      (error) =>
        calculationRefusal(
          apiErrorMessage(error, $localize`The targets could not be worked out. Try again.`),
        ),
    );
    if (ok && made) {
      this.result.set(made);
      this.recorded.emit(made);
    }
  }
}
