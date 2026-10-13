import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { TEST_PLACEHOLDERS } from '../../../testing/placeholder-fixtures';
import { HomeHeader, type HeaderTone } from './home-header';
import { HOME_PLACEHOLDERS, type PlaceholderSet } from './home-placeholder';

async function render(under: HeaderTone = 'light', placeholders: PlaceholderSet | null = null) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: HOME_PLACEHOLDERS, useValue: placeholders }],
  });
  const fixture = TestBed.createComponent(HomeHeader);
  fixture.componentRef.setInput('under', under);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

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
});
