import { expect, type Page, type Route } from '@playwright/test';

/**
 * Test-only network doubles. The application, its interceptors and its route guards run unchanged;
 * they simply receive these responses instead of a live API. Unknown API calls get a 404 so a
 * missing mock shows up as a visible error state rather than a hang.
 */
type Handler = (route: Route) => Promise<void> | void;

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page: Page, handlers: Record<string, Handler>): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/hubs/'),
    (route) => {
      const path = new URL(route.request().url()).pathname;
      const handler = handlers[`${route.request().method()} ${path}`];
      return handler ? handler(route) : json(route, 404, { title: 'Not mocked' });
    },
  );
}

/** A visitor with no session: the shell renders its public navigation. */
export async function mockSignedOut(page: Page): Promise<void> {
  await mockApi(page, {
    'GET /api/auth/csrf': (route) => json(route, 200, { token: 'e2e-csrf' }),
    'GET /api/auth/me': (route) => json(route, 401, { title: 'Unauthorized' }),
  });
}

export const OWNER_MEMBERSHIP = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Owner',
};

/** A signed-in workspace owner, plus whatever feature responses the page under test needs. */
export async function mockOwnerSession(
  page: Page,
  extra: Record<string, Handler> = {},
): Promise<void> {
  await mockApi(page, {
    'GET /api/auth/csrf': (route) => json(route, 200, { token: 'e2e-csrf' }),
    'GET /api/auth/me': (route) =>
      json(route, 200, {
        id: '00000000-0000-4000-8000-0000000000aa',
        email: 'coach@example.test',
        displayName: 'Sample Coach',
        preferredCulture: 'en-LB',
        emailConfirmed: true,
        roles: [],
      }),
    'GET /api/tenants': (route) => json(route, 200, [OWNER_MEMBERSHIP]),
    'GET /api/notifications/unread-count': (route) => json(route, 200, { unread: 0 }),
    'GET /api/messaging/unread-count': (route) => json(route, 200, { unread: 0 }),
    ...extra,
  });
}

export { json };

/**
 * Screenshots must not race the web fonts. The bundled IBM Plex faces load on first use, so each
 * face is requested explicitly and the font set is awaited before anything is measured.
 */
export async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 14px "Notebook Plex"'),
      document.fonts.load('600 14px "Notebook Plex"'),
      document.fonts.load('400 14px "Notebook Plex Arabic"', 'م'),
      document.fonts.load('600 14px "Notebook Plex Arabic"', 'م'),
    ]);
    await document.fonts.ready;
  });
}

/** Horizontal scrolling of the whole page is a reflow failure (WCAG 1.4.10). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(overflow.scrollWidth, 'page scrolls sideways').toBeLessThanOrEqual(overflow.clientWidth);
}
