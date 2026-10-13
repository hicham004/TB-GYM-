import assert from 'node:assert/strict';
import { test } from 'node:test';
import { phoneOutline, screenInOutline } from './home-pictures.mjs';

// A small frame shaped like Apple's: its outer corners (radius 16) round off more than the
// window's rectangle (6..38 x 6..58) reaches, so the window's own corners lie past the frame.
const WIDTH = 44;
const HEIGHT = 64;
const WINDOW = { left: 6, top: 6, screenWidth: 32, screenHeight: 52 };

function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const nearestX = Math.min(Math.max(x, left + radius), right - radius);
  const nearestY = Math.min(Math.max(y, top + radius), bottom - radius);
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

/** The frame's alpha: opaque band, a one-pixel soft outer edge, a clear window, an opaque island. */
function frameAlpha({ gapAtRow } = {}) {
  const alpha = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      let value = 0;
      if (inRoundedRect(cx, cy, 2, 2, 42, 62, 16)) value = 255;
      else if (inRoundedRect(cx, cy, 1, 1, 43, 63, 17)) value = 128;
      if (inRoundedRect(cx, cy, 6, 6, 38, 58, 12)) value = 0;
      if (x >= 20 && x < 24 && y >= 8 && y < 10) value = 255;
      if (y === gapAtRow && x < 6) value = 0;
      alpha[y * WIDTH + x] = value;
    }
  }
  return alpha;
}

const at = (x, y) => y * WIDTH + x;

test('the outline holds the frame, its window and the island, and nothing around them', () => {
  const inside = phoneOutline(frameAlpha(), WIDTH, HEIGHT);

  assert.equal(inside[at(0, 0)], 0, 'the picture’s corner');
  assert.equal(inside[at(3, 32)], 1, 'the frame’s band');
  assert.equal(inside[at(22, 32)], 1, 'the middle of the window');
  assert.equal(inside[at(21, 8)], 1, 'the island');
  assert.equal(inside[at(1, 32)], 0, 'the soft outer edge belongs to the space around');
  assert.equal(inside[at(6, 6)], 0, 'the window’s square corner lies past the round frame');
});

test('the screen keeps only what lies inside the outline', () => {
  const inside = phoneOutline(frameAlpha(), WIDTH, HEIGHT);
  const screen = Buffer.alloc(WINDOW.screenWidth * WINDOW.screenHeight * 4);
  for (let index = 0; index < screen.length; index += 4) screen.set([200, 30, 30, 255], index);

  const layer = screenInOutline(screen, { width: WIDTH, height: HEIGHT, ...WINDOW, inside });

  for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
    if (layer[index * 4 + 3] > 0) assert.equal(inside[index], 1, `pixel ${index} is outside`);
  }
  assert.equal(layer[at(6, 6) * 4 + 3], 0, 'no square corner');
  assert.deepEqual([...layer.subarray(at(22, 32) * 4, at(22, 32) * 4 + 4)], [200, 30, 30, 255]);
  let kept = 0;
  let windowInside = 0;
  for (let y = WINDOW.top; y < WINDOW.top + WINDOW.screenHeight; y += 1) {
    for (let x = WINDOW.left; x < WINDOW.left + WINDOW.screenWidth; x += 1) {
      if (layer[at(x, y) * 4 + 3] > 0) kept += 1;
      if (inside[at(x, y)]) windowInside += 1;
    }
  }
  assert.equal(kept, windowInside, 'every part of the window inside the outline keeps its screen');
});

test('a frame with a gap lets the space around into the window, which compose refuses', () => {
  const inside = phoneOutline(frameAlpha({ gapAtRow: 32 }), WIDTH, HEIGHT);

  assert.equal(inside[at(22, 32)], 0);
});
