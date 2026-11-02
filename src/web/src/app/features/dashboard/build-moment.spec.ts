import { beforeEach, describe, expect, it } from 'vitest';
import { fakeMotion } from '../../../testing/motion-fake';
import { EASE, type Motion } from '../../core/motion/motion';
import { BUILD_MOMENT, buildCoachToday, claimFirstBuild, resetBuildMoment } from './build-moment';

/** Coach Today as drawn after its first read, at a desk's width or a phone's. */
function page(phone: boolean): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = `
    <section class="coach-today">
      <header class="top"><h1>Good morning, Lea.</h1><p class="needs">2 clients</p></header>
      <p class="tb-visually-hidden" role="status"></p>
      <div class="columns">
        <section class="panel queue"><ul class="rows"><li class="need">Maya</li><li class="need">Sara</li></ul></section>
        ${phone ? '<app-disclosure class="feed-fold panel">What your clients did</app-disclosure>' : ''}
        <section class="panel month">This month</section>
      </div>
      <div class="plans">
        <section class="panel plan-list">Plans ending soon</section>
        <section class="panel plan-list">Ended, not renewed</section>
      </div>
      ${phone ? '' : '<section class="panel feed"><ul class="rows"><li class="event">Rami</li></ul></section>'}
    </section>`;
  return host;
}

function risen(motion: ReturnType<typeof fakeMotion>): [string[], unknown] {
  const [parts, options] = motion.rise.mock.calls[0] as unknown as [NodeListOf<Element>, unknown];
  return [
    Array.from(parts, (element) => `${element.tagName.toLowerCase()}.${element.className}`),
    options,
  ];
}

describe('Coach Today builds itself (W12)', () => {
  beforeEach(() => resetBuildMoment());

  it('rises the panels in reading order with the row’s numbers, the rows riding in their panel', () => {
    const motion = fakeMotion({ allowed: true });
    buildCoachToday(page(false), motion as unknown as Motion);
    const [parts, options] = risen(motion);
    expect(parts).toEqual([
      'section.panel queue',
      'section.panel month',
      'section.panel plan-list',
      'section.panel plan-list',
      'section.panel feed',
    ]);
    expect(options).toEqual({
      moment: BUILD_MOMENT,
      from: 18,
      duration: 320,
      stagger: 40,
      easing: EASE.outStrong,
    });
  });

  it('on a phone rises the feed’s fold where it sits, under Needs you', () => {
    const motion = fakeMotion({ allowed: true });
    buildCoachToday(page(true), motion as unknown as Motion);
    expect(risen(motion)[0]).toEqual([
      'section.panel queue',
      'app-disclosure.feed-fold panel',
      'section.panel month',
      'section.panel plan-list',
      'section.panel plan-list',
    ]);
  });

  it('rises the first client’s card alone in an empty coaching space', () => {
    const motion = fakeMotion({ allowed: true });
    const host = document.createElement('div');
    host.innerHTML =
      '<section class="coach-today"><header class="top"></header><app-empty-state class="first-client">Ready</app-empty-state></section>';
    buildCoachToday(host, motion as unknown as Motion);
    expect(risen(motion)[0]).toEqual(['app-empty-state.first-client']);
  });

  it('builds once per app load, until a test resets it', () => {
    expect(claimFirstBuild()).toBe(true);
    expect(claimFirstBuild()).toBe(false);
    expect(claimFirstBuild()).toBe(false);
    resetBuildMoment();
    expect(claimFirstBuild()).toBe(true);
  });
});
