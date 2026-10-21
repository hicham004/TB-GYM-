import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  answerAsVisitor,
  authorized,
  findPlaceholders,
  PLACEHOLDER_FILES,
  placeholdersModule,
  withoutWindowPreload,
} from './private-preview.mjs';

test('finds the stand-ins a folder holds, in the page’s order, and names the rest as missing', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tb-gym-placeholders-'));
  try {
    writeFileSync(join(folder, 'hero.jpg'), 'jpeg');
    writeFileSync(join(folder, 'team.jpg'), 'jpeg');
    writeFileSync(join(folder, 'README.md'), 'not a picture');

    assert.deepEqual(findPlaceholders(folder), [
      { name: 'hero', file: 'hero.jpg', found: true },
      { name: 'train', file: 'train.jpg', found: false },
      { name: 'talk', file: 'talk.jpg', found: false },
      { name: 'team', file: 'team.jpg', found: true },
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('writes the module the private build reads: an address for each file found, null for the rest', () => {
  const found = PLACEHOLDER_FILES.map((picture) => ({
    ...picture,
    found: picture.name === 'talk',
  }));

  const module = placeholdersModule(found, new Date('2026-10-13T09:00:00Z'));

  assert.match(
    module,
    /^\/\/ Written by scripts\/private-preview\.mjs on 2026-10-13T09:00:00\.000Z/,
  );
  assert.match(
    module,
    /import type \{ PlaceholderSet \} from '\.\.\/src\/app\/features\/home\/home-placeholder';/,
  );
  assert.match(module, /export const PLACEHOLDERS: PlaceholderSet \| null = \{/);
  assert.match(module, /hero: \{ name: 'hero', file: 'hero\.jpg', src: null \},/);
  assert.match(
    module,
    /talk: \{ name: 'talk', file: 'talk\.jpg', src: '\/placeholders\/talk\.jpg' \},/,
  );
  assert.equal(module.match(/src: null/g)?.length, 3);
});

test('lets a request in with the password under any user name, and nothing else', () => {
  const header = (user, password) =>
    `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;

  assert.equal(authorized(header('partner', 'open-sesame'), 'open-sesame'), true);
  assert.equal(authorized(header('', 'open-sesame'), 'open-sesame'), true);
  assert.equal(authorized(header('partner', 'open-sesam'), 'open-sesame'), false);
  assert.equal(authorized(header('partner', 'open-sesame-'), 'open-sesame'), false);
  assert.equal(authorized(undefined, 'open-sesame'), false);
  assert.equal(authorized('Bearer open-sesame', 'open-sesame'), false);
  assert.equal(authorized('Basic not*base64', 'open-sesame'), false);
});

test('answers what a signed-out visitor’s page asks for, and leaves the rest to the 404', () => {
  const answers = [];
  const response = {
    writeHead: (status, headers) => answers.push({ status, headers }),
    end: (body) => answers.push({ body: JSON.parse(body) }),
  };
  const ask = (pathname) =>
    answerAsVisitor(new URL(pathname, 'http://127.0.0.1'), response, { 'X-Robots-Tag': 'noindex' });

  // Nobody is signed in, as the API says it: 200 with JSON null (audit AUTH-12).
  assert.equal(ask('/api/auth/me'), true);
  assert.equal(answers[0].status, 200);
  assert.equal(answers[1].body, null);
  assert.equal(answers[0].headers['X-Robots-Tag'], 'noindex');
  assert.equal(ask('/api/website/settings'), true);
  assert.deepEqual(answers[3].body, { whatsAppNumber: null, analytics: { script: null } });
  assert.equal(ask('/api/website/contact-form'), false);
  assert.equal(answers.length, 4);
});

test('drops the preload of the coach’s window, which the private hero does not draw, and nothing else', () => {
  const head =
    '<link rel="preload" as="image" type="image/avif" imagesrcset="/images/home/client-today-460.avif 460w" imagesizes="350px" media="(min-width: 1100px)">\n' +
    '    <link rel="preload" as="image" type="image/avif" imagesrcset="/images/home/today-needs-you-dark-1x.avif 1x, /images/home/today-needs-you-dark.avif 2x" media="(min-width: 1100px)">\n' +
    '    <link rel="preload" href="/fonts/x.woff2" as="font" type="font/woff2" crossorigin>';

  const stripped = withoutWindowPreload(`<head>${head}</head>`);

  assert.doesNotMatch(stripped, /today-needs-you-dark/);
  assert.match(stripped, /client-today-460\.avif/);
  assert.match(stripped, /fonts\/x\.woff2/);
  assert.equal(withoutWindowPreload('<head></head>'), '<head></head>');
});
