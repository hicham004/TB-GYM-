import { describe, expect, it } from 'vitest';
import {
  personalRecord,
  programSummary,
  progressPhotos,
} from '../../../testing/share-card-fixtures';
import { paintBeforeAfterCard, type SharePicture } from './before-after-paint';
import {
  directionOf,
  paintShareCard,
  wrapLines,
  type ShareLook,
  type ShareMark,
} from './share-card-paint';
import { photosCard, programCard, recordCard, type ShareIdentity } from './share-card.models';

interface Drawn {
  readonly text: string;
  readonly x: number;
  readonly font: string;
  readonly fill: unknown;
  readonly align: string;
  readonly direction: string;
}

/**
 * A 2D context that records what is drawn, with the save and restore of a real one. Text is half its
 * font size wide per character, which is enough to test wrapping and fitting.
 */
function fakeContext() {
  const state = {
    font: '10px sans',
    fillStyle: '' as unknown,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'ltr',
  };
  const saved: (typeof state)[] = [];
  const texts: Drawn[] = [];
  const fills: unknown[] = [];
  const images: unknown[][] = [];
  const translations: [number, number][] = [];
  const gradients: { kind: string; stops: [number, string][] }[] = [];
  const gradient = (kind: string) => {
    const made = { kind, stops: [] as [number, string][] };
    gradients.push(made);
    return { addColorStop: (offset: number, colour: string) => made.stops.push([offset, colour]) };
  };
  const context = {
    get font() {
      return state.font;
    },
    set font(value: string) {
      state.font = value;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: unknown) {
      state.fillStyle = value;
    },
    get textAlign() {
      return state.textAlign;
    },
    set textAlign(value: string) {
      state.textAlign = value;
    },
    get textBaseline() {
      return state.textBaseline;
    },
    set textBaseline(value: string) {
      state.textBaseline = value;
    },
    get direction() {
      return state.direction;
    },
    set direction(value: string) {
      state.direction = value;
    },
    letterSpacing: '0px',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    imageSmoothingQuality: 'low',
    save: () => saved.push({ ...state }),
    restore: () => Object.assign(state, saved.pop()),
    translate: (x: number, y: number) => translations.push([x, y]),
    rotate: () => undefined,
    clip: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    arcTo: () => undefined,
    closePath: () => undefined,
    fill: () => fills.push(state.fillStyle),
    fillRect: () => fills.push(state.fillStyle),
    fillText: (text: string, x: number) =>
      texts.push({
        text,
        x,
        font: state.font,
        fill: state.fillStyle,
        align: state.textAlign,
        direction: state.direction,
      }),
    drawImage: (...args: unknown[]) => images.push(args),
    measureText: (text: string) => ({
      width: text.length * Number(/(\d+)px/.exec(state.font)?.[1] ?? 10) * 0.5,
    }),
    createLinearGradient: () => gradient('linear'),
    createRadialGradient: () => gradient('radial'),
  };
  return {
    context: context as unknown as CanvasRenderingContext2D,
    texts,
    fills,
    images,
    gradients,
    translations,
  };
}

const look: ShareLook = {
  brand: '#153d33',
  night: '#0c1e19',
  accent: '#d9ed94',
  accentBright: '#e4f3b0',
  onAccent: '#11201b',
  onAccentSoft: '#3d4a37',
};
const initials: ShareMark = { kind: 'initials', text: 'AP' };
const maya: ShareIdentity = { firstName: 'Maya', spaceName: 'Atlas Performance' };

describe('paintShareCard', () => {
  it('draws a record’s words on the accent card over the brand, as the prototype’s card', () => {
    const { context, texts, fills, gradients } = fakeContext();
    paintShareCard(context, recordCard(personalRecord(), maya, 'en-LB'), look, initials);

    expect(texts.map((drawn) => drawn.text)).toEqual([
      'AP',
      'NEW PERSONAL RECORD',
      '62.5 kg × 6',
      'Barbell bench press',
      'Maya · coached by Atlas Performance',
    ]);
    // The brand fills the story from top to foot, darkening to the night tone.
    expect(gradients[0]).toEqual({
      kind: 'linear',
      stops: [
        [0, '#153d33'],
        [1, '#0c1e19'],
      ],
    });
    expect(fills).toContain('#d9ed94');
    const headline = texts.find((drawn) => drawn.text === '62.5 kg × 6')!;
    expect(headline.font).toMatch(/^italic 400 \d+px "TB Home Serif"/);
    expect(headline.fill).toBe('#11201b');
    expect(texts.find((drawn) => drawn.text.startsWith('Maya'))!.fill).toBe('#3d4a37');
  });

  it('gives each of a program’s numbers its own line', () => {
    const { context, texts } = fakeContext();
    paintShareCard(context, programCard(programSummary(), maya), look, initials);
    expect(texts.map((drawn) => drawn.text)).toEqual([
      'AP',
      'PROGRAM COMPLETE',
      '8 weeks',
      'Strength Foundations',
      '30 workouts',
      '7 personal records',
      'Maya · coached by Atlas Performance',
    ]);
  });

  it('sets a long name on at most three lines and shrinks a long headline to fit', () => {
    const { context, texts } = fakeContext();
    const card = {
      ...recordCard(personalRecord(), maya, 'en-LB'),
      headline: '102.5 lb × 10',
      title:
        'Single arm dumbbell Romanian deadlift to a deficit with a pause at the knee and a slow eccentric lowering',
    };
    paintShareCard(context, card, look, initials);

    const title = texts.filter((drawn) => drawn.font.startsWith('600 66px'));
    expect(title).toHaveLength(3);
    expect(title[2].text.endsWith('…')).toBe(true);
    const size = Number(
      /(\d+)px/.exec(texts.find((drawn) => drawn.text === card.headline)!.font)![1],
    );
    expect(size).toBeLessThan(230);
    expect(size * 0.5 * card.headline.length).toBeLessThanOrEqual(720);
  });

  it('draws the coaching space’s logo on a white tile when it has one', () => {
    const { context, texts, images, fills } = fakeContext();
    const logo = { width: 400, height: 200 } as unknown as CanvasImageSource;
    paintShareCard(context, recordCard(personalRecord(), maya, 'en-LB'), look, {
      kind: 'logo',
      image: logo,
      width: 400,
      height: 200,
    });
    expect(texts.map((drawn) => drawn.text)).not.toContain('AP');
    expect(fills).toContain('#ffffff');
    // Fitted inside the tile, keeping its shape: 84 wide, 42 high.
    expect(images).toHaveLength(1);
    expect(images[0].slice(3)).toEqual([84, 42]);
  });

  it('mirrors on a right-to-left page, each line still read in its own direction', () => {
    const { context, texts } = fakeContext();
    paintShareCard(context, programCard(programSummary(), maya), look, initials, true);
    const words = texts.filter((drawn) => drawn.text !== 'AP');
    expect(words.every((drawn) => drawn.align === 'right' && drawn.x === 800)).toBe(true);
    // English words keep their order: "8 weeks", not "weeks 8".
    expect(words.every((drawn) => drawn.direction === 'ltr')).toBe(true);
  });

  it('reads an Arabic name right to left on an English card', () => {
    const { context, texts } = fakeContext();
    const card = programCard(programSummary({ name: 'برنامج القوة' }), maya);
    paintShareCard(context, card, look, initials);
    const title = texts.find((drawn) => drawn.text === 'برنامج القوة')!;
    expect([title.align, title.direction, title.x]).toEqual(['left', 'rtl', 80]);
  });
});

describe('directionOf', () => {
  it('takes a line’s direction from its first letter, as dir="auto" does', () => {
    expect(directionOf('8 weeks', true)).toBe('ltr');
    expect(directionOf('62.5 kg × 6', true)).toBe('ltr');
    expect(directionOf('سكوات خلفي', false)).toBe('rtl');
    expect(directionOf('12 × 5', true)).toBe('rtl');
    expect(directionOf('12 × 5', false)).toBe('ltr');
  });
});

describe('wrapLines', () => {
  it('fills lines word by word and marks text left over with an ellipsis', () => {
    const { context } = fakeContext();
    context.font = '600 10px sans';
    expect(wrapLines(context, 'one two three four', 40, 3)).toEqual(['one two', 'three', 'four']);
    expect(wrapLines(context, 'one two three four five six', 40, 2)).toEqual([
      'one two',
      'three f…',
    ]);
    expect(wrapLines(context, 'unbreakablewordhere', 40, 2)).toEqual(['unbreakablewordhere']);
  });
});

describe('paintBeforeAfterCard (R6.1b)', () => {
  const portrait = (name: string): SharePicture => ({
    image: { name } as unknown as CanvasImageSource,
    width: 600,
    height: 800,
  });
  /** Each drawn photo: which one, and where it landed. */
  const drawn = (images: unknown[][]) =>
    images.map(([image, x, y, width, height]) => ({
      name: (image as { name: string }).name,
      x: x as number,
      y: y as number,
      width: width as number,
      height: height as number,
    }));

  it('sets the two photos side by side in frames of one size, labelled, over the accent card', () => {
    const { context, texts, images, translations } = fakeContext();
    const card = photosCard(progressPhotos(), maya, 'en-LB');
    paintBeforeAfterCard(context, card, look, initials, {
      before: portrait('before'),
      after: portrait('after'),
    });

    const [before, after] = drawn(images);
    expect([before.name, after.name]).toEqual(['before', 'after']);
    // A 3:4 photo fills its 460 wide frame exactly; the two frames sit 32 apart, centred.
    expect(before.width).toBeCloseTo(460, 6);
    expect(before.height).toBeCloseTo((460 * 4) / 3, 6);
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    expect(after.x - (before.x + before.width)).toBeCloseTo(32, 6);
    expect(before.x).toBeCloseTo(1080 - (after.x + after.width), 6);
    expect(texts.map((item) => item.text)).toEqual([
      'BEFORE',
      'AFTER',
      'AP',
      'BEFORE AND AFTER',
      '4 weeks',
      'Before: 5 September 2026',
      'After: 3 October 2026',
      'Maya · coached by Atlas Performance',
    ]);
    // The labels are on accent pills, in the accent's own ink.
    expect(texts[0].fill).toBe('#11201b');

    // The card sits 72 under the photos, covering none of them, and the two are one block in the
    // middle of the story: as much room above the photos as under the card.
    const [centre, corner] = translations;
    expect(centre[0]).toBe(540);
    const cardTop = centre[1] + corner[1];
    const cardBottom = centre[1] - corner[1];
    expect(cardTop - (before.y + before.height)).toBeCloseTo(72, 6);
    expect(before.y).toBeCloseTo(1920 - cardBottom, 6);
  });

  it('shows each photo whole, never cropped, whatever its shape', () => {
    const { context, images } = fakeContext();
    const landscape: SharePicture = {
      image: { name: 'after' } as unknown as CanvasImageSource,
      width: 800,
      height: 600,
    };
    paintBeforeAfterCard(context, photosCard(progressPhotos(), maya, 'en-LB'), look, initials, {
      before: portrait('before'),
      after: landscape,
    });
    const [, after] = drawn(images);
    // Fitted inside the same 460 × 613 frame as the portrait one, keeping its own shape.
    expect(after.width).toBeCloseTo(460, 6);
    expect(after.height).toBeCloseTo(345, 5);
    expect(after.width / after.height).toBeCloseTo(800 / 600, 5);
  });

  it('makes taller frames for a phone-shaped photo, but none taller than 9:16', () => {
    const { context, images } = fakeContext();
    const tall: SharePicture = {
      image: { name: 'after' } as unknown as CanvasImageSource,
      width: 1080,
      height: 2400,
    };
    paintBeforeAfterCard(context, photosCard(progressPhotos(), maya, 'en-LB'), look, initials, {
      before: portrait('before'),
      after: tall,
    });
    const [before, after] = drawn(images);
    // The portrait photo fills the frame's width, so the frame is as wide as it is drawn; the
    // phone photo, taller than 9:16, fills the frame's height and leaves room at its sides.
    const frameHeight = (before.width * 16) / 9;
    expect(after.height).toBeCloseTo(frameHeight, 5);
    expect(after.width / after.height).toBeCloseTo(1080 / 2400, 5);
    expect(before.height).toBeCloseTo((before.width * 4) / 3, 5);
    expect(before.y).toBeGreaterThan(after.y);
  });

  it('reads the earlier photo first on a right-to-left page: on the right', () => {
    const { context, texts, images } = fakeContext();
    paintBeforeAfterCard(
      context,
      photosCard(progressPhotos(), maya, 'en-LB'),
      look,
      initials,
      { before: portrait('before'), after: portrait('after') },
      true,
    );
    const [left, right] = drawn(images);
    expect([left.name, right.name]).toEqual(['after', 'before']);
    expect(texts.slice(0, 2).map((item) => item.text)).toEqual(['AFTER', 'BEFORE']);
  });
});
