import { api, expect, requireLive, signIn, test } from './support';

/**
 * Platform billing (ADR 0028, PBL-004, PBL-007): the platform admin records the one exact payment on a
 * coaching space's unpaid invoice, dated the day the money arrived (today by default), through the real
 * Record payment sheet. The admin is a global role granted by the `platform-admin` command, so the
 * account comes from the environment; without it the file is skipped.
 *
 * On a copy where every invoice is already paid or void (a rerun), it asserts that state instead: no
 * Record payment or Void is offered and nothing is owed.
 */
requireLive();

const ADMIN_EMAIL = process.env['TB_GYM_LIVE_ADMIN_EMAIL'];
const ADMIN_PASSWORD = process.env['TB_GYM_LIVE_ADMIN_PASSWORD'];

interface AdminWorkspaceSummary {
  tenantId: string;
  name: string;
  status: string;
  unpaidTotal: number;
}

interface AdminInvoice {
  id: string;
  referenceCode: string;
  status: string;
  issuedAtUtc: string;
  amounts: { total: number; currencyCode: string };
  payment: { amount: number; reference: string; receivedOn: string } | null;
}

interface AdminWorkspaceDetail {
  summary: AdminWorkspaceSummary;
  invoices: AdminInvoice[];
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function money(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(
    amount,
  );
}

test.describe('platform admin: record a payment', () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'Set TB_GYM_LIVE_ADMIN_EMAIL and TB_GYM_LIVE_ADMIN_PASSWORD to an account granted the platform-admin role.',
  );

  test('records a payment dated today on an unpaid invoice, or sees the paid state', async ({
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    const list = await api<AdminWorkspaceSummary[]>(page, 'GET', '/api/platform-admin/workspaces');
    expect(list.status).toBe(200);
    const atlas = list.body.find((space) => space.name === 'Atlas Performance');
    expect(atlas, 'the Atlas Performance demo workspace').toBeDefined();

    await page.goto(`/admin/billing/${atlas!.tenantId}`);
    await expect(page.locator('[data-space-status]')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Atlas Performance');

    const before = await api<AdminWorkspaceDetail>(
      page,
      'GET',
      `/api/platform-admin/workspaces/${atlas!.tenantId}`,
    );
    expect(before.status).toBe(200);
    const unpaid = before.body.invoices.find(
      (invoice) => invoice.status === 'Open' || invoice.status === 'Overdue',
    );

    if (!unpaid) {
      // Nothing to pay: the screen offers no payment or void, and the space owes nothing.
      await expect(page.locator('[data-record-payment]')).toHaveCount(0);
      await expect(page.locator('[data-void]')).toHaveCount(0);
      expect(before.body.summary.unpaidTotal).toBe(0);
      await expect(page.locator('[data-space-status]')).not.toContainText('Owes');
      return;
    }

    const row = page.locator(`li.invoice[data-invoice="${unpaid.id}"]`);
    await expect(row).toContainText(unpaid.referenceCode);
    await row.locator('[data-record-payment]').click();

    const sheet = page.locator('app-platform-payment');
    await expect(sheet).toBeVisible();
    // The amount is shown, never typed: a payment is always the invoice's exact total (PBL-004).
    await expect(sheet.locator('.amount')).toContainText(
      money(unpaid.amounts.total, unpaid.amounts.currencyCode),
    );
    // The day the money arrived defaults to today, a UTC day (PBL-007).
    const todayUtc = new Date();
    await expect(sheet.locator('app-date-field button').first()).toContainText(
      String(todayUtc.getUTCDate()),
    );

    const reference = `AUDIT-${Date.now().toString(36).toUpperCase()}`;
    await sheet.locator('input[name="reference"]').fill(reference);
    await sheet.locator('textarea[name="note"]').fill('Recorded by the live check.');
    await sheet.getByRole('button', { name: 'Record payment' }).click();

    await expect(page.getByText(`Payment recorded for ${unpaid.referenceCode}.`)).toBeVisible();
    await expect(row).toContainText('Paid');
    await expect(row.locator('[data-record-payment]')).toHaveCount(0);
    await expect(row.locator('[data-void]')).toHaveCount(0);
    await expect(row).toContainText(reference);

    const after = await api<AdminWorkspaceDetail>(
      page,
      'GET',
      `/api/platform-admin/workspaces/${atlas!.tenantId}`,
    );
    const paid = after.body.invoices.find((invoice) => invoice.id === unpaid.id);
    expect(paid?.status).toBe('Paid');
    expect(paid?.payment?.amount).toBe(unpaid.amounts.total);
    expect(paid?.payment?.reference).toBe(reference);
    expect(paid?.payment?.receivedOn).toBe(utcToday());
    // Paying lifts a read-only lock at once (PBL-005): the space is never left read-only by its own paid bill.
    expect(after.body.summary.status).not.toBe('ReadOnly');

    // A second payment on the same invoice is refused (PBL-004); the identical retry answers the same payment.
    const again = await api<{ code?: string }>(
      page,
      'POST',
      `/api/platform-admin/invoices/${unpaid.id}/payments`,
      {
        body: {
          amount: unpaid.amounts.total,
          reference: `${reference}-2`,
          note: null,
          receivedOn: utcToday(),
        },
      },
    );
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('invoice_paid');
  });
});
