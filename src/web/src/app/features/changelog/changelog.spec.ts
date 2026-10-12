import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { AuthStore } from '../../core/auth/auth.store';
import { Changelog } from './changelog';

async function render(user: object | null) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthStore, useValue: { user: signal(user) } }],
  });
  const fixture = TestBed.createComponent(Changelog);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('Changelog', () => {
  it('lists every release from the file, newest first, with the date in words', async () => {
    const { host } = await render(null);

    expect(query(host, 'h1').textContent).toBe('What changed');
    const releases = Array.from(host.querySelectorAll('.release'));
    expect(releases.length).toBeGreaterThan(3);
    const dates = releases.map((release) =>
      release.querySelector('time')?.getAttribute('datetime'),
    );
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query(host, '.release__date').textContent).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(query(host, '.changelog__lead').textContent).toContain('Last change');
    expect(releases[0].querySelectorAll('li').length).toBeGreaterThan(0);
    // A visitor gets the website's header and foot around it.
    expect(host.querySelector('app-home-header')).not.toBeNull();
    expect(host.querySelector('.changelog__foot')).not.toBeNull();
  });

  it('inside the app of a signed-in person it keeps just the releases', async () => {
    const { host } = await render({ id: 'me' });

    expect(host.querySelector('app-home-header')).toBeNull();
    expect(host.querySelector('.changelog__foot')).toBeNull();
    expect(query(host, '.changelog').classList).toContain('changelog--embedded');
    expect(host.querySelectorAll('.release').length).toBeGreaterThan(0);
  });
});
