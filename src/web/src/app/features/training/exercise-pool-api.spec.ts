import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  POOL_GOBLET_SQUAT,
  POOL_WALKING_LUNGE,
  poolPage,
  poolResult,
} from '../../../testing/own-workout-fixtures';
import { ExercisePoolApi } from './exercise-pool-api';

function setUp() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { api: TestBed.inject(ExercisePoolApi), http: TestBed.inject(HttpTestingController) };
}

describe('ExercisePoolApi, TB Gym’s pool (notes plans N9b3 and N9b4)', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('asks for the first page as the picker always has: skip, then take, and nothing else', async () => {
    const { api, http } = setUp();

    const read = firstValueFrom(api.search());
    const request = http.expectOne('/api/exercise-pool?skip=0&take=50');
    expect(request.request.method).toBe('GET');
    request.flush(poolPage([POOL_GOBLET_SQUAT]));

    expect((await read).items).toEqual([POOL_GOBLET_SQUAT]);
  });

  it('sends a search after skip and take, trimmed, and none for a blank box', async () => {
    const { api, http } = setUp();

    const searched = firstValueFrom(api.search({ query: '  row ', skip: 0, take: 50 }));
    http.expectOne('/api/exercise-pool?skip=0&take=50&query=row').flush(poolPage([]));
    await searched;

    const blank = firstValueFrom(api.search({ query: '   ', skip: 50, take: 50 }));
    http.expectOne('/api/exercise-pool?skip=50&take=50').flush(poolPage([]));
    await blank;
  });

  it('sends a muscle and an equipment after the search, only when set', async () => {
    const { api, http } = setUp();

    const filtered = firstValueFrom(
      api.search({
        query: 'squat',
        skip: 50,
        take: 50,
        muscle: 'Quadriceps',
        equipment: 'Kettlebell',
      }),
    );
    http
      .expectOne(
        '/api/exercise-pool?skip=50&take=50&query=squat&muscle=Quadriceps&equipment=Kettlebell',
      )
      .flush(poolPage([POOL_GOBLET_SQUAT]));
    await filtered;

    // A filter not set is never sent: the server answers a value it does not know with a 400.
    const unset = firstValueFrom(api.search({ skip: 0, take: 50, muscle: null, equipment: null }));
    http.expectOne('/api/exercise-pool?skip=0&take=50').flush(poolPage([]));
    await unset;

    const equipmentAlone = firstValueFrom(api.search({ equipment: 'None' }));
    const request = http.expectOne(
      (asked) => asked.url === '/api/exercise-pool' && asked.params.get('equipment') === 'None',
    );
    expect(request.request.params.has('muscle')).toBe(false);
    expect(request.request.params.has('query')).toBe(false);
    request.flush(poolPage([]));
    await equipmentAlone;
  });

  it('reads one exercise of the pool by its id', async () => {
    const { api, http } = setUp();

    const read = firstValueFrom(api.get(POOL_WALKING_LUNGE.id));
    const request = http.expectOne('/api/exercise-pool/pool-walking-lunge');
    expect(request.request.method).toBe('GET');
    request.flush(poolResult(POOL_WALKING_LUNGE));

    expect(await read).toEqual({
      isAllowed: true,
      accessReason: 'Granted',
      exercise: POOL_WALKING_LUNGE,
    });
  });
});
