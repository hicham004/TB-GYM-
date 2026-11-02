// A QR code of the address for scripts/demo-day.ps1 (docs/MOTION-PLAN-2026-11.md, W2), with no
// package: byte mode, error correction level L, versions 1 to 5 (up to 106 bytes) and mask 0, laid
// out as ISO/IEC 18004 says. Prints the symbol with its four-module quiet zone as rows of '#' (dark)
// and ' ' (light); the script draws those with block characters. scripts/demo-day-qr.test.mjs checks
// the arithmetic against the standard's published numbers.
//
//   node scripts/demo-day-qr.mjs https://192.168.1.20:4200

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Data and error-correction codewords per version at level L, one block each (versions 1 to 5). */
const DATA_CODEWORDS = [0, 19, 34, 55, 80, 108];
const EC_CODEWORDS = [0, 7, 10, 15, 20, 26];
const QUIET_ZONE = 4;

/** GF(256) product with the QR code's primitive polynomial x^8 + x^4 + x^3 + x^2 + 1. */
function multiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The Reed-Solomon generator polynomial of the given degree, highest power first, monic. */
function generator(degree) {
  const result = new Array(degree - 1).fill(0).concat([1]);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiply(root, 2);
  }
  return result;
}

/** The `degree` error-correction codewords for the data codewords. */
export function errorCorrection(data, degree) {
  const divisor = generator(degree);
  const result = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] ^= multiply(coefficient, factor);
    });
  }
  return result;
}

/** The 15 format bits for level L and the given mask pattern, BCH-coded and XOR-masked. */
export function formatBits(mask) {
  const data = (1 << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

/** The symbol for `text` as a square array of booleans (true is dark), without the quiet zone. */
export function encode(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const version = [1, 2, 3, 4, 5].find((candidate) => DATA_CODEWORDS[candidate] >= bytes.length + 2);
  if (version === undefined) {
    throw new Error('The text is too long for a QR code this script draws (106 bytes at most).');
  }

  const bits = [];
  const push = (value, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  bytes.forEach((byte) => push(byte, 8));
  const capacity = DATA_CODEWORDS[version] * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return draw(version, data.concat(errorCorrection(data, EC_CODEWORDS[version])));
}

function draw(version, codewords) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  // Timing patterns, then the three finders with their separators.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [centreX, centreY] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = centreX + dx;
        const y = centreY + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  // The one alignment pattern of versions 2 to 6, centred at size - 7.
  if (version >= 2) {
    const centre = size - 7;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        set(centre + dx, centre + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  // Format information, both copies, and the dark module.
  const format = formatBits(0);
  const bit = (i) => ((format >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);

  // The codewords, two columns at a time from the bottom right, skipping the timing column, then
  // mask 0 over every module that is not a function pattern.
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (reserved[y][x]) continue;
        let dark = false;
        if (index < codewords.length * 8) {
          dark = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
          index++;
        }
        modules[y][x] = dark !== ((x + y) % 2 === 0);
      }
    }
  }
  return modules;
}

/** The symbol as text rows, '#' dark and ' ' light, with the quiet zone around it. */
export function rows(text) {
  const modules = encode(text);
  const blank = ' '.repeat(modules.length + QUIET_ZONE * 2);
  const margin = ' '.repeat(QUIET_ZONE);
  return [
    ...Array(QUIET_ZONE).fill(blank),
    ...modules.map((row) => margin + row.map((dark) => (dark ? '#' : ' ')).join('') + margin),
    ...Array(QUIET_ZONE).fill(blank),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = process.argv[2];
  if (!text) {
    console.error('Usage: node scripts/demo-day-qr.mjs <text>');
    process.exit(2);
  }
  console.log(rows(text).join('\n'));
}
