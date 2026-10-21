import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * What the edge sends with each kind of answer (audit WEB-4, WEB-14, WEB-15, UIQ-7), read from a real
 * nginx serving a production build: `scripts/edge-proof.ps1` starts one from `nginx.conf` and the
 * build output, or points these checks at a deployment such as the test copy. Only headers and
 * documents are read; nothing here needs the API, a browser window or an account.
 */

const SIGNED_IN = { cookie: '__Host-tb-gym.auth=edge-proof' };
const KEEP_FOR_A_YEAR = 'public, max-age=31536000, immutable';
const HOME_FACES = [
  '/fonts/ibm-plex/IBMPlexSans-Medium.woff2',
  '/fonts/ibm-plex/IBMPlexMono-Medium.woff2',
];

/** nginx.conf's security headers, on every answer whatever its kind. */
function expectSecurityHeaders(response: APIResponse, what: string): void {
  const headers = response.headers();
  expect(headers['x-content-type-options'], what).toBe('nosniff');
  expect(headers['x-frame-options'], what).toBe('DENY');
  expect(headers['referrer-policy'], what).toBe('no-referrer');
  expect(headers['permissions-policy'], what).toBe('camera=(), microphone=(), geolocation=()');
  expect(headers['cross-origin-opener-policy'], what).toBe('same-origin');
  const policy = headers['content-security-policy'] ?? '';
  expect(policy, what).toContain("script-src 'self'");
  // The chat socket is this host's own, which 'self' covers: no socket to any other host.
  const connect = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('connect-src'));
  expect(connect, what).toBe("connect-src 'self'");
}

/** The shell's own script and stylesheet names, which carry their content's hash. */
async function hashedFiles(request: APIRequestContext): Promise<string[]> {
  const shell = await (await request.get('/clients')).text();
  const scripts = [...shell.matchAll(/<script src="([^"]+\.js)"/g)].map((match) => match[1]);
  const preloads = [...shell.matchAll(/<link rel="modulepreload" href="([^"]+\.js)"/g)].map(
    (match) => match[1],
  );
  const styles = [...shell.matchAll(/<link rel="stylesheet" href="([^"]+\.css)"/g)].map(
    (match) => match[1],
  );
  return [...scripts, ...preloads.slice(0, 2), ...styles].map(
    (name) => `/${name.replace(/^\//, '')}`,
  );
}

test('a document is asked for afresh on every visit, whichever document answers', async ({
  request,
}) => {
  const documents: [string, Record<string, string>, RegExp][] = [
    ['/', {}, /<app-home[\s>]/],
    ['/changelog', {}, /<app-changelog[\s>]/],
    ['/auth/sign-in', {}, /id="sign-in-email"/],
    ['/', SIGNED_IN, /<app-root><\/app-root>/],
    ['/clients', {}, /<app-root><\/app-root>/],
    ['/index.html', {}, /<app-root><\/app-root>/],
  ];
  for (const [path, headers, body] of documents) {
    const what = `${path}${headers['cookie'] ? ' (signed in)' : ''}`;
    const response = await request.get(path, { headers });
    expect(response.status(), what).toBe(200);
    expect(response.headers()['cache-control'], what).toBe('no-cache');
    expect(await response.text(), what).toMatch(body);
    expectSecurityHeaders(response, what);
  }
});

test('a file named by its content is kept for a year without asking again', async ({ request }) => {
  const files = await hashedFiles(request);
  // main, polyfills, a chunk or two and the stylesheet.
  expect(files.length).toBeGreaterThanOrEqual(3);
  for (const file of files) {
    const response = await request.get(file);
    expect(response.status(), file).toBe(200);
    expect(response.headers()['cache-control'], file).toBe(KEEP_FOR_A_YEAR);
    expectSecurityHeaders(response, file);
  }
});

test('other files keep the browser’s own checks, and a missing one is a 404 never kept', async ({
  request,
}) => {
  for (const file of [
    '/favicon.ico',
    '/manifest.webmanifest',
    '/robots.txt',
    '/fonts/ibm-plex/IBMPlexSans-Regular.woff2',
  ]) {
    const response = await request.get(file);
    expect(response.status(), file).toBe(200);
    expect(response.headers()['cache-control'], file).toBeUndefined();
    expectSecurityHeaders(response, file);
  }

  const missing = await request.get('/sitemap.xml');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['cache-control']).toBe('no-cache');
  expectSecurityHeaders(missing, '/sitemap.xml');
});

test('the development lab’s stylesheet is not in the build', async ({ request }) => {
  const response = await request.get('/hero-lab.css');
  expect(response.status()).toBe(404);
});

test('only the homepage and what changed ask for the homepage’s own faces', async ({ request }) => {
  const preloads = (html: string) =>
    [...html.matchAll(/<link\s[^>]*rel="preload"[^>]*>/g)]
      .map((match) => /\shref="([^"]+)"/.exec(match[0])?.[1] ?? '')
      .filter((href) => href.startsWith('/fonts/'));
  for (const path of ['/', '/changelog']) {
    const fonts = preloads(await (await request.get(path)).text());
    for (const face of HOME_FACES) expect(fonts, path).toContain(face);
  }
  for (const [path, headers] of [
    ['/auth/sign-in', {}],
    ['/clients', {}],
    ['/', SIGNED_IN],
  ] as const) {
    const fonts = preloads(await (await request.get(path, { headers })).text());
    for (const face of HOME_FACES) expect(fonts, path).not.toContain(face);
    // Every page still asks for the regular face with the document.
    expect(fonts, path).toContain('/fonts/ibm-plex/IBMPlexSans-Regular.woff2');
  }
});
