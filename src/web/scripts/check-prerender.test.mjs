import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPrerender } from './check-prerender.mjs';

const HEAD = `<head><title>TB Gym</title>
<meta name="description" content="TB Gym brings training together.">
<meta property="og:title" content="TB Gym: you plan it, they lift it, you both see it">
<meta property="og:description" content="One place.">
<meta property="og:image" content="/images/og-home.jpg">
<meta property="og:image:alt" content="A coach.">
<meta name="twitter:card" content="summary_large_image"></head>`;

const HOME = `<!doctype html><html>${HEAD}<body><app-root ng-version="22.2.1" ngh="3"><app-home>
<h1 id="home-title">You plan it. They lift it. <em>You both see it.</em></h1></app-home></app-root>
<script src="main-ABC.js" type="module"></script>
<script id="ng-state" type="application/json">{"tb-gym.rendered-signed-out":true,"__nghData__":[]}</script>
</body></html>`;

const SHELL = `<!doctype html><html>${HEAD}<body><app-root></app-root>
<script src="main-ABC.js" type="module"></script></body></html>`;

/** Writes the given files as a build output and inspects it; a null file is left missing. */
function inspect(files) {
  const root = mkdtempSync(join(tmpdir(), 'tb-gym-prerender-check-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      if (content !== null) writeFileSync(join(root, name), content);
    }
    return checkPrerender(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('accepts a build whose homepage is finished HTML and whose shell is plain', () => {
  assert.deepEqual(inspect({ 'index.html': HOME, 'index.csr.html': SHELL }), []);
});

test('rejects a homepage that lost its headline, a preview tag or the render mark', () => {
  const findings = inspect({
    'index.html': HOME.replace('You both see it.', 'You see it both.')
      .replace(/<meta property="og:image" [^>]*>/, '')
      .replace(' ngh="3"', ''),
    'index.csr.html': SHELL,
  });
  assert.equal(findings.length, 3, findings.join('\n'));
  assert.match(findings.join('\n'), /headline "You both see it\."/);
  assert.match(findings.join('\n'), /og:image tag/);
  assert.match(findings.join('\n'), /hydration mark/);
});

test('rejects a homepage with no session mark for the browser', () => {
  const findings = inspect({
    'index.html': HOME.replace('"tb-gym.rendered-signed-out":true,', ''),
    'index.csr.html': SHELL,
  });
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0], /rendered signed out/);
});

test('rejects an inline script, which the content security policy would refuse', () => {
  const findings = inspect({
    'index.html': HOME.replace(
      '<body>',
      '<body><script>window.__jsaction_bootstrap(document.body,"ng",["click"],[]);</script>',
    ),
    'index.csr.html': SHELL,
  });
  assert.deepEqual(findings, [
    "index.html holds an inline script, which the CSP (script-src 'self') would refuse.",
  ]);
});

test('rejects a shell that is the homepage, and a missing shell', () => {
  assert.match(
    inspect({ 'index.html': HOME, 'index.csr.html': HOME }).join('\n'),
    /index\.csr\.html holds homepage text/,
  );
  assert.match(
    inspect({ 'index.html': HOME, 'index.csr.html': null }).join('\n'),
    /index\.csr\.html is missing/,
  );
});

test('a shell that keeps the preview tags is still plain: attribute text is not page text', () => {
  assert.deepEqual(
    inspect({
      'index.html': HOME,
      'index.csr.html': SHELL.replace('<app-root></app-root>', '<app-root></app-root><!-- ok -->'),
    }),
    [],
  );
});

test('rejects a homepage that still links the global stylesheet', () => {
  const findings = inspect({
    'index.html': HOME.replace('</head>', '<link rel="stylesheet" href="styles-ABC.css"></head>'),
    'index.csr.html': SHELL,
  });

  assert.match(findings.join('\n'), /still links the global stylesheet/);
});
