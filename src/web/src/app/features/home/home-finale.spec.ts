import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { HomeFinale } from './home-finale';

/**
 * The finale as its page draws it. `inputs` are what the homepage passes down inside the app (notes
 * plan N2); left out, the finale is the public website's: its own address, nobody signed in.
 */
async function render(inputs: { page?: string; signedIn?: boolean } = {}) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(HomeFinale);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

/** The finale's actions as a person meets them: each link's words and where it leads. */
const actions = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.finale__actions a')).map((link) => [
    (link.querySelector('span') ?? link).textContent?.trim(),
    link.getAttribute('href'),
  ]);

/** The foot's last link: Sign in for a visitor, the way back for someone signed in. */
function lastOfTheFoot(host: HTMLElement) {
  const links = Array.from(host.querySelectorAll('.foot__links a'));
  const last = links[links.length - 1];
  return [last?.textContent?.trim(), last?.getAttribute('href')];
}

describe('HomeFinale', () => {
  it('offers a visitor Start your coaching space in its pill and Talk to us, and ends with What changed and Sign in', async () => {
    const { host } = await render();

    expect(query(host, 'h2').textContent).toBe("Your next client's week starts here.");
    expect(actions(host)).toEqual([
      ['Start your coaching space', '/auth/register'],
      ['Talk to us about your gym', '/#talk'],
    ]);
    // The pill sits in its holder, which the finale's motion pulls toward the pointer.
    const magnet = query<HTMLElement>(host, '.finale__magnet');
    expect(magnet.hasAttribute('hidden')).toBe(false);
    expect(magnet.querySelector('a.finale__start')?.getAttribute('href')).toBe('/auth/register');

    const foot = Array.from(host.querySelectorAll('.foot__links a'));
    expect(foot.map((link) => link.getAttribute('href'))).toEqual(['/changelog', '/auth/sign-in']);
    expect(foot[0].textContent?.trim()).toMatch(/^What changed/);
    expect(lastOfTheFoot(host)).toEqual(['Sign in', '/auth/sign-in']);
    expect(host.textContent).not.toContain('Back to Today');
  });

  it('offers someone signed in no sign-up: the pill’s holder stays, hidden and empty, and the foot leads back to Today', async () => {
    const { host } = await render({ signedIn: true });

    expect(host.querySelector('[href="/auth/register"]')).toBeNull();
    expect(host.querySelector('.finale__start')).toBeNull();
    expect(host.textContent).not.toContain('Start your coaching space');
    const magnets = host.querySelectorAll<HTMLElement>('.finale__magnet');
    expect(magnets).toHaveLength(1);
    expect(magnets[0].hasAttribute('hidden')).toBe(true);
    expect(magnets[0].querySelector('a')).toBeNull();
    expect(magnets[0].textContent?.trim()).toBe('');
    expect(actions(host)).toEqual([['Talk to us about your gym', '/#talk']]);

    const foot = Array.from(host.querySelectorAll('.foot__links a'));
    expect(foot.map((link) => link.getAttribute('href'))).toEqual(['/changelog', '/']);
    expect(lastOfTheFoot(host)).toEqual(['Back to Today', '/']);
    expect(host.querySelector('[href="/auth/sign-in"]')).toBeNull();
    expect(host.querySelector('.foot__links')?.textContent).not.toContain('Sign in');
  });

  it('keeps the same holder when the session becomes known, so the motion set up around it still has it', async () => {
    const { fixture, host } = await render();
    const magnet = query<HTMLElement>(host, '.finale__magnet');

    fixture.componentRef.setInput('signedIn', true);
    await settle(fixture);
    expect(query(host, '.finale__magnet')).toBe(magnet);
    expect(magnet.hasAttribute('hidden')).toBe(true);
    expect(magnet.querySelector('a')).toBeNull();
    expect(lastOfTheFoot(host)).toEqual(['Back to Today', '/']);

    fixture.componentRef.setInput('signedIn', false);
    await settle(fixture);
    expect(query(host, '.finale__magnet')).toBe(magnet);
    expect(magnet.hasAttribute('hidden')).toBe(false);
    expect(magnet.querySelector('a')?.getAttribute('href')).toBe('/auth/register');
    expect(lastOfTheFoot(host)).toEqual(['Sign in', '/auth/sign-in']);
  });

  it('inside the app at /about keeps Talk to us on that address, signed in or not', async () => {
    const { fixture, host } = await render({ page: '/about', signedIn: true });
    expect(actions(host)).toEqual([['Talk to us about your gym', '/about#talk']]);
    // What changed and the way back are pages of their own, at the same addresses as ever.
    expect(
      Array.from(host.querySelectorAll('.foot__links a')).map((link) => link.getAttribute('href')),
    ).toEqual(['/changelog', '/']);

    // A visitor who typed the address is offered the sign-up as on the homepage.
    fixture.componentRef.setInput('signedIn', false);
    await settle(fixture);
    expect(actions(host)).toEqual([
      ['Start your coaching space', '/auth/register'],
      ['Talk to us about your gym', '/about#talk'],
    ]);
    expect(lastOfTheFoot(host)).toEqual(['Sign in', '/auth/sign-in']);
    expect(host.querySelector('[href="/#talk"]')).toBeNull();
  });
});
