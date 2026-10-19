import { expect, test, type APIRequestContext } from '@playwright/test';

import { ACCOUNTS, DEMO_PASSWORD, requireLive, uniqueEmail } from './support';

/**
 * Security and tenancy, proved against the live API with Playwright's request fixture (full audit,
 * October 2026): a coach reading another coach's client is answered 404, a write without the
 * antiforgery token is 400, a released client is 409 for the owner, a non-admin is 403 on the
 * platform admin's routes, and a client reading another client's photo is 404. Each test signs in
 * through POST /api/auth/login with the csrf dance the app itself does, and the release test creates
 * the client it releases so a rebuilt demo runs it again.
 */
requireLive();

interface Membership {
  tenantId: string;
  tenantName: string;
  role: string;
}

/** A signed-in API session: cookies live in the request context, the csrf token is refreshed per write. */
class ApiSession {
  tenantId = '';

  constructor(private readonly request: APIRequestContext) {}

  async signIn(email: string, password = DEMO_PASSWORD): Promise<void> {
    const token = await this.csrf();
    let response = await this.request.post('/api/auth/login', {
      headers: { 'X-XSRF-TOKEN': token },
      data: { email, password, rememberMe: false },
    });
    if (response.status() === 429) {
      // The public sign-in limit (30 a minute per address) can be spent by the rest of a live run;
      // waiting the minute out once keeps this spec about tenancy, not about the limit.
      await new Promise((resolve) => setTimeout(resolve, 61_000));
      response = await this.request.post('/api/auth/login', {
        headers: { 'X-XSRF-TOKEN': await this.csrf() },
        data: { email, password, rememberMe: false },
      });
    }
    expect(response.status(), `sign-in as ${email}`).toBe(200);
    const memberships = await this.request.get('/api/tenants');
    expect(memberships.status()).toBe(200);
    const list = (await memberships.json()) as Membership[];
    this.tenantId =
      list.find((m) => m.tenantName === 'Atlas Performance')?.tenantId ?? list[0]?.tenantId ?? '';
  }

  async csrf(): Promise<string> {
    const response = await this.request.get('/api/auth/csrf');
    expect(response.status()).toBe(200);
    return ((await response.json()) as { token: string }).token;
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.tenantId ? { 'X-Tenant-Id': this.tenantId, ...extra } : extra;
  }

  get(path: string) {
    return this.request.get(path, { headers: this.headers() });
  }

  async post(path: string, data: unknown, options: { withToken?: boolean } = {}) {
    const headers =
      options.withToken === false
        ? this.headers()
        : this.headers({ 'X-XSRF-TOKEN': await this.csrf() });
    return this.request.post(path, { headers, data });
  }

  async put(path: string, data: unknown) {
    return this.request.put(path, {
      headers: this.headers({ 'X-XSRF-TOKEN': await this.csrf() }),
      data,
    });
  }
}

interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string;
  version: number;
}

async function clientNamed(session: ApiSession, lastName: string): Promise<ClientSummary> {
  const response = await session.get('/api/clients');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { items?: ClientSummary[] } | ClientSummary[];
  const items = Array.isArray(body) ? body : (body.items ?? []);
  const client = items.find((c) => c.lastName === lastName);
  expect(client, `client ${lastName} in the list`).toBeDefined();
  return client as ClientSummary;
}

test.describe('security and tenancy (live)', () => {
  test("a coach reading another coach's client is answered 404, never data", async ({
    playwright,
  }) => {
    const omarContext = await playwright.request.newContext();
    const leaContext = await playwright.request.newContext();
    try {
      const omar = new ApiSession(omarContext);
      await omar.signIn(ACCOUNTS.coachOmar);
      const jad = await clientNamed(omar, 'Karam');

      const lea = new ApiSession(leaContext);
      await lea.signIn(ACCOUNTS.coachLea);
      for (const path of [
        `/api/clients/${jad.id}`,
        `/api/clients/${jad.id}/overview`,
        `/api/commercial/clients/${jad.id}`,
        `/api/training/clients/${jad.id}/program`,
        `/api/progress/clients/${jad.id}/photos`,
        `/api/checkins/clients/${jad.id}/assignments`,
        `/api/nutrition/clients/${jad.id}/plans`,
        `/api/strength/clients/${jad.id}/maxes`,
      ]) {
        const response = await lea.get(path);
        expect(response.status(), path).toBe(404);
        expect(await response.text(), path).not.toContain('Karam');
      }
      const note = await lea.put(`/api/clients/${jad.id}/coach-notes`, {
        notes: 'not mine',
        version: jad.version,
      });
      expect(note.status()).toBe(404);
      const list = await lea.get('/api/clients');
      expect(await list.text()).not.toContain('Karam');
    } finally {
      await omarContext.dispose();
      await leaContext.dispose();
    }
  });

  test('a write without the antiforgery token is 400 antiforgery_token_invalid', async ({
    request,
  }) => {
    const lea = new ApiSession(request);
    await lea.signIn(ACCOUNTS.coachLea);
    const noToken = await lea.post('/api/notifications/read-all', {}, { withToken: false });
    expect(noToken.status()).toBe(400);
    expect(((await noToken.json()) as { code: string }).code).toBe('antiforgery_token_invalid');
    const withToken = await lea.post('/api/notifications/read-all', {});
    expect([200, 204]).toContain(withToken.status());
  });

  test('a released client is read-only: the owner gets 409 client_released on every write', async ({
    playwright,
  }) => {
    const ownerContext = await playwright.request.newContext();
    try {
      const karim = new ApiSession(ownerContext);
      await karim.signIn(ACCOUNTS.owner);
      // A client of our own, so a rebuilt demo runs this again: invite, accept through the API, release.
      const email = uniqueEmail('released');
      const invitation = await karim.post('/api/invitations', {
        email,
        firstName: 'Released',
        lastName: 'Probe',
        idempotencyKey: crypto.randomUUID(),
      });
      expect(invitation.status()).toBe(201);
      const link = ((await invitation.json()) as { developmentActionUrl?: string })
        .developmentActionUrl;
      expect(link, 'the development build returns the invitation link').toBeTruthy();
      const token = new URL(link as string).searchParams.get('token') as string;

      const inviteeContext = await playwright.request.newContext();
      try {
        const anonymousToken = (
          (await (await inviteeContext.get('/api/auth/csrf')).json()) as { token: string }
        ).token;
        const accept = await inviteeContext.post('/api/invitations/accept', {
          headers: { 'X-XSRF-TOKEN': anonymousToken },
          data: { token, displayName: 'Released Probe', password: 'Released-Probe-2026!' },
        });
        expect([200, 201, 204]).toContain(accept.status());
      } finally {
        await inviteeContext.dispose();
      }

      const client = await clientNamed(karim, 'Probe');
      const release = await karim.post(`/api/clients/${client.id}/release`, {
        reason: 'Audit release',
        version: client.version,
      });
      expect(release.status()).toBe(200);

      const notes = await karim.put(`/api/clients/${client.id}/coach-notes`, {
        notes: 'after release',
        version: client.version + 1,
      });
      expect(notes.status()).toBe(409);
      expect(((await notes.json()) as { code: string }).code).toBe('client_released');
      const block = await karim.post(`/api/clients/${client.id}/relationship/block`, {
        reason: 'x',
        version: client.version + 1,
      });
      expect(block.status()).toBe(409);
      const bodyweight = await karim.post(`/api/progress/clients/${client.id}/bodyweight`, {
        value: 70,
        unit: 'Kilogram',
        measurementDate: '2026-10-18',
      });
      expect(bodyweight.status()).toBe(409);
      // The owner keeps the read-only record.
      expect((await karim.get(`/api/clients/${client.id}`)).status()).toBe(200);
      expect(await (await karim.get('/api/clients')).text()).not.toContain('"Probe"');
    } finally {
      await ownerContext.dispose();
    }
  });

  test('the platform admin routes refuse an owner, a coach and a client', async ({
    playwright,
  }) => {
    for (const account of [ACCOUNTS.owner, ACCOUNTS.coachLea, ACCOUNTS.maya]) {
      const context = await playwright.request.newContext();
      try {
        const session = new ApiSession(context);
        await session.signIn(account);
        const workspaces = await context.get('/api/platform-admin/workspaces');
        expect(workspaces.status(), account).toBe(403);
        const issue = await context.post('/api/platform-admin/invoices/issue', {
          headers: { 'X-XSRF-TOKEN': await session.csrf() },
          data: { periodStart: '2026-09-01' },
        });
        expect(issue.status(), account).toBe(403);
      } finally {
        await context.dispose();
      }
    }
  });

  test("a client reading another client's rows is answered 404", async ({ playwright }) => {
    const leaContext = await playwright.request.newContext();
    const mayaContext = await playwright.request.newContext();
    try {
      const lea = new ApiSession(leaContext);
      await lea.signIn(ACCOUNTS.coachLea);
      const nour = await clientNamed(lea, 'Hamdan');
      const nourProgress = await lea.get(
        `/api/progress/clients/${nour.id}?from=2026-10-01&to=2026-10-18`,
      );
      expect(nourProgress.status()).toBe(200);
      const observations =
        ((await nourProgress.json()) as { observations?: { id: string }[] }).observations ?? [];
      const nourPhotos = await lea.get(`/api/progress/clients/${nour.id}/photos`);
      expect(nourPhotos.status()).toBe(200);
      const photos =
        ((await nourPhotos.json()) as { photos?: { id: string; mediaAssetId: string }[] }).photos ??
        [];

      const maya = new ApiSession(mayaContext);
      await maya.signIn(ACCOUNTS.maya);
      if (observations[0]) {
        expect(
          (await maya.get(`/api/progress/me/bodyweight/${observations[0].id}/history`)).status(),
        ).toBe(404);
      }
      if (photos[0]) {
        expect(
          (
            await maya.post(`/api/progress/me/photos/${photos[0].id}/remove`, {
              reason: 'x',
              version: 1,
            })
          ).status(),
        ).toBe(404);
        expect([403, 404]).toContain(
          (await maya.post(`/api/media/${photos[0].mediaAssetId}/access`, {})).status(),
        );
      }
      const randomPhoto = crypto.randomUUID();
      expect(
        (
          await maya.post(`/api/progress/me/photos/${randomPhoto}/remove`, {
            reason: 'x',
            version: 1,
          })
        ).status(),
      ).toBe(404);
      expect(
        (await maya.get(`/api/progress/me/bodyweight/${crypto.randomUUID()}/history`)).status(),
      ).toBe(404);
      // A client on a coach route is 403, and Nour's name never appears.
      const clients = await maya.get('/api/clients');
      expect(clients.status()).toBe(403);
      expect(await clients.text()).not.toContain('Hamdan');
    } finally {
      await leaContext.dispose();
      await mayaContext.dispose();
    }
  });
});
