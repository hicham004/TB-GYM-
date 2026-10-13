import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GSAP_LOADER,
  type GsapModules,
  HomeMotion,
  type HomeMotionTargets,
  WIDE_STORY,
} from './home-motion';
import { findBelow, type HomeMotionBelow, type MotionRow, startBelow } from './home-motion-below';

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

interface FakeTimeline {
  readonly vars: Record<string, unknown>;
  readonly steps: { target: unknown; vars: Record<string, unknown>; at: unknown }[];
}

/** A stand-in for the four GSAP modules: records what the page asks of them. */
function fakeGsap() {
  const triggers: FakeTrigger[] = [];
  const tweens: { target: unknown; vars: Record<string, unknown> }[] = [];
  const froms: { target: unknown; vars: Record<string, unknown> }[] = [];
  const fromTos: { target: unknown; from: Record<string, unknown>; to: Record<string, unknown> }[] =
    [];
  const timelines: FakeTimeline[] = [];
  const quick: { target: unknown; property: string; values: number[] }[] = [];
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
      vars.onSplit({ lines: [target], words: [target] });
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
    fromTo: vi.fn((target: unknown, from: Record<string, unknown>, to: Record<string, unknown>) =>
      fromTos.push({ target, from, to }),
    ),
    timeline: vi.fn((vars: Record<string, unknown>) => {
      const timeline: FakeTimeline = { vars, steps: [] };
      timelines.push(timeline);
      const chain = {
        from: (target: unknown, stepVars: Record<string, unknown>, at?: unknown) => {
          timeline.steps.push({ target, vars: stepVars, at });
          return chain;
        },
      };
      return chain;
    }),
    quickTo: vi.fn((target: unknown, property: string) => {
      const record = { target, property, values: [] as number[] };
      quick.push(record);
      return (value: number) => record.values.push(value);
    }),
  };
  return {
    modules: { gsap, ScrollTrigger, Flip, SplitText },
    triggers,
    tweens,
    froms,
    fromTos,
    timelines,
    quick,
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

/** An element whose top sits `top` px down the screen, as the layout would put it. */
function placed<T extends HTMLElement>(element: T, top: number): T {
  element.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + 100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: top,
    }) as DOMRect;
  return element;
}

/** The parts below the week, each below the screen unless the test places it in view. */
function belowTargets(rowTops: readonly number[] = [2000, 2600]): HomeMotionBelow {
  const row = (top: number, index: number): MotionRow => {
    const phone = document.createElement('div');
    phone.append(document.createElement('picture'));
    return {
      row: placed(document.createElement('article'), top),
      window: document.createElement('div'),
      phone,
      words: [
        document.createElement('p'),
        document.createElement('p'),
        document.createElement('a'),
      ],
      phoneFirst: index % 2 === 1,
    };
  };
  const section = document.createElement('section');
  const title = placed(document.createElement('h2'), 5000);
  const glow = document.createElement('div');
  const magnet = document.createElement('span');
  section.append(glow, title, magnet);
  return {
    rows: rowTops.map(row),
    facts: {
      list: placed(document.createElement('ul'), 3000),
      items: [document.createElement('li'), document.createElement('li')],
    },
    who: {
      halves: placed(document.createElement('div'), 4000),
      shots: [document.createElement('div'), document.createElement('div')],
    },
    finale: {
      section,
      title,
      after: [document.createElement('p'), document.createElement('a')],
      glow,
      magnet,
    },
  };
}

/** A mouse (or not): the finale follows only a fine pointer that can hover. */
function pointer(fine: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: fine && query.includes('pointer: fine'), media: query })),
  );
}

function triggerOf(timeline: FakeTimeline): unknown {
  return (timeline.vars['scrollTrigger'] as { trigger?: unknown } | undefined)?.trigger;
}

describe('the motion below the week', () => {
  afterEach(() => vi.unstubAllGlobals());

  function start(below = belowTargets(), fonts: Promise<unknown> = Promise.resolve()) {
    const fake = fakeGsap();
    const undo = startBelow(fake.modules as unknown as GsapModules, below, fonts);
    return { fake, below, undo };
  }

  it('brings each row’s screens in from their two sides with the words after them, and lets the phone drift', () => {
    pointer(false);
    const { fake, below } = start();
    const [first, second] = fake.timelines;
    const [one, two] = below.rows;

    expect(first.vars).toMatchObject({
      scrollTrigger: { trigger: one.row, start: 'top 72%', once: true },
      defaults: { clearProps: 'transform,opacity' },
    });
    expect(first.steps.map((step) => step.target)).toEqual([one.window, one.phone, one.words]);
    // The window comes from its own side, the phone from the other one, rising.
    expect(first.steps[0].vars).toMatchObject({ x: -110, opacity: 0 });
    expect(first.steps[1].vars).toMatchObject({ x: 110, y: 50, opacity: 0 });
    expect(first.steps[2].vars).toMatchObject({ y: 18, opacity: 0, stagger: 0.08 });
    // With the phone first, the sides swap.
    expect(second.steps[0].vars).toMatchObject({ x: 110 });
    expect(second.steps[1].vars).toMatchObject({ x: -110 });
    // The drift moves the phone's picture, never the phone the entrance moves.
    expect(fake.fromTos.map((drift) => drift.target)).toEqual([
      one.phone.firstElementChild,
      two.phone.firstElementChild,
    ]);
    expect(fake.fromTos[0].from).toEqual({ y: -26 });
    expect(fake.fromTos[0].to).toMatchObject({
      y: 26,
      ease: 'none',
      scrollTrigger: { trigger: one.row, start: 'top bottom', end: 'bottom top', scrub: 0.4 },
    });
  });

  it('leaves a row the reader can already see as it is, and still lets its phone drift', () => {
    pointer(false);
    const { fake, below } = start(belowTargets([120]));

    expect(fake.timelines.map(triggerOf)).not.toContain(below.rows[0].row);
    expect(fake.fromTos).toHaveLength(1);
  });

  it('brings the facts in one after another with their dots, and who it’s for’s two screens up', () => {
    pointer(false);
    const { fake, below } = start();
    const facts = fake.timelines.find((timeline) => triggerOf(timeline) === below.facts?.list);

    expect(facts?.vars['scrollTrigger']).toMatchObject({ start: 'top 85%', once: true });
    expect(facts?.steps.map((step) => step.target)).toEqual([
      below.facts?.items,
      below.facts?.items,
    ]);
    expect(facts?.steps[0].vars).toMatchObject({ y: 16, opacity: 0, stagger: 0.07 });
    expect(facts?.steps[1].vars).toMatchObject({ '--dot': 0, ease: 'back.out(3)' });
    const rise = fake.froms.find((tween) => tween.target === below.who?.shots);
    expect(rise?.vars).toMatchObject({
      y: 70,
      opacity: 0,
      clearProps: 'transform,opacity',
      scrollTrigger: { trigger: below.who?.halves, start: 'top 78%', once: true },
    });
  });

  it('splits the closing line into words once the fonts are in, its eyebrow and ways in following', async () => {
    pointer(false);
    let fontsLoaded: () => void = () => undefined;
    const { fake, below, undo } = start(
      belowTargets(),
      new Promise<void>((done) => (fontsLoaded = done)),
    );
    const finale = below.finale as NonNullable<HomeMotionBelow['finale']>;

    expect(fake.froms.find((tween) => tween.target === finale.after)?.vars).toMatchObject({
      delay: 0.35,
      scrollTrigger: { trigger: finale.title, start: 'top 86%', once: true },
    });
    expect(fake.splits).toHaveLength(0);

    fontsLoaded();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.splits.map((split) => split.target)).toEqual([finale.title]);
    expect(fake.splits[0].vars).toMatchObject({ type: 'words', mask: 'words', autoSplit: true });
    expect(fake.froms.at(-1)?.vars).toMatchObject({ yPercent: 115, stagger: 0.075 });

    undo();
    expect(fake.splits[0].revert).toHaveBeenCalledTimes(1);
  });

  it('for a mouse, the light follows the pointer and the pill leans in once it is near; the clean-up lets go', () => {
    pointer(true);
    const { fake, below, undo } = start();
    const finale = below.finale as NonNullable<HomeMotionBelow['finale']>;
    expect(fake.quick.map((record) => [record.target, record.property])).toEqual([
      [finale.glow, 'x'],
      [finale.glow, 'y'],
      [finale.magnet, 'x'],
      [finale.magnet, 'y'],
    ]);
    const [lightX, lightY, pillX, pillY] = fake.quick;

    // jsdom lays nothing out, so the light and the pill rest at the section's corner.
    finale.section.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 40 }));
    expect(lightX.values).toEqual([50]);
    expect(lightY.values).toEqual([40]);
    expect(pillX.values).toEqual([50 * 0.22]);
    expect(pillY.values).toEqual([40 * 0.32]);

    // Far from the pill, it springs back.
    finale.section.dispatchEvent(new MouseEvent('pointermove', { clientX: 600, clientY: 400 }));
    expect(fake.tweens.at(-1)).toMatchObject({
      target: finale.magnet,
      vars: { x: 0, y: 0, ease: 'elastic.out(1, 0.45)' },
    });

    undo();
    finale.section.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }));
    expect(lightX.values).toHaveLength(2);
  });

  it('follows no finger: without a fine pointer neither the light nor the pill moves', () => {
    pointer(false);
    const { fake } = start();

    expect(fake.quick).toHaveLength(0);
  });
});

/** The page below the week as the components draw it: the classes the motion looks for. */
function belowPage(): HTMLElement {
  const page = document.createElement('div');
  const row = (extra: string) => `
    <article class="row ${extra}">
      <div class="row__copy">
        <p class="row__eyebrow">Programs</p><h3 class="row__title">Title</h3>
        <p class="row__body">Body</p><a class="row__link" href="/">Link</a>
      </div>
      <figure class="pair"><div class="pair__window"></div><div class="pair__phone"><picture></picture></div></figure>
    </article>`;
  page.innerHTML = `
    ${row('')}${row('row--phone-first')}
    <ul class="facts__list"><li>One</li><li>Two</li></ul>
    <div class="who__halves"><div class="half__shot"></div><div class="half__shot"></div></div>
    <section class="finale">
      <div class="finale__light"><div class="finale__glow"></div></div>
      <p class="finale__eyebrow">Start</p><h2 class="finale__title">Your next client's week starts here.</h2>
      <span class="finale__magnet"><a class="finale__start" href="/">Start</a></span>
      <a class="finale__talk" href="/">Talk to us</a>
    </section>`;
  return page;
}

describe('the motion below the week, in the page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as { fonts?: unknown }).fonts;
  });

  it('finds the rows, the facts, who it’s for and the finale by the classes they are drawn with', () => {
    const page = belowPage();
    const below = findBelow(page);
    const rows = page.querySelectorAll('.row');

    expect(below.rows.map((row) => [row.row, row.phoneFirst])).toEqual([
      [rows[0], false],
      [rows[1], true],
    ]);
    expect(below.rows[0].window).toBe(rows[0].querySelector('.pair__window'));
    expect(below.rows[0].phone).toBe(rows[0].querySelector('.pair__phone'));
    expect(below.rows[0].words.map((word) => word.className)).toEqual([
      'row__eyebrow',
      'row__body',
      'row__link',
    ]);
    expect(below.facts?.items).toHaveLength(2);
    expect(below.who?.shots).toHaveLength(2);
    expect(below.finale?.title).toBe(page.querySelector('.finale__title'));
    expect(below.finale?.glow).toBe(page.querySelector('.finale__glow'));
    expect(below.finale?.magnet).toBe(page.querySelector('.finale__magnet'));
    expect(below.finale?.after.map((element) => element.className)).toEqual([
      'finale__eyebrow',
      'finale__start',
      'finale__talk',
    ]);
  });

  it('finds nothing to move on a page without those parts', () => {
    expect(findBelow(document.createElement('div'))).toEqual({
      rows: [],
      facts: null,
      who: null,
      finale: null,
    });
  });

  it('HomeMotion starts them inside the same wide-screen context, and stop undoes them', async () => {
    wide(true);
    const fake = fakeGsap();
    const motionOfPage = motion(async () => fake.modules);
    const ready = fontsReady();
    const page = belowPage();
    for (const part of page.querySelectorAll<HTMLElement>(
      '.row, .facts__list, .who__halves, .finale__title',
    )) {
      placed(part, 3000);
    }

    await motionOfPage.start({ ...targets(2), page });
    await ready;
    await new Promise((resolve) => setTimeout(resolve));

    expect(fake.contexts.map((context) => context.query)).toEqual([WIDE_STORY]);
    expect(fake.timelines.map(triggerOf)).toEqual([
      ...page.querySelectorAll('.row'),
      page.querySelector('.facts__list'),
    ]);
    const words = fake.splits.find(
      (split) => split.target === page.querySelector('.finale__title'),
    );
    expect(words?.vars).toMatchObject({ type: 'words' });

    motionOfPage.stop();
    expect(words?.revert).toHaveBeenCalledTimes(1);
  });
});
