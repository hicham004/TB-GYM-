import {
  directionOf,
  layOutCard,
  letterSpacing,
  paintBackground,
  paintTiltedCard,
  roundedRect,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  SHARE_SANS,
  type ShareLook,
  type ShareMark,
} from './share-card-paint';
import type { ShareCard } from './share-card.models';

/** A decoded photo and its size in pixels. */
export interface SharePicture {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

const MARGIN_X = 64;
const GAP = 32;
/** The least room above the photos and under the card; the two sit as one block in the middle. */
const TOP = 96;
const FOOT = 72;
/** Between the photos' foot and the card, which never covers any of either photo. */
const CARD_GAP = 72;
const FRAME_RADIUS = 40;
/** A before-and-after's headline leaves the photos the room. */
const HEADLINE_LARGEST = 180;
/** The frames are as tall as the taller photo's shape, from square to a phone's 9:16. */
const TALLEST = 16 / 9;
const PILL_INSET = 24;
const PILL_HEIGHT = 60;
const PILL_PAD_X = 24;

/**
 * Draws a before-and-after (R6.1b) on a story-sized canvas: the brand behind, the two photos side by
 * side in frames of one size, each whole and as taken, never cropped, covered or retouched, labelled
 * Before and After, and under them the tilted accent card with the time between them, the day each was
 * taken and who made it, the two as one block in the middle of the story. A right-to-left page reads
 * the earlier photo first, on the right.
 */
export function paintBeforeAfterCard(
  context: CanvasRenderingContext2D,
  card: ShareCard,
  look: ShareLook,
  mark: ShareMark,
  pictures: { readonly before: SharePicture; readonly after: SharePicture },
  rtl = false,
): void {
  paintBackground(context, look);
  const layout = layOutCard(context, card, HEADLINE_LARGEST);

  const shape = Math.min(TALLEST, Math.max(1, ratio(pictures.before), ratio(pictures.after)));
  let width = (SHARE_IMAGE_WIDTH - 2 * MARGIN_X - GAP) / 2;
  let height = width * shape;
  const room = SHARE_IMAGE_HEIGHT - TOP - FOOT - CARD_GAP - layout.height;
  if (height > room) {
    height = room;
    width = height / shape;
  }
  const left = (SHARE_IMAGE_WIDTH - 2 * width - GAP) / 2;
  const top = Math.max(TOP, (SHARE_IMAGE_HEIGHT - height - CARD_GAP - layout.height) / 2);
  const cardTop = top + height + CARD_GAP;

  const labels = card.photos;
  const first = { picture: pictures.before, label: labels?.before.label ?? '' };
  const second = { picture: pictures.after, label: labels?.after.label ?? '' };
  const [atLeft, atRight] = rtl ? [second, first] : [first, second];
  paintPhoto(context, atLeft.picture, atLeft.label, left, top, width, height, look, rtl);
  paintPhoto(
    context,
    atRight.picture,
    atRight.label,
    left + width + GAP,
    top,
    width,
    height,
    look,
    rtl,
  );

  paintTiltedCard(context, card, layout, look, mark, rtl, cardTop + layout.height / 2);
}

function ratio(picture: SharePicture): number {
  return picture.width > 0 ? picture.height / picture.width : 1;
}

function paintPhoto(
  context: CanvasRenderingContext2D,
  picture: SharePicture,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  look: ShareLook,
  rtl: boolean,
): void {
  // The frame lifts off the brand as the card does; any room the photo leaves is the night tone.
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.36)';
  context.shadowBlur = 64;
  context.shadowOffsetY = 32;
  context.fillStyle = look.night;
  roundedRect(context, x, y, width, height, FRAME_RADIUS);
  context.fill();
  context.restore();

  context.save();
  roundedRect(context, x, y, width, height, FRAME_RADIUS);
  context.clip();
  const scale = Math.min(width / picture.width, height / picture.height);
  const drawnWidth = picture.width * scale;
  const drawnHeight = picture.height * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    picture.image,
    x + (width - drawnWidth) / 2,
    y + (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
  context.restore();

  if (label)
    paintPill(
      context,
      label,
      rtl ? x + width - PILL_INSET : x + PILL_INSET,
      y + PILL_INSET,
      look,
      rtl,
    );
}

/** "BEFORE" on an accent pill in the photo's top corner, the one a reader meets first. */
function paintPill(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  look: ShareLook,
  rtl: boolean,
): void {
  context.save();
  const words = label.toLocaleUpperCase();
  context.font = `600 30px ${SHARE_SANS}`;
  letterSpacing(context, '4px');
  const width = context.measureText(words).width + 2 * PILL_PAD_X;
  const left = rtl ? x - width : x;
  context.fillStyle = look.accent;
  roundedRect(context, left, y, width, PILL_HEIGHT, PILL_HEIGHT / 2);
  context.fill();
  context.fillStyle = look.onAccent;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.direction = directionOf(words, rtl);
  context.fillText(words, left + width / 2, y + PILL_HEIGHT / 2 + 1);
  context.restore();
}
