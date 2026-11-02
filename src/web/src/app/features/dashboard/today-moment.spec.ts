import { describe, expect, it } from 'vitest';
import { fakeMotion } from '../../../testing/motion-fake';
import type { Motion } from '../../core/motion/motion';
import { riseTodaySteps, TODAY_MOMENT } from './today-moment';

function page(): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = `
    <div class="today">
      <header class="today-header">Today, Maya.</header>
      <section class="today-week">This week</section>
      <section class="today-card">Lower A</section>
      <div class="today-below">
        <app-today-renewal><section class="today-card">Plan</section></app-today-renewal>
        <app-today-also>Also today</app-today-also>
        <app-today-coach-message>Lea</app-today-coach-message>
      </div>
    </div>`;
  return host;
}

describe('Today’s first draw (W9)', () => {
  it('rises the greeting alone, then the week and the card, then the tiles, as W9 and in reading order', () => {
    const motion = fakeMotion({ allowed: true });
    const host = page();
    riseTodaySteps(host, ['greeting'], motion as unknown as Motion);
    riseTodaySteps(host, ['core', 'below'], motion as unknown as Motion);
    const [greeting, rest] = motion.rise.mock.calls as unknown as [
      [NodeListOf<Element>, { moment: string; stagger: number; from: number; duration: number }],
      [NodeListOf<Element>],
    ];
    expect(Array.from(greeting[0]).map((element) => element.className)).toEqual(['today-header']);
    expect(greeting[1]).toEqual({ moment: TODAY_MOMENT, from: 14, duration: 450, stagger: 50 });
    expect(
      Array.from(rest[0]).map((element) => element.tagName.toLowerCase() + '.' + element.className),
    ).toEqual([
      'section.today-week',
      'section.today-card',
      'section.today-card',
      'app-today-also.',
      'app-today-coach-message.',
    ]);
  });

  it('leaves the renewal’s inline host alone and moves its card, wherever it sits', () => {
    const motion = fakeMotion({ allowed: true });
    const host = page();
    host.querySelector('.today-below')!.remove();
    host.querySelector('.today > .today-card')!.outerHTML =
      '<app-today-renewal><section class="today-card">Plan ended</section></app-today-renewal>';
    riseTodaySteps(host, ['core'], motion as unknown as Motion);
    const [parts] = motion.rise.mock.calls[0] as unknown as [NodeListOf<Element>];
    expect(Array.from(parts).map((element) => element.textContent)).toEqual([
      'This week',
      'Plan ended',
    ]);
  });
});
