import { describe, expect, it } from 'vitest';
import { changeWorkingMaxUnit, IntentIdempotencyKey } from './training-assignment-state';

describe('training assignment state', () => {
  it('keeps one idempotency key across retries and rotates it for a changed intent', () => {
    let sequence = 0;
    const keys = new IntentIdempotencyKey(() => `key-${++sequence}`);
    const request = { templateVersionId: 'version-1', startDate: '2026-08-21' };

    expect(keys.forPayload(request)).toBe('key-1');
    expect(keys.forPayload({ ...request })).toBe('key-1');
    expect(keys.forPayload({ ...request, startDate: '2026-08-22' })).toBe('key-2');

    keys.complete();
    expect(keys.forPayload(request)).toBe('key-3');
  });

  it('preserves a manual value when the assignment unit changes', () => {
    const changed = changeWorkingMaxUnit(
      [{ value: 140, unit: 'Kilogram' as const, sourceRecordId: 'record-1' }],
      'Pound',
    );

    expect(changed).toEqual([{ value: 140, unit: 'Pound', sourceRecordId: null }]);
  });
});
