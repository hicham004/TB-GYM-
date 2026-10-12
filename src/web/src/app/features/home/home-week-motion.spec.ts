import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GSAP_LOADER,
  HomeWeekMotion,
  WIDE_STORY,
  type WeekMotionTargets,
} from './home-week-motion';

interface FakeTrigger {
  readonly config: {
    trigger: Element;
    start: string;
    end: string;
    onToggle(self: { isActive: boolean }): void;
  };
  readonly kill: ReturnType<typeof vi.fn>;
}

/** A stand-in for the two GSAP modules: records what the story asks of them. */
function fakeGsap() {
  const triggers: FakeTrigger[] = [];
  const tweens: { target: unknown; vars: Record<string, unknown> }[] = [];
  const contexts: { query: string; cleanup: (() => void) | void }[] = [];
  const ScrollTrigger = {
    create: vi.fn((config: FakeTrigger['config']) => {
      const trigger: FakeTrigger = { config, kill: vi.fn() };
      triggers.push(trigger);
      return trigger;
    }),
    refresh: vi.fn(),
  };
  const media = {
    add: vi.fn((query: string, setUp: () => (() => void) | void) => {
      contexts.push({ query, cleanup: setUp() });
    }),
    revert: vi.fn(() => {
      for (const context of contexts) context.cleanup?.();
      contexts.length = 0;
    }),
  };
  const gsap = {
    registerPlugin: vi.fn(),
    matchMedia: vi.fn(() => media),
    to: vi.fn((target: unknown, vars: Record<string, unknown>) => tweens.push({ target, vars })),
  };
  return { modules: { gsap, ScrollTrigger }, triggers, tweens, contexts, media };
}

function targets(count = 3): WeekMotionTargets & { shown: number[]; marker: HTMLElement } {
  const moments = Array.from({ length: count }, () => document.createElement('div'));
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = document.createElement('li');
    Object.defineProperty(day, 'offsetLeft', { value: 40 * index });
    Object.defineProperty(day, 'offsetWidth', { value: 36 });
    return day;
  });
  const shown: number[] = [];
  return {
    moments,
    marker: document.createElement('span'),
    dayOf: (moment) => days[[0, 0, 3][moment] ?? 6],
    onMoment: (index) => shown.push(index),
    shown,
  };
}

function wide(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: matches && query === WIDE_STORY, media: query })),
  );
}

function motion(loader: () => Promise<unknown>, platform = 'browser'): HomeWeekMotion {
  TestBed.configureTestingModule({
    providers: [
      HomeWeekMotion,
      { provide: GSAP_LOADER, useValue: loader },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  return TestBed.inject(HomeWeekMotion);
}

describe('HomeWeekMotion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never loads GSAP on a narrow screen or for a reader who asked for less motion', async () => {
    wide(false);
    const loader = vi.fn();
    const story = motion(loader);

    await story.start(targets());

    expect(loader).not.toHaveBeenCalled();
    expect(story.state()).toBe('off');
  });

  it('never starts in the build-time render', async () => {
    wide(true);
    const loader = vi.fn();
    const story = motion(loader, 'server');

    await story.start(targets());

    expect(loader).not.toHaveBeenCalled();
    expect(story.state()).toBe('idle');
  });

  it('on a wide screen loads GSAP once, watches every moment at the same line and shows the first', async () => {
    wide(true);
    const fake = fakeGsap();
    const loader = vi.fn(async () => fake.modules);
    const story = motion(loader);
    const stage = targets(3);

    await story.start(stage);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(fake.modules.gsap.registerPlugin).toHaveBeenCalledWith(fake.modules.ScrollTrigger);
    expect(fake.contexts.map((context) => context.query)).toEqual([WIDE_STORY]);
    expect(fake.triggers.map((trigger) => trigger.config.trigger)).toEqual(stage.moments);
    expect(fake.triggers.map((trigger) => trigger.config.start)).toEqual([
      'top 58%',
      'top 58%',
      'top 58%',
    ]);
    expect(stage.shown).toEqual([0]);
    expect(story.state()).toBe('running');
  });

  it("shows a moment when its chapter reaches the line, and slides the marker to the moment's day", async () => {
    wide(true);
    const fake = fakeGsap();
    const story = motion(async () => fake.modules);
    const stage = targets(3);
    await story.start(stage);

    fake.triggers[2].config.onToggle({ isActive: true });
    fake.triggers[2].config.onToggle({ isActive: true });
    fake.triggers[1].config.onToggle({ isActive: false });

    expect(stage.shown).toEqual([0, 2]);
    const slide = fake.tweens.at(-1);
    expect(slide?.target).toBe(stage.marker);
    expect(slide?.vars).toMatchObject({ x: 120, width: 36 });
  });

  it('stop reverts what GSAP set up and kills every trigger', async () => {
    wide(true);
    const fake = fakeGsap();
    const story = motion(async () => fake.modules);
    await story.start(targets(2));

    story.stop();

    expect(fake.media.revert).toHaveBeenCalledTimes(1);
    for (const trigger of fake.triggers) expect(trigger.kill).toHaveBeenCalledTimes(1);
    expect(story.state()).toBe('idle');
  });

  it('a stop while GSAP is still loading leaves nothing behind', async () => {
    wide(true);
    const fake = fakeGsap();
    let resolve: (modules: typeof fake.modules) => void = () => undefined;
    const story = motion(() => new Promise((done) => (resolve = done)));

    const started = story.start(targets());
    story.stop();
    resolve(fake.modules);
    await started;

    expect(fake.modules.gsap.registerPlugin).not.toHaveBeenCalled();
    expect(fake.modules.gsap.matchMedia).not.toHaveBeenCalled();
    expect(story.state()).toBe('idle');
  });
});
