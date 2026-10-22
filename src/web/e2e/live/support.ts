import { expect, test as base, type Page } from '@playwright/test';

/**
 * Helpers for the live checks (playwright.live.config.ts): the demo accounts, a real sign-in through
 * the sign-in page, and an API call made from the page with the antiforgery token and the workspace
 * header the app itself sends. Nothing here mocks anything.
 */

/** The origin under test, or undefined when the live suite should be skipped. */
export const LIVE_URL = process.env['TB_GYM_LIVE_URL'];

/** Every Atlas demo account signs in with this (DemoWorkspaceCommand.DefaultPassword). */
export const DEMO_PASSWORD = 'AtlasDemo-2026!';

export const ACCOUNTS = {
  owner: 'karim@atlas.example',
  coachLea: 'lea@atlas.example',
  coachOmar: 'omar@atlas.example',
  maya: 'maya.fakhoury@mail.example',
  rami: 'rami.tabet@mail.example',
  nour: 'nour.hamdan@mail.example',
  jad: 'jad.karam@mail.example',
  sara: 'sara.mansour@mail.example',
  elie: 'elie.azar@mail.example',
  yasmine: 'yasmine.chahine@mail.example',
  hadi: 'hadi.srour@mail.example',
  rita: 'rita.daher@mail.example',
  karl: 'karl.matar@mail.example',
  lynn: 'lynn.boukhalil@mail.example',
  tarek: 'tarek.ghanem@mail.example',
} as const;

export const test = base;
export { expect };

/**
 * Ticks every legal document the page asks for (audit INV-3), as the person joining would. A fresh demo has
 * none published, so there is nothing to tick there.
 */
export async function acceptLegalDocuments(page: Page): Promise<void> {
  for (const box of await page.locator('fieldset[data-legal] input[type="checkbox"]').all()) {
    await box.check();
  }
}

/** The legal documents in force someone joining as `audience` names in a request made past the page. */
export async function legalDocumentIds(
  page: Page,
  audience: 'Owner' | 'Coach' | 'Client',
): Promise<string[]> {
  const answer = await api<{ id: string }[]>(
    page,
    'GET',
    `/api/legal/documents/to-accept?audience=${audience}`,
  );
  return answer.body.map((document) => document.id);
}

/** Skips the whole file unless the live origin is configured. Call it at the top of a spec. */
export function requireLive(): void {
  base.skip(
    !LIVE_URL,
    'Set TB_GYM_LIVE_URL to the origin serving the app with a live API behind it.',
  );
}

/** An email nobody has used yet, so a rerun on the same database never collides. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}@audit.example`;
}

/** Signs in through the real sign-in page and waits for the app to leave the auth screens. */
export async function signIn(page: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  // The public sign-in limit is 30 a minute per address; a whole live run can reach it. A refused
  // attempt (429) waits the minute out and tries once more, so the suite proves the app, not the limit.
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith('/api/auth/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  if (response.status() === 429) {
    await page.waitForTimeout(61_000);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 30_000 });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

/**
 * Calls the API from inside the signed-in page, the way the app does: a fresh antiforgery token
 * before a state change, sent as X-XSRF-TOKEN, and the selected workspace in X-Tenant-Id when given.
 */
export async function api<T = unknown>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { body?: unknown; tenantId?: string } = {},
): Promise<ApiResponse<T>> {
  return page.evaluate(
    async ({ method, path, body, tenantId }) => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (tenantId) headers['X-Tenant-Id'] = tenantId;
      if (method !== 'GET') {
        const csrf = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
        const token = ((await csrf.json()) as { token?: string }).token;
        if (token) headers['X-XSRF-TOKEN'] = token;
        headers['Content-Type'] = 'application/json';
      }
      const response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      return { status: response.status, body: parsed as never };
    },
    { method, path, body: options.body, tenantId: options.tenantId },
  );
}

/** The signed-in person's memberships; the first is the one the app selects by default. */
export async function memberships(
  page: Page,
): Promise<{ tenantId: string; tenantName: string; role: string }[]> {
  const result = await api<{ tenantId: string; tenantName: string; role: string }[]>(
    page,
    'GET',
    '/api/tenants',
  );
  expect(result.status).toBe(200);
  return result.body;
}

/** Collects console errors so a spec can assert the page stayed quiet. */
export function watchConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}
