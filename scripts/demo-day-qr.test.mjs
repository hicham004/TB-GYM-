// node --test scripts/demo-day-qr.test.mjs
// The QR encoder's arithmetic against ISO/IEC 18004's published numbers, and the symbol's shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, errorCorrection, formatBits, rows } from './demo-day-qr.mjs';

test('Reed-Solomon codewords match the standard’s 1-M HELLO WORLD example', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(errorCorrection(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('the format bits for level L and mask 0 are 111011111000100', () => {
  assert.equal(formatBits(0).toString(2).padStart(15, '0'), '111011111000100');
});

test('a short address is a version 2 symbol with its finders and dark module', () => {
  const modules = encode('https://192.168.10.224:4200');
  assert.equal(modules.length, 25);
  for (const [x, y] of [
    [0, 0],
    [24, 0],
    [0, 24],
    [3, 3],
    [21, 3],
    [3, 21],
  ]) {
    assert.equal(modules[y][x], true, `finder at ${x},${y}`);
  }
  assert.equal(modules[25 - 8][8], true, 'the dark module');
  assert.equal(modules[7][7], false, 'the separator');
});

test('rows carry a four-module quiet zone', () => {
  // 17 bytes is the most a version 1 symbol holds at level L.
  const lines = rows('https://tbgym.app');
  assert.equal(lines.length, 21 + 8);
  assert.ok(lines.every((line) => line.length === 21 + 8));
  assert.ok(lines.slice(0, 4).every((line) => line.trim() === ''));
  assert.ok(lines.every((line) => line.startsWith('    ') && line.endsWith('    ')));
});

test('a text past 106 bytes is refused', () => {
  assert.throws(() => encode('x'.repeat(107)), /too long/);
  assert.equal(encode('x'.repeat(106)).length, 37);
});
