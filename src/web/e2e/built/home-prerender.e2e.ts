import { expect, mockSignedOut, test, waitForFonts } from '../support';

/**
 * The built app, served as `nginx.conf` serves it (`scripts/serve-built.mjs`, the `built` project):
 * the homepage pre-rendered at build time (UI plan R6.2a) and the plain shell for every other
 * address. The dev server renders `/` on request too, but only a build writes the two documents and
 * only nginx picks one by address and cookie, so this project is where those rules are checked.
 */
const HEADLINE = /You plan it\./;

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
  expect(html).toMatch(/<h1[^>]*>\s*You plan it\.[\s\S]*They lift it\.[\s\S]*You both see it\./);
  // The whole week is in the HTML (R6.2b): nothing below the fold waits for the browser.
  expect(pageText(html)).toMatch(/A record worth sharing\./);
  expect(html.match(/data-chapter="/g)).toHaveLength(7);
  expect(html).toMatch(
    /<meta[^>]*property="og:title"[^>]*content="TB Gym: you plan it, they lift it, you both see it"/,
  );
  expect(html).toMatch(/<meta[^>]*name="description"[^>]*content="[^"]+"/);
  // The CSP allows no inline script, so the page must not come with one.
  expect(html).not.toMatch(/<script(?![^>]*type="application\/json")[^>]*>[^<]/);
});

test('a deep link loads the plain shell, so it never shows the homepage first', async ({
  request,
}) => {
  for (const path of [
    '/auth/sign-in',
    '/clients',
    '/clients/00000000-0000-4000-8000-000000000001/training',
    '/invite?token=abc',
    '/index.csr.html',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).toContain('<app-root></app-root>');
    expect(html, path).not.toMatch(/<h1[\s>]/);
    expect(pageText(html), path).not.toMatch(HEADLINE);
  }
});

test('a visitor who is signed in gets the shell at /, whichever way the cookie is spelled', async ({
  request,
}) => {
  for (const cookie of [
    'tb-gym.auth=session',
    '__Host-tb-gym.auth=session',
    'tb-gym-antiforgery=x; __Host-tb-gym.auth=session',
  ]) {
    const html = await (await request.get('/', { headers: { cookie } })).text();
    expect(html, cookie).toContain('<app-root></app-root>');
    expect(html, cookie).not.toMatch(/<h1[\s>]/);
    expect(pageText(html), cookie).not.toMatch(HEADLINE);
  }
  // The other cookies a visitor may hold do not count as a session.
  const visitor = await (
    await request.get('/', { headers: { cookie: 'tb-gym-antiforgery=x; XSRF-TOKEN=y' } })
  ).text();
  expect(visitor).toMatch(/<h1[\s>]/);
  expect(pageText(visitor)).toMatch(HEADLINE);
});

test('robots.txt and the week’s pictures are served as files, not as the shell', async ({
  request,
}) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect(await robots.text()).toMatch(/^User-agent: \*/);
  for (const picture of ['hero-phone.avif', 'hero-coach.webp', 'share-coach-small.avif']) {
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

  // The story decides how it is told once the app is live: the page is hydrated.
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
    document.querySelector('[data-chapter="eat"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(page.locator('#week')).toHaveAttribute('data-moment', 'eat');
});

// The build cannot know a visitor's motion setting, so the page arrives with the stage; a visitor
// who asked for less motion gets the still story from the same HTML, with nothing else disturbed.
test('a visitor who prefers reduced motion gets the still page from the same HTML, without errors', async ({
  page,
}) => {
  await mockSignedOut(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForFonts(page);

  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'off');
  await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
  await expect(page.locator('.week__stage')).toBeHidden();
  await expect(page.locator('[data-chapter="plan"] .screens')).toBeVisible();
  await expect(page.locator('.launch')).toHaveCount(0);
});
