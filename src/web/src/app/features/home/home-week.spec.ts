import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { TEST_PLACEHOLDERS } from '../../../testing/placeholder-fixtures';
import { WEEK_STAGES } from './home-content';
import { GSAP_LOADER, HomeMotion, WIDE_STORY } from './home-motion';
import { HOME_PLACEHOLDERS, type PlaceholderSet } from './home-placeholder';
import { HomeWeek } from './home-week';

function fakeGsap() {
  const media = {
    add: vi.fn((_query: string, setUp: () => (() => void) | void) => setUp()),
    revert: vi.fn(),
  };
  return {
    media,
    modules: {
      gsap: { registerPlugin: vi.fn(), matchMedia: () => media, to: vi.fn(), from: vi.fn() },
      ScrollTrigger: { create: vi.fn(() => ({ kill: vi.fn() })), refresh: vi.fn() },
      Flip: { getState: vi.fn(() => ({})), from: vi.fn() },
      SplitText: { create: vi.fn(() => ({ revert: vi.fn() })) },
    },
  };
}

async function render(wide: boolean, placeholders: PlaceholderSet | null = null) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({ matches: wide && media === WIDE_STORY, media })),
  );
  const fake = fakeGsap();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      HomeMotion,
      { provide: GSAP_LOADER, useValue: async () => fake.modules },
      { provide: HOME_PLACEHOLDERS, useValue: placeholders },
    ],
  });
  const fixture = TestBed.createComponent(HomeWeek);
  await settle(fixture);
  // The page starts the motion with this section's targets once everything is rendered.
  const motion = TestBed.inject(HomeMotion);
  await motion.start({
    ...fixture.componentInstance.motionTargets(),
    titles: fixture.componentInstance.titles(),
  });
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, fake, motion };
}

describe('HomeWeek', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tells the four stages in words a screen reader hears, each with its own pictures and numeral', async () => {
    const { host } = await render(false);

    const stages = host.querySelectorAll('.stage');
    expect(stages).toHaveLength(WEEK_STAGES.length);
    expect(stages[1].querySelector('h2')?.textContent).toBe('They lift it.');
    expect(stages[1].textContent).toContain('finished Lower A in 41 minutes');
    expect(stages[1].querySelector('.stage__numeral b')?.textContent).toBe('52.5');
    // Each stage's own phone, as AVIF with a WebP fallback at three widths, lazy.
    const phone = stages[1].querySelector<HTMLImageElement>('.stage__own-phone img');
    expect(phone?.getAttribute('srcset')).toBe(
      '/images/home/client-player-460.webp 460w, /images/home/client-player-600.webp 600w, /images/home/client-player-760.webp 760w, /images/home/client-player-1140.webp 1140w',
    );
    expect(phone?.getAttribute('loading')).toBe('lazy');
    expect(stages[1].querySelector('.stage__own-phone source')?.getAttribute('type')).toBe(
      'image/avif',
    );
    // The panel is decorative: the words carry the story, so it must hold nothing to focus.
    const panel = query(host, '.week__panel');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.querySelectorAll('a, button')).toHaveLength(0);
    expect(panel.querySelectorAll('.panel__slot--window .panel__picture')).toHaveLength(4);
    expect(panel.querySelectorAll('.panel__slot--phone .panel__picture')).toHaveLength(4);
    // The public build draws no stand-in anywhere in the week.
    expect(host.querySelectorAll('[data-placeholder]')).toHaveLength(0);
    expect(panel.classList).not.toContain('week__panel--photo');
  });

  it('on the private build gives Monday evening and Sunday their stand-ins, in the panel and in each stage’s own scene', async () => {
    const { host } = await render(false, TEST_PLACEHOLDERS);

    const panel = query(host, '.week__panel');
    expect(panel.classList).toContain('week__panel--photo');
    const panelPhotos = Array.from(panel.querySelectorAll('.panel__photo'));
    expect(panelPhotos.map((photo) => photo.getAttribute('data-stage-id'))).toEqual([
      'train',
      'see',
    ]);
    expect(panelPhotos.map((photo) => photo.getAttribute('data-placeholder'))).toEqual([
      'train',
      'talk',
    ]);
    // The photographs sit under the slots, so the devices stay lifted out of them.
    expect(panel.children[0]).toBe(panelPhotos[0]);
    expect(panel.querySelector('.panel__scrim')).not.toBeNull();
    expect(panel.querySelectorAll('a, button')).toHaveLength(0);

    const own = (stage: string) => query(host, `[data-stage-id="${stage}"] .stage__own`);
    expect(own('train').classList).toContain('stage__own--photo');
    expect(own('train').querySelector('.stage__own-photo img')?.getAttribute('src')).toBe(
      '/placeholders/train.jpg',
    );
    expect(own('see').querySelector('.stage__own-photo .missing')).not.toBeNull();
    expect(own('plan').classList).not.toContain('stage__own--photo');
    expect(own('plan').querySelector('.stage__own-photo')).toBeNull();
    expect(own('checkin').querySelector('.stage__own-photo')).toBeNull();
    // The scene holds the photograph and the devices; the caption stays under it.
    const scene = query(own('train'), '.stage__own-scene');
    expect(scene.querySelector('.stage__own-phone')).not.toBeNull();
    expect(scene.querySelector('.stage__own-window')).not.toBeNull();
    expect(scene.querySelector('figcaption')).toBeNull();
    expect(own('train').querySelector('figcaption')?.textContent).toBe('Shown with sample data');
  });

  it('starts on Monday with the first composition, and nothing fetched ahead of the words', async () => {
    const { host } = await render(false);

    expect(query(host, '#week').getAttribute('data-stage')).toBe('plan');
    expect(query(host, '.week__panel').getAttribute('data-stage')).toBe('plan');
    expect(query(host, '.days--strip .days__day.is-on').textContent).toBe('Mon');
    for (const img of Array.from(host.querySelectorAll<HTMLImageElement>('img'))) {
      expect(img.getAttribute('loading'), img.getAttribute('src') ?? '').toBe('lazy');
    }
    // The coach's window keeps its own width inside the panel, so its text keeps its size.
    const window = query<HTMLElement>(host, '.panel__slot--window .panel__picture');
    expect(window.style.inlineSize).toBe('520px');
    expect(window.querySelector('img')?.getAttribute('srcset')).toBe(
      '/images/home/builder-week-dark-1x.webp 1x, /images/home/builder-week-dark.webp 2x',
    );
  });

  it('without the motion the section says so, and loads no motion library', async () => {
    const { host, fake } = await render(false);

    expect(query(host, '#week').getAttribute('data-motion')).toBe('off');
    expect(fake.modules.ScrollTrigger.create).not.toHaveBeenCalled();
  });

  it('shows a stage when the motion asks: the panel at once, the copy column through the signal', async () => {
    const { fixture, host } = await render(true);
    const targets = fixture.componentInstance.motionTargets();
    expect(targets.stages).toHaveLength(4);
    expect(targets.slots).toHaveLength(2);
    expect(targets.dayOf(2)?.textContent).toBe('Thu');

    targets.onStage(2);
    // The panel's composition changed before onStage returned, for Flip to measure.
    expect(query(host, '.week__panel').getAttribute('data-stage')).toBe('checkin');
    await settle(fixture);

    expect(query(host, '#week').getAttribute('data-stage')).toBe('checkin');
    expect(query(host, '.days--strip .days__day.is-on').textContent).toBe('Thu');
    expect(query(host, '[data-stage-id="checkin"]').classList).toContain('is-current');
    expect(query(host, '[data-stage-id="plan"]').classList).not.toContain('is-current');
  });

  it('names the headlines the page reveals', async () => {
    const { fixture } = await render(false);

    expect(fixture.componentInstance.titles().map((title) => title.textContent)).toEqual(
      WEEK_STAGES.map((stage) => stage.title),
    );
  });
});
