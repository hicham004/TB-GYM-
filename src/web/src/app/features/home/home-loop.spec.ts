import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { button, press, query, settle } from '../../../testing/dom';
import { HomeLoop } from './home-loop';

async function render() {
  const fixture = TestBed.createComponent(HomeLoop);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

function caption(host: HTMLElement): string {
  return query(host, '.loop__caption').textContent?.trim() ?? '';
}

describe('HomeLoop', () => {
  it('starts on the plan step and tells it in words beside the picture', async () => {
    const { host } = await render();

    expect(button(host, 'Plan').getAttribute('aria-current')).toBe('step');
    expect(caption(host)).toContain('Build the session once');
    expect(query(host, '.loop__stage').getAttribute('aria-hidden')).toBe('true');
    expect(host.textContent).toContain('Illustration with a sample client.');
  });

  it('jumps to the step the visitor presses', async () => {
    const { fixture, host } = await render();

    press(host, 'Check in');
    await settle(fixture);

    expect(button(host, 'Check in').getAttribute('aria-current')).toBe('step');
    expect(button(host, 'Plan').hasAttribute('aria-current')).toBe(false);
    expect(caption(host)).toContain('weekly check-in');
  });

  it("advances when the active step's progress bar finishes", async () => {
    const { fixture, host } = await render();

    query(host, '.loop__bar').dispatchEvent(new Event('animationend'));
    await settle(fixture);

    expect(button(host, 'Train').getAttribute('aria-current')).toBe('step');
    expect(caption(host)).toContain('logs every set');
  });

  it('pauses and plays from a labelled button, and stops running while paused', async () => {
    const { fixture, host } = await render();
    expect(query(host, '.loop').classList).toContain('is-running');

    press(host, 'Pause the example');
    await settle(fixture);

    expect(query(host, '.loop').classList).not.toContain('is-running');
    expect(button(host, 'Play the example')).toBeTruthy();

    press(host, 'Play the example');
    await settle(fixture);

    expect(query(host, '.loop').classList).toContain('is-running');
  });
});
