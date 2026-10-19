import { ACCOUNTS, api, expect, memberships, requireLive, LIVE_URL, signIn, test } from './support';

/**
 * Messaging between two real browsers: Lea (coach, 1440 px) and Maya (client, 390 px) on the Atlas demo's
 * own conversation. A message sent on one side must reach the other side's open thread over the live
 * channel with no refresh (ADR 0020), the read cursor moves only when the client reopens the thread
 * (MSG-009), an edit carries its "Edited" mark across, and a removal takes the body away on both sides
 * (MSG-007, MSG-008). Messages are append-only, so this spec writes into the demo thread and cannot clean
 * up; every body carries a stamp so reruns never collide.
 */
requireLive();

const contextOptions = { baseURL: LIVE_URL, locale: 'en-US', timezoneId: 'Asia/Beirut' } as const;

test.describe('messaging live', () => {
  test.setTimeout(240_000);

  test('delivery both ways, read state on reopening, edit and removal', async ({ browser }) => {
    const coachContext = await browser.newContext({
      ...contextOptions,
      viewport: { width: 1440, height: 900 },
    });
    const clientContext = await browser.newContext({
      ...contextOptions,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const lea = await coachContext.newPage();
    const maya = await clientContext.newPage();
    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

    await signIn(lea, ACCOUNTS.coachLea);
    await lea.goto('/messages');
    await lea.locator('button.conversation', { hasText: 'Maya Fakhoury' }).click();
    await expect(lea.locator('#thread-heading')).toHaveText('Maya Fakhoury');
    await expect(lea.locator('#draft')).toBeVisible();

    await signIn(maya, ACCOUNTS.maya);
    const [{ tenantId }] = await memberships(maya);
    await maya.goto('/messages');
    // One coach: the client lands straight in the thread.
    await expect(maya.locator('#thread-heading')).toHaveText('Lea Khoury');
    await expect(maya.locator('#draft')).toBeVisible();

    // Coach to client, live.
    const fromCoach = `Live check ${stamp}: coach to client`;
    await lea.locator('#draft').fill(fromCoach);
    await lea.keyboard.press('Enter');
    await expect(lea.locator('.feed')).toContainText(fromCoach);
    await expect(maya.locator('.feed')).toContainText(fromCoach, { timeout: 15_000 });

    // Read state (MSG-009, ADR 0020): a message that arrives in the open thread is not read until the
    // client reopens the thread; the cursor never moves by delivery alone.
    const whileOpen = await api<{ unread: number }>(maya, 'GET', '/api/messaging/unread-count', {
      tenantId,
    });
    expect(whileOpen.status).toBe(200);
    expect(whileOpen.body.unread).toBeGreaterThanOrEqual(1);
    await maya.goto('/');
    await expect(maya.locator('h1').first()).toBeVisible();
    await maya.goto('/messages');
    await expect(maya.locator('.feed')).toContainText(fromCoach);
    await expect
      .poll(
        async () =>
          (await api<{ unread: number }>(maya, 'GET', '/api/messaging/unread-count', { tenantId }))
            .body.unread,
        { timeout: 15_000 },
      )
      .toBe(0);

    // Client to coach, live, with the phone's send button.
    const fromClient = `Live check ${stamp}: client to coach`;
    await maya.locator('#draft').fill(fromClient);
    await maya.locator('button.send').click();
    await expect(maya.locator('.feed')).toContainText(fromClient);
    await expect(lea.locator('.feed')).toContainText(fromClient, { timeout: 15_000 });

    // The coach edits her message a few seconds after the client's app received it, as a coach who
    // spots a typo would: the client sees the new words and the Edited mark.
    await lea.waitForTimeout(5_000);
    const edited = `${fromCoach} (edited)`;
    const coachRow = lea.locator('.feed li.mine', { hasText: fromCoach }).first();
    await coachRow.hover();
    await coachRow.locator('button.options').click();
    await coachRow.getByRole('button', { name: /^Edit/ }).click();
    await lea.locator('#edit-draft').fill(edited);
    await lea.getByRole('button', { name: 'Save changes' }).click();
    await expect(lea.locator('.feed')).toContainText(edited, { timeout: 15_000 });
    const editedOnPhone = maya.locator('app-chat-bubble', { hasText: edited }).first();
    await expect(editedOnPhone).toBeVisible({ timeout: 15_000 });
    await expect(editedOnPhone).toContainText('Edited');

    // The coach takes her message back: the body leaves both screens and the row stays as removed.
    const editedRow = lea.locator('.feed li.mine', { hasText: edited }).first();
    await editedRow.hover();
    await editedRow.locator('button.options').click();
    await editedRow.getByRole('button', { name: /^Remove your message/ }).click();
    await expect(lea.locator('.feed')).not.toContainText(edited, { timeout: 15_000 });
    await expect(lea.locator('.feed li.removed').first()).toBeVisible();
    await expect(maya.locator('.feed')).not.toContainText(edited, { timeout: 15_000 });
    await expect(maya.locator('.feed li.removed').first()).toBeVisible();

    await coachContext.close();
    await clientContext.close();
  });
});
