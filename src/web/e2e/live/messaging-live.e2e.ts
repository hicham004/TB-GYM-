import { ACCOUNTS, api, expect, memberships, requireLive, LIVE_URL, signIn, test } from './support';

/**
 * Messaging between two real browsers: Lea (coach, 1440 px) and Maya (client, 390 px) on the Atlas demo's
 * own conversation. A message sent on one side must reach the other side's open thread over the live
 * channel with no refresh (ADR 0020); one that lands in front of the reader, in the open thread of a shown
 * tab at its newest message, is read at once and the badge agrees (MSG-009, audit NCM-4); an edit carries
 * its "Edited" mark across, and a removal and a coach's removal take the body away on both sides (MSG-007,
 * MSG-008), each made after the other side's app has acknowledged the message, which is what used to
 * answer 409 (audit NCM-12). Messages are append-only, so this spec writes into the demo thread and
 * cannot clean up; every body carries a stamp so reruns never collide.
 */

interface ThreadMessage {
  id: string;
  body: string | null;
  deliveryState: string;
}
requireLive();

const contextOptions = { baseURL: LIVE_URL, locale: 'en-US', timezoneId: 'Asia/Beirut' } as const;

test.describe('messaging live', () => {
  test.setTimeout(240_000);

  test('delivery both ways, read where it lands, and edits and removals after acknowledgement', async ({
    browser,
  }) => {
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

    // What the server says about each message's delivery, read as the coach.
    const [{ tenantId: leaTenant }] = await memberships(lea);
    const threads = await api<{ items: { id: string; counterpart: { displayName: string } }[] }>(
      lea,
      'GET',
      '/api/messaging/conversations',
      { tenantId: leaTenant },
    );
    const conversationId = threads.body.items.find(
      (item) => item.counterpart.displayName === 'Maya Fakhoury',
    )!.id;
    const deliveryOf = async (body: string) =>
      (
        await api<{ items: ThreadMessage[] }>(
          lea,
          'GET',
          `/api/messaging/conversations/${conversationId}/messages`,
          { tenantId: leaTenant },
        )
      ).body.items.find((item) => item.body === body)?.deliveryState;

    // Read state (MSG-009, NCM-4): it landed in front of Maya, in her open thread at its newest message,
    // so it is read where she reads it, and the badge, the count and the thread all say so.
    await expect
      .poll(
        async () =>
          (await api<{ unread: number }>(maya, 'GET', '/api/messaging/unread-count', { tenantId }))
            .body.unread,
        { timeout: 15_000 },
      )
      .toBe(0);
    await expect(maya.locator('.thread-unread')).toContainText('Nothing unread');
    // Her app acknowledges what it received a quarter second after it lands; a reload before then drops
    // that acknowledgement, so the server must have it before she leaves the thread.
    await expect
      .poll(() => deliveryOf(fromCoach), { timeout: 15_000 })
      .toBe('RealtimeAcknowledged');
    // Coming back draws no "New messages" line over what she has already read.
    await maya.goto('/');
    await expect(maya.locator('h1').first()).toBeVisible();
    await maya.goto('/messages');
    await expect(maya.locator('.feed')).toContainText(fromCoach);
    await expect(maya.locator('.new-divider')).toHaveCount(0);

    // Client to coach, live, with the phone's send button.
    const fromClient = `Live check ${stamp}: client to coach`;
    await maya.locator('#draft').fill(fromClient);
    await maya.locator('button.send').click();
    await expect(maya.locator('.feed')).toContainText(fromClient);
    await expect(lea.locator('.feed')).toContainText(fromClient, { timeout: 15_000 });

    // Both apps have acknowledged both messages, which once rewrote each message's version so every
    // edit and removal after it answered 409 (NCM-12). Wait until the server says so, then act.
    await expect
      .poll(() => deliveryOf(fromCoach), { timeout: 15_000 })
      .toBe('RealtimeAcknowledged');
    await expect
      .poll(() => deliveryOf(fromClient), { timeout: 15_000 })
      .toBe('RealtimeAcknowledged');

    // The coach edits her message after the client's app received it, as a coach who spots a typo
    // would: the client sees the new words and the Edited mark.
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

    // The coach removes the client's acknowledged message as coach, with a reason only she keeps.
    const clientRow = lea.locator('.feed li.theirs', { hasText: fromClient }).first();
    await clientRow.hover();
    await clientRow.locator('button.options').click();
    await clientRow.getByRole('button', { name: /as coach$/ }).click();
    await lea.getByLabel('Reason for removing this message').fill('Live check: moved to the plan');
    await lea.getByRole('button', { name: 'Confirm removal' }).click();
    await expect(lea.locator('.feed')).not.toContainText(fromClient, { timeout: 15_000 });
    await expect(maya.locator('.feed')).not.toContainText(fromClient, { timeout: 15_000 });
    await expect(lea.locator('p.error')).toHaveText('');

    await coachContext.close();
    await clientContext.close();
  });
});
