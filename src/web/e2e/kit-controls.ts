import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Driving the kit's own controls the way a person does (audit A14a: no screen draws a browser
 * picker any more, so `selectOption` and `fill('2026-10-12')` have nothing to act on). Both the
 * mocked and the live specs use these.
 */

/** The kit select (`app-select`) whose label reads `label` exactly. */
export function kitSelect(scope: Page | Locator, label: string): Locator {
  return scope.locator(`app-select:has(> label:text-is(${JSON.stringify(label)}))`);
}

/** The kit date field (`app-date-field`) whose label reads `label` exactly. */
export function kitDateField(scope: Page | Locator, label: string): Locator {
  return scope.locator(`app-date-field:has(> label:text-is(${JSON.stringify(label)}))`);
}

/** Opens the select labelled `label` with its button and presses the option worded `option`. */
export async function chooseOption(
  scope: Page | Locator,
  label: string,
  option: string,
): Promise<void> {
  const select = kitSelect(scope, label);
  await select.locator('button.trigger').click();
  await select
    .locator(`[role="option"]:has(.option-label:text-is(${JSON.stringify(option)}))`)
    .click();
}

/**
 * Opens the calendar of the date field labelled `label` and chooses the day `iso` (`YYYY-MM-DD`),
 * turning its pages as a person would.
 */
export async function chooseDay(scope: Page | Locator, label: string, iso: string): Promise<void> {
  const field = kitDateField(scope, label);
  const trigger = field.locator('button.trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const month = field.locator('.month');
  // The calendar draws a frame after the press: read it only once it is there.
  await month.waitFor();
  for (let turn = 0; turn < 36; turn++) {
    const day = field.locator(`button.day[data-date="${iso}"]`);
    if ((await day.count()) > 0) {
      await day.click();
      return;
    }
    const shown = (await month.textContent()) ?? '';
    const first = (await field.locator('button.day').first().getAttribute('data-date')) ?? '';
    await field
      .getByRole('button', { name: iso < first ? 'Previous month' : 'Next month', exact: true })
      .click();
    await expect(month).not.toHaveText(shown);
  }
  throw new Error(`The date field labelled "${label}" never showed ${iso}.`);
}
