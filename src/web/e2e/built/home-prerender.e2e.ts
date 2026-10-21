import { expect, json, mockSignedOut, test, waitForFonts } from '../support';

/**
 * The built app, served as `nginx.conf` serves it (`scripts/serve-built.mjs`, the `built` project):
 * the homepage, what changed and sign-in pre-rendered at build time for a visitor (UI plan R6.2a,
 * R6.2f, audit UIQ-13), the plain shell for someone signed in and for every other address, and a 404
 * for a missing file (audit AUTH-10). The dev server renders the three pages on request too, but only
 * a build writes the documents and only nginx picks one by address and cookie, so this project is
 * where those rules are checked.
 */
const HEADLINE = /Coach both/;

const SIGNED_IN_COOKIES = [
  'tb-gym.auth=session',
  '__Host-tb-gym.auth=session',
  'tb-gym-antiforgery=x; __Host-tb-gym.auth=session',
];

/** The document's text without its tags: the shell's og:image:alt names the headline, its page does not. */
function pageText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

test('the homepage is served as finished HTML, with its headline, its week and link-preview tags', async ({
  request,
}) => {
  const response = await request.get('/');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(response.headers()['cache-control']).toBe('no-cache');
  const html = await response.text();
  expect(html).toMatch(/<h1[^>]*>\s*Coach both[\s\S]*sides of[\s\S]*the week\./);
  // The whole page is in the HTML: nothing below the fold waits for the browser.
  expect(pageText(html)).toMatch(/You both see it\./);
  expect(pageText(html)).toMatch(/Built for one coach\. Ready for a whole floor\./);
  expect(html.match(/<article[^>]*data-stage-id="/g)).toHaveLength(4);
  expect(html.match(/<article[^>]*data-row="/g)).toHaveLength(6);
  // Talk to us (R6.2g) is in the HTML; the analytics script never is, it waits for the settings.
  expect(html).toMatch(/<section[^>]*\sid="talk"/);
  expect(html).toMatch(/<form[\s>]/);
  expect(html).not.toMatch(/\/stats\//);
  expect(html).toMatch(
    /<meta[^>]*property="og:title"[^>]*content="TB Gym: coach both sides of the week"/,
  );
  expect(html).toMatch(/<meta[^>]*name="description"[^>]*content="[^"]+"/);
  // The CSP allows no inline script, so the page must not come with one.
  expect(html).not.toMatch(/<script(?![^>]*type="application\/json")[^>]*>[^<]/);
  // Nothing of the private pre-launch build (R6.2h): no stand-in, no placeholders folder, no noindex.
  expect(html).not.toMatch(/\sdata-placeholder="/);
  expect(html).not.toMatch(/placeholders\//);
  expect(html).not.toMatch(/<meta name="robots"/);
  expect(html).toMatch(/<app-home-window[^>]*class="hero__window"/);
});

test('the placeholders folder is not in the build: a stand-in’s address is a missing file', async ({
  request,
}) => {
  const response = await request.get('/placeholders/hero.jpg');

  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(await response.text()).toContain('<app-root></app-root>');
});

test('a missing file answers 404 with the shell; an unknown screen is the app’s to answer', async ({
  request,
}) => {
  for (const path of ['/sitemap.xml', '/wp-login.php', '/.env.bak', '/chunk-NOT-THERE.js']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()['content-type'], path).toContain('text/html');
    expect(await response.text(), path).toContain('<app-root></app-root>');
  }
  const screen = await request.get('/no-such-page');
  expect(screen.status()).toBe(200);
  expect(await screen.text()).toContain('<app-root></app-root>');
});

test('sign-in is served as finished HTML to a visitor: its form, and a button that waits for the app', async ({
  request,
}) => {
  const response = await request.get('/auth/sign-in?returnUrl=%2Fclients');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(response.headers()['cache-control']).toBe('no-cache');
  const html = await response.text();
  expect(html).toMatch(/<title>Sign in \| TB Gym<\/title>/);
  expect(html).toMatch(/<h1[^>]*>\s*Welcome <em[^>]*>back\.<\/em>/);
  expect(html).toMatch(/<input[^>]*id="sign-in-email"[^>]*type="email"/);
  expect(html).toMatch(/<input[^>]*id="sign-in-password"[^>]*type="password"/);
  // Disabled until the app is live, so Enter or a tap cannot submit natively and reload the page.
  expect(html).toMatch(/<button(?=[^>]*auth-submit)(?=[^>]*\sdisabled)[^>]*>/);
  expect(html).not.toMatch(/<input[^>]*\sname="/);
  expect(html).not.toMatch(/<script(?![^>]*type="application\/json")[^>]*>[^<]/);
  expect(html).not.toMatch(/<link\s+rel="stylesheet"/);
  // Its scripts keep their priority: the form needs the app to send.
  expect(html).toMatch(/<script src="[^"]+" type="module">/);
  expect(html).not.toMatch(/fetchpriority="low"/);
});

test('what changed is served as finished HTML with its dated releases', async ({ request }) => {
  const response = await request.get('/changelog');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  const html = await response.text();
  expect(html).toMatch(/<h1[^>]*>\s*What changed/);
  expect(html).toMatch(/<time[^>]*datetime="\d{4}-\d{2}-\d{2}"/);
  expect(html).not.toMatch(/<script(?![^>]*type="application\/json")[^>]*>[^<]/);
  expect(html).not.toMatch(/<link\s+rel="stylesheet"/);
});

test('a deep link loads the plain shell, so it never shows the homepage first', async ({
  request,
}) => {
  for (const path of [
    '/auth/register',
    '/clients',
    '/clients/00000000-0000-4000-8000-000000000001/training',
    '/invite?token=abc',
    '/changelog/2026',
    '/index.csr.html',
    // A pre-rendered page by another spelling: only its own address chooses by the cookie.
    '/index.html',
    '/changelog/',
    '/changelog/index.html',
    '/auth/sign-in/',
    '/auth/sign-in/index.html',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).toContain('<app-root></app-root>');
    expect(html, path).not.toMatch(/<h1[\s>]/);
    expect(pageText(html), path).not.toMatch(HEADLINE);
  }
});

test('someone signed in gets the shell at all three pre-rendered addresses, however the cookie is spelled', async ({
  request,
}) => {
  for (const path of ['/', '/changelog', '/auth/sign-in']) {
    for (const cookie of SIGNED_IN_COOKIES) {
      const response = await request.get(path, { headers: { cookie } });
      expect(response.headers()['cache-control'], `${path} ${cookie}`).toBe('no-cache');
      const html = await response.text();
      expect(html, `${path} ${cookie}`).toContain('<app-root></app-root>');
      expect(html, `${path} ${cookie}`).not.toMatch(/<h1[\s>]/);
      expect(pageText(html), `${path} ${cookie}`).not.toMatch(HEADLINE);
    }
  }
  // The other cookies a visitor may hold do not count as a session.
  const visitor = await (
    await request.get('/', { headers: { cookie: 'tb-gym-antiforgery=x; XSRF-TOKEN=y' } })
  ).text();
  expect(visitor).toMatch(/<h1[\s>]/);
  expect(pageText(visitor)).toMatch(HEADLINE);
});

test('robots.txt and the page’s pictures are served as files, not as the shell', async ({
  request,
}) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect(await robots.text()).toMatch(/^User-agent: \*/);
  for (const picture of [
    'client-today-760.avif',
    'today-needs-you-dark.webp',
    'programs-1x.avif',
    'review-narrow.webp',
  ]) {
    const response = await request.get(`/images/home/${picture}`);
    expect(response.status(), picture).toBe(200);
    expect(response.headers()['content-type'], picture).toMatch(/^image\//);
  }
});

test('the app takes the pre-rendered page over in place: same headline, no launch screen, no errors', async ({
  page,
}) => {
  await mockSignedOut(page);
  // Before any script runs: mark the headline the HTML arrived with, and watch for a launch screen.
  await page.addInitScript(() => {
    const seen = { launchScreen: false };
    (window as unknown as { __prerender: typeof seen }).__prerender = seen;
    new MutationObserver(() => {
      if (!document.querySelector('[data-arrived-with-the-page]')) {
        document.querySelector('h1')?.setAttribute('data-arrived-with-the-page', '');
      }
      if (document.querySelector('.launch')) seen.launchScreen = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  await waitForFonts(page);

  // The page decides how its story is told once the app is live: the page is hydrated.
  await expect(page.locator('#week')).toHaveAttribute('data-motion', /running|off/);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1[data-arrived-with-the-page]')).toHaveText(HEADLINE);
  expect(
    await page.evaluate(
      () => (window as unknown as { __prerender: { launchScreen: boolean } }).__prerender,
    ),
  ).toEqual({ launchScreen: false });
  await expect(page.locator('.launch')).toHaveCount(0);
  // And it is interactive: on this wide screen the story runs, from its own lazily loaded chunk.
  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'running');
  await page.evaluate(() =>
    document.querySelector('[data-stage-id="checkin"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(page.locator('#week')).toHaveAttribute('data-stage', 'checkin');
});

// The build cannot know a visitor's motion setting, so the page arrives with the panel; a visitor
// who asked for less motion gets the still page from the same HTML, with nothing else disturbed.
test('a visitor who prefers reduced motion gets the still page from the same HTML, without errors', async ({
  page,
}) => {
  await mockSignedOut(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForFonts(page);

  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'off');
  await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
  await expect(page.locator('.week__panel')).toBeHidden();
  await expect(page.locator('[data-stage-id="plan"] .stage__own')).toBeVisible();
  await expect(page.locator('.launch')).toHaveCount(0);
});

test('what changed hydrates in place and keeps the website around it for a visitor', async ({
  page,
}) => {
  await mockSignedOut(page);
  await page.goto('/changelog');
  await waitForFonts(page);

  await expect(page.getByRole('heading', { level: 1, name: 'What changed' })).toBeVisible();
  await expect(page.locator('app-home-header')).toBeVisible();
  await expect(page.locator('.launch')).toHaveCount(0);
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
});

test.describe('sign-in, taken over in place', () => {
  // The refused sign-in is the answer these checks ask for, and the browser logs it.
  test.use({ allowedConsoleErrors: { patterns: [/status of 401 .*\/api\/auth\/login/] } });

  test('keeps what was typed before the app arrived and sends it once the app is live', async ({
    page,
  }) => {
    let sent: unknown = null;
    await mockSignedOut(page, {
      'POST /api/auth/login': (route) => {
        sent = route.request().postDataJSON();
        return json(route, 401, { code: 'invalid_credentials' });
      },
    });
    // The app's entry waits until the person has typed into the page the build rendered.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/main.js', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/auth/sign-in', { waitUntil: 'commit' });

    const submit = page.locator('button.auth-submit');
    await expect(page.getByRole('heading', { level: 1, name: /Welcome/ })).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.locator('#sign-in-email').fill('maya@example.test');
    await page.locator('#sign-in-password').fill('typed-before-the-app');
    await page.getByLabel('Keep me signed in').check();
    release();

    await expect(submit).toBeEnabled();
    await expect(page.locator('#sign-in-email')).toHaveValue('maya@example.test');
    await expect(page.locator('#sign-in-password')).toHaveValue('typed-before-the-app');
    await submit.click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
    expect(sent).toEqual({
      email: 'maya@example.test',
      password: 'typed-before-the-app',
      rememberMe: true,
    });
    await expect(page.locator('.launch')).toHaveCount(0);
  });

  test('says a session ended over the page the build rendered for nobody, without errors', async ({
    page,
  }) => {
    await mockSignedOut(page);
    await page.goto('/auth/sign-in?reason=session-ended&returnUrl=%2Fclients');

    await expect(
      page.getByText('You were signed out. Sign in again to carry on where you left off.'),
    ).toBeVisible();
    await expect(page.locator('button.auth-submit')).toBeEnabled();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('.launch')).toHaveCount(0);
  });
});
