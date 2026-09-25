import { expect, test as base, type Page, type Route } from '@playwright/test';

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

/**
 * A stand-in for the messaging hub, so a signed-in page reaches a server that answers instead of a
 * 404 that the SignalR client reports as an error on every retry. It negotiates once and then
 * behaves as a connected hub with nothing to say: it completes the handshake and answers pings.
 * No event is ever pushed — realtime delivery is not what these checks are about.
 */
async function mockMessagingHub(page: Page): Promise<void> {
  await page.routeWebSocket(/\/hubs\//, (ws) => {
    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString();
      if (text.includes('"protocol"')) {
        ws.send('{}\u001e'); // handshake accepted
      } else if (text.includes('"type":6')) {
        ws.send('{"type":6}\u001e'); // ping, answered so the client does not time out
      }
    });
  });
}

const hubHandlers: Record<string, Handler> = {
  'POST /hubs/chat/negotiate': (route) =>
    json(route, 200, {
      negotiateVersion: 1,
      connectionId: 'e2e-connection',
      connectionToken: 'e2e-token',
      availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text', 'Binary'] }],
    }),
};

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

export const COACH_MEMBERSHIP = {
  tenantId: '00000000-0000-4000-8000-000000000002',
  tenantName: 'Beirut Barbell',
  tenantSlug: 'beirut-barbell',
  role: 'Coach',
};

export const SIGNED_IN_USER = {
  id: '00000000-0000-4000-8000-0000000000aa',
  email: 'coach@example.test',
  displayName: 'Hicham Haddad',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

/** A signed-in member, plus whatever feature responses the page under test needs. */
export async function mockSession(
  page: Page,
  options: {
    memberships?: (typeof OWNER_MEMBERSHIP)[];
    user?: typeof SIGNED_IN_USER;
    unreadNotifications?: number;
    unreadMessages?: number;
    extra?: Record<string, Handler>;
  } = {},
): Promise<void> {
  await mockMessagingHub(page);
  await mockApi(page, {
    'GET /api/auth/csrf': (route) => json(route, 200, { token: 'e2e-csrf' }),
    'GET /api/auth/me': (route) => json(route, 200, options.user ?? SIGNED_IN_USER),
    'GET /api/tenants': (route) => json(route, 200, options.memberships ?? [OWNER_MEMBERSHIP]),
    'GET /api/notifications/unread-count': (route) =>
      json(route, 200, { unread: options.unreadNotifications ?? 0 }),
    'GET /api/messaging/unread-count': (route) =>
      json(route, 200, { unread: options.unreadMessages ?? 0 }),
    // The coach shell's billing banner asks on every page (ADR 0028). A paid workspace shows no banner.
    'GET /api/billing/access': (route) =>
      json(route, 200, { isReadOnly: false, hasOverdueInvoice: false, readOnlyFrom: null }),
    ...hubHandlers,
    ...(options.extra ?? {}),
  });
}

/** A signed-in workspace owner. */
export async function mockOwnerSession(
  page: Page,
  extra: Record<string, Handler> = {},
): Promise<void> {
  await mockSession(page, { extra });
}

export { expect, json };

/**
 * Every check runs with the browser console watched. An unexpected console error or an uncaught
 * page error fails the test that produced it, because both are defects a screenshot cannot show.
 *
 * `allowedConsoleErrors` is the explicit, per-test escape hatch, and the default list holds exactly
 * one entry: a signed-out visitor's `GET /api/auth/me` is answered 401 by the real API too, and the
 * browser logs every failed request. Pretending it succeeded would be a worse lie than allowing it.
 */
export const test = base.extend<{
  // An object rather than a bare array: Playwright reads a two-element array as a fixture tuple.
  allowedConsoleErrors: { patterns: RegExp[] };
  consoleGuard: void;
}>({
  allowedConsoleErrors: [{ patterns: [/status of 401 .*\/api\/auth\/me/] }, { option: true }],
  consoleGuard: [
    async ({ page, allowedConsoleErrors }, use) => {
      const problems: string[] = [];
      const allowed = (message: string) =>
        allowedConsoleErrors.patterns.some((pattern) => pattern.test(message));

      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = `${message.text()} ${message.location().url}`;
        if (!allowed(text)) problems.push(`console: ${text}`);
      });
      page.on('pageerror', (error) => {
        if (!allowed(error.message)) problems.push(`page error: ${error.message}`);
      });

      await use();

      expect(problems, 'the page reported errors').toEqual([]);
    },
    { auto: true },
  ],
});

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

/**
 * Switches the document to right-to-left the way a locale build would. The application sets `dir`
 * once, at start-up, from its locale; these checks change it afterwards so the same build can be
 * measured in both directions.
 */
export async function useRtl(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
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
