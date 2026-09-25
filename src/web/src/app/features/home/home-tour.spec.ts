import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { HomeTour } from './home-tour';

async function render() {
  const fixture = TestBed.createComponent(HomeTour);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

function tabs(host: HTMLElement): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
}

function selected(host: HTMLElement): string {
  return (
    tabs(host)
      .find((tab) => tab.getAttribute('aria-selected') === 'true')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

async function key(
  fixture: ReturnType<typeof TestBed.createComponent>,
  target: HTMLElement,
  name: string,
) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  await settle(fixture);
}

describe('HomeTour', () => {
  it('is a tab set whose panel is labelled by the selected tab', async () => {
    const { host } = await render();
    const panel = query(host, '[role="tabpanel"]');

    expect(tabs(host)).toHaveLength(5);
    expect(selected(host)).toContain('Training');
    expect(panel.getAttribute('aria-labelledby')).toBe('tour-tab-training');
    expect(panel.textContent).toContain('Programs that fit each client');
    expect(tabs(host).map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it('selects a tab when it is pressed', async () => {
    const { fixture, host } = await render();

    tabs(host)[3].click();
    await settle(fixture);

    expect(selected(host)).toContain('Progress');
    expect(query(host, '[role="tabpanel"]').textContent).toContain('Progress you can both see');
  });

  it('moves selection and focus with the arrow keys, Home and End, wrapping at the ends', async () => {
    const { fixture, host } = await render();
    const [first] = tabs(host);
    first.focus();

    await key(fixture, first, 'ArrowRight');
    expect(selected(host)).toContain('Nutrition');
    expect(document.activeElement).toBe(tabs(host)[1]);

    await key(fixture, tabs(host)[1], 'End');
    expect(selected(host)).toContain('Messages');

    await key(fixture, tabs(host)[4], 'ArrowDown');
    expect(selected(host)).toContain('Training');

    await key(fixture, tabs(host)[0], 'ArrowUp');
    expect(selected(host)).toContain('Messages');

    await key(fixture, tabs(host)[4], 'Home');
    expect(selected(host)).toContain('Training');
    expect(document.activeElement).toBe(tabs(host)[0]);
  });

  it('reverses the sideways arrows in a right-to-left page', async () => {
    const { fixture, host } = await render();
    host.setAttribute('dir', 'rtl');

    await key(fixture, tabs(host)[0], 'ArrowLeft');

    expect(selected(host)).toContain('Nutrition');
  });
});
