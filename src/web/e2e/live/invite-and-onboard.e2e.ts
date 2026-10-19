import {
  ACCOUNTS,
  LIVE_URL,
  api,
  expect,
  memberships,
  requireLive,
  signIn,
  test,
  uniqueEmail,
  watchConsoleErrors,
} from './support';

/**
 * Invite and onboard, live (full audit, October 2026): Lea invites a new client, sends the link again
 * (the old one dies), cancels another invitation after being asked, is refused for an under-18 birth
 * date and for an email already in the coaching space; the client accepts in a signed-out context,
 * goes through the five steps, resumes after a reload, and leaves the starting weight out; Lea then
 * finishes setting up from the intake page. Every person this spec writes is created with uniqueEmail
 * and a run-unique first name, so a rerun on the same database never collides.
 */
requireLive();

interface InvitationRow {
  id: string;
  email: string;
  status: string;
  sendCount: number;
  expiresAtUtc: string;
  developmentActionUrl: string | null;
}

async function invitations(
  page: Parameters<typeof api>[0],
  tenantId: string,
): Promise<InvitationRow[]> {
  const result = await api<InvitationRow[] | { items: InvitationRow[] }>(
    page,
    'GET',
    '/api/invitations',
    {
      tenantId,
    },
  );
  expect(result.status).toBe(200);
  return Array.isArray(result.body) ? result.body : result.body.items;
}

/** The browser's own resource errors for statuses this spec provokes on purpose are not page errors. */
const realErrors = (lines: string[]) =>
  lines.filter((line) => !/Failed to load resource/.test(line));

test.describe.configure({ mode: 'serial' });

const suffix = Date.now().toString(36).slice(-4);
const firstName = `Nadia${suffix}`;
const fullName = `${firstName} Spec`;

/** Handed from the first test to the second (same worker, serial). */
let invited: { email: string; link: string } | undefined;

test('Lea invites a client, sends the link again, cancels another and is refused twice', async ({
  page,
}) => {
  const errors = watchConsoleErrors(page);
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);
  const email = uniqueEmail('invite.spec');

  await page.goto('/invitations');
  await expect(page.getByRole('heading', { name: 'Invitations', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Invite a client' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('First name').fill(firstName);
  await sheet.getByLabel('Last name').fill('Spec');
  await sheet.getByLabel('Email').fill(email);
  await sheet.getByLabel(/Phone/).fill('+961 70 000 111');
  await sheet.getByLabel('Day').fill('14');
  await sheet.getByLabel('Month').fill('3');
  await sheet.getByLabel('Year').fill('1994');
  await sheet.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(`Invitation created. We will email ${email} shortly.`)).toBeVisible();

  const created = (await invitations(page, tenantId)).find((row) => row.email === email);
  expect(created?.status).toBe('Pending');
  expect(created?.sendCount).toBe(1);
  const oldLink = created?.developmentActionUrl ?? null;
  expect(oldLink).not.toBeNull();
  // The row says until when the newest link works: the day the API's expiry falls on in Beirut.
  const expiryDay = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Beirut',
    month: 'short',
    day: 'numeric',
  }).format(new Date(created!.expiresAtUtc));
  const row = page.locator(`[data-invitation="${created!.id}"]`);
  await expect(row.locator('.line')).toHaveText(
    `Sent once · the newest link works until ${expiryDay}`,
  );

  // Send again: a new link, and the earlier one no longer works.
  await row.getByRole('button', { name: /Send again/ }).click();
  await expect(
    page.getByText(`A new link was sent to ${email}. The earlier link no longer works.`),
  ).toBeVisible();
  await expect(row.locator('.line')).toContainText('Sent twice');
  const resent = (await invitations(page, tenantId)).find((item) => item.email === email);
  expect(resent?.sendCount).toBe(2);
  expect(resent?.developmentActionUrl).not.toBe(oldLink);

  // Cancel asks first.
  const cancelMe = uniqueEmail('cancel.spec');
  await page.getByRole('button', { name: 'Invite a client' }).first().click();
  await page.getByRole('dialog').getByLabel('First name').fill(`Sami${suffix}`);
  await page.getByRole('dialog').getByLabel('Last name').fill('Cancel');
  await page.getByRole('dialog').getByLabel('Email').fill(cancelMe);
  await page.getByRole('dialog').getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const cancelId = (await invitations(page, tenantId)).find((item) => item.email === cancelMe)!.id;
  await page
    .locator(`[data-invitation="${cancelId}"]`)
    .getByRole('button', { name: /Cancel the invitation/ })
    .click();
  const ask = page.getByRole('dialog');
  await expect(ask).toContainText(
    `Cancel the invitation for Sami${suffix} Cancel? Their link stops working.`,
  );
  await ask.getByRole('button', { name: 'Cancel invitation' }).click();
  await expect(
    page.getByText(`The invitation for Sami${suffix} Cancel was cancelled.`),
  ).toBeVisible();
  const cancelled = (await invitations(page, tenantId)).find((item) => item.email === cancelMe);
  expect(cancelled?.status).toBe('Revoked');

  // Under 18: refused in the sheet, in words, before any request.
  await page.getByRole('button', { name: 'Invite a client' }).first().click();
  const young = page.getByRole('dialog');
  await young.getByLabel('First name').fill('Tala');
  await young.getByLabel('Last name').fill('Young');
  await young.getByLabel('Email').fill(uniqueEmail('young.spec'));
  await young.getByLabel('Day').fill('1');
  await young.getByLabel('Month').fill('6');
  await young.getByLabel('Year').fill('2012');
  await young.getByRole('button', { name: 'Send invitation' }).click();
  await expect(young.getByText('Clients have to be 18 or older.')).toBeVisible();
  await expect(young.getByRole('alert')).toHaveText('Check the fields marked above.');
  // Not now with typed work asks first.
  await young.getByRole('button', { name: 'Not now' }).click();
  const closeAsk = page.getByRole('dialog').last();
  await expect(closeAsk.getByRole('button', { name: 'Keep editing' })).toBeVisible();
  await closeAsk.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // An email already in the coaching space: the server's refusal, kept on screen.
  await page.getByRole('button', { name: 'Invite a client' }).first().click();
  const existing = page.getByRole('dialog');
  await existing.getByLabel('First name').fill('Karl');
  await existing.getByLabel('Last name').fill('Matar');
  await existing.getByLabel('Email').fill(ACCOUNTS.karl);
  await existing.getByRole('button', { name: 'Send invitation' }).click();
  await expect(existing.getByRole('alert')).toHaveText(
    'An active invitation or client relationship already exists for this email.',
  );
  await existing.getByRole('button', { name: 'Not now' }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();

  // The old link is dead, in a signed-out context; the new one shows the invitation.
  const guest = await page
    .context()
    .browser()!
    .newContext({ baseURL: LIVE_URL, timezoneId: 'Asia/Beirut', locale: 'en-US' });
  const guestPage = await guest.newPage();
  await guestPage.goto(new URL(oldLink!).pathname + new URL(oldLink!).search);
  await expect(guestPage.getByRole('heading', { name: /Link unavailable/ })).toBeVisible();
  const newLink = resent!.developmentActionUrl!;
  await guestPage.goto(new URL(newLink).pathname + new URL(newLink).search);
  await expect(guestPage.getByRole('heading', { name: /Join your coach/ })).toBeVisible();
  await expect(guestPage.getByText(email)).toBeVisible();
  await guest.close();

  expect(realErrors(errors)).toEqual([]);
  invited = { email, link: newLink };
});

test('the client joins, resumes the steps after a reload, and Lea finishes the setup', async ({
  browser,
}) => {
  test.skip(!invited, 'needs the invitation from the first test');
  const { link } = invited!;
  const baseURL = LIVE_URL!;
  const password = 'Nadia-Spec-2026!';

  // The client, on a phone, signed out.
  const phone = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });
  const client = await phone.newPage();
  const clientErrors = watchConsoleErrors(client);
  await client.goto(new URL(link).pathname + new URL(link).search);
  await client.getByLabel('Display name').fill(fullName);
  await client.getByLabel('Password', { exact: true }).fill(password);
  await client.getByLabel('Confirm password').fill(password);
  await client.getByRole('button', { name: 'Create account and join' }).click();
  await expect(client).toHaveURL(/\/profile/, { timeout: 30_000 });
  await expect(
    client.getByRole('heading', { level: 1, name: 'Set up your profile' }),
  ).toBeVisible();
  await expect(client.locator('.kicker')).toHaveText('Step 1 of 5');
  // Prefilled from the invitation (CLI-004).
  await expect(client.getByLabel('First name')).toHaveValue(firstName);
  await expect(client.getByLabel(/Phone/)).toHaveValue('+961 70 000 111');
  await expect(client.getByLabel('Year')).toHaveValue('1994');
  await client.getByLabel('Height', { exact: true }).fill('165');
  await client.getByRole('button', { name: 'Continue' }).click();
  await expect(client.locator('.kicker')).toHaveText('Step 2 of 5');
  await client.getByLabel('Goals').fill('Lose 5 kg before the summer and feel stronger.');
  await client.getByRole('button', { name: 'Continue' }).click();
  await expect(client.locator('.kicker')).toHaveText('Step 3 of 5');
  // A reload half way resumes at the first step the saved profile does not finish.
  await client.reload();
  await expect(client.locator('.kicker')).toHaveText('Step 3 of 5');
  await expect(client.locator('#intake-step-heading')).toHaveText('Your day and food');
  await client.getByRole('button', { name: 'Continue' }).click();
  await expect(client.locator('.kicker')).toHaveText('Step 4 of 5');
  await client.getByRole('button', { name: 'Continue' }).click();
  await expect(client.locator('.kicker')).toHaveText('Step 5 of 5');
  await expect(client.getByRole('button', { name: 'Finish setting up' })).toBeVisible();
  // The starting weight is left out: the client goes to Today instead.
  await client.goto('/');
  await expect(client.getByRole('heading', { level: 1 })).toContainText(firstName);
  const [{ tenantId }] = await memberships(client);
  const me = await api<{ id: string; onboardingStatus: string }>(
    client,
    'GET',
    '/api/client-profile/me',
    {
      tenantId,
    },
  );
  expect(me.body.onboardingStatus).toBe('InProgress');
  const clientProfileId = me.body.id;
  expect(realErrors(clientErrors)).toEqual([]);
  await phone.close();

  // Lea: the client is listed as new with no plan, the intake says what is missing, Finish setting up.
  const desktop = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });
  const lea = await desktop.newPage();
  await signIn(lea, ACCOUNTS.coachLea);
  await lea.goto('/clients?show=new');
  const row = lea.locator('.clients li.client-row', { hasText: fullName });
  await expect(row).toBeVisible();
  await expect(row.locator('.plan')).toHaveText('No plan yet');
  await expect(row.locator('app-status-pill')).toHaveText('No active plan');
  await lea.goto(`/clients/${clientProfileId}/intake`);
  await expect(
    lea.getByText(
      `${firstName} has not finished setting up. Their starting weight is the last thing needed.`,
    ),
  ).toBeVisible();
  await lea.getByRole('button', { name: 'Finish setting up' }).click();
  const finish = lea.getByRole('dialog');
  await expect(finish.getByRole('heading', { name: 'Starting weight' })).toBeVisible();
  await finish.getByLabel('Weight', { exact: true }).fill('68.4');
  await finish.getByRole('button', { name: 'Finish setting up' }).click();
  await expect(lea.getByText(`${firstName} has finished setting up.`)).toBeVisible();
  const [{ tenantId: leaTenant }] = await memberships(lea);
  const profile = await api<{ onboardingStatus: string }>(
    lea,
    'GET',
    `/api/clients/${clientProfileId}`,
    {
      tenantId: leaTenant,
    },
  );
  expect(profile.body.onboardingStatus).toBe('Completed');
  await desktop.close();
});
