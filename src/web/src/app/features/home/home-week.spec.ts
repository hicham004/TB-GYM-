import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { HomeWeek, WEEK_MOMENTS } from './home-week';
import { GSAP_LOADER, WIDE_STORY } from './home-week-motion';

interface FakeTrigger {
  readonly config: { trigger: Element; onToggle(self: { isActive: boolean }): void };
  readonly kill: ReturnType<typeof vi.fn>;
}

function fakeGsap() {
  const triggers: FakeTrigger[] = [];
  const media = {
    add: vi.fn((_query: string, setUp: () => (() => void) | void) => setUp()),
    revert: vi.fn(),
  };
  return {
    triggers,
    media,
    modules: {
      gsap: { registerPlugin: vi.fn(), matchMedia: () => media, to: vi.fn() },
      ScrollTrigger: {
        create: vi.fn((config: FakeTrigger['config']) => {
          const trigger = { config, kill: vi.fn() };
          triggers.push(trigger);
          return trigger;
        }),
        refresh: vi.fn(),
      },
    },
  };
}

async function render(wide: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({ matches: wide && media === WIDE_STORY, media })),
  );
  const fake = fakeGsap();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: GSAP_LOADER, useValue: async () => fake.modules }],
  });
  const fixture = TestBed.createComponent(HomeWeek);
  await settle(fixture);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, fake };
}

const activeCoach = (host: HTMLElement) =>
  query<HTMLImageElement>(host, '.stage__coach picture.is-active img').getAttribute('src');

describe('HomeWeek', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tells the week in words a screen reader hears, with the real screens beside them', async () => {
    const { host } = await render(false);

    expect(query(host, 'h1').textContent).toContain('You plan it. They lift it.');
    const chapters = host.querySelectorAll('.chapter');
    expect(chapters).toHaveLength(WEEK_MOMENTS.length - 1);
    expect(chapters[1].textContent).toContain('She lifts it.');
    expect(chapters[1].textContent).toContain('finished Lower A in 41 minutes');
    // Each moment's two pictures, as AVIF with a WebP fallback, in the chapter and on the stage.
    expect(chapters[1].querySelector('source')?.getAttribute('srcset')).toBe(
      '/images/home/train-phone-480.avif 480w, /images/home/train-phone.avif 720w',
    );
    expect(chapters[1].querySelector('img')?.getAttribute('src')).toBe(
      '/images/home/train-phone.webp',
    );
    expect(host.querySelectorAll('.stage__coach picture')).toHaveLength(WEEK_MOMENTS.length);
    expect(host.querySelectorAll('.stage__phone picture')).toHaveLength(WEEK_MOMENTS.length);
    // The stage is decorative: the words carry the story, so it must hold nothing to focus.
    expect(query(host, '.week__stage').getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelectorAll('.week__stage a, .week__stage button')).toHaveLength(0);
  });

  it('starts on Monday morning with the hero pictures, each phone in two sizes, nothing fetched ahead of the words', async () => {
    const { host } = await render(false);

    expect(query(host, '#week').getAttribute('data-moment')).toBe('hero');
    expect(activeCoach(host)).toBe('/images/home/hero-coach.webp');
    expect(query(host, '.stage__number').textContent).toContain('Lower A');
    // On a phone the copy owns the first screen, so every picture waits for the reader (lazy);
    // the stage's first pair is in view on a wide screen and comes from index.html's preload.
    for (const img of Array.from(host.querySelectorAll<HTMLImageElement>('img'))) {
      expect(img.getAttribute('loading'), img.getAttribute('src') ?? '').toBe('lazy');
    }
    const heroPhone = query<HTMLImageElement>(host, '.screens--hero .screens__phone img');
    expect(heroPhone.getAttribute('srcset')).toBe(
      '/images/home/hero-phone-480.webp 480w, /images/home/hero-phone.webp 720w',
    );
    expect(heroPhone.getAttribute('sizes')).toBe('250px');
    expect(
      query<HTMLImageElement>(host, '.stage__coach picture.is-active img').getAttribute(
        'fetchpriority',
      ),
    ).toBe('high');
  });

  it('without the scroll story the page still says so, and loads no motion library', async () => {
    const { host, fake } = await render(false);

    expect(query(host, '#week').getAttribute('data-motion')).toBe('off');
    expect(fake.triggers).toHaveLength(0);
  });

  it('on a wide screen the stage follows the chapter at the line', async () => {
    const { fixture, host, fake } = await render(true);
    expect(query(host, '#week').getAttribute('data-motion')).toBe('running');
    // The hero's copy first, then one trigger per chapter, in the page's order.
    expect(fake.triggers).toHaveLength(WEEK_MOMENTS.length);
    expect(fake.triggers[0].config.trigger).toBe(query(host, '.hero'));
    expect(fake.triggers[3].config.trigger).toBe(query(host, '[data-chapter="eat"]'));

    fake.triggers[3].config.onToggle({ isActive: true });
    await settle(fixture);

    expect(query(host, '#week').getAttribute('data-moment')).toBe('eat');
    expect(activeCoach(host)).toBe('/images/home/eat-coach.webp');
    expect(query(host, '.stage__number').textContent).toContain('2,156 kcal');
    expect(query(host, '.stage__when').textContent).toContain('Tuesday');
    expect(query(host, '[data-chapter="eat"]').classList).toContain('is-current');
    expect(query(host, '[data-chapter="train"]').classList).not.toContain('is-current');
    expect(query(host, '.stage__days li.is-on').textContent).toBe('Tue');
  });

  it('leaving the page reverts everything the story set up', async () => {
    const { fixture, fake } = await render(true);

    fixture.destroy();

    expect(fake.media.revert).toHaveBeenCalledTimes(1);
  });
});
