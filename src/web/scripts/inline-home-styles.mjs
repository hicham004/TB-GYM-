// Puts the global stylesheet inside the pre-rendered pages (UI plan R6.2b, R6.2f, audit UIQ-13).
//
// `ng build` writes the homepage, what changed and sign-in as finished HTML (R6.2a) that links the
// global stylesheet, so a browser cannot paint a page before a second request comes back. The
// homepage is the one page whose first paint is measured against a bar (Lighthouse on a phone), and
// sign-in is where the installed app starts; their component styles are already inline from the
// render, and this moves the global sheet (fonts, tokens, the base rules; about 5 kB compressed)
// inline too, so the first paint needs the HTML alone. The CSP allows it (`style-src
// 'unsafe-inline'`, nginx.conf), and the file itself stays in the output for the shell
// (index.csr.html), which keeps its link: every other page starts from the shell.
//
//   node scripts/inline-home-styles.mjs [browser output folder]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'tb-gym-web',
  'browser',
);

// `styles-<hash>.css` in production, `styles.css` in a development build (the `built` checks).
const STYLESHEET_LINK = /<link\s+rel="stylesheet"\s+href="(styles(?:-[^"]+)?\.css)"\s*\/?>/;

const MODULE_SCRIPT = /<script src="([^"]+)" type="module">/g;
const MODULE_PRELOAD = /<link rel="modulepreload" href="([^"]+)">/g;

/**
 * The page with its stylesheet link replaced by the sheet itself, or null when the page holds no
 * link (already inlined, or built without one). `read` gives a file of the output by name.
 *
 * The page's scripts are asked for at low priority too (UI plan R6.2f), unless `lowPriorityScripts`
 * is false: the homepage and what changed are complete before the app runs, so on a slow connection
 * their words and pictures should not wait behind the bundle that only makes them interactive. Sign-in
 * keeps its scripts at full priority, because its form needs the app to send (audit UIQ-13), and so
 * does the shell, which has nothing to show without them.
 */
export function inlineHomeStyles(home, read, { lowPriorityScripts = true } = {}) {
  const link = STYLESHEET_LINK.exec(home);
  if (!link) return null;
  const css = read(link[1]);
  // The sheet is minified CSS with no "</style" in it; a quote in a url() is fine inside <style>.
  const inlined = home.replace(link[0], `<style>${css}</style>`);
  return lowPriorityScripts
    ? inlined
        .replace(MODULE_PRELOAD, '<link rel="modulepreload" href="$1" fetchpriority="low">')
        .replace(MODULE_SCRIPT, '<script src="$1" type="module" fetchpriority="low">')
    : inlined;
}

/**
 * The pre-rendered pages, when the build wrote them: the homepage, what changed (UI plan R6.2f) and
 * sign-in (audit UIQ-13).
 */
export const PRERENDERED_DOCUMENTS = [
  'index.html',
  'changelog/index.html',
  'auth/sign-in/index.html',
];

/** The pre-rendered pages whose scripts wait behind their words and pictures (see above). */
export const LOW_PRIORITY_SCRIPTS = new Set(['index.html', 'changelog/index.html']);

/** `inlineHomeStyles` for one of PRERENDERED_DOCUMENTS, with that document's script priority. */
export function inlinePrerenderedDocument(document, page, read) {
  return inlineHomeStyles(page, read, { lowPriorityScripts: LOW_PRIORITY_SCRIPTS.has(document) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUTPUT;
  for (const document of PRERENDERED_DOCUMENTS) {
    const path = join(directory, document);
    if (!existsSync(path)) continue;
    const page = readFileSync(path, 'utf8');
    const inlined = inlinePrerenderedDocument(document, page, (name) =>
      readFileSync(join(directory, name), 'utf8'),
    );
    if (inlined === null) {
      console.log(`${document} links no stylesheet; nothing to inline (${directory}).`);
    } else {
      writeFileSync(path, inlined);
      console.log(`${document}: the global stylesheet is inline (${directory}).`);
    }
  }
}
