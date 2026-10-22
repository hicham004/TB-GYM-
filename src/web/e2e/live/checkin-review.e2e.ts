import { chooseDay, chooseOption } from '../kit-controls';
import { ACCOUNTS, api, expect, memberships, requireLive, LIVE_URL, signIn, test } from './support';

/**
 * A check-in end to end: Lea writes and publishes a new form on its own page (unique title, so a rerun
 * never collides), assigns it to Nour due today from Nour's Check-ins tab (audit A14b), Nour answers it on
 * a phone and sends it, and Lea reviews it from Nour's record. The server rules proved on the way: a due
 * date before today is refused (ADR 0017), a submitted check-in moves Draft -> Submitted -> Reviewed one
 * way and a second review is refused (CHK-005, CHK-009).
 */
requireLive();

interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface FormVersionView {
  id: string;
  status: string;
  version: number | string;
}

interface FormDetail {
  form: { id: string; version: number | string };
  versions: FormVersionView[];
}

/** Today as a calendar day in Beirut, where the demo workspace lives. */
function todayInBeirut(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Beirut',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function daysAgo(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const contextOptions = { baseURL: LIVE_URL, locale: 'en-US', timezoneId: 'Asia/Beirut' } as const;

test.describe('check-in review live', () => {
  test.setTimeout(240_000);

  test('publish a form, assign it, answer it as the client, review it as the coach', async ({
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
    const nour = await clientContext.newPage();
    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const title = `Live check-in ${stamp}`;
    const today = todayInBeirut();

    await signIn(lea, ACCOUNTS.coachLea);
    const [{ tenantId }] = await memberships(lea);
    const clients = await api<ClientSummary[]>(lea, 'GET', '/api/clients', { tenantId });
    expect(clients.status).toBe(200);
    const client = clients.body.find(
      (item) => item.firstName === 'Nour' && item.lastName === 'Hamdan',
    );
    expect(client, 'Nour Hamdan is one of Lea’s demo clients').toBeDefined();
    const clientId = client!.id;

    // The form, written on its own page (audit A14b): a short answer and a 1-10 scale, published.
    await lea.goto('/checkins/forms/new');
    await lea.getByLabel('Name', { exact: true }).fill(title);
    await lea.getByLabel('Description (optional)').fill('Made by the live check-in spec.');
    const first = lea.locator('.question').first();
    await first.getByLabel('Question', { exact: true }).fill('How did training feel this week?');
    await lea.getByRole('button', { name: 'Add a question' }).click();
    const second = lea.locator('.question').nth(1);
    await second.getByLabel('Question', { exact: true }).fill('Energy, 1 to 10');
    await chooseOption(second, 'Kind of answer', 'Number scale');
    await expect(second.getByLabel('Highest')).toHaveValue('10');
    await lea.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(lea).toHaveURL(/\/checkins\/forms\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(lea.getByRole('button', { name: 'Change the questions' })).toBeVisible({
      timeout: 20_000,
    });
    const formId = new URL(lea.url()).pathname.split('/').pop()!;
    const created = await api<FormDetail>(lea, 'GET', `/api/checkins/forms/${formId}`, {
      tenantId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const published = created.body.versions.find((version) => version.status === 'Published');
    expect(published, 'the form was published').toBeDefined();
    const formVersionId = published!.id;

    // A due date before today is refused by the server; the sheet never offers one.
    const past = await api(lea, 'POST', `/api/checkins/clients/${clientId}/assignments`, {
      tenantId,
      body: { formVersionId, dueDate: daysAgo(today, 1) },
    });
    expect(past.status).toBe(400);

    // Lea assigns it from Nour's Check-ins tab, due today (audit A14b).
    await lea.goto(`/clients/${clientId}/checkins`);
    await lea.getByRole('button', { name: 'Assign a check-in' }).first().click();
    const sheet = lea.getByRole('dialog', { name: 'Assign a check-in to Nour' });
    await expect(sheet).toBeVisible();
    await chooseOption(sheet, 'Check-in form', title);
    await chooseDay(sheet, 'Due', today);
    await sheet.getByRole('button', { name: 'Assign check-in' }).click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
    await expect(lea.locator('section[aria-labelledby="open-heading"]')).toContainText(title, {
      timeout: 20_000,
    });
    const listed = await api<{ items: { assignment: { id: string; formTitle: string } }[] }>(
      lea,
      'GET',
      `/api/checkins/clients/${clientId}/assignments`,
      { tenantId },
    );
    expect(listed.status).toBe(200);
    const assignmentId = listed.body.items.find((item) => item.assignment.formTitle === title)!
      .assignment.id;

    // Nour answers it on her phone and sends it.
    await signIn(nour, ACCOUNTS.nour);
    await nour.goto(`/checkins/me/${assignmentId}`);
    await expect(nour.locator('.flow-name')).toHaveText(title);
    await expect(nour.locator('#step-heading')).toHaveText('How did training feel this week?');
    await nour.locator('input[name="answer-text"]').fill('Strong, a little tired on Thursday.');
    await nour.locator('.step-primary').click();
    await expect(nour.locator('#step-heading')).toHaveText('Energy, 1 to 10');
    // Few positions are chips; many are a stepper with a number box.
    const chip = nour.locator('.scale-chip', { hasText: /^7$/ });
    if (await chip.isVisible().catch(() => false)) await chip.click();
    else await nour.locator('input[name="scale-value"]').fill('7');
    await nour.locator('.step-primary').click();
    // The optional photo step, then the review.
    const photos = nour.getByRole('button', { name: 'Skip photos' });
    if (await photos.isVisible().catch(() => false)) await photos.click();
    await expect(nour.locator('#step-heading')).toHaveText('Check your answers');
    await expect(nour.locator('.answers')).toContainText('7 out of 10');
    await nour.getByRole('button', { name: 'Send check-in' }).click();
    await expect(nour.locator('.sent')).toContainText('Sent to Lea Khoury', { timeout: 20_000 });

    // Lea reviews it from Nour's record: the first of this form stands alone, Mark reviewed, then reviewed.
    await lea.goto(`/clients/${clientId}/checkins`);
    const toReview = lea.locator('section[aria-labelledby="to-review-heading"]');
    await expect(toReview).toContainText(title, { timeout: 20_000 });
    await toReview.locator('a.row-link', { hasText: title }).click();
    await expect(lea.locator('.review-head .title')).toHaveText(title);
    await expect(lea.locator('.review-head')).toContainText('Needs review');
    await expect(lea.locator('.answers-line')).toContainText('nothing earlier to read it beside');
    await expect(lea.locator('.rows')).toContainText('Strong, a little tired on Thursday.');
    await expect(lea.locator('.rows')).toContainText('7');
    await lea.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(lea.locator('.review-head')).toContainText('Reviewed', { timeout: 20_000 });
    await expect(lea.locator('.review-head .reviewed-line')).toContainText('by you');

    // One way: a second review is refused by the server (CHK-009).
    const again = await api<{ code?: string }>(
      lea,
      'POST',
      `/api/checkins/clients/${clientId}/assignments/${assignmentId}/response/review`,
      { tenantId, body: {} },
    );
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CheckInAlreadyReviewed');

    // The client reads it as reviewed, and the answers are what she sent.
    await nour.goto(`/checkins/me/${assignmentId}`);
    await expect(nour.locator('.sent-view')).toContainText('Reviewed by your coach');
    await expect(nour.locator('.sent-view')).toContainText('Strong, a little tired on Thursday.');

    await coachContext.close();
    await clientContext.close();
  });
});
