import { ACCOUNTS, expect, requireLive, signIn, test, uniqueEmail } from './support';

/**
 * A client invitation's lifecycle against the real API (ADR 0002, ADR 0021, NOT-031): Lea invites
 * a new address, "Send again" issues a new link and kills the earlier one, and the new link opens
 * the invitation for the person. The invited address is new on every run.
 */
requireLive();

interface InvitationSummary {
  id: string;
  email: string;
  status: string;
  version: number;
  developmentActionUrl: string | null;
}

test('invite, then send again: the first link dies and the new one works', async ({
  page,
  browser,
}) => {
  await signIn(page, ACCOUNTS.coachLea);
  await page.goto('/invitations');
  await page.getByRole('button', { name: 'Invite a client' }).click();
  const dialog = page.getByRole('dialog');
  const email = uniqueEmail('invitee');
  await dialog.getByLabel('First name').fill('Live');
  await dialog.getByLabel('Last name').fill('Invitee');
  await dialog.getByLabel('Email').fill(email);
  const created = page.waitForResponse(
    (response) =>
      /\/api\/invitations\/?$/.test(response.url()) && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const invitation = (await createdResponse.json()) as InvitationSummary;
  expect(invitation.email).toBe(email);
  expect(invitation.status).toBe('Pending');

  const row = page.locator(`[data-invitation="${invitation.id}"]`);
  await expect(row).toContainText('Waiting to join');
  await expect(row).toContainText('Sent once');

  test.skip(
    !invitation.developmentActionUrl,
    'The API returned no development link (a production mail provider sends it).',
  );
  const firstLink = invitation.developmentActionUrl as string;

  const resent = page.waitForResponse((response) =>
    response.url().includes(`/api/invitations/${invitation.id}/resend`),
  );
  await row.locator('[data-send-again]').click();
  const resentResponse = await resent;
  expect(resentResponse.status()).toBe(200);
  const second = (await resentResponse.json()) as InvitationSummary;
  expect(second.developmentActionUrl).toBeTruthy();
  expect(second.developmentActionUrl).not.toBe(firstLink);
  await expect(row).toContainText('Sent twice');

  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  // The earlier link is dead the moment the new one exists.
  await visitorPage.goto(firstLink);
  await expect(
    visitorPage.getByText('This invitation link is invalid or no longer available.'),
  ).toBeVisible();
  // The new link opens the invitation for the person.
  await visitorPage.goto(second.developmentActionUrl as string);
  await expect(visitorPage.getByRole('heading', { level: 1 })).toContainText('Join your');
  await expect(visitorPage.getByText(email)).toBeVisible();
  await expect(visitorPage.getByRole('button', { name: 'Create account and join' })).toBeVisible();
  await visitor.close();
});
