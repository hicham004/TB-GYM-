import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ClientSelfProfile } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, fill, press, query, settle } from '../../../testing/dom';
import { ClientProfilePage } from './client-profile';

function profile(overrides: Partial<ClientSelfProfile> = {}): ClientSelfProfile {
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
    version: 4,
    ...overrides,
  };
}

async function render(api: Partial<ApiClient> = {}, initial = profile()) {
  await TestBed.configureTestingModule({
    imports: [ClientProfilePage],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getSelfProfile: vi.fn(() => of(initial)),
          updateSelfIntake: vi.fn(() => of({ ...initial, version: initial.version + 1 })),
          completeSelfOnboarding: vi.fn(() =>
            of({ ...initial, onboardingStatus: 'Completed', version: initial.version + 1 }),
          ),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ClientProfilePage);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
}

describe('ClientProfilePage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * The client fills the same intake form the coach sees, but against their own endpoints. This
   * drives the embedded form's real controls, so it covers the whole path from the rendered field
   * to the request, including the output the page is wired to.
   */
  it('saves the client’s own intake from the rendered form', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Work type', 'Shift work');
    fill(host, 'Food aversions', 'No shellfish.');
    await settle(fixture);
    press(host, 'Save intake');
    await settle(fixture);

    expect(api.updateSelfIntake).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Rana',
        workType: 'Shift work',
        foodAversions: 'No shellfish.',
        version: 4,
      }),
    );
    expect(host.textContent).toContain('Your intake was saved.');
  });

  it('completes the client’s own onboarding with their first bodyweight', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Date of birth', '1996-04-02');
    fill(host, 'Height', '168');
    fill(host, 'Height unit', 'Centimeter');
    fill(host, 'Goals', 'Get stronger.');
    fill(host, 'Initial bodyweight', '62.5');
    fill(host, 'Measurement date', '2026-08-25');
    await settle(fixture);
    press(host, 'Complete onboarding');
    await settle(fixture);

    expect(api.completeSelfOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        initialBodyweightValue: 62.5,
        initialBodyweightUnit: 'Kilogram',
        measurementDate: '2026-08-25',
        intake: expect.objectContaining({ goals: 'Get stronger.', version: 4 }),
      }),
    );
    expect(host.textContent).toContain('Your onboarding is complete.');
    // The status on the page follows the profile the server returned.
    expect(host.textContent).toContain('Completed');
  });

  it('offers no completion control to a client who has already onboarded', async () => {
    const { host } = await render({}, profile({ onboardingStatus: 'Completed' }));

    expect(() => button(host, 'Complete onboarding')).toThrow();
    expect(button(host, 'Save intake')).toBeTruthy();
  });

  it('reports a rejected save instead of claiming the intake was stored', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: { title: 'Your profile was changed elsewhere.' },
    });
    const { fixture, host } = await render({
      updateSelfIntake: vi.fn(() => throwError(() => conflict)),
    });

    fill(host, 'Work type', 'Shift work');
    await settle(fixture);
    press(host, 'Save intake');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'Your profile was changed elsewhere.',
    );
    expect(host.textContent).not.toContain('Your intake was saved.');
  });

  it('reports a failed load rather than rendering an empty intake form', async () => {
    const { host } = await render({
      getSelfProfile: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain(
      'Your profile could not be loaded.',
    );
    expect(host.querySelector('form')).toBeNull();
  });
});
