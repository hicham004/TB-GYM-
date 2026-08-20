import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api-client';

describe('ApiClient contract mapping', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('normalizes generated PostgreSQL concurrency values for workspace forms', () => {
    api.getWorkspace().subscribe((workspace) => {
      expect(workspace.version).toBe(42);
      expect(workspace.defaultCurrencyCode).toBe('USD');
    });

    http.expectOne('/api/workspace').flush({
      id: 'workspace-a',
      name: 'Solo Coach',
      slug: 'solo-coach',
      timeZoneId: 'Asia/Beirut',
      defaultCulture: 'en-LB',
      defaultCurrencyCode: 'USD',
      weekStartsOn: 'Monday',
      version: '42',
    });
  });

  it('normalizes generated decimal and version unions for client intake', () => {
    api.getSelfProfile().subscribe((profile) => {
      expect(profile.heightCentimeters).toBe(177.8);
      expect(profile.averageDailySteps).toBe(8000);
      expect(profile.version).toBe(7);
    });

    http.expectOne('/api/client-profile/me').flush({
      id: 'client-a',
      firstName: 'Mira',
      lastName: 'Haddad',
      email: 'mira@example.test',
      phoneNumber: null,
      birthDate: '1995-04-02',
      heightCentimeters: '177.80',
      heightEnteredValue: '70',
      heightEnteredUnit: 'Inch',
      workType: null,
      averageDailySteps: '8000',
      trainingBackground: null,
      foodPreferences: null,
      foodAversions: null,
      goals: 'Build strength',
      allergies: null,
      medications: null,
      previousInjuries: null,
      onboardingStatus: 'InProgress',
      onboardingCompletedAtUtc: null,
      version: '7',
    });
  });
});
