import { describe, expect, it } from 'vitest';
import { perSideWords, PLATE_SETS, PLATE_STRATEGY, splitPlates, stepLoadable } from './plates';

const kg = PLATE_SETS.Kilogram;
const lb = PLATE_SETS.Pound;

describe('plates-greedy-v1 (motion plan W11)', () => {
  it('is the named, versioned strategy', () => {
    expect(PLATE_STRATEGY).toBe('plates-greedy-v1');
    expect(splitPlates(100, kg).strategy).toBe('plates-greedy-v1');
  });

  it('loads 100 kg as 20 and 20 per side on the 20 kg bar', () => {
    const split = splitPlates(100, kg);
    expect(split.state).toBe('loadable');
    expect(split.bar).toBe(20);
    expect(split.perSide).toEqual([20, 20]);
    expect(split.below).toBe(100);
    expect(split.above).toBe(100);
  });

  it('loads 82.5 kg as 20, 10 and 1.25 per side', () => {
    expect(splitPlates(82.5, kg).perSide).toEqual([20, 10, 1.25]);
  });

  it("loads Maya's 52.5 kg as 15 and 1.25 per side, and 55 as 15 and 2.5", () => {
    expect(splitPlates(52.5, kg).perSide).toEqual([15, 1.25]);
    expect(splitPlates(55, kg).perSide).toEqual([15, 2.5]);
  });

  it('loads 135 lb as 45 per side on the 45 lb bar', () => {
    const split = splitPlates(135, lb);
    expect(split.state).toBe('loadable');
    expect(split.bar).toBe(45);
    expect(split.perSide).toEqual([45]);
  });

  it('says 21 kg is not loadable, between 20 and 22.5', () => {
    const split = splitPlates(21, kg);
    expect(split.state).toBe('not-loadable');
    expect(split.below).toBe(20);
    expect(split.above).toBe(22.5);
    // The bar shows the nearest weight below: the bar alone.
    expect(split.perSide).toEqual([]);
  });

  it('says 15 kg is lighter than the 20 kg bar, and loads it on the 15 kg bar', () => {
    const heavy = splitPlates(15, kg);
    expect(heavy.state).toBe('lighter-than-bar');
    expect(heavy.perSide).toEqual([]);
    expect(heavy.below).toBeNull();
    expect(heavy.above).toBe(20);
    const light = splitPlates(15, kg, 15);
    expect(light.state).toBe('loadable');
    expect(light.perSide).toEqual([]);
  });

  it('loads the bar alone as no plates', () => {
    expect(splitPlates(20, kg).perSide).toEqual([]);
    expect(perSideWords([])).toBe('none');
    expect(perSideWords([15, 1.25])).toBe('15, 1.25');
  });

  it('keeps 1.25 and 2.5 exact: no plate is lost to floating point', () => {
    expect(splitPlates(23.75, kg).state).toBe('not-loadable');
    expect(splitPlates(22.5, kg).perSide).toEqual([1.25]);
    expect(splitPlates(27.5, kg).perSide).toEqual([2.5, 1.25]);
    expect(splitPlates(147.5, kg).perSide).toEqual([20, 20, 20, 2.5, 1.25]);
    expect(splitPlates(137.5, kg, 15).perSide).toEqual([20, 20, 20, 1.25]);
  });

  it('puts a 25 on only where it saves a plate', () => {
    expect(splitPlates(120, kg).perSide).toEqual([25, 25]);
    expect(splitPlates(110, kg).perSide).toEqual([25, 20]);
    expect(splitPlates(70, kg).perSide).toEqual([25]);
    expect(splitPlates(80, kg).perSide).toEqual([20, 10]);
    expect(splitPlates(140, kg).perSide).toEqual([20, 20, 20]);
  });

  it('loads pounds in their own plates, never converted', () => {
    expect(splitPlates(225, lb).perSide).toEqual([45, 45]);
    expect(splitPlates(185, lb).perSide).toEqual([45, 25]);
    expect(splitPlates(130, lb).perSide).toEqual([35, 5, 2.5]);
    expect(splitPlates(132.5, lb).state).toBe('not-loadable');
    const odd = splitPlates(136, lb);
    expect(odd.state).toBe('not-loadable');
    expect(odd.below).toBe(135);
    expect(odd.above).toBe(140);
    expect(splitPlates(40, lb).state).toBe('lighter-than-bar');
    expect(splitPlates(40, lb, 35).perSide).toEqual([2.5]);
  });

  it('steps to the next loadable weight either way', () => {
    expect(stepLoadable(52.5, kg, 20, 1)).toBe(55);
    expect(stepLoadable(52.5, kg, 20, -1)).toBe(50);
    expect(stepLoadable(135, lb, 45, 1)).toBe(140);
    expect(stepLoadable(135, lb, 45, -1)).toBe(130);
    // A weight no plate makes steps to the nearest loadable one.
    expect(stepLoadable(21, kg, 20, 1)).toBe(22.5);
    expect(stepLoadable(21, kg, 20, -1)).toBe(20);
    // The bar is the floor: nothing lighter is loadable, and + from under it gives the bar.
    expect(stepLoadable(20, kg, 20, -1)).toBeNull();
    expect(stepLoadable(15, kg, 20, -1)).toBeNull();
    expect(stepLoadable(15, kg, 20, 1)).toBe(20);
    expect(stepLoadable(15, kg, 15, 1)).toBe(17.5);
  });
});
