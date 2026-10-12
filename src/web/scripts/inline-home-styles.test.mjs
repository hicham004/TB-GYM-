import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inlineHomeStyles } from './inline-home-styles.mjs';

const HOME =
  '<!doctype html><html><head><title>TB Gym</title>' +
  '<link rel="stylesheet" href="styles-ABC12345.css">' +
  '<link rel="modulepreload" href="chunk-GHI.js"></head>' +
  '<body><app-root ngh="0"><h1>You plan it.</h1></app-root>' +
  '<script src="polyfills-ABC.js" type="module"></script>' +
  '<script src="main-DEF.js" type="module"></script></body></html>';

test('replaces the stylesheet link with the sheet itself', () => {
  const read = (name) => {
    assert.equal(name, 'styles-ABC12345.css');
    return ':root{--tb-bg:#fbfaf5}';
  };

  const inlined = inlineHomeStyles(HOME, read);

  assert.ok(inlined);
  assert.doesNotMatch(inlined, /<link\s+rel="stylesheet"/);
  assert.match(inlined, /<head><title>TB Gym<\/title><style>:root\{--tb-bg:#fbfaf5\}<\/style>/);
  assert.match(inlined, /<h1>You plan it\.<\/h1>/);
});

test('asks for the page’s scripts at low priority, every module script and nothing else', () => {
  const inlined = inlineHomeStyles(HOME, () => 'body{margin:0}');

  assert.match(inlined, /<script src="polyfills-ABC\.js" type="module" fetchpriority="low">/);
  assert.match(inlined, /<script src="main-DEF\.js" type="module" fetchpriority="low">/);
  assert.match(inlined, /<link rel="modulepreload" href="chunk-GHI\.js" fetchpriority="low">/);
  assert.doesNotMatch(inlined, /<script src="[^"]+" type="module">/);
  assert.doesNotMatch(inlined, /<style>[^<]*fetchpriority/);
});

test('inlines the unhashed sheet of a development build too', () => {
  const page = HOME.replace('styles-ABC12345.css', 'styles.css');

  const inlined = inlineHomeStyles(page, (name) => {
    assert.equal(name, 'styles.css');
    return 'body{margin:0}';
  });

  assert.match(inlined, /<style>body\{margin:0\}<\/style>/);
});

test('leaves a page without a stylesheet link alone', () => {
  const page = HOME.replace('<link rel="stylesheet" href="styles-ABC12345.css">', '');

  assert.equal(
    inlineHomeStyles(page, () => assert.fail('nothing should be read')),
    null,
  );
});

test('inlines only the first stylesheet link once, and does not touch a preload', () => {
  const page = HOME.replace(
    '<link rel="stylesheet"',
    '<link rel="preload" href="/fonts/x.woff2" as="font"><link rel="stylesheet"',
  );

  const inlined = inlineHomeStyles(page, () => 'body{margin:0}');

  assert.match(
    inlined,
    /<link rel="preload" href="\/fonts\/x\.woff2" as="font"><style>body\{margin:0\}<\/style>/,
  );
});
