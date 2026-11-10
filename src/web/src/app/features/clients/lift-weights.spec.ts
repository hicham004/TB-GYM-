import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import {
  liftStanding,
  liftWeightsApplied,
  standingReason,
  standingSet,
} from '../../../testing/lift-weight-fixtures';
import {
  applyError,
  applyLabel,
  applyName,
  appliedNotice,
  applyRequest,
  canApply,
  LiftWeightApplier,
  sessionDay,
  setsToApply,
} from './lift-weights';
import { ClientProgramApi } from './client-program-api';

const refused = (status: number, body: unknown) =>
  new HttpErrorResponse({
    status,
    error: body,
    url: '/api/training/clients/client-1/lift-weights/apply',
  });

describe('applying a weight (N6c, STR-020)', () => {
  it('applies every set the answer moves to a weight it does not have yet, as the server does', () => {
    const view = liftStanding({
      sets: [
        standingSet(1, { weight: 17, currentWeight: 15 }),
        // Already at 17 kg (the coach typed it): nothing to write.
        standingSet(2, { weight: '17.000', currentWeight: 17 }),
        // A set with no weight yet: the client picked last time.
        standingSet(3, { weight: 17, currentWeight: null }),
        // New since last time: it keeps its own.
        standingSet(4, { move: 'Unchanged', weight: 20, currentWeight: 20, note: 'NewSet' }),
      ],
    });

    expect(setsToApply(view).map((set) => set.setNumber)).toEqual([1, 3]);
    expect(canApply(view)).toBe(true);
    expect(applyRequest([view], 'key-1')).toEqual({
      idempotencyKey: 'key-1',
      lifts: [
        {
          exercisePrescriptionId: 'prescription-1',
          sets: [
            { setPrescriptionId: 'set-1', currentWeight: 15, weight: 17 },
            { setPrescriptionId: 'set-3', currentWeight: null, weight: 17 },
          ],
        },
      ],
    });
  });

  it('offers last time’s weight on a hold that names it, and nothing on a hold that keeps each set’s own', () => {
    // Line (d), decision 22: a new program's 30 kg start carries on at last time's 25 kg.
    const kept = liftStanding({
      outcome: 'Hold',
      reason: standingReason({
        kind: 'RepsShort',
        setNumber: 2,
        repetitions: 8,
        repetitionsAsked: 10,
      }),
      sets: [1, 2, 3].map((n) =>
        standingSet(n, { move: 'SameAsLastTime', weight: 25, currentWeight: 30 }),
      ),
    });
    expect(canApply(kept)).toBe(true);
    expect(applyLabel(kept, 'en-US')).toBe('Apply 25 kg');

    const same = liftStanding({
      outcome: 'Hold',
      reason: standingReason({
        kind: 'RepsShort',
        setNumber: 2,
        repetitions: 8,
        repetitionsAsked: 10,
      }),
      sets: [1, 2, 3].map((n) =>
        standingSet(n, { move: 'SameAsLastTime', weight: 25, currentWeight: 25 }),
      ),
    });
    expect(canApply(same)).toBe(false);

    const never = liftStanding({
      outcome: 'Hold',
      reason: standingReason({ kind: 'NeverDone', day: null }),
      lastTime: null,
      sets: [1, 2, 3].map((n) =>
        standingSet(n, { move: 'Unchanged', weight: null, currentWeight: null }),
      ),
    });
    expect(canApply(never)).toBe(false);
    expect(setsToApply(never)).toEqual([]);

    // A set carried on from a log of 0 kg has no weight to apply, as on the server.
    const nothing = liftStanding({
      outcome: 'Hold',
      reason: standingReason({
        kind: 'RepsShort',
        setNumber: 1,
        repetitions: 8,
        repetitionsAsked: 10,
      }),
      sets: [standingSet(1, { move: 'SameAsLastTime', weight: 0, currentWeight: null })],
    });
    expect(canApply(nothing)).toBe(false);
  });

  it('names the weights, the lift, its workout and its day on the button', () => {
    const view = liftStanding();
    expect(applyLabel(view, 'en-US')).toBe('Apply 17 kg');
    expect(applyName(view, 'en-US')).toBe('Apply 17 kg to Seated Leg Curl, Lower A on Thu 12 Nov');

    const spread = liftStanding({
      sets: [
        standingSet(1, { weight: 22.5, currentWeight: 20 }),
        standingSet(2, { weight: 25, currentWeight: 22.5 }),
      ],
    });
    expect(applyLabel(spread, 'en-US')).toBe('Apply 22.5–25 kg');

    expect(sessionDay(liftStanding({}, { sessionDate: '2026-11-10' }), 'en-US')).toBe('today');
    expect(sessionDay(liftStanding({}, { sessionDate: '2026-11-11' }), 'en-US')).toBe('tomorrow');
    expect(applyName(liftStanding({}, { sessionDate: '2026-11-11' }), 'en-US')).toBe(
      'Apply 17 kg to Seated Leg Curl, Lower A tomorrow',
    );
  });

  it('says what was applied: one lift by name and day, several by count', () => {
    const one = liftStanding();
    expect(appliedNotice(liftWeightsApplied([one]), [one], 'Maya', 'en-US')).toBe(
      'Seated Leg Curl is now 17 kg on Thu 12 Nov. Maya sees it on that workout.',
    );

    const two = liftStanding(
      {},
      { exercisePrescriptionId: 'prescription-2', exerciseName: 'Leg press' },
    );
    expect(appliedNotice(liftWeightsApplied([one, two]), [one, two], 'Maya', 'en-US')).toBe(
      '2 weights applied. Maya sees each on its workout.',
    );
  });

  it('puts every refusal in a coach’s words, and says the lifts were read again on a conflict', () => {
    const changed =
      'Where a lift stands changed since this was read. It has been read again: check it, then apply.';
    expect(applyError(refused(409, { code: 'lift_standing_changed', message: 'x' }), 'Maya')).toBe(
      changed,
    );
    expect(applyError(refused(409, { code: 'concurrency_conflict', message: 'x' }), 'Maya')).toBe(
      changed,
    );
    expect(applyError(refused(409, { code: 'idempotency_conflict', message: 'x' }), 'Maya')).toBe(
      'That apply clashed with another one. It has been read again: check it, then apply.',
    );
    // A closed training read (TRN-023) answers 403 without a code.
    expect(applyError(refused(403, null), 'Maya')).toBe(
      'Maya’s training isn’t open now, so the weights stay as they are.',
    );
    expect(applyError(refused(403, { code: 'workspace_read_only', message: 'x' }), 'Maya')).toBe(
      'Your coaching space is read-only until its TB Gym bill is paid. You can still view everything.',
    );
  });
});

describe('LiftWeightApplier (N6c)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sends a retry of the same request under the same key, and a new request under a new one', async () => {
    let fail = true;
    const applyLiftWeights = vi.fn(() =>
      fail
        ? throwError(
            () => new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') }),
          )
        : of(liftWeightsApplied([liftStanding()])),
    );
    const refresh = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClientProgramApi, useValue: { applyLiftWeights } },
        { provide: CsrfService, useValue: { refresh } },
      ],
    });
    const applier = TestBed.runInInjectionContext(() => new LiftWeightApplier());
    const view = liftStanding();
    const keyOf = (call: number) =>
      (applyLiftWeights.mock.calls[call] as unknown as [string, { idempotencyKey: string }])[1]
        .idempotencyKey;

    // The answer was lost: the retry is the same request, so the server can answer it with the first result.
    await expect(applier.apply('client-1', [view])).rejects.toBeInstanceOf(HttpErrorResponse);
    fail = false;
    await applier.apply('client-1', [view]);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(refresh).toHaveBeenCalledTimes(2);

    // Once answered, the next apply is a request of its own.
    await applier.apply('client-1', [view]);
    expect(keyOf(2)).not.toBe(keyOf(1));
  });
});
