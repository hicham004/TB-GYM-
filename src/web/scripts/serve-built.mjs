// Serves a build of the app the way nginx.conf does (UI plan R6.2a), for the `built` Playwright
// project: "/" answers the pre-rendered homepage, or the plain shell when the request carries the
// sign-in cookie; any other address answers its file, or else the plain shell. nginx's security
// headers are sent too, so a page that would need an inline script fails here as in production.
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
import { inlineHomeStyles } from './inline-home-styles.mjs';

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

const TYPES = {
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

/**
 * Which file answers a request: nginx.conf's three rules. `exists` says whether a relative path is
 * a file in the build output.
 */
export function documentFor(pathname, cookie, exists) {
  if (pathname === '/') {
    return SIGNED_IN_COOKIE.test(cookie ?? '') ? 'index.csr.html' : 'index.html';
  }
  if (pathname === '/changelog') {
    return 'changelog/index.html';
  }
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, '');
  if (relative === '' || relative.split(/[\\/]/).includes('..')) return 'index.csr.html';
  return exists(relative) ? relative : 'index.csr.html';
}

/** The newest change under the given paths, as a timestamp. */
function newestChange(paths) {
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

function buildIfStale() {
  const built = statSync(join(browser, 'index.html'), { throwIfNoEntry: false });
  const sources = newestChange(
    [
      'src',
      'public',
      'angular.json',
      'package-lock.json',
      'tsconfig.json',
      'tsconfig.app.json',
    ].map((path) => join(root, path)),
  );
  if (built && built.mtimeMs >= sources) {
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
  for (const document of ['index.html', 'changelog/index.html']) {
    const path = join(browser, document);
    if (!existsSync(path)) continue;
    const inlined = inlineHomeStyles(readFileSync(path, 'utf8'), (name) =>
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

function serve(port) {
  const isFile = (relative) => {
    const file = join(browser, relative);
    return file.startsWith(browser + sep) && existsSync(file) && statSync(file).isFile();
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    // nginx proxies these to the API; here there is none, and the shell must not stand in for it.
    if (/^\/(api|health|hubs|openapi)(\/|$)/.test(url.pathname)) {
      response.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      response.end('{"title":"No API behind this server"}');
      return;
    }
    const name = documentFor(url.pathname, request.headers.cookie, isFile);
    const file = join(browser, name);
    const headers = {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      ...SECURITY_HEADERS,
    };
    if (url.pathname === '/') headers['Cache-Control'] = 'no-cache';
    response.writeHead(200, headers);
    createReadStream(file).pipe(response);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Serving ${browser} at http://127.0.0.1:${port}/ as nginx.conf would.`);
  });
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
  serve(port);
}
