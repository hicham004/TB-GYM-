import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkPrerender } from './check-prerender.mjs';

const HEAD = `<head><title>TB Gym</title>
<meta name="description" content="TB Gym brings training together.">
<meta property="og:title" content="TB Gym: coach both sides of the week">
<meta property="og:description" content="One place.">
<meta property="og:image" content="/images/og-home.jpg">
<meta property="og:image:alt" content="A coach.">
<meta name="twitter:card" content="summary_large_image"></head>`;

const STATE =
  '<script id="ng-state" type="application/json">{"tb-gym.rendered-signed-out":true,"__nghData__":[]}</script>';

const TALK = '<section id="talk"><form><input name="name"><button>Send</button></form></section>';

const HOME = `<!doctype html><html>${HEAD}<body><app-root ng-version="22.2.1" ngh="3"><app-home>
<h1 id="home-title">Coach both <br>sides of <br>the week.</h1>${TALK}</app-home></app-root>
<script src="main-ABC.js" type="module"></script>
${STATE}
</body></html>`;

const CHANGELOG = `<!doctype html><html>${HEAD}<body><app-root ng-version="22.2.1" ngh="3"><app-changelog>
<h1>What changed</h1><h2><time datetime="2026-10-13">13 Oct 2026</time></h2><ul><li>The homepage, rebuilt.</li></ul>
</app-changelog></app-root>
<script src="main-ABC.js" type="module"></script>
${STATE}
</body></html>`;

const SHELL = `<!doctype html><html>${HEAD}<body><app-root></app-root>
<script src="main-ABC.js" type="module"></script></body></html>`;

const BUILD = { 'index.html': HOME, 'changelog/index.html': CHANGELOG, 'index.csr.html': SHELL };

/** Writes the given files as a build output and inspects it; a null file is left missing. */
function inspect(files, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tb-gym-prerender-check-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      if (content === null) continue;
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    return checkPrerender(root, options);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The private pre-launch build's homepage (R6.2h): a stand-in drawn, and the noindex tag. */
const PRIVATE_HOME = HOME.replace(
  '<h1 id="home-title">',
  '<app-home-placeholder data-placeholder="hero"><img src="/placeholders/hero.jpg" alt=""><span class="mark">Placeholder · hero.jpg</span></app-home-placeholder><h1 id="home-title">',
).replace('</head>', '<meta name="robots" content="noindex, nofollow"></head>');

const PRIVATE_CHANGELOG = CHANGELOG.replace(
  '</head>',
  '<meta name="robots" content="noindex, nofollow"></head>',
);

test('accepts a build whose homepage and changelog are finished HTML and whose shell is plain', () => {
  assert.deepEqual(inspect(BUILD), []);
});

test('rejects a homepage that lost its headline, a preview tag or the render mark', () => {
  const findings = inspect({
    ...BUILD,
    'index.html': HOME.replace('the week.', 'the month.')
      .replace(/<meta property="og:image" [^>]*>/, '')
      .replace(' ngh="3"', ''),
  });
  assert.equal(findings.length, 3, findings.join('\n'));
  assert.match(findings.join('\n'), /headline "the week\."/);
  assert.match(findings.join('\n'), /og:image tag/);
  assert.match(findings.join('\n'), /hydration mark/);
});

test('rejects a homepage with no session mark for the browser', () => {
  const findings = inspect({
    ...BUILD,
    'index.html': HOME.replace('"tb-gym.rendered-signed-out":true,', ''),
  });
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0], /rendered signed out/);
});

test('rejects a homepage without the Talk-to-us form, or one that loads analytics at build time', () => {
  assert.deepEqual(inspect({ ...BUILD, 'index.html': HOME.replace(TALK, '') }), [
    'index.html does not hold the Talk-to-us form.',
  ]);
  assert.deepEqual(
    inspect({
      ...BUILD,
      'index.html': HOME.replace('</head>', '<script async src="/stats/pa-x.js"></script></head>'),
    }),
    ['index.html loads the analytics script at build time.'],
  );
});

test('rejects an inline script, which the content security policy would refuse', () => {
  const findings = inspect({
    ...BUILD,
    'index.html': HOME.replace(
      '<body>',
      '<body><script>window.__jsaction_bootstrap(document.body,"ng",["click"],[]);</script>',
    ),
  });
  assert.deepEqual(findings, [
    "index.html holds an inline script, which the CSP (script-src 'self') would refuse.",
  ]);
});

test('rejects a changelog that is missing, lost its title or its dated releases', () => {
  assert.match(
    inspect({ ...BUILD, 'changelog/index.html': null }).join('\n'),
    /changelog[\\/]index\.html is missing/,
  );
  const findings = inspect({
    ...BUILD,
    'changelog/index.html': CHANGELOG.replace(
      '<h1>What changed</h1>',
      '<p>What changed</p>',
    ).replace(/<time[^>]*>/, '<span>'),
  });
  assert.match(findings.join('\n'), /title "What changed" as its <h1>/);
  assert.match(findings.join('\n'), /no dated release/);
});

test('rejects a shell that is the homepage or the changelog, and a missing shell', () => {
  assert.match(
    inspect({ ...BUILD, 'index.csr.html': HOME }).join('\n'),
    /index\.csr\.html holds page text/,
  );
  assert.match(
    inspect({ ...BUILD, 'index.csr.html': CHANGELOG }).join('\n'),
    /index\.csr\.html holds page text \("What changed"\)/,
  );
  assert.match(
    inspect({ ...BUILD, 'index.csr.html': null }).join('\n'),
    /index\.csr\.html is missing/,
  );
});

test('a shell that keeps the preview tags is still plain: attribute text is not page text', () => {
  assert.deepEqual(
    inspect({
      ...BUILD,
      'index.csr.html': SHELL.replace('<app-root></app-root>', '<app-root></app-root><!-- ok -->'),
    }),
    [],
  );
});

test('rejects a page that still links the global stylesheet', () => {
  const findings = inspect({
    ...BUILD,
    'changelog/index.html': CHANGELOG.replace(
      '</head>',
      '<link rel="stylesheet" href="styles-ABC.css"></head>',
    ),
  });

  assert.match(findings.join('\n'), /changelog\/index\.html still links the global stylesheet/);
});

// ---- The private pre-launch build's stand-ins must never reach a production build (R6.2h) ----

test('rejects a planted placeholders folder in the output', () => {
  const findings = inspect({ ...BUILD, 'placeholders/hero.jpg': 'planted' });

  assert.deepEqual(findings, [
    'the output holds a placeholders/ folder: the stand-in photographs were copied into it.',
  ]);
});

test('rejects a page or a script that names the placeholders folder, and a page that draws a stand-in', () => {
  assert.deepEqual(
    inspect({
      ...BUILD,
      'index.html': HOME.replace(
        '<h1 id="home-title">',
        '<img src="/placeholders/hero.jpg"><h1 id="home-title">',
      ),
    }),
    ['index.html names the placeholders/ folder: a stand-in photograph is referenced.'],
  );
  assert.deepEqual(
    inspect({ ...BUILD, 'chunk-ABC.js': 'const picture = "/placeholders/team.jpg";' }),
    ['chunk-ABC.js names the placeholders/ folder: a stand-in photograph is referenced.'],
  );
  // A fresh clone's private build draws grey stand-ins and names no file; the mark still gives it away.
  assert.deepEqual(
    inspect({
      ...BUILD,
      'index.html': HOME.replace(
        '<h1 id="home-title">',
        '<app-home-placeholder data-placeholder="hero"><div class="missing"></div></app-home-placeholder><h1 id="home-title">',
      ),
    }),
    ['index.html draws a stand-in photograph, which only the private build may.'],
  );
});

test('rejects a page that asks not to be indexed, which only the private build may', () => {
  const findings = inspect({ ...BUILD, 'changelog/index.html': PRIVATE_CHANGELOG });

  assert.deepEqual(findings, [
    'changelog/index.html carries a robots noindex tag, which only the private build may.',
  ]);
});

test('a picture, a font or a source map cannot serve the folder, so only text files are read', () => {
  const findings = inspect({
    ...BUILD,
    'media/photo.jpg': '/placeholders/hero.jpg in a binary',
    'fonts/x.woff2': 'placeholders/',
    'chunk-ABC.js.map':
      '{"sourcesContent":["// the owner puts stand-ins in src/web/placeholders/"]}',
  });

  assert.deepEqual(findings, []);
});

test('in private mode the stand-ins and the noindex tag are required, and the folder is allowed', () => {
  assert.deepEqual(
    inspect(
      {
        ...BUILD,
        'index.html': PRIVATE_HOME,
        'changelog/index.html': PRIVATE_CHANGELOG,
        'placeholders/hero.jpg': 'the owner’s stand-in',
      },
      { privatePreview: true },
    ),
    [],
  );
  const findings = inspect(BUILD, { privatePreview: true });
  assert.deepEqual(findings, [
    'index.html carries no robots noindex tag, which the private pre-launch build must.',
    'index.html draws no stand-in photograph: this is not the private pre-launch build.',
    'changelog/index.html carries no robots noindex tag, which the private pre-launch build must.',
  ]);
});
