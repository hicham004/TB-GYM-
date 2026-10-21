import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { settle } from '../../../testing/dom';
import { NotFound } from './not-found';

const MAYA = { id: 'user-maya', displayName: 'Maya Rahman' } as CurrentUser;

async function render(user: CurrentUser | null) {
  await TestBed.configureTestingModule({
    imports: [NotFound],
    providers: [provideRouter([]), { provide: AuthStore, useValue: { user: signal(user) } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(NotFound);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    heading: () => host.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim(),
    link: (name: string) =>
      [...host.querySelectorAll('a')].find((anchor) => anchor.textContent?.trim() === name),
  };
}

const robots = () => document.head.querySelectorAll('meta[name="robots"]');

/** An address the app does not have (audit AUTH-10). */
describe('NotFound', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    robots().forEach((tag) => tag.remove());
  });

  it('tells someone signed in the page is not here, inside their shell, with the way to Today', async () => {
    const { host, heading, link } = await render(MAYA);

    expect(heading()).toBe('This page isn’t here');
    expect(host.textContent).toContain('The link may be old, or the address may have a typo.');
    expect(link('Go to Today')?.getAttribute('href')).toBe('/');
    expect(host.querySelector('app-auth-frame')).toBeNull();
  });

  it('tells a visitor in the signed-out frame, light, with the homepage and sign-in', async () => {
    const { host, heading, link } = await render(null);

    expect(heading()).toBe('This page isn’t here.');
    expect(host.querySelector('app-auth-frame')?.getAttribute('data-mode')).toBe('light');
    expect(link('Go to the homepage')?.getAttribute('href')).toBe('/');
    expect(link('Sign in')?.getAttribute('href')).toBe('/auth/sign-in');
    expect(link('Go to Today')).toBeUndefined();
  });

  it('asks search engines not to index it while it is shown, and takes the tag away after', async () => {
    const { fixture } = await render(null);

    expect([...robots()].map((tag) => tag.getAttribute('content'))).toEqual(['noindex']);

    fixture.destroy();
    expect(robots()).toHaveLength(0);
  });

  it('leaves a robots tag the document already had, which says noindex itself', async () => {
    const own = document.createElement('meta');
    own.setAttribute('name', 'robots');
    own.setAttribute('content', 'noindex, nofollow');
    document.head.append(own);
    const { fixture } = await render(MAYA);

    expect([...robots()]).toEqual([own]);

    fixture.destroy();
    expect([...robots()]).toEqual([own]);
  });
});
