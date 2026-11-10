import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { composePlan, phoneOutline, screenInOutline } from './home-pictures.mjs';

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

// What capture leaves in its folder: a phone in light and dark, the coach's Training page and the
// two status bars it draws for the phones.
const SHOTS = [
  'client-today.png',
  'client-today-dark.png',
  'coach-client-training-dark.png',
  'statusbar-on-light.png',
  'statusbar-on-dark.png',
];
const nowhere = () => false;
const names = (windows) => windows.map((window) => window.name);

test('a coach window alone is planned with no bezel and no status bars', () => {
  const plan = composePlan(
    { only: 'coach-client-training-dark,maxes-dark' },
    ['coach-client-training-dark.png'],
    nowhere,
  );

  assert.deepEqual(plan.phones, []);
  assert.deepEqual(names(plan.windows), ['maxes-dark']);
});

test('a window chosen beside phones in the folder still needs no bezel', () => {
  const plan = composePlan({ only: 'maxes-dark' }, SHOTS, nowhere);

  assert.deepEqual(plan.phones, []);
  assert.deepEqual(names(plan.windows), ['maxes-dark']);
});

test('a phone without the bezel is refused, naming it', () => {
  assert.throws(
    () => composePlan({ only: 'client-today' }, SHOTS, nowhere),
    /The phones client-today, client-today-dark need --bezel with the path to Apple’s portrait/,
  );
});

test('a bezel that is not there is refused by its path', () => {
  assert.throws(
    () => composePlan({ only: 'client-today', bezel: 'C:/bezels/iPhone 17.png' }, SHOTS, nowhere),
    /need the bezel at C:\/bezels\/iPhone 17\.png, which is not there\.$/,
  );
});

test('a phone without the status bars capture draws is refused, naming each', () => {
  const withoutBars = SHOTS.filter((file) => !file.startsWith('statusbar-'));

  assert.throws(
    () => composePlan({ only: 'client-today', bezel: 'bezel.png' }, withoutBars, () => true),
    /need statusbar-on-light\.png, which capture draws; statusbar-on-dark\.png, which capture draws\.$/,
  );
});

test('a phone with its bezel and both status bars is planned, in light and dark', () => {
  const plan = composePlan(
    { only: 'client-today', bezel: 'bezel.png' },
    SHOTS,
    (path) => path === 'bezel.png',
  );

  assert.deepEqual(plan.phones, ['client-today', 'client-today-dark']);
  assert.deepEqual(plan.windows, []);
});

test('with no --only every phone in the folder needs the bezel, and coach shots alone do not', () => {
  assert.throws(() => composePlan({}, SHOTS, nowhere), /need --bezel/);

  const plan = composePlan({}, ['coach-client-training-dark.png'], nowhere);
  assert.deepEqual(plan.phones, []);
  assert.ok(names(plan.windows).includes('maxes-dark'));
});

test('every coach window lies inside the 1440 x 900 screen it is cut from', () => {
  for (const window of composePlan({}, [], nowhere).windows) {
    assert.ok(window.left >= 0 && window.top >= 0, window.name);
    assert.ok(window.left + window.width <= 1440, `${window.name} runs past the right edge`);
    assert.ok(window.top + window.height <= 900, `${window.name} runs past the foot`);
  }
});

/**
 * Runs `compose` itself on a shots folder holding one phone shot and no coach shot, with a `sharp`
 * that throws the moment anything is opened, so a bezel or a status bar read shows as a failure.
 */
function composeIn(t, ...args) {
  const root = mkdtempSync(join(tmpdir(), 'tb-home-compose-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = join(root, 'tools');
  mkdirSync(join(tools, 'node_modules', 'sharp'), { recursive: true });
  writeFileSync(join(tools, 'package.json'), '{}');
  writeFileSync(
    join(tools, 'node_modules', 'sharp', 'index.js'),
    "module.exports = (file) => { throw new Error('sharp opened ' + file); };",
  );
  const shots = join(root, 'shots');
  mkdirSync(shots);
  writeFileSync(join(shots, 'client-today.png'), '');
  const out = join(root, 'out');
  const script = fileURLToPath(new URL('./home-pictures.mjs', import.meta.url));
  const run = spawnSync(
    process.execPath,
    [script, 'compose', '--shots', shots, '--out', out, ...args],
    { env: { ...process.env, TB_HOME_TOOLS: tools }, encoding: 'utf8' },
  );
  return { run, out };
}

test('compose makes a window alone without opening a bezel or a status bar', (t) => {
  const { run } = composeIn(t, '--only', 'maxes-dark');

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /skip maxes-dark: no coach-client-training-dark\.png/);
});

test('compose refuses a phone without the bezel before it makes anything', (t) => {
  const { run, out } = composeIn(t, '--only', 'client-today');

  assert.equal(run.status, 1);
  assert.match(run.stderr, /The phones client-today need --bezel/);
  assert.equal(existsSync(out), false);
});
