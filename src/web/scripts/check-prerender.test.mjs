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
function inspect(files) {
  const root = mkdtempSync(join(tmpdir(), 'tb-gym-prerender-check-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      if (content === null) continue;
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    return checkPrerender(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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
