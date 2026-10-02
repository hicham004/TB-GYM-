import type { ActivatedRouteSnapshot, Data } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { REDESIGNED, REDESIGNED_FOR_STAFF, redesignedFor } from './redesigned-route';

function chain(...data: Data[]): ActivatedRouteSnapshot {
  let child: ActivatedRouteSnapshot | null = null;
  for (const item of [...data].reverse()) {
    child = { data: item, firstChild: child } as unknown as ActivatedRouteSnapshot;
  }
  return child!;
}

describe('redesignedFor', () => {
  it('finds the marker on the active route or any route above it', () => {
    expect(redesignedFor(chain({}, REDESIGNED))).toBe('everyone');
    expect(redesignedFor(chain(REDESIGNED, {}))).toBe('everyone');
    expect(redesignedFor(chain({}, REDESIGNED_FOR_STAFF))).toBe('staff');
    expect(redesignedFor(chain({}, {}))).toBeNull();
  });
});
