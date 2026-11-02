import { afterEach, describe, expect, it, vi } from 'vitest';
import { newIdempotencyKey } from './idempotency-key';

const VERSION_4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newIdempotencyKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('takes the browser’s UUID where it gives one', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '11111111-2222-4333-8444-555555555555',
    );
    expect(newIdempotencyKey()).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('lays out a version 4 UUID from random bytes where randomUUID is missing (a plain http address)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array<ArrayBuffer>) => real.getRandomValues(array),
    });
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();
    expect(first).toMatch(VERSION_4_UUID);
    expect(second).toMatch(VERSION_4_UUID);
    expect(second).not.toBe(first);
  });

  it('still answers a key with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newIdempotencyKey()).toMatch(VERSION_4_UUID);
  });
});
