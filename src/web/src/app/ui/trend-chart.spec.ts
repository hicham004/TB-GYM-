import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { settle } from '../../testing/dom';
import { TrendChart, type TrendPoint, type TrendWeek } from './trend-chart';

function day(date: string, value: number | null, estimate: number | null): TrendPoint {
  return { date, value, estimate };
}

async function render(
  points: TrendPoint[],
  options: { weeks?: TrendWeek[]; audience?: 'self' | 'coach' } = {},
): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(TrendChart);
  fixture.componentRef.setInput('points', points);
  fixture.componentRef.setInput('weeks', options.weeks ?? []);
  fixture.componentRef.setInput('unit', 'kg');
  if (options.audience) fixture.componentRef.setInput('audience', options.audience);
  await settle(fixture);
  return fixture.nativeElement as HTMLElement;
}

const read = (host: HTMLElement) => (host.textContent ?? '').replace(/\s+/g, ' ');
const texts = (host: HTMLElement, selector: string) =>
  Array.from(host.querySelectorAll(selector)).map((item) => item.textContent?.trim());
const legend = (host: HTMLElement) => texts(host, '.legend span');

describe('TrendChart', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows two weigh-ins as readings in a compact chart, and asks for one more', async () => {
    const host = await render([day('2026-09-21', 82, 82), day('2026-09-28', 81.5, 81.6)]);

    expect(host.querySelector('.plot')?.classList.contains('compact')).toBe(true);
    expect(texts(host, '.reading-date')).toEqual(['21 Sep', '28 Sep']);
    expect(texts(host, '.reading-value')).toEqual(['82 kg', '81.5 kg']);
    expect(host.querySelector('.change')?.textContent?.trim()).toBe('−0.5 kg');
    expect(host.querySelector('.hint')?.textContent?.trim()).toBe(
      'Log 1 more weigh-in to see your trend line.',
    );
    // A trend and weekly averages are not claimed for two points, so only the weigh-in is keyed.
    expect(legend(host)).toEqual(['Weigh-in']);
    expect(host.querySelectorAll('.week-band')).toHaveLength(0);
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('Bodyweight readings');
  });

  it('says how many more a single weigh-in needs, with no change to report', async () => {
    const host = await render([day('2026-09-28', 81.5, null)]);

    expect(host.querySelector('.hint')?.textContent?.trim()).toBe(
      'Log 2 more weigh-ins to see your trend line.',
    );
    expect(host.querySelector('.readings')).toBeNull();
    expect(host.querySelectorAll('.observation')).toHaveLength(1);
  });

  it('tells a coach what is needed instead of asking them to log', async () => {
    const host = await render([day('2026-09-28', 81.5, null)], { audience: 'coach' });

    expect(host.querySelector('.hint')?.textContent?.trim()).toBe(
      'A trend line needs at least 3 weigh-ins.',
    );
  });

  it('shows no sign beside an unchanged weight', async () => {
    const host = await render([day('2026-09-21', 82.3, null), day('2026-09-28', 82.3, null)]);

    expect(host.querySelector('.change')?.textContent?.trim()).toBe('0 kg');
  });

  it('draws the full chart from three weigh-ins, with every series keyed', async () => {
    const host = await render(
      [day('2026-09-21', 82, 82), day('2026-09-24', 81.8, 81.9), day('2026-09-28', 81.5, 81.7)],
      { weeks: [{ from: '2026-09-21', toExclusive: '2026-09-28', mean: 81.9, observedDays: 2 }] },
    );

    expect(host.querySelector('.plot')?.classList.contains('compact')).toBe(false);
    expect(host.querySelector('.hint')).toBeNull();
    expect(host.querySelector('.readings')).toBeNull();
    expect(legend(host)).toEqual(['Trend estimate', 'Weekly average', 'Weigh-in']);
    expect(host.querySelectorAll('.week-band')).toHaveLength(1);
    expect(host.querySelectorAll('.observation')).toHaveLength(3);
  });

  it('places each weigh-in as a share of the chart, so a stretched chart never squashes a dot', async () => {
    const host = await render([day('2026-09-21', 82, null), day('2026-09-28', 81, null)]);

    const dots = Array.from(host.querySelectorAll<HTMLElement>('.observation'));
    expect(dots).toHaveLength(2);
    // The first and last day sit 16 and 704 of the 720-wide space in from the edge.
    expect(parseFloat(dots[0].style.left)).toBeCloseTo((100 * 16) / 720, 1);
    expect(parseFloat(dots[1].style.left)).toBeCloseTo((100 * 704) / 720, 1);
    // Plain elements: a stretched SVG circle would be an ellipse.
    expect(host.querySelectorAll('svg circle')).toHaveLength(0);
  });

  it('keeps the empty message when nothing was recorded', async () => {
    const host = await render([day('2026-09-28', null, null)]);

    expect(read(host)).toContain('Log a few weights to see your trend.');
    expect(host.querySelector('.plot')).toBeNull();
  });
});
