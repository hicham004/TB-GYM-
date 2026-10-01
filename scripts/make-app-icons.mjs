// Renders the TB Gym app icons (UI-REDESIGN-PLAN R2.5c): the "TB." wordmark in IBM Plex Sans
// SemiBold, white on forest with the lime full stop, as the app draws it. Chromium does the
// rendering, so the letters are the real brand face rather than a drawing of it.
//
//   .tools\node\node.exe scripts\make-app-icons.mjs
//
// Writes src/web/public/icons/* and src/web/public/favicon.ico. Commit the PNGs; rerun this only
// when the mark changes.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'src', 'web', 'public');
const { chromium } = createRequire(path.join(root, 'src', 'web', 'package.json'))(
  '@playwright/test',
);

const FOREST = '#153d33';
const LIME = '#d9ed94';

// `rounded` is the ordinary icon (the corners are transparent); `full` fills the square, for iOS,
// which draws its own corners; `maskable` fills it and keeps the mark inside the safe circle, since
// Android cuts the icon to whatever shape the launcher uses.
const ICONS = [
  { file: 'icons/icon-192.png', size: 192, shape: 'rounded' },
  { file: 'icons/icon-512.png', size: 512, shape: 'rounded' },
  { file: 'icons/icon-maskable-512.png', size: 512, shape: 'maskable' },
  { file: 'icons/apple-touch-icon.png', size: 180, shape: 'full' },
  { file: 'icons/favicon-32.png', size: 32, shape: 'rounded' },
];
const FAVICON_SIZES = [16, 32, 48];

const font = (
  await readFile(path.join(pub, 'fonts', 'ibm-plex', 'IBMPlexSans-SemiBold.woff2'))
).toString('base64');

function page(size, shape) {
  const radius = shape === 'rounded' ? size * 0.22 : 0;
  const mark = size * (shape === 'maskable' ? 0.4 : 0.5);
  return `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: Plex; font-weight: 600; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    html, body { background: transparent; margin: 0; }
    .icon { align-items: center; background: ${FOREST}; block-size: ${size}px; border-radius: ${radius}px;
      display: flex; inline-size: ${size}px; justify-content: center; }
    .mark { color: #fff; font: 600 ${mark}px/1 Plex, sans-serif; letter-spacing: -0.07em; padding-inline-end: 0.07em;
      transform: translateY(-0.02em); }
    .dot { color: ${LIME}; }
  </style><div class="icon"><span class="mark">TB<span class="dot">.</span></span></div>`;
}

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1 });

async function render(size, shape) {
  const tab = await context.newPage();
  await tab.setViewportSize({ width: size, height: size });
  await tab.setContent(page(size, shape));
  await tab.evaluate(() => document.fonts.load('600 40px Plex'));
  await tab.evaluate(() => document.fonts.ready);
  const png = await tab.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: true,
  });
  await tab.close();
  return png;
}

await mkdir(path.join(pub, 'icons'), { recursive: true });
for (const { file, size, shape } of ICONS) {
  await writeFile(path.join(pub, file), await render(size, shape));
  console.log(`${file} ${size}x${size} ${shape}`);
}

// A multi-size .ico whose images are PNGs, which every current browser reads.
const images = [];
for (const size of FAVICON_SIZES) images.push({ size, png: await render(size, 'rounded') });
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, png }, index) => {
  const entry = 6 + 16 * index;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(path.join(pub, 'favicon.ico'), Buffer.concat([header, ...images.map((i) => i.png)]));
console.log(`favicon.ico ${FAVICON_SIZES.join(', ')}`);

await browser.close();
