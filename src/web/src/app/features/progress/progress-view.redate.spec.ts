import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ProgressView } from './progress-view';
import type { BodyweightDateCorrection, BodyweightObservation } from './progress.models';

interface RedateHarness {
  beginRedate(observation: BodyweightObservation): void;
  cancelRedate(): void;
  beginCorrection(observation: BodyweightObservation): void;
  redate(observation: BodyweightObservation): Promise<void>;
  redatingId: string | null;
  redateDate: string;
  redateReason: string;
  correctingId: string | null;
  correction(): BodyweightDateCorrection | null;
  error(): string | null;
  notice(): string | null;
}

const observation: BodyweightObservation = {
  id: 'observation-1',
  measurementDate: '2026-08-17',
  valueKilograms: 80,
  enteredValue: 80,
  enteredUnit: 'Kilogram',
  source: 'Client',
  recordedByUserId: 'user-1',
  recordedAtUtc: '2026-08-17T08:00:00Z',
  status: 'Active',
  version: 4,
};

const correction: BodyweightDateCorrection = {
  replacement: { ...observation, id: 'observation-2', measurementDate: '2026-08-18', version: 1 },
  voided: { ...observation, status: 'Voided' },
  void: {
    id: 'void-1',
    reason: 'Logged against the wrong day.',
    voidedByUserId: 'user-1',
    voidedAtUtc: '2026-08-22T09:00:00Z',
    replacementObservationId: 'observation-2',
  },
};

async function createHarness(
  replace: (id: string, request: unknown) => Observable<BodyweightDateCorrection>,
): Promise<{ harness: RedateHarness; replaceMyBodyweightDate: ReturnType<typeof vi.fn> }> {
  const replaceMyBodyweightDate = vi.fn(replace);
  await TestBed.configureTestingModule({
    imports: [ProgressView],
    providers: [
      {
        provide: ApiClient,
        // A successful correction reloads the view; an empty reload keeps the test on the flow.
        useValue: { replaceMyBodyweightDate, getMyProgress: vi.fn(() => of(null)) },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      // No selected tenant, so the load effect stays inert and only the correction flow runs.
      { provide: TenantStore, useValue: { selectedTenantId: signal(null) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProgressView);
  fixture.detectChanges();
  return {
    harness: fixture.componentInstance as unknown as RedateHarness,
    replaceMyBodyweightDate,
  };
}

describe('ProgressView mis-dated bodyweight correction', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('moves the entry to the corrected date and reports what happened to the original', async () => {
    const { harness, replaceMyBodyweightDate } = await createHarness(() => of(correction));

    harness.beginRedate(observation);
    // The form starts on the entry's current date so the user edits rather than retypes.
    expect(harness.redateDate).toBe('2026-08-17');
    harness.redateDate = '2026-08-18';
    harness.redateReason = '  Logged against the wrong day.  ';
    await harness.redate(observation);

    expect(replaceMyBodyweightDate).toHaveBeenCalledWith('observation-1', {
      measurementDate: '2026-08-18',
      reason: 'Logged against the wrong day.',
      version: 4,
    });
    // The result names both sides, so the UI can say the original was kept rather than deleted.
    expect(harness.correction()?.voided.status).toBe('Voided');
    expect(harness.correction()?.replacement.measurementDate).toBe('2026-08-18');
    expect(harness.notice()).toContain('voided record');
    expect(harness.error()).toBeNull();
    expect(harness.redatingId).toBeNull();
  });

  it('refuses to submit without a reason or onto the same date', async () => {
    const { harness, replaceMyBodyweightDate } = await createHarness(() => of(correction));

    harness.beginRedate(observation);
    harness.redateDate = '2026-08-18';
    harness.redateReason = '   ';
    await harness.redate(observation);
    expect(harness.error()).toContain('reason');

    harness.redateReason = 'Wrong day.';
    harness.redateDate = observation.measurementDate;
    await harness.redate(observation);
    expect(harness.error()).toContain('different date');

    // Neither attempt reached the server, so nothing was voided on a malformed request.
    expect(replaceMyBodyweightDate).not.toHaveBeenCalled();
    expect(harness.correction()).toBeNull();
  });

  it('surfaces an occupied target date as its own actionable message', async () => {
    const { harness } = await createHarness(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              code: 'BodyweightDateAlreadyExists',
              title: 'A bodyweight observation already exists for that local date.',
            },
          }),
      ),
    );

    harness.beginRedate(observation);
    harness.redateDate = '2026-08-18';
    harness.redateReason = 'Wrong day.';
    await harness.redate(observation);

    expect(harness.error()).toContain('already recorded for that date');
    // The failure leaves the form open so the user can pick another date without starting over.
    expect(harness.redatingId).toBe('observation-1');
    expect(harness.correction()).toBeNull();
    expect(harness.notice()).toBeNull();
  });

  it('keeps the value correction and the date correction mutually exclusive', async () => {
    const { harness } = await createHarness(() => of(correction));

    harness.beginCorrection(observation);
    expect(harness.correctingId).toBe('observation-1');
    // Two open forms editing the same entry could submit contradictory corrections.
    harness.beginRedate(observation);
    expect(harness.correctingId).toBeNull();
    expect(harness.redatingId).toBe('observation-1');

    harness.beginCorrection(observation);
    expect(harness.redatingId).toBeNull();
    expect(harness.correctingId).toBe('observation-1');
  });
});
