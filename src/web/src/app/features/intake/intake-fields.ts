import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { type IsoDate } from '../../ui/calendar';
import { DateField } from '../../ui/date-field';
import { DateInput } from '../../ui/date-input';
import { Control, Field } from '../../ui/field';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import type { BodyweightUnit, LengthUnit } from '../../core/api/api.models';
import type { IntakeErrors, IntakeStepId, IntakeSubject, IntakeValues } from './intake.models';

/**
 * The boxes of one step or one group of answers (R5.3b), shared by the first-run steps, the edit sheets
 * and the coach's sheets so a question is worded, limited and labelled once. It holds no state of its own:
 * `values` is the page's, and `errors` holds only the messages that are due on screen now (the page
 * decides when, through `FormAttempt`), so the text, `aria-invalid` and `aria-describedby` agree.
 */
@Component({
  selector: 'app-intake-fields',
  imports: [Control, DateField, DateInput, Field, SegmentedControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (step()) {
      @case ('about') {
        <div class="pair">
          <app-field [label]="firstLabel" [errors]="errors()['firstName'] ?? null">
            <input
              appControl
              name="firstName"
              autocomplete="given-name"
              maxlength="100"
              dir="auto"
              [value]="values().firstName"
              (input)="set({ firstName: $any($event.target).value })"
              (blur)="touched.emit('firstName')"
            />
          </app-field>
          <app-field [label]="lastLabel" [errors]="errors()['lastName'] ?? null">
            <input
              appControl
              name="lastName"
              autocomplete="family-name"
              maxlength="100"
              dir="auto"
              [value]="values().lastName"
              (input)="set({ lastName: $any($event.target).value })"
              (blur)="touched.emit('lastName')"
            />
          </app-field>
        </div>
        <app-field
          [label]="phoneLabel"
          [help]="phoneHelp()"
          [errors]="errors()['phoneNumber'] ?? null"
        >
          <input
            appControl
            name="phoneNumber"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            maxlength="32"
            dir="ltr"
            [value]="values().phoneNumber"
            (input)="set({ phoneNumber: $any($event.target).value })"
            (blur)="touched.emit('phoneNumber')"
          />
        </app-field>
        <app-date-input
          [label]="birthLabel"
          [help]="birthHelp"
          [errors]="errors()['birthDate'] ?? null"
          autocompleteName="bday"
          [value]="values().birthDate"
          (valueChange)="set({ birthDate: $event })"
          (status)="set({ birthStatus: $event })"
          (touched)="touched.emit('birthDate')"
        />
        <app-field [label]="heightLabel" [errors]="errors()['heightValue'] ?? null">
          <div class="value-unit">
            <input
              appControl
              name="heightValue"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              [value]="values().heightValue ?? ''"
              (input)="set({ heightValue: numberOrNull($any($event.target).valueAsNumber) })"
              (blur)="touched.emit('heightValue')"
            />
            <app-segmented-control
              [label]="heightUnitLabel"
              [hideLabel]="true"
              [options]="heightUnits"
              [selected]="values().heightUnit"
              (selectedChange)="set({ heightUnit: $any($event) })"
            />
          </div>
        </app-field>
      }
      @case ('goal') {
        <app-field [label]="goalsLabel" [help]="goalsHelp" [errors]="errors()['goals'] ?? null">
          <textarea
            appControl
            name="goals"
            rows="4"
            maxlength="4000"
            dir="auto"
            [value]="values().goals"
            (input)="set({ goals: $any($event.target).value })"
            (blur)="touched.emit('goals')"
          ></textarea>
        </app-field>
        <app-field
          [label]="backgroundLabel"
          [help]="backgroundHelp"
          [errors]="errors()['trainingBackground'] ?? null"
        >
          <textarea
            appControl
            name="trainingBackground"
            rows="4"
            maxlength="4000"
            dir="auto"
            [value]="values().trainingBackground"
            (input)="set({ trainingBackground: $any($event.target).value })"
            (blur)="touched.emit('trainingBackground')"
          ></textarea>
        </app-field>
      }
      @case ('life') {
        <app-field [label]="workLabel" [help]="workHelp" [errors]="errors()['workType'] ?? null">
          <input
            appControl
            name="workType"
            maxlength="200"
            dir="auto"
            [value]="values().workType"
            (input)="set({ workType: $any($event.target).value })"
            (blur)="touched.emit('workType')"
          />
        </app-field>
        <app-field
          [label]="stepsLabel"
          [help]="stepsHelp"
          [errors]="errors()['averageDailySteps'] ?? null"
        >
          <input
            appControl
            name="averageDailySteps"
            type="number"
            inputmode="numeric"
            min="0"
            max="100000"
            step="1"
            [value]="values().averageDailySteps ?? ''"
            (input)="set({ averageDailySteps: numberOrNull($any($event.target).valueAsNumber) })"
            (blur)="touched.emit('averageDailySteps')"
          />
        </app-field>
        <app-field [label]="likesLabel" [errors]="errors()['foodPreferences'] ?? null">
          <textarea
            appControl
            name="foodPreferences"
            rows="3"
            maxlength="4000"
            dir="auto"
            [value]="values().foodPreferences"
            (input)="set({ foodPreferences: $any($event.target).value })"
            (blur)="touched.emit('foodPreferences')"
          ></textarea>
        </app-field>
        <app-field [label]="avoidLabel" [errors]="errors()['foodAversions'] ?? null">
          <textarea
            appControl
            name="foodAversions"
            rows="3"
            maxlength="4000"
            dir="auto"
            [value]="values().foodAversions"
            (input)="set({ foodAversions: $any($event.target).value })"
            (blur)="touched.emit('foodAversions')"
          ></textarea>
        </app-field>
      }
      @case ('health') {
        <app-field [label]="allergiesLabel" [errors]="errors()['allergies'] ?? null">
          <textarea
            appControl
            name="allergies"
            rows="3"
            maxlength="4000"
            dir="auto"
            [value]="values().allergies"
            (input)="set({ allergies: $any($event.target).value })"
            (blur)="touched.emit('allergies')"
          ></textarea>
        </app-field>
        <app-field [label]="medicationsLabel" [errors]="errors()['medications'] ?? null">
          <textarea
            appControl
            name="medications"
            rows="3"
            maxlength="4000"
            dir="auto"
            [value]="values().medications"
            (input)="set({ medications: $any($event.target).value })"
            (blur)="touched.emit('medications')"
          ></textarea>
        </app-field>
        <app-field [label]="injuriesLabel" [errors]="errors()['previousInjuries'] ?? null">
          <textarea
            appControl
            name="previousInjuries"
            rows="3"
            maxlength="4000"
            dir="auto"
            [value]="values().previousInjuries"
            (input)="set({ previousInjuries: $any($event.target).value })"
            (blur)="touched.emit('previousInjuries')"
          ></textarea>
        </app-field>
      }
      @case ('start') {
        <app-field [label]="weightLabel" [errors]="errors()['weightValue'] ?? null">
          <div class="value-unit">
            <input
              appControl
              name="weightValue"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              [value]="values().weightValue ?? ''"
              (input)="set({ weightValue: numberOrNull($any($event.target).valueAsNumber) })"
              (blur)="touched.emit('weightValue')"
            />
            <app-segmented-control
              [label]="weightUnitLabel"
              [hideLabel]="true"
              [options]="weightUnits"
              [selected]="values().weightUnit"
              (selectedChange)="set({ weightUnit: $any($event) })"
            />
          </div>
        </app-field>
        <app-date-field
          [label]="weighedLabel"
          [help]="weighedHelp"
          [errors]="errors()['weighedOn'] ?? null"
          [value]="values().weighedOn"
          (valueChange)="set({ weighedOn: $event })"
          [max]="today()"
          [today]="today()"
          [firstDay]="firstDay()"
          (touched)="touched.emit('weighedOn')"
        />
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-inline-size: 0;
    }

    .pair {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
    }

    .value-unit {
      align-items: center;
      display: grid;
      gap: 0.5rem;
      grid-template-columns: minmax(0, 1fr) minmax(0, 12rem);
    }

    @media (max-width: 26rem) {
      .value-unit {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    // A focused box scrolls clear of the sticky action bar at the sheet's foot.
    input,
    textarea,
    button {
      scroll-margin-block-end: 5rem;
    }
  `,
})
export class IntakeFields {
  readonly step = input.required<IntakeStepId>();
  readonly values = model.required<IntakeValues>();
  /** The messages due on screen now, by box. */
  readonly errors = input<IntakeErrors>({});
  /** Today in the coaching space, for the weighing day's calendar. */
  readonly today = input.required<IsoDate>();
  readonly firstDay = input<number | null>(null);
  readonly subject = input<IntakeSubject>({ kind: 'self' });
  /** A box was left; the page then lets that box's message show. */
  readonly touched = output<string>();

  protected readonly firstLabel = $localize`First name`;
  protected readonly lastLabel = $localize`Last name`;
  protected readonly phoneLabel = $localize`Phone number (optional)`;
  protected readonly phoneHelp = computed(() =>
    this.subject().kind === 'self'
      ? $localize`So your coach can reach you.`
      : $localize`So you can reach them.`,
  );
  protected readonly birthLabel = $localize`Date of birth`;
  protected readonly birthHelp = $localize`For example, 27 3 1990.`;
  protected readonly heightLabel = $localize`Height`;
  protected readonly heightUnitLabel = $localize`Height unit`;
  protected readonly heightUnits: readonly SegmentOption[] = [
    { value: 'Centimeter' satisfies LengthUnit, label: $localize`Centimeters` },
    { value: 'Inch' satisfies LengthUnit, label: $localize`Inches` },
  ];

  protected readonly goalsLabel = $localize`Goals`;
  protected readonly goalsHelp = $localize`A number, an event, or how you want to feel.`;
  protected readonly backgroundLabel = $localize`Training background (optional)`;
  protected readonly backgroundHelp = $localize`What has been done so far, how often, and what was liked or not.`;

  protected readonly workLabel = $localize`Work (optional)`;
  protected readonly workHelp = $localize`For example, a desk job, on your feet all day, or shifts.`;
  protected readonly stepsLabel = $localize`Average daily steps (optional)`;
  protected readonly stepsHelp = $localize`A rough number is fine. A phone’s step counter shows it.`;
  protected readonly likesLabel = $localize`Favorite foods (optional)`;
  protected readonly avoidLabel = $localize`Foods to avoid (optional)`;

  protected readonly allergiesLabel = $localize`Allergies (optional)`;
  protected readonly medicationsLabel = $localize`Medications (optional)`;
  protected readonly injuriesLabel = $localize`Previous injuries (optional)`;

  protected readonly weightLabel = $localize`Weight`;
  protected readonly weightUnitLabel = $localize`Weight unit`;
  protected readonly weightUnits: readonly SegmentOption[] = [
    { value: 'Kilogram' satisfies BodyweightUnit, label: $localize`Kilograms` },
    { value: 'Pound' satisfies BodyweightUnit, label: $localize`Pounds` },
  ];
  protected readonly weighedLabel = $localize`Weighed on`;
  protected readonly weighedHelp = $localize`Today, unless it was another day.`;

  protected set(patch: Partial<IntakeValues>): void {
    this.values.update((current) => ({ ...current, ...patch }));
  }

  /** A number box answers NaN while it holds nothing usable. */
  protected numberOrNull(value: number): number | null {
    return Number.isFinite(value) ? value : null;
  }
}
