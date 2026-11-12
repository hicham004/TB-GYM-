import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { TEST_PLACEHOLDERS } from '../../../testing/placeholder-fixtures';
import { HomeHeader, type HeaderTone } from './home-header';
import { HOME_PLACEHOLDERS, type PlaceholderSet } from './home-placeholder';

/**
 * The header as its page draws it. `inputs` are what the homepage passes down inside the app (notes
 * plan N2); left out, the header is the public website's: its own address, nobody signed in.
 */
async function render(
  under: HeaderTone = 'light',
  placeholders: PlaceholderSet | null = null,
  inputs: { page?: string; signedIn?: boolean } = {},
) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: HOME_PLACEHOLDERS, useValue: placeholders }],
  });
  const fixture = TestBed.createComponent(HomeHeader);
  fixture.componentRef.setInput('under', under);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

/** Links as a person meets them: each one's words and where it leads. */
const linksIn = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll(selector)).map((link) => [
    link.textContent?.trim(),
    link.getAttribute('href'),
  ]);

const hrefsIn = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll(selector)).map((link) => link.getAttribute('href'));

describe('HomeHeader', () => {
  afterEach(() => document.querySelector('meta[name="robots"]')?.remove());

  it('never asks not to be indexed on the public build', async () => {
    await render('light');

    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('asks not to be indexed on the private pre-launch build', async () => {
    await render('light', TEST_PLACEHOLDERS);

    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });

  it('links the sections and sign-in, and takes the tone of the section under it', async () => {
    const { fixture, host } = await render('dark');

    expect(query(host, '.header').getAttribute('data-tone')).toBe('dark');
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('.links a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/#week',
      '/#inside',
      '/#for-gyms',
      '/auth/sign-in',
    ]);

    fixture.componentRef.setInput('under', 'light');
    await settle(fixture);
    expect(query(host, '.header').getAttribute('data-tone')).toBe('light');

    // Over the dark ending below the hero the header keeps cream words on a frosted night fill.
    fixture.componentRef.setInput('under', 'night');
    await settle(fixture);
    expect(query(host, '.header').getAttribute('data-tone')).toBe('night');
  });

  it('marks the section in view with one line under its link, and none over the hero or the finale', async () => {
    const { fixture, host } = await render('light');
    const links = Array.from(host.querySelectorAll<HTMLElement>('.links [data-section]'));
    expect(links.map((link) => link.dataset['section'])).toEqual(['week', 'inside', 'for-gyms']);
    // jsdom lays nothing out; the links stand where a wide screen would put them.
    links.forEach((link, index) => {
      Object.defineProperty(link, 'offsetLeft', { value: 100 * index, configurable: true });
      Object.defineProperty(link, 'offsetWidth', { value: 80 + index, configurable: true });
    });
    const marker = query<HTMLElement>(host, '.links__marker');
    expect(marker.getAttribute('aria-hidden')).toBe('true');
    expect(marker.classList).not.toContain('links__marker--on');

    fixture.componentRef.setInput('current', 'inside');
    await settle(fixture);
    expect(marker.classList).toContain('links__marker--on');
    expect(marker.style.getPropertyValue('--marker-x')).toBe('100px');
    expect(marker.style.getPropertyValue('--marker-width')).toBe('81px');
    expect(links.map((link) => link.classList.contains('is-current'))).toEqual([
      false,
      true,
      false,
    ]);

    fixture.componentRef.setInput('current', 'for-gyms');
    await settle(fixture);
    expect(marker.style.getPropertyValue('--marker-x')).toBe('200px');

    fixture.componentRef.setInput('current', null);
    await settle(fixture);
    expect(marker.classList).not.toContain('links__marker--on');
    expect(host.querySelectorAll('.is-current')).toHaveLength(0);
  });

  it('opens the menu on a phone, closes it on Escape or a choice, and draws it light either way', async () => {
    const { fixture, host } = await render('dark');
    const button = query<HTMLButtonElement>(host, '.menu-button');
    const menu = query<HTMLElement>(host, '#home-menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(menu.hidden).toBe(true);

    button.click();
    await settle(fixture);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent?.trim()).toBe('Close');
    expect(menu.hidden).toBe(false);
    expect(query(host, '.header').getAttribute('data-tone')).toBe('light');
    expect(Array.from(menu.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(
      ['/#week', '/#inside', '/#for-gyms', '/auth/sign-in', '/auth/register'],
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(menu.hidden).toBe(true);
    expect(query(host, '.header').getAttribute('data-tone')).toBe('dark');

    button.click();
    await settle(fixture);
    menu.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(fixture);
    expect(menu.hidden).toBe(true);
  });

  it('offers a visitor Sign in beside the sections and in the phone menu, with Start your coaching space, and no way back to Today', async () => {
    const { host } = await render('light');

    expect(linksIn(host, '.links__sign')).toEqual([['Sign in', '/auth/sign-in']]);
    expect(linksIn(host, '#home-menu a')).toEqual([
      ['The week', '/#week'],
      ["What's inside", '/#inside'],
      ['For gyms', '/#for-gyms'],
      ['Sign in', '/auth/sign-in'],
      ['Start your coaching space', '/auth/register'],
    ]);
    expect(host.textContent).not.toContain('Back to Today');
    // Nothing but the wordmark leads to the bare address.
    expect(Array.from(host.querySelectorAll('[href="/"]')).map((link) => link.className)).toEqual([
      'brand',
    ]);
  });

  it('gives someone signed in Back to Today where Sign in stood, in both places, and no sign-in or sign-up', async () => {
    const { fixture, host } = await render('light', null, { signedIn: true });

    expect(linksIn(host, '.links__sign')).toEqual([['Back to Today', '/']]);
    expect(linksIn(host, '#home-menu a')).toEqual([
      ['The week', '/#week'],
      ["What's inside", '/#inside'],
      ['For gyms', '/#for-gyms'],
      ['Back to Today', '/'],
    ]);
    expect(host.querySelector('[href="/auth/sign-in"]')).toBeNull();
    expect(host.querySelector('[href="/auth/register"]')).toBeNull();
    expect(host.querySelector('.menu__start')).toBeNull();
    expect(host.textContent).not.toContain('Sign in');
    expect(host.textContent).not.toContain('Start your coaching space');

    // The way back closes the phone menu behind it, as every choice there does.
    const menu = query<HTMLElement>(host, '#home-menu');
    query<HTMLButtonElement>(host, '.menu-button').click();
    await settle(fixture);
    expect(menu.hidden).toBe(false);
    query(menu, 'a[href="/"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(fixture);
    expect(menu.hidden).toBe(true);
  });

  it('swaps Sign in for Back to Today the moment the session is known', async () => {
    const { fixture, host } = await render('light');
    expect(linksIn(host, '.links__sign')).toEqual([['Sign in', '/auth/sign-in']]);

    fixture.componentRef.setInput('signedIn', true);
    await settle(fixture);
    expect(linksIn(host, '.links__sign')).toEqual([['Back to Today', '/']]);
    expect(host.querySelector('[href="/auth/register"]')).toBeNull();

    fixture.componentRef.setInput('signedIn', false);
    await settle(fixture);
    expect(linksIn(host, '.links__sign')).toEqual([['Sign in', '/auth/sign-in']]);
    expect(linksIn(host, '.menu__start')).toEqual([
      ['Start your coaching space', '/auth/register'],
    ]);
  });

  it('at its own address leads the wordmark to the homepage and the six section links to its sections', async () => {
    const { host } = await render('light');

    expect(hrefsIn(host, 'a.brand')).toEqual(['/']);
    expect(hrefsIn(host, '.links [data-section]')).toEqual(['/#week', '/#inside', '/#for-gyms']);
    expect(hrefsIn(host, '#home-menu a[href*="#"]')).toEqual(['/#week', '/#inside', '/#for-gyms']);
    expect(hrefsIn(host, 'a').filter((href) => href?.startsWith('/about'))).toEqual([]);
  });

  it('inside the app at /about keeps the wordmark and the six section links on that address', async () => {
    const { host } = await render('light', null, { page: '/about' });

    expect(hrefsIn(host, 'a.brand')).toEqual(['/about']);
    expect(linksIn(host, '.links [data-section]')).toEqual([
      ['The week', '/about#week'],
      ["What's inside", '/about#inside'],
      ['For gyms', '/about#for-gyms'],
    ]);
    // A visitor there still signs in and signs up at the same addresses.
    expect(linksIn(host, '#home-menu a')).toEqual([
      ['The week', '/about#week'],
      ["What's inside", '/about#inside'],
      ['For gyms', '/about#for-gyms'],
      ['Sign in', '/auth/sign-in'],
      ['Start your coaching space', '/auth/register'],
    ]);
    expect(linksIn(host, '.links__sign')).toEqual([['Sign in', '/auth/sign-in']]);
    // No link is left that would leave the page for the bare address or a section of it.
    expect(hrefsIn(host, 'a').filter((href) => href === '/' || href?.startsWith('/#'))).toEqual([]);
  });

  it('at /about, signed in, only the two Back to Today links leave the page for Today', async () => {
    const { host } = await render('light', null, { page: '/about', signedIn: true });

    expect(linksIn(host, 'a[href="/"]')).toEqual([
      ['Back to Today', '/'],
      ['Back to Today', '/'],
    ]);
    expect(hrefsIn(host, 'a').filter((href) => href !== '/')).toEqual([
      '/about',
      '/about#week',
      '/about#inside',
      '/about#for-gyms',
      '/about#week',
      '/about#inside',
      '/about#for-gyms',
    ]);
  });
});
