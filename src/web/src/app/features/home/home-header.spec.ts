import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { HomeHeader } from './home-header';

async function render(dark = false) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(HomeHeader);
  fixture.componentRef.setInput('dark', dark);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('HomeHeader', () => {
  it('links the sections and sign-in, and takes the tone of the section under it', async () => {
    const { fixture, host } = await render(true);

    expect(query(host, '.header').getAttribute('data-tone')).toBe('dark');
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('.links a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/#week',
      '/#inside',
      '/#for-gyms',
      '/auth/sign-in',
    ]);

    fixture.componentRef.setInput('dark', false);
    await settle(fixture);
    expect(query(host, '.header').getAttribute('data-tone')).toBe('light');
  });

  it('opens the menu on a phone, closes it on Escape or a choice, and draws it light either way', async () => {
    const { fixture, host } = await render(true);
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
