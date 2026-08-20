import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  BodyweightUnit,
  ClientIntakeProfile,
  CompleteClientOnboardingRequest,
  LengthUnit,
  UpdateClientIntakeRequest,
} from '../../core/api/api.models';

@Component({
  selector: 'app-client-intake-form',
  imports: [ReactiveFormsModule],
  templateUrl: './client-intake-form.html',
  styleUrl: './client-intake-form.scss',
})
export class ClientIntakeForm {
  private readonly formBuilder = inject(FormBuilder);

  readonly profile = input.required<ClientIntakeProfile>();
  readonly busy = input(false);
  readonly saveIntake = output<UpdateClientIntakeRequest>();
  readonly completeOnboarding = output<CompleteClientOnboardingRequest>();

  protected readonly localError = signal<string | null>(null);
  protected readonly maximumBirthDate = adultCutoff();
  protected readonly maximumMeasurementDate = today();
  protected readonly form = this.formBuilder.group({
    firstName: this.formBuilder.nonNullable.control('', [
      Validators.required,
      Validators.maxLength(100),
    ]),
    lastName: this.formBuilder.nonNullable.control('', [
      Validators.required,
      Validators.maxLength(100),
    ]),
    phoneNumber: this.formBuilder.nonNullable.control('', Validators.maxLength(32)),
    birthDate: this.formBuilder.nonNullable.control(''),
    heightValue: this.formBuilder.control<number | null>(null, Validators.min(1)),
    heightUnit: this.formBuilder.control<LengthUnit | null>(null),
    workType: this.formBuilder.nonNullable.control('', Validators.maxLength(200)),
    averageDailySteps: this.formBuilder.control<number | null>(null, [
      Validators.min(0),
      Validators.max(100000),
    ]),
    trainingBackground: this.formBuilder.nonNullable.control('', Validators.maxLength(4000)),
    foodPreferences: this.formBuilder.nonNullable.control('', Validators.maxLength(4000)),
    foodAversions: this.formBuilder.nonNullable.control('', Validators.maxLength(4000)),
    goals: this.formBuilder.nonNullable.control('', Validators.maxLength(4000)),
    allergies: this.formBuilder.nonNullable.control('', Validators.maxLength(4000)),
    medications: this.formBuilder.nonNullable.control('', Validators.maxLength(4000)),
    previousInjuries: this.formBuilder.nonNullable.control('', Validators.maxLength(4000)),
    initialBodyweightValue: this.formBuilder.control<number | null>(null, Validators.min(1)),
    initialBodyweightUnit: this.formBuilder.nonNullable.control<BodyweightUnit>('Kilogram'),
    measurementDate: this.formBuilder.nonNullable.control(today()),
  });

  constructor() {
    effect(() => {
      const profile = this.profile();
      this.form.reset({
        firstName: profile.firstName,
        lastName: profile.lastName,
        phoneNumber: profile.phoneNumber ?? '',
        birthDate: profile.birthDate ?? '',
        heightValue: profile.heightEnteredValue,
        heightUnit: profile.heightEnteredUnit,
        workType: profile.workType ?? '',
        averageDailySteps: profile.averageDailySteps,
        trainingBackground: profile.trainingBackground ?? '',
        foodPreferences: profile.foodPreferences ?? '',
        foodAversions: profile.foodAversions ?? '',
        goals: profile.goals ?? '',
        allergies: profile.allergies ?? '',
        medications: profile.medications ?? '',
        previousInjuries: profile.previousInjuries ?? '',
        initialBodyweightValue: null,
        initialBodyweightUnit: 'Kilogram',
        measurementDate: today(),
      });
      this.localError.set(null);
    });
  }

  protected save(): void {
    this.localError.set(null);
    if (!this.validateIntake()) {
      return;
    }

    this.saveIntake.emit(this.toIntakeRequest());
  }

  protected complete(): void {
    this.localError.set(null);
    if (!this.validateIntake()) {
      return;
    }

    const value = this.form.getRawValue();
    if (!value.birthDate || !value.heightValue || !value.heightUnit || !value.goals.trim()) {
      this.localError.set(
        $localize`Birth date, height, and at least one goal are required to complete onboarding.`,
      );
      return;
    }
    if (!value.initialBodyweightValue || !value.measurementDate) {
      this.localError.set($localize`Initial bodyweight and measurement date are required.`);
      return;
    }

    this.completeOnboarding.emit({
      intake: this.toIntakeRequest(),
      initialBodyweightValue: value.initialBodyweightValue,
      initialBodyweightUnit: value.initialBodyweightUnit,
      measurementDate: value.measurementDate,
    });
  }

  private validateIntake(): boolean {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.localError.set($localize`Review the highlighted intake fields.`);
      return false;
    }

    const value = this.form.getRawValue();
    if ((value.heightValue === null) !== (value.heightUnit === null)) {
      this.localError.set($localize`Enter both a height value and unit, or leave both empty.`);
      return false;
    }
    return true;
  }

  private toIntakeRequest(): UpdateClientIntakeRequest {
    const value = this.form.getRawValue();
    return {
      firstName: value.firstName,
      lastName: value.lastName,
      phoneNumber: blankToNull(value.phoneNumber),
      birthDate: blankToNull(value.birthDate),
      heightValue: value.heightValue,
      heightUnit: value.heightUnit,
      workType: blankToNull(value.workType),
      averageDailySteps: value.averageDailySteps,
      trainingBackground: blankToNull(value.trainingBackground),
      foodPreferences: blankToNull(value.foodPreferences),
      foodAversions: blankToNull(value.foodAversions),
      goals: blankToNull(value.goals),
      allergies: blankToNull(value.allergies),
      medications: blankToNull(value.medications),
      previousInjuries: blankToNull(value.previousInjuries),
      version: this.profile().version,
    };
  }
}

function blankToNull(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function today(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function adultCutoff(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
}
