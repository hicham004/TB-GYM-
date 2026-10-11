import type { ActivatedRouteSnapshot, Data } from '@angular/router';
import { describe, expect, it } from 'vitest';
import {
  FULL_SCREEN,
  HOUSE_BRAND,
  REDESIGNED,
  REDESIGNED_FOR_STAFF,
  redesignedFor,
  wantsFullScreen,
  wantsHouseBrand,
} from './redesigned-route';

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

describe('wantsHouseBrand', () => {
  it('keeps TB Gym’s own brand on a marked route or below one', () => {
    expect(wantsHouseBrand(chain({}, HOUSE_BRAND))).toBe(true);
    expect(wantsHouseBrand(chain(HOUSE_BRAND, {}))).toBe(true);
    expect(wantsHouseBrand(chain({}, REDESIGNED))).toBe(false);
  });
});

describe('wantsFullScreen', () => {
  it('fills the screen on a marked route or below one, and nowhere else', () => {
    expect(wantsFullScreen(chain({}, FULL_SCREEN))).toBe(true);
    expect(wantsFullScreen(chain(FULL_SCREEN, {}))).toBe(true);
    expect(wantsFullScreen(chain({}, REDESIGNED))).toBe(false);
  });
});
