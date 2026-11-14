import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { houseListing } from '../../../testing/program-builder-fixtures';
import { HouseListingsApi, HouseListingsMemo } from './house-listings-api';

function setUp() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { api: TestBed.inject(HouseListingsApi), http: TestBed.inject(HttpTestingController) };
}

describe('HouseListingsApi, TB Gym’s programs for trainees as its staff mark them (N9c4)', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('reads the list and turns its numbers into numbers', async () => {
    const { api, http } = setUp();

    const read = firstValueFrom(api.list());
    const request = http.expectOne('/api/training/house-programs');
    expect(request.request.method).toBe('GET');
    request.flush([houseListing({ weeks: '2', version: '3', timesStarted: '0' })]);

    expect(await read).toEqual([
      expect.objectContaining({ listingId: 'listing-1', weeks: 2, version: 3, timesStarted: 0 }),
    ]);
  });

  it('offers a program with a PUT of its terms, the rounding by its name', async () => {
    const { api, http } = setUp();
    const body = {
      suits: 'Beginners',
      runName: 'Foundations',
      runPosition: 2,
      loadIncrement: 2.5,
      loadRoundingMode: 'Down' as const,
      version: null,
    };

    const offered = firstValueFrom(api.offer('template 1', body));
    const request = http.expectOne('/api/training/templates/template%201/house-listing');
    expect([request.request.method, request.request.body]).toEqual(['PUT', body]);
    request.flush(houseListing({ runPosition: 2, version: 1 }));

    expect(await offered).toMatchObject({ runPosition: 2, version: 1 });
  });

  it('withdraws a program with its version', async () => {
    const { api, http } = setUp();

    const withdrawn = firstValueFrom(api.withdraw('template-1', { version: 3 }));
    const request = http.expectOne('/api/training/templates/template-1/house-listing/withdraw');
    expect([request.request.method, request.request.body]).toEqual(['POST', { version: 3 }]);
    request.flush(houseListing({ isOffered: false, version: 4 }));

    expect(await withdrawn).toMatchObject({ isOffered: false, version: 4 });
  });
});

describe('HouseListingsMemo', () => {
  afterEach(() => TestBed.resetTestingModule());

  /** The memo over a workspace selection that changes as `TenantStore`'s does. */
  function memoOf() {
    const selectedTenantId = signal<string | null>('tenant-1');
    TestBed.configureTestingModule({
      providers: [{ provide: TenantStore, useValue: { selectedTenantId } }],
    });
    const memo = TestBed.inject(HouseListingsMemo);
    const select = (tenantId: string | null) => {
      selectedTenantId.set(tenantId);
      TestBed.inject(TenantContext).invalidate();
    };
    return { memo, select };
  }

  it('remembers another space per space, across workspace switches', () => {
    const { memo, select } = memoOf();
    memo.markNotTheHouse('tenant-1');

    expect(memo.isNotTheHouse('tenant-1')).toBe(true);
    expect(memo.isNotTheHouse('tenant-2')).toBe(false);
    select('tenant-2');
    select('tenant-1');
    expect(memo.isNotTheHouse('tenant-1')).toBe(true);
  });

  it('forgets every space when the session changes', () => {
    const { memo, select } = memoOf();
    memo.markNotTheHouse('tenant-1');
    memo.markNotTheHouse('tenant-2');

    select(null);

    expect(memo.isNotTheHouse('tenant-1')).toBe(false);
    expect(memo.isNotTheHouse('tenant-2')).toBe(false);
  });
});
