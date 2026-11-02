import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { settle } from '../../testing/dom';
import { BarChart, type ChartBar } from './bar-chart';

async function render(bars: ChartBar[]): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(BarChart);
  fixture.componentRef.setInput('bars', bars);
  fixture.componentRef.setInput('label', 'Completed workouts compared with scheduled workouts');
  await settle(fixture);
  return fixture.nativeElement as HTMLElement;
}

describe('BarChart', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('draws each bar as its share of the total, with the counts beside it', async () => {
    const host = await render([
      { label: 'Last 7 days', value: 3, total: 4 },
      { label: 'This period', value: 10, total: 12 },
    ]);

    const bars = Array.from(host.querySelectorAll<HTMLElement>('.track i'));
    expect(bars.map((bar) => parseFloat(bar.style.width))).toEqual([75, (100 * 10) / 12]);
    expect(
      Array.from(host.querySelectorAll('.bar-row strong'), (strong) => strong.textContent?.trim()),
    ).toEqual(['3 / 4', '10 / 12']);
    expect(host.querySelector('.bars')?.getAttribute('aria-label')).toBe(
      'Completed workouts compared with scheduled workouts',
    );
    // The bars grow from their start on the first draw (W13), so each scales from there.
    expect(getComputedStyle(bars[0]).transformOrigin).toBe('0 50%');
  });

  it('draws nothing of a bar with no sessions scheduled, rather than dividing by zero', async () => {
    const host = await render([{ label: 'This period', value: 0, total: 0 }]);

    expect(host.querySelector<HTMLElement>('.track i')?.style.width).toBe('0%');
    expect(host.querySelector('.bar-row strong')?.textContent?.trim()).toBe('0 / 0');
  });
});
