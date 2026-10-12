// Puts the global stylesheet inside the pre-rendered homepage (UI plan R6.2b).
//
// `ng build` writes the homepage as finished HTML (index.html, R6.2a) that links the global
// stylesheet, so a browser cannot paint the page before a second request comes back. The homepage
// is the one page whose first paint is measured against a bar (Lighthouse on a phone), and its
// component styles are already inline from the render; this moves the global sheet (fonts, tokens,
// the base rules; about 5 kB compressed) inline too, so the first paint needs the HTML alone. The
// CSP allows it (`style-src 'unsafe-inline'`, nginx.conf), and the file itself stays in the output
// for the shell (index.csr.html), which keeps its link: every other page starts from the shell.
//
//   node scripts/inline-home-styles.mjs [browser output folder]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'tb-gym-web',
  'browser',
);

const STYLESHEET_LINK = /<link\s+rel="stylesheet"\s+href="(styles-[^"]+\.css)"\s*\/?>/;

/**
 * The homepage with its stylesheet link replaced by the sheet itself, or null when the page holds
 * no link (already inlined, or built without one). `read` gives a file of the output by name.
 */
export function inlineHomeStyles(home, read) {
  const link = STYLESHEET_LINK.exec(home);
  if (!link) return null;
  const css = read(link[1]);
  // The sheet is minified CSS with no "</style" in it; a quote in a url() is fine inside <style>.
  return home.replace(link[0], `<style>${css}</style>`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUTPUT;
  const path = join(directory, 'index.html');
  const home = readFileSync(path, 'utf8');
  const inlined = inlineHomeStyles(home, (name) => readFileSync(join(directory, name), 'utf8'));
  if (inlined === null) {
    console.log(`index.html links no stylesheet; nothing to inline (${directory}).`);
  } else {
    writeFileSync(path, inlined);
    console.log(`The homepage's global stylesheet is inline (${directory}).`);
  }
}
