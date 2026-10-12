import { expect, mockSignedOut, test, waitForFonts } from '../support';

/**
 * The built app, served as `nginx.conf` serves it (`scripts/serve-built.mjs`, the `built` project):
 * the homepage pre-rendered at build time (UI plan R6.2a) and the plain shell for every other
 * address. The dev server renders `/` on request too, but only a build writes the two documents and
 * only nginx picks one by address and cookie, so this project is where those rules are checked.
 */
const HEADLINE = /Stop coaching from/;

/** The document's text without its tags: the shell's og:image:alt names the headline, its page does not. */
function pageText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

test('the homepage is served as finished HTML, with its headline and link-preview tags', async ({
  request,
}) => {
  const response = await request.get('/');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(response.headers()['cache-control']).toBe('no-cache');
  const html = await response.text();
  expect(html).toMatch(/<h1[^>]*>\s*Stop coaching from[\s\S]*chats and spreadsheets\./);
  expect(html).toMatch(
    /<meta[^>]*property="og:title"[^>]*content="TB Gym: stop coaching from chats and spreadsheets"/,
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

  // The sections below the fold render in the browser once it is idle: the app is live.
  await expect(page.locator('#tour')).toBeAttached();
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1[data-arrived-with-the-page]')).toHaveText(HEADLINE);
  expect(
    await page.evaluate(
      () => (window as unknown as { __prerender: { launchScreen: boolean } }).__prerender,
    ),
  ).toEqual({ launchScreen: false });
  await expect(page.locator('.launch')).toHaveCount(0);
  // And it is interactive: the hero example runs and can be paused.
  const example = page.getByRole('group', { name: 'Example: a week of coaching in TB Gym' });
  await example.getByRole('button', { name: 'Pause the example' }).click();
  await expect(example.getByRole('button', { name: 'Play the example' })).toBeVisible();
});

// The build cannot know a visitor's motion setting, so the page arrives with the pause controls; a
// visitor who asked for less motion sees them go once the app is live, with nothing else disturbed.
test('a visitor who prefers reduced motion gets the still page from the same HTML, without errors', async ({
  page,
}) => {
  await mockSignedOut(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForFonts(page);

  await expect(page.locator('#tour')).toBeAttached();
  await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pause the/ })).toHaveCount(0);
  await expect(page.locator('.launch')).toHaveCount(0);
});
