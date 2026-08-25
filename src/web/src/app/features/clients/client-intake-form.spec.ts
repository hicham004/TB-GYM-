import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ClientIntakeProfile,
  CompleteClientOnboardingRequest,
  UpdateClientIntakeRequest,
} from '../../core/api/api.models';
import { button, field, fill, press, query, settle } from '../../../testing/dom';
import { ClientIntakeForm } from './client-intake-form';

function profile(overrides: Partial<ClientIntakeProfile> = {}): ClientIntakeProfile {
  return {
    id: 'client-1',
    firstName: 'Rana',
    lastName: 'Haddad',
    email: 'rana@example.test',
    phoneNumber: null,
    birthDate: null,
    heightCentimeters: null,
    heightEnteredValue: null,
    heightEnteredUnit: null,
    workType: null,
    averageDailySteps: null,
    trainingBackground: null,
    foodPreferences: null,
    foodAversions: null,
    goals: null,
    allergies: null,
    medications: null,
    previousInjuries: null,
    onboardingStatus: 'InProgress',
    onboardingCompletedAtUtc: null,
    version: 7,
    ...overrides,
  };
}

async function render(intake: ClientIntakeProfile = profile()) {
  await TestBed.configureTestingModule({ imports: [ClientIntakeForm] }).compileComponents();

  const fixture = TestBed.createComponent(ClientIntakeForm);
  fixture.componentRef.setInput('profile', intake);
  const saved: UpdateClientIntakeRequest[] = [];
  const completed: CompleteClientOnboardingRequest[] = [];
  fixture.componentInstance.saveIntake.subscribe((request) => saved.push(request));
  fixture.componentInstance.completeOnboarding.subscribe((request) => completed.push(request));
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, saved, completed };
}

/** Fills the fields onboarding cannot complete without. */
function fillRequiredForCompletion(host: HTMLElement) {
  fill(host, 'Date of birth', '1996-04-02');
  fill(host, 'Height', '168');
  fill(host, 'Height unit', 'Centimeter');
  fill(host, 'Goals', 'Get stronger and sleep better.');
  fill(host, 'Initial bodyweight', '62.5');
  fill(host, 'Bodyweight unit', 'Kilogram');
  fill(host, 'Measurement date', '2026-08-25');
}

describe('ClientIntakeForm', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('opens with the intake already on file rather than an empty form', async () => {
    const { host } = await render(
      profile({ phoneNumber: '+96170123456', workType: 'Desk', goals: 'Recomposition.' }),
    );

    expect(field(host, 'First name').value).toBe('Rana');
    expect(field(host, 'Phone number').value).toBe('+96170123456');
    expect(field(host, 'Work type').value).toBe('Desk');
    expect(field(host, 'Goals').value).toBe('Recomposition.');
  });

  /**
   * Completing onboarding is what opens every gated feature for this client, and it sends the
   * intake and the first bodyweight as one command. A control that never reaches the model would
   * either block completion outright or record the wrong starting weight.
   */
  it('completes onboarding with the intake and the first bodyweight together', async () => {
    const { fixture, host, completed, saved } = await render();

    fill(host, 'First name', 'Rana');
    fill(host, 'Last name', 'Haddad');
    fill(host, 'Phone number', '+96170123456');
    fill(host, 'Work type', 'Desk-based');
    fill(host, 'Average daily steps', '6500');
    fill(host, 'Training background', 'Two years of general training.');
    fill(host, 'Allergies', 'Peanuts');
    fillRequiredForCompletion(host);
    await settle(fixture);

    expect(button(host, 'Complete onboarding').disabled).toBe(false);
    press(host, 'Complete onboarding');
    await settle(fixture);

    expect(saved).toHaveLength(0);
    expect(completed).toEqual([
      {
        intake: {
          firstName: 'Rana',
          lastName: 'Haddad',
          phoneNumber: '+96170123456',
          birthDate: '1996-04-02',
          heightValue: 168,
          heightUnit: 'Centimeter',
          workType: 'Desk-based',
          averageDailySteps: 6500,
          trainingBackground: 'Two years of general training.',
          // Untouched free-text fields travel as absent, not as empty strings.
          foodPreferences: null,
          foodAversions: null,
          goals: 'Get stronger and sleep better.',
          allergies: 'Peanuts',
          medications: null,
          previousInjuries: null,
          // The version the coach was looking at, so a concurrent edit conflicts rather than wins.
          version: 7,
        },
        initialBodyweightValue: 62.5,
        initialBodyweightUnit: 'Kilogram',
        measurementDate: '2026-08-25',
      },
    ]);
  });

  it('saves an intake without completing onboarding', async () => {
    const { fixture, host, saved, completed } = await render();

    fill(host, 'Work type', 'Shift work');
    await settle(fixture);
    press(host, 'Save intake');
    await settle(fixture);

    expect(completed).toHaveLength(0);
    expect(saved).toHaveLength(1);
    expect(saved[0].workType).toBe('Shift work');
    expect(saved[0].version).toBe(7);
  });

  it('refuses to complete onboarding without a birth date, height and goal', async () => {
    const { fixture, host, completed } = await render();

    fill(host, 'Initial bodyweight', '62.5');
    await settle(fixture);
    press(host, 'Complete onboarding');
    await settle(fixture);

    expect(completed).toHaveLength(0);
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Birth date, height, and at least one goal are required to complete onboarding.',
    );
  });

  it('refuses to complete onboarding without an initial bodyweight', async () => {
    const { fixture, host, completed } = await render();

    fill(host, 'Date of birth', '1996-04-02');
    fill(host, 'Height', '168');
    fill(host, 'Height unit', 'Centimeter');
    fill(host, 'Goals', 'Get stronger.');
    await settle(fixture);
    press(host, 'Complete onboarding');
    await settle(fixture);

    expect(completed).toHaveLength(0);
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Initial bodyweight and measurement date are required.',
    );
  });

  /** A height is a number and a unit, and one without the other is not a measurement. */
  it('refuses a height value with no unit', async () => {
    const { fixture, host, saved } = await render();

    fill(host, 'Height', '168');
    await settle(fixture);
    press(host, 'Save intake');
    await settle(fixture);

    expect(saved).toHaveLength(0);
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Enter both a height value and unit, or leave both empty.',
    );
  });

  it('refuses an intake with no name', async () => {
    const { fixture, host, saved } = await render();

    fill(host, 'First name', '');
    await settle(fixture);
    press(host, 'Save intake');
    await settle(fixture);

    expect(saved).toHaveLength(0);
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Review the highlighted intake fields.',
    );
  });

  /**
   * Onboarding completes once. Re-offering the control would invite a second initial bodyweight
   * for a client who already has one.
   */
  it('offers no completion control once onboarding is done', async () => {
    const { host } = await render(
      profile({ onboardingStatus: 'Completed', onboardingCompletedAtUtc: '2026-08-01T09:00:00Z' }),
    );

    expect(() => button(host, 'Complete onboarding')).toThrow();
    expect(host.querySelector('.completion-fields')).toBeNull();
    // The intake itself stays editable.
    expect(button(host, 'Save intake')).toBeTruthy();
  });

  it('holds both actions while the parent is saving', async () => {
    await TestBed.configureTestingModule({ imports: [ClientIntakeForm] }).compileComponents();
    const fixture = TestBed.createComponent(ClientIntakeForm);
    fixture.componentRef.setInput('profile', profile());
    fixture.componentRef.setInput('busy', true);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;

    expect(button(host, 'Save intake').disabled).toBe(true);
    expect(query<HTMLButtonElement>(host, 'button.primary-button').disabled).toBe(true);
  });
});
