import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BASE_1_LISTING,
  HOUSE_TODAY,
  SQUAT_ID,
  startedView,
  typedMaxView,
  underPass,
} from '../../../testing/house-program-fixtures';
import { HouseProgramsApi } from './house-programs-api';

describe('HouseProgramsApi', () => {
  let api: HouseProgramsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(HouseProgramsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('reads the trainee’s programs and maps them to the page’s model', async () => {
    const read = firstValueFrom(api.programs());
    const request = http.expectOne('/api/training/me/house-programs');
    expect(request.request.method).toBe('GET');
    request.flush(underPass());

    const programs = await read;
    expect(programs.today).toBe(HOUSE_TODAY);
    expect(programs.pass?.lastDay).toBe('2026-12-11');
    expect(programs.programs.map((program) => program.name)).toEqual([
      'Strength Base 1',
      'Strength Base 2',
      'Powerbuilding 6',
    ]);
    expect(programs.programs[1].weeks).toBe(1);
  });

  it('starts one with the version read and the press’s key', async () => {
    const started = firstValueFrom(
      api.start(BASE_1_LISTING, { templateVersionId: 'version-1', idempotencyKey: 'key-1' }),
    );
    const request = http.expectOne(`/api/training/me/house-programs/${BASE_1_LISTING}/start`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      templateVersionId: 'version-1',
      idempotencyKey: 'key-1',
    });
    request.flush(startedView());

    expect(await started).toMatchObject({
      name: 'Strength Base 1',
      endDateExclusive: '2026-11-28',
    });
  });

  it('adds a max the trainee typed, in the program’s unit', async () => {
    const saved = firstValueFrom(
      api.recordMax({ exerciseId: SQUAT_ID, value: 140, unit: 'Kilogram' }),
    );
    const request = http.expectOne('/api/strength/me/maxes');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ exerciseId: SQUAT_ID, value: 140, unit: 'Kilogram' });
    request.flush(typedMaxView());

    expect((await saved).methodKey).toBe('TraineeTyped');
  });
});
