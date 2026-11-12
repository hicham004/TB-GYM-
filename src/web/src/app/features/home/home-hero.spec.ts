import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { TEST_PLACEHOLDERS } from '../../../testing/placeholder-fixtures';
import { HomeHero } from './home-hero';
import { HOME_PLACEHOLDERS, type PlaceholderSet } from './home-placeholder';

/**
 * The hero as its page draws it. `inputs` are what the homepage passes down inside the app (notes
 * plan N2); left out, the hero is the public website's: its own address, nobody signed in.
 */
async function render(
  placeholders: PlaceholderSet | null,
  inputs: { page?: string; signedIn?: boolean } = {},
) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: HOME_PLACEHOLDERS, useValue: placeholders }],
  });
  const fixture = TestBed.createComponent(HomeHero);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

/** The hero's actions as a person meets them: each link's words and where it leads. */
const actions = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.hero__actions a')).map((link) => [
    (link.querySelector('span') ?? link).textContent?.trim(),
    link.getAttribute('href'),
  ]);

describe('HomeHero', () => {
  it('on the public build shows the coach’s window beside the phone, and no stand-in', async () => {
    const { host } = await render(null);

    expect(query(host, 'h1').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Coach both sides of the week.',
    );
    expect(host.querySelector('.hero__window img')?.getAttribute('src')).toBe(
      '/images/home/today-needs-you-dark-1x.webp',
    );
    expect(host.querySelector('.hero__phone img')).not.toBeNull();
    expect(host.querySelector('.hero__photo')).toBeNull();
    expect(host.querySelector('.hero__scrim')).toBeNull();
    expect(query(host, '.hero').classList).not.toContain('hero--photo');
    expect(query(host, '.tb-visually-hidden').textContent).toContain("On the coach's screen");
  });

  it('on the private build puts the stand-in behind the copy, keeps the phone, and drops the window', async () => {
    const { host } = await render(TEST_PLACEHOLDERS);

    expect(query(host, '.hero').classList).toContain('hero--photo');
    const photo = query(host, '.hero__photo');
    expect(photo.getAttribute('data-placeholder')).toBe('hero');
    const img = query<HTMLImageElement>(photo, 'img');
    expect(img.getAttribute('src')).toBe('/placeholders/hero.jpg');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    expect(img.getAttribute('alt')).toContain('a stand-in for the shoot');
    expect(host.querySelector('.hero__scrim')).not.toBeNull();
    expect(host.querySelector('.hero__window')).toBeNull();
    expect(host.querySelector('.hero__phone img')).not.toBeNull();
    const hidden = query(host, '.tb-visually-hidden').textContent ?? '';
    expect(hidden).toContain('On the photograph, a stand-in for the shoot');
    expect(hidden).toContain("On the client's phone");
    expect(hidden).not.toContain("On the coach's screen");
  });

  it('offers a visitor Start your coaching space, and Talk to us on the homepage’s own address', async () => {
    const { host } = await render(null);

    expect(actions(host)).toEqual([
      ['Start your coaching space', '/auth/register'],
      ['Talk to us about your gym', '/#talk'],
    ]);
    expect(query(host, '.hero__actions').firstElementChild?.className).toBe('hero__start');
  });

  it('offers someone signed in no sign-up, and keeps Talk to us', async () => {
    const { host } = await render(null, { signedIn: true });

    expect(host.querySelector('[href="/auth/register"]')).toBeNull();
    expect(host.querySelector('.hero__start')).toBeNull();
    expect(host.textContent).not.toContain('Start your coaching space');
    expect(actions(host)).toEqual([['Talk to us about your gym', '/#talk']]);
  });

  it('inside the app at /about keeps Talk to us on that address, signed in or not', async () => {
    const { fixture, host } = await render(null, { page: '/about', signedIn: true });
    expect(actions(host)).toEqual([['Talk to us about your gym', '/about#talk']]);
    expect(host.querySelector('[href="/auth/register"]')).toBeNull();

    // A visitor who typed the address is offered the sign-up as on the homepage.
    fixture.componentRef.setInput('signedIn', false);
    await settle(fixture);
    expect(actions(host)).toEqual([
      ['Start your coaching space', '/auth/register'],
      ['Talk to us about your gym', '/about#talk'],
    ]);
    expect(host.querySelector('[href="/#talk"]')).toBeNull();
  });

  it('on the private build, too, offers someone signed in no sign-up', async () => {
    const { host } = await render(TEST_PLACEHOLDERS, { page: '/about', signedIn: true });

    expect(host.querySelector('[href="/auth/register"]')).toBeNull();
    expect(host.textContent).not.toContain('Start your coaching space');
    expect(actions(host)).toEqual([['Talk to us about your gym', '/about#talk']]);
  });
});
