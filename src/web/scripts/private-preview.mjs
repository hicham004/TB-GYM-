// The private pre-launch build (UI plan R6.2h): the homepage with the owner's stand-in photographs
// from src/web/placeholders/, for a showing on this laptop or on a second screen on the same
// network. Nothing here is deployed and the public build is untouched: `npm run build` refuses an
// output that names the folder (check-prerender.mjs). scripts/private-preview.ps1 wraps the two
// commands below.
//
//   node scripts/private-preview.mjs build [--out .private] [--no-pictures]
//   node scripts/private-preview.mjs serve [--out .private] [--port 4400] [--network]
//                                          [--password <word>] [--api <origin>] [--build]
//
// `build` looks in the folder for hero.jpg, train.jpg, talk.jpg and team.jpg (any that exist are
// used; the rest are drawn as grey stand-ins), writes placeholders/home-placeholders.ts for the
// `placeholders` configuration to swap in (git-ignored with the pictures), runs `ng build
// --configuration production,placeholders` into --out, inlines the stylesheet as `npm run build`
// does, and checks the output in check-prerender.mjs's private mode. `--no-pictures` builds the page
// a fresh clone would get, every stand-in grey (the files are still copied, unused).
//
// `serve` answers the build the way nginx.conf would (serve-built.mjs) with `X-Robots-Tag: noindex,
// nofollow` on every response. It listens on this laptop only, unless `--network` opens it to the
// local network behind a password (HTTP Basic; a random one is printed when none is given) for a
// phone or a second laptop on the same Wi-Fi. `--api` proxies the API's paths to a running API so
// Talk to us can send; without it the page gets the answers a signed-out visitor needs and the form
// cannot send. `--build` first builds when the sources or the folder changed (the Playwright config
// playwright.private.config.ts uses it).
import { spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPrerender } from './check-prerender.mjs';
import { inlinePrerenderedDocument, PRERENDERED_DOCUMENTS } from './inline-home-styles.mjs';
import {
  API_PATHS,
  BUILD_SOURCES,
  createSiteServer,
  newestChange,
  SECURITY_HEADERS,
} from './serve-built.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The owner's folder of stand-ins: git-ignored but for its README, and outside the public assets. */
export const PLACEHOLDERS_FOLDER = join(root, 'placeholders');

/** The module the `placeholders` configuration swaps in for features/home/home-placeholders.ts. */
export const PLACEHOLDERS_MODULE = join(PLACEHOLDERS_FOLDER, 'home-placeholders.ts');

/** The stand-ins the page draws, by the file each is kept as (placeholders/README.md says what each shows). */
export const PLACEHOLDER_FILES = [
  { name: 'hero', file: 'hero.jpg' },
  { name: 'train', file: 'train.jpg' },
  { name: 'talk', file: 'talk.jpg' },
  { name: 'team', file: 'team.jpg' },
];

/** The header every response of the private server carries: this page is never for Google. */
export const ROBOTS_HEADER = { 'X-Robots-Tag': 'noindex, nofollow' };

/** Which of the stand-ins a folder holds. */
export function findPlaceholders(folder = PLACEHOLDERS_FOLDER) {
  return PLACEHOLDER_FILES.map(({ name, file }) => ({
    name,
    file,
    found: existsSync(join(folder, file)),
  }));
}

/**
 * The module for the private build: the set the page reads, with a null address for each file the
 * folder lacks, so the page draws a grey stand-in there. Imports are relative to the folder.
 */
export function placeholdersModule(found, writtenAt = new Date()) {
  const lines = found.map(
    ({ name, file, found: present }) =>
      `  ${name}: { name: '${name}', file: '${file}', src: ${present ? `'/placeholders/${file}'` : 'null'} },`,
  );
  return [
    `// Written by scripts/private-preview.mjs on ${writtenAt.toISOString()} from the files in this folder`,
    '// (UI plan R6.2h). Git-ignored with the pictures; the public build never reads it, and the next',
    '// private build rewrites it.',
    "import type { PlaceholderSet } from '../src/app/features/home/home-placeholder';",
    '',
    'export const PLACEHOLDERS: PlaceholderSet | null = {',
    ...lines,
    '};',
    '',
  ].join('\n');
}

/**
 * The pre-rendered page without index.html's preload of the coach's window: the private hero
 * draws the stand-in photograph instead, so a wide screen would fetch that picture for nothing.
 */
export function withoutWindowPreload(html) {
  return html.replace(
    /\s*<link\s+rel="preload"[^>]*imagesrcset="[^"]*today-needs-you-dark[^"]*"[^>]*>/,
    '',
  );
}

/** Whether a request's Authorization header carries the password (HTTP Basic, any user name). */
export function authorized(header, password) {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(header ?? '');
  if (!match) return false;
  const given = Buffer.from(match[1], 'base64').toString('utf8').split(':').slice(1).join(':');
  const expected = Buffer.from(password, 'utf8');
  const actual = Buffer.from(given, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * What a signed-out visitor's page asks the API for, answered as that visitor would get them, so a
 * showing without an API behind it opens cleanly. Anything else under the API's paths stays 404.
 */
export function answerAsVisitor(url, response, headers) {
  const answers = {
    '/api/auth/csrf': [200, { token: 'private-preview' }],
    // Nobody is signed in: the API answers that with JSON null (audit AUTH-12).
    '/api/auth/me': [200, null],
    '/api/website/settings': [200, { whatsAppNumber: null, analytics: { script: null } }],
  };
  const answer = answers[url.pathname];
  if (!answer) return false;
  response.writeHead(answer[0], { 'Content-Type': 'application/json', ...headers });
  response.end(JSON.stringify(answer[1]));
  return true;
}

/** Hands a request to a running API and relays its answer, as nginx.conf's proxy_pass does. */
function proxyTo(api, request, response, headers) {
  const target = new URL(request.url ?? '/', api);
  const upstream = httpRequest(
    target,
    { method: request.method, headers: { ...request.headers, host: target.host } },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, { ...answer.headers, ...headers });
      answer.pipe(response);
    },
  );
  upstream.on('error', (error) => {
    response.writeHead(502, { 'Content-Type': 'application/json', ...headers });
    response.end(JSON.stringify({ title: `The API at ${api} did not answer: ${error.message}` }));
  });
  request.pipe(upstream);
}

/** This laptop's addresses on the local network, for the second screen. */
function networkAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
}

/** Builds the private version into `out`; returns which stand-ins were found. */
export function buildPrivate({ out, pictures = true }) {
  const found = findPlaceholders().map((picture) => ({
    ...picture,
    found: pictures && picture.found,
  }));
  writeFileSync(PLACEHOLDERS_MODULE, placeholdersModule(found));
  console.log(
    `Stand-ins: ${found.map(({ file, found: present }) => `${file} ${present ? 'found' : 'grey'}`).join(', ')}.`,
  );
  console.log(`Building the private pre-launch version into ${out}...`);
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'),
      'build',
      '--configuration',
      'production,placeholders',
      '--output-path',
      out,
    ],
    // CI=true keeps the build out of .angular/cache, which a dev server next door may be using.
    { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' } },
  );
  if (result.status !== 0) {
    console.error('ng build failed.');
    process.exit(result.status ?? 1);
  }
  const browser = join(out, 'browser');
  for (const document of PRERENDERED_DOCUMENTS) {
    const path = join(browser, document);
    if (!existsSync(path)) continue;
    const page = readFileSync(path, 'utf8');
    const inlined = inlinePrerenderedDocument(document, page, (name) =>
      readFileSync(join(browser, name), 'utf8'),
    );
    writeFileSync(path, withoutWindowPreload(inlined ?? page));
  }
  const findings = checkPrerender(browser, { privatePreview: true });
  if (findings.length > 0) {
    console.error(findings.join('\n'));
    process.exit(1);
  }
  console.log(
    `The private pre-launch build is in ${browser}, with its stand-ins and its noindex tag.`,
  );
  return found;
}

function buildIfStale(out) {
  const built = statSync(join(out, 'browser', 'index.html'), { throwIfNoEntry: false });
  if (built && built.mtimeMs >= newestChange([...BUILD_SOURCES, PLACEHOLDERS_FOLDER])) {
    console.log(
      `The private build in ${out} is newer than the sources and the folder; serving it.`,
    );
    return;
  }
  buildPrivate({ out });
}

function servePrivate({ out, port, network, password, api }) {
  const browser = join(out, 'browser');
  if (!existsSync(join(browser, 'index.csr.html'))) {
    console.error(`No private build in ${browser}. Run "build" first, or serve with --build.`);
    process.exit(1);
  }
  const headers = ROBOTS_HEADER;
  const server = createSiteServer(browser, {
    extraHeaders: headers,
    intercept: (request, response, url) => {
      if (password && !authorized(request.headers.authorization, password)) {
        response.writeHead(401, {
          'WWW-Authenticate': 'Basic realm="TB Gym private preview", charset="UTF-8"',
          'Content-Type': 'text/plain; charset=utf-8',
          ...SECURITY_HEADERS,
          ...headers,
        });
        response.end('This is a private preview.');
        return true;
      }
      if (!API_PATHS.test(url.pathname)) return false;
      if (api) {
        proxyTo(api, request, response, headers);
        return true;
      }
      return answerAsVisitor(url, response, { ...SECURITY_HEADERS, ...headers });
    },
  });
  const host = network ? '0.0.0.0' : '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`Private pre-launch preview from ${browser}, every response marked noindex.`);
    console.log(`  On this laptop:   http://127.0.0.1:${port}/`);
    if (network) {
      for (const address of networkAddresses()) {
        console.log(`  On the network:   http://${address}:${port}/`);
      }
      console.log(`  Password:         ${password}   (any user name)`);
      console.log(
        '  If a second screen cannot reach it, Windows Firewall is asking: allow node.exe on private networks.',
      );
    }
    console.log(
      api
        ? `  API: proxied to ${api}, so Talk to us can send.`
        : '  API: none; the page opens as for a signed-out visitor, and Talk to us cannot send.',
    );
    console.log('  Ctrl+C stops it.');
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1];
  };
  const out = resolve(root, option('--out') ?? '.private');
  if (command === 'build') {
    buildPrivate({ out, pictures: !args.includes('--no-pictures') });
  } else if (command === 'serve') {
    if (args.includes('--build')) buildIfStale(out);
    const network = args.includes('--network');
    servePrivate({
      out,
      port: Number(option('--port') ?? 4400),
      network,
      password: option('--password') ?? (network ? randomBytes(9).toString('base64url') : null),
      api: option('--api'),
    });
  } else {
    console.error('Usage: node scripts/private-preview.mjs build|serve [options]; see the header.');
    process.exit(2);
  }
}
