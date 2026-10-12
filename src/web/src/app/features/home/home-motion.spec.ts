import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GSAP_LOADER, HomeMotion, type HomeMotionTargets, WIDE_STORY } from './home-motion';

interface FakeTrigger {
  readonly config: {
    trigger: Element;
    start: string;
    end?: string;
    pin?: boolean;
    endTrigger?: Element;
    onToggle?(self: { isActive: boolean; direction: number }): void;
  };
  readonly kill: ReturnType<typeof vi.fn>;
}

interface FakeSplit {
  readonly target: Element;
  readonly vars: {
    type: string;
    mask: string;
    autoSplit: boolean;
    onSplit(self: unknown): unknown;
  };
  readonly revert: ReturnType<typeof vi.fn>;
}

/** A stand-in for the four GSAP modules: records what the page asks of them. */
function fakeGsap() {
  const triggers: FakeTrigger[] = [];
  const tweens: { target: unknown; vars: Record<string, unknown> }[] = [];
  const froms: { target: unknown; vars: Record<string, unknown> }[] = [];
  const flips: { state: unknown; vars: Record<string, unknown> }[] = [];
  const splits: FakeSplit[] = [];
  const contexts: { query: string; cleanup: (() => void) | void }[] = [];
  const ScrollTrigger = {
    create: vi.fn((config: FakeTrigger['config']) => {
      const trigger: FakeTrigger = { config, kill: vi.fn() };
      triggers.push(trigger);
      return trigger;
    }),
    refresh: vi.fn(),
  };
  const Flip = {
    getState: vi.fn((targets: unknown) => ({ targets })),
    from: vi.fn((state: unknown, vars: Record<string, unknown>) => flips.push({ state, vars })),
  };
  const SplitText = {
    create: vi.fn((target: Element, vars: FakeSplit['vars']) => {
      const split: FakeSplit = { target, vars, revert: vi.fn() };
      splits.push(split);
      vars.onSplit({ lines: [target] });
      return split;
    }),
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
    from: vi.fn((target: unknown, vars: Record<string, unknown>) => froms.push({ target, vars })),
  };
  return {
    modules: { gsap, ScrollTrigger, Flip, SplitText },
    triggers,
    tweens,
    froms,
    flips,
    splits,
    contexts,
    media,
  };
}

function targets(count = 4): HomeMotionTargets & {
  shown: number[];
  marker: HTMLElement;
  titles: HTMLElement[];
} {
  const week = document.createElement('section');
  const panel = document.createElement('div');
  const stages = Array.from({ length: count }, () => document.createElement('article'));
  const slots = [document.createElement('div'), document.createElement('div')];
  const titles = Array.from({ length: 2 }, () => document.createElement('h2'));
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = document.createElement('span');
    Object.defineProperty(day, 'offsetLeft', { value: 40 * index });
    Object.defineProperty(day, 'offsetWidth', { value: 36 });
    return day;
  });
  const shown: number[] = [];
  return {
    week,
    panel,
    stages,
    slots,
    marker: document.createElement('span'),
    dayOf: (stage) => days[[0, 0, 3, 6][stage] ?? 6],
    titles,
    onStage: (index) => shown.push(index),
    shown,
  };
}

function wide(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: matches && query === WIDE_STORY, media: query })),
  );
}

function motion(loader: () => Promise<unknown>, platform = 'browser'): HomeMotion {
  TestBed.configureTestingModule({
    providers: [
      HomeMotion,
      { provide: GSAP_LOADER, useValue: loader },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  return TestBed.inject(HomeMotion);
}

/** jsdom has no document.fonts; the page waits for it before splitting the headlines. */
function fontsReady(): Promise<void> {
  const ready = Promise.resolve();
  Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true });
  return ready;
}

describe('HomeMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as { fonts?: unknown }).fonts;
  });

  it('never loads GSAP on a narrow screen or for a reader who asked for less motion', async () => {
    wide(false);
    const loader = vi.fn();
    const page = motion(loader);

    await page.start(targets());

    expect(loader).not.toHaveBeenCalled();
    expect(page.state()).toBe('off');
  });

  it('never starts in the build-time render', async () => {
    wide(true);
    const loader = vi.fn();
    const page = motion(loader, 'server');

    await page.start(targets());

    expect(loader).not.toHaveBeenCalled();
    expect(page.state()).toBe('idle');
  });

  it('on a wide screen loads GSAP once, pins the panel for the week, and watches every stage at the line', async () => {
    wide(true);
    const fake = fakeGsap();
    const loader = vi.fn(async () => fake.modules);
    const page = motion(loader);
    const stage = targets(4);

    await page.start(stage);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(fake.modules.gsap.registerPlugin).toHaveBeenCalledWith(
      fake.modules.ScrollTrigger,
      fake.modules.Flip,
      fake.modules.SplitText,
    );
    expect(fake.contexts.map((context) => context.query)).toEqual([WIDE_STORY]);
    const [pin, ...stages] = fake.triggers;
    expect(pin.config).toMatchObject({
      trigger: stage.panel,
      pin: true,
      endTrigger: stage.week,
      end: 'bottom bottom',
    });
    expect(stages.map((trigger) => trigger.config.trigger)).toEqual(stage.stages);
    expect(stages.map((trigger) => trigger.config.start)).toEqual(Array(4).fill('top 60%'));
    // The first stage is shown at once, with nothing to carry over from.
    expect(stage.shown).toEqual([0]);
    expect(fake.flips).toHaveLength(0);
    expect(page.state()).toBe('running');
  });

  it('shows a stage when its copy reaches the line, carrying the slots over with Flip and the marker to its day', async () => {
    wide(true);
    const fake = fakeGsap();
    const page = motion(async () => fake.modules);
    const stage = targets(4);
    await page.start(stage);

    fake.triggers[3].config.onToggle?.({ isActive: true, direction: 1 });
    fake.triggers[3].config.onToggle?.({ isActive: true, direction: 1 });
    fake.triggers[1].config.onToggle?.({ isActive: false, direction: 1 });

    expect(stage.shown).toEqual([0, 2]);
    // The state is measured before the stage changes, so Flip animates from the old composition.
    expect(fake.modules.Flip.getState).toHaveBeenCalledWith(stage.slots);
    expect(fake.flips).toHaveLength(1);
    expect(fake.flips[0].vars).toMatchObject({ duration: 0.8 });
    const slide = fake.tweens.at(-1);
    expect(slide?.target).toBe(stage.marker);
    expect(slide?.vars).toMatchObject({ x: 120, width: 36 });
  });

  it('a jump back above the week shows Monday again, and leaving the last stage downward keeps Sunday', async () => {
    wide(true);
    const fake = fakeGsap();
    const page = motion(async () => fake.modules);
    const stage = targets(4);
    await page.start(stage);
    const [, ...stages] = fake.triggers;

    stages[3].config.onToggle?.({ isActive: true, direction: 1 });
    stages[3].config.onToggle?.({ isActive: false, direction: 1 });
    expect(stage.shown).toEqual([0, 3]);

    stages[3].config.onToggle?.({ isActive: true, direction: -1 });
    stages[3].config.onToggle?.({ isActive: false, direction: -1 });
    expect(stage.shown).toEqual([0, 3, 0]);
  });

  it('splits every headline into masked lines once the fonts are in, and reveals each as it arrives', async () => {
    wide(true);
    const fake = fakeGsap();
    const page = motion(async () => fake.modules);
    const stage = targets(2);
    const ready = fontsReady();
    await page.start(stage);
    await ready;
    await Promise.resolve();

    expect(fake.splits.map((split) => split.target)).toEqual(stage.titles);
    expect(fake.splits[0].vars).toMatchObject({ type: 'lines', mask: 'lines', autoSplit: true });
    expect(fake.froms).toHaveLength(2);
    expect(fake.froms[0].vars).toMatchObject({ yPercent: 110 });
    expect(fake.froms[0].vars['scrollTrigger']).toMatchObject({
      trigger: stage.titles[0],
      once: true,
    });
    expect(fake.modules.ScrollTrigger.refresh).toHaveBeenCalled();
  });

  it('stop reverts what GSAP set up: the splits, every trigger and the pin', async () => {
    wide(true);
    const fake = fakeGsap();
    const page = motion(async () => fake.modules);
    const ready = fontsReady();
    await page.start(targets(2));
    await ready;
    await Promise.resolve();

    page.stop();

    expect(fake.media.revert).toHaveBeenCalledTimes(1);
    for (const trigger of fake.triggers) expect(trigger.kill).toHaveBeenCalledTimes(1);
    for (const split of fake.splits) expect(split.revert).toHaveBeenCalledTimes(1);
    expect(page.state()).toBe('idle');
  });

  it('a stop while GSAP is still loading leaves nothing behind', async () => {
    wide(true);
    const fake = fakeGsap();
    let resolve: (modules: typeof fake.modules) => void = () => undefined;
    const page = motion(() => new Promise((done) => (resolve = done)));

    const started = page.start(targets());
    page.stop();
    resolve(fake.modules);
    await started;

    expect(fake.modules.gsap.registerPlugin).not.toHaveBeenCalled();
    expect(fake.modules.gsap.matchMedia).not.toHaveBeenCalled();
    expect(page.state()).toBe('idle');
  });

  it('fonts that arrive after a stop split nothing', async () => {
    wide(true);
    const fake = fakeGsap();
    const page = motion(async () => fake.modules);
    let fontsLoaded: () => void = () => undefined;
    Object.defineProperty(document, 'fonts', {
      value: { ready: new Promise<void>((done) => (fontsLoaded = done)) },
      configurable: true,
    });
    await page.start(targets(2));

    page.stop();
    fontsLoaded();
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.splits).toHaveLength(0);
  });
});
