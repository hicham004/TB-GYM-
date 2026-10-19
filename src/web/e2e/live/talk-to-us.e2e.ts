import { expect, requireLive, test, type Page } from './support';

/**
 * Talk to us (WEB-001, WEB-002) against the real API: the form sends once the server's minimum
 * time has passed and the request is accepted, and a filled honeypot is answered exactly as an
 * accepted request. Each test posts once; the API allows five posts an hour per address, so a run
 * of this file costs two of them. Whether a request is stored is a database fact the audit checks
 * with SQL; here only the API's answer and the screen are read.
 */
requireLive();

const MINIMUM_FORM_MS = 3000;

async function openForm(page: Page): Promise<void> {
  const stamp = page.waitForResponse((response) =>
    response.url().includes('/api/website/contact-form'),
  );
  await page.goto('/');
  await page.locator('#talk').scrollIntoViewIfNeeded();
  expect((await stamp).status()).toBe(200);
}

async function fillForm(page: Page, name: string, contact: string): Promise<void> {
  await page.locator('#talk-name').fill(name);
  await page.locator('#talk-gym').fill('Live Gym');
  await page.locator('#talk-contact').fill(contact);
  await page.locator('#talk-message').fill('Two coaches, about thirty clients. A live check.');
}

test('the form sends after the minimum time and the request is accepted', async ({ page }) => {
  await openForm(page);
  const name = 'Live Gym Owner';
  await fillForm(page, name, 'live.owner@audit.example');
  await page.waitForTimeout(MINIMUM_FORM_MS + 500);
  const posted = page.waitForResponse(
    (response) =>
      response.url().includes('/api/website/contact-requests') &&
      response.request().method() === 'POST',
  );
  await page.locator('.talk__send').click();
  expect((await posted).status()).toBe(202);
  await expect(page.locator('.talk__done')).toContainText(`Thanks, ${name}.`);
  await expect(page.locator('.talk__done')).toContainText('live.owner@audit.example');
});

test('a filled honeypot is answered exactly as an accepted request', async ({ page }) => {
  await openForm(page);
  await fillForm(page, 'Live Honeypot', 'honeypot@audit.example');
  // A person never sees the Website field; a script that fills it is answered as if accepted.
  await page.evaluate(() => {
    const field = document.getElementById('talk-website') as HTMLInputElement;
    field.value = 'http://spam.example';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(MINIMUM_FORM_MS + 500);
  const posted = page.waitForResponse(
    (response) =>
      response.url().includes('/api/website/contact-requests') &&
      response.request().method() === 'POST',
  );
  await page.locator('.talk__send').click();
  const response = await posted;
  expect(response.status()).toBe(202);
  expect(await response.text()).toBe('');
  await expect(page.locator('.talk__done')).toContainText('Thanks, Live Honeypot.');
});
