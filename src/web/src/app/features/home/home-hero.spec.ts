import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { TEST_PLACEHOLDERS } from '../../../testing/placeholder-fixtures';
import { HomeHero } from './home-hero';
import { HOME_PLACEHOLDERS, type PlaceholderSet } from './home-placeholder';

async function render(placeholders: PlaceholderSet | null) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: HOME_PLACEHOLDERS, useValue: placeholders }],
  });
  const fixture = TestBed.createComponent(HomeHero);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

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
});
