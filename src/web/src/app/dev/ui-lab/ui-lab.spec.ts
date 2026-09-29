import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import {
  announced,
  button,
  field,
  fill,
  focusedId,
  leave,
  press,
  query,
  settle,
  text,
  tick,
} from '../../../testing/dom';
import { devRoutes } from '../dev-routes.development';
import { LAB_SAVE_DELAY_MS, UiLab } from './ui-lab';

async function render(url = '/dev/ui-lab') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'dev/ui-lab', component: UiLab }]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, UiLab);
  await settle(harness.fixture);
  return { harness, fixture: harness.fixture, host: harness.routeNativeElement as HTMLElement };
}

/** The value shown beside a label in the lab's form-state list. */
function state(host: HTMLElement, label: string): string {
  const term = Array.from(host.querySelectorAll('dt')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  return term?.nextElementSibling?.textContent?.trim() ?? '';
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('UiLab', () => {
  it('is registered only as a development route', () => {
    expect(devRoutes.map((route) => route.path)).toEqual(['dev/ui-lab']);
  });

  it('opens pristine: no reasons, no invalid controls and an empty summary', async () => {
    const { host } = await render();

    expect(field(host, 'Exercise name').hasAttribute('aria-invalid')).toBe(false);
    expect(host.querySelectorAll('.tb-field__support--error')).toHaveLength(1); // the "already touched" example
    expect(announced(host)).toBe('');
    expect(state(host, 'Dirty')).toBe('no');
    expect(state(host, 'Touched')).toBe('no');
  });

  it('changes period and tab content through the rendered selection controls', async () => {
    const { fixture, host } = await render();

    const month = query<HTMLInputElement>(host, 'app-segmented-control input[value="month"]');
    month.click();
    await settle(fixture);
    expect(month.checked).toBe(true);
    expect(text(fixture)).toContain('Selected period: month');

    const activity = query<HTMLButtonElement>(host, 'app-tabs button:nth-child(2)');
    expect(activity.getAttribute('role')).toBe('tab');
    activity.click();
    await settle(fixture);
    expect(text(fixture)).toContain('Activity tells the story behind the numbers.');
  });

  it('shows a reason only for the field that was left', async () => {
    const { fixture, host } = await render();

    leave(host, 'Exercise name');
    await settle(fixture);

    const name = field(host, 'Exercise name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(query(host, `#${name.id}-error`).textContent).toContain(
      'Enter a name for this exercise.',
    );
    expect(field<HTMLSelectElement>(host, 'Equipment').hasAttribute('aria-invalid')).toBe(false);
    expect(state(host, 'Touched')).toBe('yes');
  });

  it('refuses an invalid submit out loud: every reason, focus on the summary, nothing saved', async () => {
    const { fixture, host } = await render();

    press(host, 'Save exercise');
    await settle(fixture);

    expect(announced(host)).toContain('This exercise cannot be saved yet:');
    expect(announced(host)).toContain('Enter a name for this exercise.');
    expect(announced(host)).toContain('Choose the equipment this exercise uses.');
    expect(focusedId()).toBe('lab-summary');
    expect(field(host, 'Exercise name').getAttribute('aria-invalid')).toBe('true');
    expect(state(host, 'Saves started')).toBe('0');
  });

  it('saves a valid form once, even when pressed again while it is loading', async () => {
    const { fixture, host } = await render();
    fill(host, 'Exercise name', 'Barbell back squat');
    fill(host, 'Equipment', 'Barbell');
    await settle(fixture);
    expect(state(host, 'Valid')).toBe('yes');
    expect(state(host, 'Dirty')).toBe('yes');

    press(host, 'Save exercise');
    await settle(fixture);
    const saving = button(host, 'Saving…');
    expect(saving.getAttribute('aria-disabled')).toBe('true');
    expect(saving.disabled).toBe(false);

    saving.click();
    saving.click();
    await settle(fixture);
    expect(state(host, 'Saves started')).toBe('1');

    await delay(LAB_SAVE_DELAY_MS + 50);
    await settle(fixture);
    expect(text(fixture)).toContain('Saved in this lab only. Nothing was sent.');
    expect(state(host, 'Saves started')).toBe('1');
    expect(state(host, 'Dirty')).toBe('no');
    // The lab is synthetic: a whole save cycle must not reach the network.
    TestBed.inject(HttpTestingController).verify();
  });

  it('never reports a press from a loading or disabled button', async () => {
    const { fixture, host } = await render();

    tick(host, 'Hold the loading state');
    await settle(fixture);
    button(host, 'Saving…').click();
    button(host, 'Publish').click();
    await settle(fixture);

    expect(text(fixture)).toContain('Last pressed: nothing yet');
  });

  it('reports presses from operable buttons and icon buttons', async () => {
    const { fixture, host } = await render();

    press(host, 'Apply');
    query<HTMLButtonElement>(host, 'button[aria-label="Notifications"]').click();
    await settle(fixture);

    expect(text(fixture)).toContain('Last pressed: Notifications');
    expect(text(fixture)).toContain('Apply: 1');
  });

  it('marks the Arabic sample as Arabic, right to left, with LTR isolation for values', async () => {
    const { host } = await render();
    const arabic = query(host, 'section[lang="ar"]');

    expect(arabic.getAttribute('dir')).toBe('rtl');
    expect(field(arabic, 'الإيقاع').getAttribute('dir')).toBe('ltr');
    expect(query(arabic, 'bdi').getAttribute('dir')).toBe('ltr');
  });

  it('takes its direction from the URL', async () => {
    const { host } = await render('/dev/ui-lab?dir=rtl');

    expect(query(host, '.lab').getAttribute('dir')).toBe('rtl');
  });
});
