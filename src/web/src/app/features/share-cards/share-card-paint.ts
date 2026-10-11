import type { ShareCard } from './share-card.models';

/** A story's size, 9:16: Instagram, WhatsApp and Facebook stories fill the phone's screen with it. */
export const SHARE_IMAGE_WIDTH = 1080;
export const SHARE_IMAGE_HEIGHT = 1920;

/** The app's own faces (styles.scss): Instrument Serif for the moment, IBM Plex Sans for the words. */
export const SHARE_SERIF = '"TB Home Serif", Georgia, "Times New Roman", serif';
export const SHARE_SANS = '"Notebook Plex", "Notebook Plex Arabic", system-ui, sans-serif';

/** The coach's colours as a card is drawn in them, every text pairing readable (brand-theme.ts). */
export interface ShareLook {
  readonly brand: string;
  readonly night: string;
  readonly accent: string;
  readonly accentBright: string;
  readonly onAccent: string;
  /** Quieter text on the accent that still reads at AA. */
  readonly onAccentSoft: string;
}

/** The coaching space's mark: its logo on a white tile, as the sidebar shows it, or its initials. */
export type ShareMark =
  | {
      readonly kind: 'logo';
      readonly image: CanvasImageSource;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'initials'; readonly text: string };

interface TextStyle {
  readonly size: number;
  readonly weight: number;
  /** The distance from one line's top to the next. */
  readonly line: number;
  readonly lines: number;
}

const CARD_WIDTH = 880;
const PAD_X = 80;
const PAD_Y = 88;
const INNER = CARD_WIDTH - 2 * PAD_X;
const RADIUS = 64;
const MARK = 112;
/** The prototype's share card leans 2° back. */
const TILT = (-2 * Math.PI) / 180;
const KICKER: TextStyle = { size: 34, weight: 600, line: 44, lines: 1 };
const TITLE: TextStyle = { size: 66, weight: 600, line: 80, lines: 3 };
const FACT: TextStyle = { size: 46, weight: 400, line: 62, lines: 1 };
const BYLINE: TextStyle = { size: 36, weight: 600, line: 48, lines: 2 };
const HEADLINE_LARGEST = 230;
const HEADLINE_SMALLEST = 96;

interface Layout {
  readonly headlineSize: number;
  readonly title: readonly string[];
  readonly facts: readonly string[];
  readonly byline: readonly string[];
  readonly height: number;
}

/**
 * Draws a card on a story-sized canvas: the brand behind it, dark toward the foot, with two soft glows,
 * and the card itself in the accent, tilted like the prototype's. The faces should be loaded first; a
 * face that is not falls back to the next in its list.
 */
export function paintShareCard(
  context: CanvasRenderingContext2D,
  card: ShareCard,
  look: ShareLook,
  mark: ShareMark,
  rtl = false,
): void {
  paintBackground(context, look);
  const layout = layOut(context, card);

  context.save();
  context.translate(SHARE_IMAGE_WIDTH / 2, SHARE_IMAGE_HEIGHT / 2 - 40);
  context.rotate(TILT);
  context.translate(-CARD_WIDTH / 2, -layout.height / 2);

  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.42)';
  context.shadowBlur = 96;
  context.shadowOffsetY = 48;
  context.fillStyle = look.accent;
  roundedRect(context, 0, 0, CARD_WIDTH, layout.height, RADIUS);
  context.fill();
  context.restore();

  paintCard(context, card, layout, look, mark, rtl);
  context.restore();
}

/**
 * At most `max` lines of `text` no wider than `width` in the context's current font. A word too long
 * for a line keeps a line of its own (the caller squeezes it), and the last line kept ends in an
 * ellipsis when text was left over.
 */
export function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
  max: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || context.measureText(candidate).width <= width) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;

  const kept = lines.slice(0, max);
  let last = Array.from(`${kept[max - 1]} ${lines[max]}`);
  while (last.length > 1 && context.measureText(`${last.join('').trimEnd()}…`).width > width) {
    last = last.slice(0, -1);
  }
  kept[max - 1] = `${last.join('').trimEnd()}…`;
  return kept;
}

function layOut(context: CanvasRenderingContext2D, card: ShareCard): Layout {
  context.font = sans(TITLE);
  const title = wrapLines(context, card.title, INNER, TITLE.lines);
  context.font = sans(FACT);
  const facts = card.facts.map((fact) => wrapLines(context, fact, INNER, FACT.lines)[0] ?? '');
  context.font = sans(BYLINE);
  const byline = wrapLines(context, card.byline, INNER, BYLINE.lines);

  let headlineSize = HEADLINE_LARGEST;
  context.font = serif(headlineSize);
  while (
    headlineSize - 4 >= HEADLINE_SMALLEST &&
    context.measureText(card.headline).width > INNER
  ) {
    headlineSize -= 4;
    context.font = serif(headlineSize);
  }

  const height =
    PAD_Y +
    MARK +
    64 +
    headlineSize +
    36 +
    title.length * TITLE.line +
    (facts.length ? 28 + facts.length * FACT.line : 0) +
    64 +
    2 +
    40 +
    byline.length * BYLINE.line +
    PAD_Y;
  return { headlineSize, title, facts, byline, height };
}

function paintBackground(context: CanvasRenderingContext2D, look: ShareLook): void {
  const fill = context.createLinearGradient(0, 0, 0, SHARE_IMAGE_HEIGHT);
  fill.addColorStop(0, look.brand);
  fill.addColorStop(1, look.night);
  context.fillStyle = fill;
  context.fillRect(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT);
  glow(context, 880, 300, 660, look.accentBright, 0.24);
  glow(context, 140, 1680, 600, look.accent, 0.14);
}

function glow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colour: string,
  alpha: number,
): void {
  const fill = context.createRadialGradient(x, y, 0, x, y, radius);
  fill.addColorStop(0, withAlpha(colour, alpha));
  fill.addColorStop(1, withAlpha(colour, 0));
  context.fillStyle = fill;
  context.fillRect(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT);
}

function paintCard(
  context: CanvasRenderingContext2D,
  card: ShareCard,
  layout: Layout,
  look: ShareLook,
  mark: ShareMark,
  rtl: boolean,
): void {
  // The card mirrors on a right-to-left page; each line still reads in its own direction.
  const start = rtl ? CARD_WIDTH - PAD_X : PAD_X;
  const write = (text: string, y: number, width: number) => {
    context.direction = directionOf(text, rtl);
    context.fillText(text, start, y, width);
  };
  context.textAlign = rtl ? 'right' : 'left';
  context.textBaseline = 'top';

  paintMark(context, mark, rtl ? PAD_X : CARD_WIDTH - PAD_X - MARK, PAD_Y, look);

  // The kicker sits level with the middle of the mark, in capitals with a little air between letters.
  context.fillStyle = look.onAccentSoft;
  context.font = sans(KICKER);
  letterSpacing(context, '5px');
  write(card.kicker.toLocaleUpperCase(), PAD_Y + (MARK - KICKER.size) / 2, INNER - MARK - 32);
  letterSpacing(context, '0px');

  let y = PAD_Y + MARK + 64;
  context.fillStyle = look.onAccent;
  context.font = serif(layout.headlineSize);
  write(card.headline, y, INNER);
  y += layout.headlineSize + 36;

  context.font = sans(TITLE);
  for (const line of layout.title) {
    write(line, y, INNER);
    y += TITLE.line;
  }

  if (layout.facts.length) {
    y += 28;
    context.font = sans(FACT);
    for (const fact of layout.facts) {
      write(fact, y, INNER);
      y += FACT.line;
    }
  }

  y += 64;
  context.fillStyle = withAlpha(look.onAccent, 0.18);
  context.fillRect(PAD_X, y, INNER, 2);
  y += 2 + 40;

  context.fillStyle = look.onAccentSoft;
  context.font = sans(BYLINE);
  for (const line of layout.byline) {
    write(line, y, INNER);
    y += BYLINE.line;
  }
}

function paintMark(
  context: CanvasRenderingContext2D,
  mark: ShareMark,
  x: number,
  y: number,
  look: ShareLook,
): void {
  context.save();
  if (mark.kind === 'logo') {
    context.fillStyle = '#ffffff';
    roundedRect(context, x, y, MARK, MARK, 28);
    context.fill();
    const room = MARK - 2 * 14;
    const scale = Math.min(room / mark.width, room / mark.height);
    const width = mark.width * scale;
    const height = mark.height * scale;
    context.drawImage(mark.image, x + (MARK - width) / 2, y + (MARK - height) / 2, width, height);
  } else {
    context.fillStyle = look.brand;
    roundedRect(context, x, y, MARK, MARK, 28);
    context.fill();
    context.fillStyle = look.accentBright;
    context.font = sans({ size: 44, weight: 600, line: 44, lines: 1 });
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(mark.text, x + MARK / 2, y + MARK / 2 + 2, MARK - 24);
  }
  context.restore();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/** Letters of the scripts written right to left. */
const RIGHT_TO_LEFT =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

/**
 * A line's own direction, as `dir="auto"` finds it: from its first strong letter, so an Arabic name on
 * an English card, or English words on a right-to-left page, read in their own order. A line with no
 * letter takes the page's.
 */
export function directionOf(text: string, rtl: boolean): CanvasDirection {
  for (const character of text) {
    if (RIGHT_TO_LEFT.test(character)) return 'rtl';
    if (/\p{L}/u.test(character)) return 'ltr';
  }
  return rtl ? 'rtl' : 'ltr';
}

/** Letter spacing where the browser draws it (Chrome 99, Safari 18); plain text elsewhere. */
function letterSpacing(context: CanvasRenderingContext2D, value: string): void {
  if ('letterSpacing' in context)
    context.letterSpacing = value as CanvasRenderingContext2D['letterSpacing'];
}

function sans(style: TextStyle): string {
  return `${style.weight} ${style.size}px ${SHARE_SANS}`;
}

function serif(size: number): string {
  return `italic 400 ${size}px ${SHARE_SERIF}`;
}

/** `#rrggbb` as `rgba(...)` with the given opacity. */
function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
