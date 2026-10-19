import {
  ACCOUNTS,
  api,
  expect,
  memberships,
  requireLive,
  signIn,
  test,
  uniqueEmail,
} from './support';

/**
 * The unpaid read-only state (ADR 0028, PBL-005): once an unpaid platform invoice has passed its read-only
 * day, the owner's and coaches' state-changing requests answer 403 `workspace_read_only`, reads and the
 * reviewed personal writes still work, and the coach app says so in a banner. The lock is a fact of the
 * copy's billing data, so when the workspace is not locked the file skips with a message instead of
 * inventing the state.
 */
requireLive();

interface BillingAccess {
  isReadOnly: boolean;
  hasOverdueInvoice: boolean;
  readOnlyFrom: string | null;
}

interface ReadOnlyProblem {
  code?: string;
  message?: string;
}

test.describe('unpaid workspace: read-only for staff', () => {
  test('a staff write is refused with 403 workspace_read_only and the banner says so', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.owner);
    const atlas = (await memberships(page)).find(
      (membership) => membership.tenantName === 'Atlas Performance',
    );
    expect(atlas, 'the Atlas Performance demo workspace').toBeDefined();
    const tenantId = atlas!.tenantId;

    const access = await api<BillingAccess>(page, 'GET', '/api/billing/access', { tenantId });
    expect(access.status).toBe(200);
    test.skip(
      !access.body.isReadOnly,
      'The workspace is not read-only: no unpaid platform invoice has passed its read-only day.',
    );

    // A write the owner could otherwise make: inviting a client. Refused before anything is created.
    const refused = await api<ReadOnlyProblem>(page, 'POST', '/api/invitations', {
      tenantId,
      body: {
        email: uniqueEmail('readonly'),
        firstName: 'Read',
        lastName: 'Only',
        phoneNumber: null,
        birthDate: null,
      },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('workspace_read_only');
    expect(refused.body.message).toContain('read-only');

    // Reads still work, and so does a reviewed personal write (notification read state).
    const read = await api(page, 'GET', '/api/clients', { tenantId });
    expect(read.status).toBe(200);
    const allowed = await api(page, 'POST', '/api/notifications/read-all', { tenantId, body: {} });
    expect(allowed.status).toBeLessThan(300);

    // The coach app's banner, on an ordinary coach page, in words.
    await page.goto('/clients');
    const banner = page.locator('[data-billing-banner="read-only"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('read-only until the overdue TB Gym invoice is paid');
    await expect(banner).toContainText('your clients keep full access');
    await expect(banner.getByRole('link', { name: 'Open Billing' })).toBeVisible();

    // The Billing page names the state the same way.
    await banner.getByRole('link', { name: 'Open Billing' }).click();
    await expect(page.locator('[data-billing-status]')).toContainText('Read-only until paid');
    await expect(page.locator('[data-billing-status]')).toContainText(
      'read-only for you and your coaches until the overdue invoice is paid',
    );
  });

  test('a coach is locked too, and a client is not', async ({ browser }) => {
    const coachContext = await browser.newContext();
    const coach = await coachContext.newPage();
    await signIn(coach, ACCOUNTS.coachLea);
    const atlas = (await memberships(coach)).find(
      (membership) => membership.tenantName === 'Atlas Performance',
    );
    const tenantId = atlas!.tenantId;
    const access = await api<BillingAccess>(coach, 'GET', '/api/billing/access', { tenantId });
    test.skip(
      !access.body.isReadOnly,
      'The workspace is not read-only: no unpaid platform invoice has passed its read-only day.',
    );
    // A coach learns only that the space is read-only; the overdue warning and the lock day are the owner's.
    expect(access.body.hasOverdueInvoice).toBe(false);
    expect(access.body.readOnlyFrom).toBeNull();

    const refused = await api<ReadOnlyProblem>(coach, 'POST', '/api/messaging/saved-replies', {
      tenantId,
      body: { title: 'Read-only check', body: 'This must not be saved.' },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('workspace_read_only');

    await coach.goto('/clients');
    const banner = coach.locator('[data-billing-banner="read-only"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('the owner can settle it');
    await expect(banner.getByRole('link', { name: 'Open Billing' })).toHaveCount(0);
    await coachContext.close();

    // A client keeps full use: their own notification read state is a write the lock never touches.
    const clientContext = await browser.newContext();
    const client = await clientContext.newPage();
    await signIn(client, ACCOUNTS.maya);
    const clientWrite = await api(client, 'POST', '/api/notifications/read-all', {
      tenantId,
      body: {},
    });
    expect(clientWrite.status).toBeLessThan(300);
    const clientAccess = await api(client, 'GET', '/api/billing/access', { tenantId });
    // The billing access read is the coach shell's; a client is not offered it.
    expect([401, 403, 404]).toContain(clientAccess.status);
    await expect(client.locator('[data-billing-banner]')).toHaveCount(0);
    await clientContext.close();
  });
});
