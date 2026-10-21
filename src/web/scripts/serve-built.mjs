// Serves a build of the app the way nginx.conf does (UI plan R6.2a), for the `built` Playwright
// project: "/", "/changelog" and "/auth/sign-in" answer their pre-rendered pages, or the plain shell
// when the request carries the sign-in cookie; a missing file answers 404 with the shell (audit
// AUTH-10); any other address answers its file, or else the plain shell. nginx's security headers
// are sent too, so a page that would need an inline script fails here as in production.
// private-preview.mjs serves the private pre-launch build (R6.2h) through the same server.
//
//   node scripts/serve-built.mjs [--port 4301] [--build]
//
// --build first runs `ng build --configuration development` into .e2e-dist when no build is there or
// a source file is newer than it, then checks the output with check-prerender.mjs. The development
// configuration is chosen on purpose: Angular compares the rendered page with what it would draw only
// in development mode, so a hydration mismatch fails the tests instead of passing unseen.
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPrerender } from './check-prerender.mjs';
import { inlinePrerenderedDocument, PRERENDERED_DOCUMENTS } from './inline-home-styles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.e2e-dist');
const browser = join(output, 'browser');

/** The test nginx.conf applies to the Cookie header: the API's cookie in either environment's spelling. */
export const SIGNED_IN_COOKIE = /(^|;\s*)(__Host-)?tb-gym\.auth=/;

/** nginx.conf's headers, repeated so the served page is judged by the same policy. */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:",
};

/** The content types a build output needs; nginx's own table has them all. */
export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** The paths nginx.conf proxies to the API; a static server has nothing behind them. */
export const API_PATHS = /^\/(api|health|hubs|openapi)(\/|$)/;

/** The addresses the build renders ahead of time, with the document each is for a visitor. */
export const PRERENDERED_PAGES = {
  '/': 'index.html',
  '/changelog': 'changelog/index.html',
  '/auth/sign-in': 'auth/sign-in/index.html',
};

/** A pre-rendered page by its file's name, or an address ending in a slash: nginx gives the shell. */
const OTHER_SPELLING = /(^|\/)index\.html$|\/$/;

/** An address whose last segment has a file extension names a file, not a screen of the app. */
const FILE_ADDRESS = /\.[A-Za-z0-9]+$/;

/**
 * Which file answers a request, and its status: nginx.conf's rules. A pre-rendered page goes to a
 * visitor only; someone signed in gets the shell. A missing file is a 404 with the shell. `exists`
 * says whether a relative path is a file in the build output.
 */
export function documentFor(pathname, cookie, exists) {
  if (Object.hasOwn(PRERENDERED_PAGES, pathname)) {
    const signedIn = SIGNED_IN_COOKIE.test(cookie ?? '');
    return { file: signedIn ? 'index.csr.html' : PRERENDERED_PAGES[pathname], status: 200 };
  }
  if (OTHER_SPELLING.test(pathname)) return { file: 'index.csr.html', status: 200 };
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, '');
  if (relative === '' || relative.split(/[\\/]/).includes('..')) {
    return { file: 'index.csr.html', status: 200 };
  }
  if (exists(relative)) return { file: relative, status: 200 };
  return { file: 'index.csr.html', status: FILE_ADDRESS.test(pathname) ? 404 : 200 };
}

/** The newest change under the given paths, as a timestamp. */
export function newestChange(paths) {
  let newest = 0;
  const visit = (path) => {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats) return;
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
    } else {
      newest = Math.max(newest, stats.mtimeMs);
    }
  };
  for (const path of paths) visit(path);
  return newest;
}

/** The sources a build depends on, for telling a stale output from a current one. */
export const BUILD_SOURCES = [
  'src',
  'public',
  'angular.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.app.json',
].map((path) => join(root, path));

/**
 * A server for a build output (`browserDirectory`, the folder holding index.html), answering as
 * nginx.conf would. `extraHeaders` go on every response; `intercept(request, response, url)` may
 * answer a request itself first and return true, for a proxy or a stand-in API.
 */
export function createSiteServer(browserDirectory, { extraHeaders = {}, intercept } = {}) {
  const headersFor = (file) => ({
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  const isFile = (relative) => {
    const file = join(browserDirectory, relative);
    return file.startsWith(browserDirectory + sep) && existsSync(file) && statSync(file).isFile();
  };
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    if (intercept?.(request, response, url)) return;
    // nginx proxies these to the API; here there is none, and the shell must not stand in for it.
    if (API_PATHS.test(url.pathname)) {
      response.writeHead(404, {
        'Content-Type': 'application/json',
        ...SECURITY_HEADERS,
        ...extraHeaders,
      });
      response.end('{"title":"No API behind this server"}');
      return;
    }
    const answer = documentFor(url.pathname, request.headers.cookie, isFile);
    const file = join(browserDirectory, answer.file);
    const headers = headersFor(file);
    if (Object.hasOwn(PRERENDERED_PAGES, url.pathname)) headers['Cache-Control'] = 'no-cache';
    response.writeHead(answer.status, headers);
    createReadStream(file).pipe(response);
  });
}

function buildIfStale() {
  const built = statSync(join(browser, 'index.html'), { throwIfNoEntry: false });
  if (built && built.mtimeMs >= newestChange(BUILD_SOURCES)) {
    console.log(`The build in ${output} is newer than the sources; serving it.`);
    return;
  }
  console.log(`Building into ${output} (development configuration)...`);
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'),
      'build',
      '--configuration',
      'development',
      '--output-path',
      output,
    ],
    // CI=true keeps the build out of .angular/cache, which the dev server next door may be using.
    { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' } },
  );
  if (result.status !== 0) {
    console.error('ng build failed.');
    process.exit(result.status ?? 1);
  }
  // As `npm run build` does: the pre-rendered pages' first paint needs the HTML alone.
  for (const document of PRERENDERED_DOCUMENTS) {
    const path = join(browser, document);
    if (!existsSync(path)) continue;
    const inlined = inlinePrerenderedDocument(document, readFileSync(path, 'utf8'), (name) =>
      readFileSync(join(browser, name), 'utf8'),
    );
    if (inlined !== null) writeFileSync(path, inlined);
  }
  const findings = checkPrerender(browser);
  if (findings.length > 0) {
    console.error(findings.join('\n'));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('--port');
  const port = portIndex === -1 ? 4301 : Number(args[portIndex + 1]);
  if (args.includes('--build')) buildIfStale();
  if (!existsSync(join(browser, 'index.csr.html'))) {
    console.error(`No build in ${browser}. Run with --build, or build into ${output} first.`);
    process.exit(1);
  }
  createSiteServer(browser).listen(port, '127.0.0.1', () => {
    console.log(`Serving ${browser} at http://127.0.0.1:${port}/ as nginx.conf would.`);
  });
}
