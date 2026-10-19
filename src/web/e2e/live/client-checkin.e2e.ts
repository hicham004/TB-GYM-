import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * A client's check-in against a live API (M6, CHK-005, CHK-008, CHK-012): one question per screen,
 * a required question held, the draft saved as it goes and resumed after a reload, the photo step,
 * the review with Edit, Send, and the list afterwards. Sending uses up one assignment, so the file
 * takes the first demo client who still has one open (there are several on a rebuilt demo) and
 * skips when none is left. Nothing depends on another spec's writes.
 */
requireLive();

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

interface AssignmentItem {
  assignment: { id: string; formTitle: string; dueDate: string };
  response: { status: string; isLate: boolean; submittedDate: string | null } | null;
}

const candidates = [
  ACCOUNTS.yasmine,
  ACCOUNTS.hadi,
  ACCOUNTS.lynn,
  ACCOUNTS.nour,
  ACCOUNTS.sara,
  ACCOUNTS.maya,
  ACCOUNTS.jad,
  ACCOUNTS.rita,
  ACCOUNTS.tarek,
];

async function signInWithOpenCheckIn(page: Parameters<typeof signIn>[0]) {
  for (const email of candidates) {
    await signIn(page, email);
    const tenantId = (await memberships(page))[0].tenantId;
    const list = await api<{ items: AssignmentItem[] }>(
      page,
      'GET',
      '/api/checkins/me/assignments',
      {
        tenantId,
      },
    );
    if (list.status !== 200) {
      await api(page, 'POST', '/api/auth/logout');
      continue;
    }
    const open = list.body.items.find((item) => !item.response || item.response.status === 'Draft');
    if (open) return { email, tenantId, open };
    await api(page, 'POST', '/api/auth/logout');
  }
  return null;
}

/** Answers whatever question is on screen, by its kind. */
async function answerCurrent(page: Parameters<typeof signIn>[0]): Promise<void> {
  if (await page.locator('.scale').count()) {
    const chips = page.locator('.scale-chip');
    await chips.nth(Math.min((await chips.count()) - 1, 6)).click();
  } else if (await page.locator('.stepper').count()) {
    await page.getByRole('button', { name: 'Higher' }).click();
  } else if (await page.locator('input.answer-input').count()) {
    await page.locator('input.answer-input').fill('Live check answer');
  } else if (await page.locator('textarea.answer-text').count()) {
    await page.locator('textarea.answer-text').fill('Live check: a good week, nothing to report.');
  } else if (await page.locator('.options').count()) {
    await page.locator('.option').first().click();
  }
}

test('one question per screen, saved as you go, reviewed, sent and listed', async ({ page }) => {
  test.setTimeout(240_000);
  const found = await signInWithOpenCheckIn(page);
  test.skip(!found, 'No demo client has an open check-in left.');
  const { tenantId, open } = found!;
  const kicker = page.locator('.step .kicker');
  const primary = page.locator('.step-primary');

  await test.step('the list leads with the check-in due and opens the flow', async () => {
    await page.goto('/checkins/me');
    await expect(page.getByRole('heading', { name: 'Check-ins', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: open.assignment.formTitle }).first(),
    ).toBeVisible();
    await page
      .getByRole('link', { name: /Start check-in|Continue check-in/ })
      .first()
      .click();
    await page.waitForURL((url) => url.pathname === `/checkins/me/${open.assignment.id}`);
    await expect(kicker).toContainText(/Question \d+ of \d+|Photos|Ready to send/i);
    await expect(page.locator('.flow-progress')).toBeVisible();
  });

  await test.step('a required question is held until it is answered', async () => {
    const label = (await primary.innerText()).trim();
    if (
      label === 'Next' &&
      (await page
        .locator('.scale, .options, input.answer-input, textarea.answer-text, .stepper')
        .count())
    ) {
      const before = (await kicker.textContent()) ?? '';
      const answered = await page
        .locator('.scale-chip input:checked, .option input:checked')
        .count();
      if (
        answered === 0 &&
        !(await page.locator('input.answer-input, textarea.answer-text').count())
      ) {
        await primary.click();
        await expect(page.locator('.step-reason')).toContainText(
          'This question has to be answered.',
        );
        await expect(kicker).toHaveText(before);
      }
    }
  });

  await test.step('two answers, then a reload lands on the same question', async () => {
    for (let i = 0; i < 2; i++) {
      const text = (await kicker.textContent()) ?? '';
      if (/photos|ready to send/i.test(text)) break;
      await answerCurrent(page);
      await primary.click();
      await expect(kicker).not.toHaveText(text);
    }
    const before = (await kicker.textContent()) ?? '';
    await page.reload();
    await expect(kicker).toBeVisible();
    await expect(kicker).toHaveText(before);
    const draft = await api<{ response?: { status?: string } | null; status?: string }>(
      page,
      'GET',
      `/api/checkins/me/assignments/${open.assignment.id}/response`,
      { tenantId },
    );
    expect(draft.status).toBe(200);
  });

  await test.step('the rest of the questions, a photo, the review with Edit, then Send', async () => {
    for (let i = 0; i < 25; i++) {
      const text = (await kicker.textContent()) ?? '';
      if (/photos|ready to send/i.test(text)) break;
      await answerCurrent(page);
      await primary.click();
      await expect(kicker).not.toHaveText(text);
    }
    if (/photos/i.test(await kicker.innerText())) {
      await expect(primary).toHaveText('Skip photos');
      const art = await page.context().newPage();
      await art.setContent('<canvas id="c" width="300" height="400"></canvas>');
      await art.evaluate(() => {
        const g = (document.getElementById('c') as HTMLCanvasElement).getContext('2d')!;
        g.fillStyle = '#d8e6dc';
        g.fillRect(0, 0, 300, 400);
        g.fillStyle = '#1f4d3a';
        g.fillRect(110, 60, 80, 280);
      });
      const bytes = await art.locator('#c').screenshot();
      await art.close();
      await page.locator('.pose-input').first().setInputFiles({
        name: 'live-check-front.png',
        mimeType: 'image/png',
        buffer: bytes,
      });
      await expect(page.getByText('Added today').first()).toBeVisible({ timeout: 30_000 });
      await expect(primary).toHaveText('Next');
      await primary.click();
    }
    await expect(kicker).toContainText(/ready to send/i);
    await expect(page.getByRole('heading', { name: 'Check your answers' })).toBeVisible();
    const rows = page.locator('.answer-row');
    expect(await rows.count()).toBeGreaterThan(0);
    await rows.first().getByRole('button', { name: /^Edit/ }).click();
    await expect(primary).toHaveText('Back to review');
    await primary.click();
    await expect(kicker).toContainText(/ready to send/i);
    await expect(page.getByText("Answers can't be changed once sent.")).toBeVisible();
    await page.getByRole('button', { name: 'Send check-in' }).click();
    await expect(page.getByText('Check-in sent')).toBeVisible();
    await expect(page.getByText(/Sent to /)).toBeVisible();
  });

  await test.step('the list shows it sent and collapsed; the API says Submitted', async () => {
    const list = await api<{ items: AssignmentItem[] }>(
      page,
      'GET',
      '/api/checkins/me/assignments',
      {
        tenantId,
      },
    );
    const sent = list.body.items.find((item) => item.assignment.id === open.assignment.id)!;
    expect(sent.response?.status).toBe('Submitted');
    await page.goto('/checkins/me');
    await expect(page.getByRole('heading', { name: 'Sent' })).toBeVisible();
    const row = page.locator('.rows a').first();
    await expect(row).toContainText(/Sent /);
    await expect(row).toContainText('Waiting for your coach');
    if (sent.response?.isLate) await expect(row).toContainText('after the due date');
  });
});

test('a paused plan closes check-ins with the reason, never an empty list (CHK-011)', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.karl);
  await page.goto('/checkins/me');
  await expect(page.getByRole('heading', { name: 'Check-ins are closed' })).toBeVisible();
  await expect(page.getByText('Check-ins are not in your plan. Ask your coach.')).toBeVisible();
});
