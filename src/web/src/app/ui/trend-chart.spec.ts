import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { query, settle } from '../../testing/dom';
import { TrendChart, type TrendPoint, type TrendWeek } from './trend-chart';

function day(date: string, value: number | null, estimate: number | null): TrendPoint {
  return { date, value, estimate };
}

async function render(
  points: TrendPoint[],
  options: { weeks?: TrendWeek[]; audience?: 'self' | 'coach' } = {},
): Promise<HTMLElement> {
  return (await mount(points, options)).host;
}

async function mount(
  points: TrendPoint[],
  options: { weeks?: TrendWeek[]; audience?: 'self' | 'coach' } = {},
): Promise<{ host: HTMLElement; flush: () => Promise<void> }> {
  const fixture = TestBed.createComponent(TrendChart);
  fixture.componentRef.setInput('points', points);
  fixture.componentRef.setInput('weeks', options.weeks ?? []);
  fixture.componentRef.setInput('unit', 'kg');
  if (options.audience) fixture.componentRef.setInput('audience', options.audience);
  await settle(fixture);
  return { host: fixture.nativeElement as HTMLElement, flush: () => settle(fixture) };
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
    // The readings line (W13): the first weigh-in, the change and the latest, over the full chart too.
    expect(texts(host, '.reading-date')).toEqual(['21 Sep', '28 Sep']);
    expect(texts(host, '.reading-value')).toEqual(['82 kg', '81.5 kg']);
    expect(host.querySelector('.change')?.textContent?.trim()).toBe('−0.5 kg');
    expect(legend(host)).toEqual(['Trend estimate', 'Weekly average', 'Weigh-in']);
    expect(host.querySelectorAll('.week-band')).toHaveLength(1);
    expect(host.querySelectorAll('.observation')).toHaveLength(3);
    // The soft area under the trend runs down to the plot's floor at both ends.
    expect(host.querySelector('.trend-area')?.getAttribute('d')).toMatch(
      /^M16\.0 240 L16\.0 .* L704\.0 240 Z$/,
    );
  });

  /**
   * The scrub (motion plan W13): a finger, the mouse or the arrow keys rest on the nearest day and
   * the readings' last reading becomes that day's; release returns to the latest.
   */
  describe('the scrub (W13)', () => {
    const points = [
      day('2026-09-21', 82, 82),
      day('2026-09-22', null, 81.95),
      day('2026-09-24', 81.8, 81.9),
      day('2026-09-28', 81.5, 81.7),
    ];
    const slider = (host: HTMLElement) => query<HTMLElement>(host, '.scrub');
    const lastReading = (host: HTMLElement) =>
      texts(host, '.readings .end > span').join(' · ').replace(/\s+/g, ' ');
    const key = (host: HTMLElement, name: string) => {
      const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
      slider(host).dispatchEvent(event);
      return event.defaultPrevented;
    };
    function pointer(host: HTMLElement, type: string, clientX: number, pointerId = 1) {
      slider(host).dispatchEvent(
        new PointerEvent(type, { clientX, pointerId, button: 0, bubbles: true, cancelable: true }),
      );
    }
    /** The slider is 720 px wide from x = 100, so a client x maps onto the chart's own units. */
    function widen(host: HTMLElement) {
      vi.spyOn(slider(host), 'getBoundingClientRect').mockReturnValue({
        left: 100,
        width: 720,
        top: 0,
        height: 224,
        right: 820,
        bottom: 224,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      });
    }

    it('is a slider over the plot that rests on the latest weigh-in, the chart keeping its name', async () => {
      const host = await render(points);

      const control = slider(host);
      expect(control.getAttribute('role')).toBe('slider');
      expect(control.getAttribute('aria-label')).toBe('Weigh-in to read');
      expect(control.getAttribute('aria-valuemin')).toBe('0');
      expect(control.getAttribute('aria-valuemax')).toBe('3');
      expect(control.getAttribute('aria-valuenow')).toBe('3');
      expect(control.getAttribute('aria-valuetext')).toBe('Mon 28 Sep · 81.5 kg');
      expect(host.querySelector('svg')?.getAttribute('role')).toBe('img');
      expect(host.querySelector('.cursor')).toBeNull();
      expect(host.querySelector('.guide')).toBeNull();
    });

    it('steps a day with the arrow keys and reads the trend where no weigh-in was logged', async () => {
      const { host, flush } = await mount(points);

      expect(key(host, 'ArrowLeft')).toBe(true);
      await flush();
      expect(slider(host).getAttribute('aria-valuenow')).toBe('2');
      expect(slider(host).getAttribute('aria-valuetext')).toBe('Thu 24 Sep · 81.8 kg');
      expect(lastReading(host)).toBe('Thu 24 Sep · 81.8 kg');
      expect(host.querySelector('.change')?.textContent?.trim()).toBe('−0.2 kg');
      // The cursor and the guide sit on that day.
      const cursor = host.querySelector<HTMLElement>('.cursor')!;
      expect(parseFloat(cursor.style.left)).toBeCloseTo((100 * (16 + 688 * (2 / 3))) / 720, 1);
      expect(host.querySelector('.guide')?.getAttribute('x1')).toBe(String(16 + (688 * 2) / 3));

      key(host, 'ArrowLeft');
      await flush();
      expect(slider(host).getAttribute('aria-valuetext')).toBe('Tue 22 Sep · trend 81.95 kg');
      expect(lastReading(host)).toBe('Tue 22 Sep · trend 81.95 kg');

      key(host, 'Home');
      await flush();
      expect(slider(host).getAttribute('aria-valuetext')).toBe('Mon 21 Sep · 82 kg');
      expect(host.querySelector('.change')?.textContent?.trim()).toBe('0 kg');

      key(host, 'End');
      await flush();
      expect(slider(host).getAttribute('aria-valuenow')).toBe('3');
      expect(host.querySelector('.cursor')).not.toBeNull();
      // A key the slider does not take is left to the page.
      expect(key(host, 'Tab')).toBe(false);

      slider(host).dispatchEvent(new FocusEvent('blur'));
      await flush();
      expect(host.querySelector('.cursor')).toBeNull();
      expect(lastReading(host)).toBe('28 Sep · 81.5 kg');
    });

    it('follows a finger or the mouse to the nearest day and lets go to the latest', async () => {
      const { host, flush } = await mount(points);
      widen(host);

      // Down 300 units in: nearest to the second day (245 of 720), the trend's estimate.
      pointer(host, 'pointerdown', 400);
      await flush();
      expect(slider(host).getAttribute('aria-valuenow')).toBe('1');
      expect(lastReading(host)).toBe('Tue 22 Sep · trend 81.95 kg');

      pointer(host, 'pointermove', 790);
      await flush();
      expect(slider(host).getAttribute('aria-valuenow')).toBe('3');
      // Another pointer's move is not this scrub's.
      pointer(host, 'pointermove', 100, 2);
      await flush();
      expect(slider(host).getAttribute('aria-valuenow')).toBe('3');

      pointer(host, 'pointerup', 790);
      await flush();
      expect(host.querySelector('.cursor')).toBeNull();
      expect(lastReading(host)).toBe('28 Sep · 81.5 kg');

      // The page taking the touch to scroll lets go too.
      pointer(host, 'pointerdown', 100);
      pointer(host, 'pointercancel', 100);
      await flush();
      expect(host.querySelector('.cursor')).toBeNull();
    });

    it('scrubs between two readings in the compact chart, and offers no slider for one', async () => {
      const { host, flush } = await mount([
        day('2026-09-21', 82, 82),
        day('2026-09-28', 81.5, 81.6),
      ]);
      expect(slider(host).getAttribute('aria-valuemax')).toBe('1');
      key(host, 'Home');
      await flush();
      expect(lastReading(host)).toBe('Mon 21 Sep · 82 kg');
      expect(host.querySelector('.change')?.textContent?.trim()).toBe('0 kg');

      const single = await render([day('2026-09-28', 81.5, null)]);
      expect(single.querySelector('.scrub')).toBeNull();
    });
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
