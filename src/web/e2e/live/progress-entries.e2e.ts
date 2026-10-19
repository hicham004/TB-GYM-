import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * Your entries against a live API (M5, PRG-001, PRG-009 to PRG-011): a weigh-in on a far-past free
 * day, a value correction with a one-tap reason, void-and-replace to another day (the freed day can
 * be logged again), the change history, a measurement out of range refused in words, and kg/lb as a
 * display choice that leaves stored kilograms alone. Each run picks days nobody has used yet, so a
 * rerun on the same database never collides.
 */
requireLive();

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

interface Observation {
  id: string;
  measurementDate: string;
  valueKilograms: number;
  enteredValue: number;
  enteredUnit: string;
  status: string;
}
interface Window {
  displayUnit: string;
  days: { date: string; observation: Observation | null }[];
}

const sheet = (page: Parameters<typeof signIn>[0]) => page.locator('[role=dialog]').last();

/** Walks the sheet's calendar to the day and taps it. */
async function pickDay(page: Parameters<typeof signIn>[0], iso: string): Promise<void> {
  await sheet(page).locator('app-date-field button.trigger').click();
  for (let i = 0; i < 40; i++) {
    const day = page.locator(`button.day[data-date="${iso}"]:not(.outside)`);
    if (await day.count()) {
      await day.click();
      return;
    }
    const first = await page.locator('button.day:not(.outside)').first().getAttribute('data-date');
    await page
      .getByRole('button', { name: iso < (first ?? iso) ? 'Previous month' : 'Next month' })
      .click();
  }
  throw new Error(`${iso} is not reachable in the calendar`);
}

const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Two consecutive free days between 350 and 200 days ago (inside the year the entries page can
 * read, long before the demo's weigh-ins), so the move has somewhere to go.
 */
async function freeDays(page: Parameters<typeof signIn>[0], tenantId: string) {
  const from = isoDaysAgo(350);
  const toExclusive = isoDaysAgo(200);
  const window = await api<Window>(
    page,
    'GET',
    `/api/progress/me?from=${from}&toExclusive=${toExclusive}`,
    { tenantId },
  );
  expect(window.status, JSON.stringify(window.body)).toBe(200);
  const taken = new Set(window.body.days.filter((day) => day.observation).map((day) => day.date));
  for (let days = 349; days > 201; days--) {
    const a = isoDaysAgo(days);
    const b = isoDaysAgo(days - 1);
    if (!taken.has(a) && !taken.has(b)) return { a, b };
  }
  throw new Error('No free pair of days left between 350 and 200 days ago');
}

test('log, correct, move and re-log a weigh-in; the history and the stored kilograms hold', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, ACCOUNTS.maya);
  const tenantId = (await memberships(page))[0].tenantId;
  const { a: dayA, b: dayB } = await freeDays(page, tenantId);
  await page.goto('/progress?tab=weight');
  await expect(page.getByRole('heading', { name: 'Your entries' })).toBeVisible();
  const row = (iso: string) =>
    page.locator('li.row').filter({ has: page.locator(`time[datetime="${iso}"]`) });
  const showAll = async () => {
    for (let i = 0; i < 4; i++) {
      const earlier = page.locator('[data-earlier-weight]');
      if (!(await earlier.isVisible().catch(() => false))) break;
      await earlier.click();
      await expect(earlier).toBeEnabled();
    }
  };
  // A row deep in a long list sits below the fold of the 844-px phone; Playwright's own scroll
  // reports it outside the viewport, so the menu and its item are opened with dispatched clicks.
  const chooseRowAction = async (iso: string, action: string) => {
    const trigger = row(iso).locator('button').first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.dispatchEvent('click');
    const item = page.locator('.panel .item', { hasText: action });
    await expect(item).toBeVisible();
    await item.dispatchEvent('click');
  };

  await test.step('a weigh-in on a free far-past day', async () => {
    await page.locator('[data-log-weight]').click();
    await sheet(page).locator('input[name=value]').fill('70.2');
    await pickDay(page, dayA);
    await sheet(page).getByRole('button', { name: 'Save weight' }).click();
    await expect(page.getByText(/Weight logged for /)).toBeVisible();
    await showAll();
    await expect(row(dayA)).toContainText('70.2 kg');
    await expect(row(dayA)).toContainText('Added by you');
  });

  await test.step('the same day again offers Correct instead of a second entry', async () => {
    await page.locator('[data-log-weight]').click();
    await sheet(page).locator('input[name=value]').fill('70.3');
    await pickDay(page, dayA);
    await expect(sheet(page).locator('[data-already]')).toContainText('is already logged for');
    await expect(sheet(page).getByRole('button', { name: 'Correct that weight' })).toBeVisible();
    await sheet(page).getByRole('button', { name: 'Not now' }).click();
    // A sheet with typed work asks first; Close discards the 70.3 and lets the next step tap freely.
    await page.locator('app-confirm button', { hasText: 'Close' }).click();
    await expect(page.locator('app-confirm')).toHaveCount(0);
  });

  await test.step('Correct the weight with a one-tap reason keeps the history', async () => {
    await chooseRowAction(dayA, 'Correct the weight');
    await sheet(page).locator('input[name=value]').fill('70.4');
    await sheet(page).getByText('Typed the wrong number').click();
    await sheet(page).getByRole('button', { name: 'Save correction' }).click();
    await expect(
      page.getByText('Weight corrected. The earlier number stays in its history.'),
    ).toBeVisible();
    await expect(row(dayA)).toContainText('70.4 kg');
    await chooseRowAction(dayA, 'See changes');
    await expect(sheet(page)).toContainText('Changes to this weight');
    await expect(sheet(page)).toContainText('70.2');
    await page.keyboard.press('Escape');
  });

  await test.step('Wrong day moves it; the freed day can be logged again (PRG-011)', async () => {
    await chooseRowAction(dayA, 'Wrong day');
    await pickDay(page, dayB);
    await sheet(page).getByText('Logged on the wrong day').click();
    await sheet(page).getByRole('button', { name: 'Move to that day' }).click();
    await expect(
      page.getByText(/Moved to .*\. The old entry is kept, marked as replaced\./),
    ).toBeVisible();
    await expect(row(dayA)).toHaveCount(0);
    await expect(row(dayB)).toContainText('70.4 kg');
    // The sheet fades out after the move; its backdrop would swallow the next tap.
    await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
    await page.locator('[data-log-weight]').click();
    await sheet(page).locator('input[name=value]').fill('70');
    await pickDay(page, dayA);
    await expect(sheet(page).locator('[data-already]')).toHaveCount(0);
    await sheet(page).getByRole('button', { name: 'Save weight' }).click();
    await expect(page.getByText(/Weight logged for /)).toBeVisible();
    const window = await api<Window>(
      page,
      'GET',
      `/api/progress/me?from=${dayA}&toExclusive=${dayB}`,
      { tenantId },
    );
    // The read runs to today whatever the end asked for, so judge the two days themselves.
    const byDate = new Map(
      window.body.days
        .filter((day) => day.observation)
        .map((day) => [day.date, day.observation!.valueKilograms]),
    );
    expect(byDate.get(dayA)).toBe(70);
    expect(byDate.get(dayB)).toBe(70.4);
  });

  await test.step('lb is a display choice: stored kilograms stay', async () => {
    const before = await api<Window>(
      page,
      'GET',
      `/api/progress/me?from=${dayA}&toExclusive=${dayB}`,
      {
        tenantId,
      },
    );
    const unit = await api(page, 'PUT', '/api/auth/me/weight-unit', { body: { unit: 'Pound' } });
    expect(unit.status).toBe(200);
    try {
      await page.goto('/progress?tab=weight');
      await showAll();
      await expect(row(dayA)).toContainText('lb');
      await expect(row(dayA)).toContainText('Entered as 70 kg');
      const after = await api<Window>(
        page,
        'GET',
        `/api/progress/me?from=${dayA}&toExclusive=${dayB}`,
        {
          tenantId,
        },
      );
      expect(after.body.days.find((day) => day.date === dayA)!.observation!.valueKilograms).toBe(
        before.body.days.find((day) => day.date === dayA)!.observation!.valueKilograms,
      );
    } finally {
      await api(page, 'PUT', '/api/auth/me/weight-unit', { body: { unit: 'Kilogram' } });
    }
  });
});

test('a measurement out of range is refused in words and the others wait', async ({ page }) => {
  await signIn(page, ACCOUNTS.maya);
  await page.goto('/progress?tab=measurements');
  await expect(page.getByRole('heading', { name: 'Your entries' })).toBeVisible();
  await page.getByRole('button', { name: /Log measurements/ }).click();
  const inputs = sheet(page).locator('input[type=number]');
  await inputs.nth(0).fill('5');
  await sheet(page).getByRole('button', { name: 'Save measurements' }).click();
  await expect(sheet(page)).toContainText('Waist has to be between 10 and 300 cm.');
  await expect(sheet(page)).toContainText('Check the fields marked above.');
  await sheet(page).getByRole('button', { name: 'Not now' }).click();
  const confirm = page.locator('app-confirm');
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.locator('button').last().click();
  }
});
