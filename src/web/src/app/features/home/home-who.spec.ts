import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { TEST_PLACEHOLDERS } from '../../../testing/placeholder-fixtures';
import { HOME_PLACEHOLDERS, type PlaceholderSet } from './home-placeholder';
import { HomeWho } from './home-who';

async function render(placeholders: PlaceholderSet | null) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: HOME_PLACEHOLDERS, useValue: placeholders }],
  });
  const fixture = TestBed.createComponent(HomeWho);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('HomeWho', () => {
  it('gives each audience a half of the band with a real screen and its own button, with no stand-in on the public build', async () => {
    const { fixture, host } = await render(null);

    const halves = host.querySelectorAll('.half');
    expect(halves).toHaveLength(2);
    expect(halves[0].querySelector('h3')?.textContent).toContain('For independent coaches');
    expect(halves[0].querySelector('.half__button')?.getAttribute('href')).toBe('/auth/register');
    expect(halves[1].querySelector('h3')?.textContent).toContain('For gyms and coaching teams');
    expect(halves[1].querySelector('.half__button')?.getAttribute('href')).toBe('/#talk');
    expect(halves[0].querySelector('.half__shot img')?.getAttribute('src')).toBe(
      '/images/home/builder-week-1x.webp',
    );
    expect(halves[1].querySelector('.half__shot img')?.getAttribute('src')).toBe(
      '/images/home/team-window-1x.webp',
    );
    // Each screen is drawn at its own width until its half is narrower, and a phone gets a narrower
    // crop of the same screen.
    const windows = host.querySelectorAll<HTMLElement>('.half__window');
    expect(windows[0].style.getPropertyValue('--window-width')).toBe('520px');
    expect(windows[1].style.getPropertyValue('--window-width')).toBe('640px');
    const phoneCrop = (index: number) =>
      windows[index]
        .querySelector('source[type="image/webp"][media="(max-width: 1099px)"]')
        ?.getAttribute('srcset');
    expect(phoneCrop(0)).toContain('/images/home/builder-week-narrow-1x.webp 1x');
    expect(phoneCrop(1)).toContain('/images/home/team-window-narrow-1x.webp 1x');
    expect(host.querySelector('.half__photo')).toBeNull();
    // The band is where the dark ending begins; the page reads its top for the header's tone.
    expect(fixture.componentInstance.band()).toBe(query(host, '#for-gyms'));
  });

  it('on the private build lifts the Team screen onto the gym floor’s stand-in, and only there', async () => {
    const { host } = await render(TEST_PLACEHOLDERS);

    const halves = host.querySelectorAll('.half');
    expect(halves[0].querySelector('.half__photo')).toBeNull();
    const shot = query(halves[1], '.half__shot');
    expect(shot.classList).toContain('half__shot--photo');
    const photo = query(shot, '.half__photo');
    expect(photo.getAttribute('data-placeholder')).toBe('team');
    expect(photo.querySelector('img')?.getAttribute('src')).toBe('/placeholders/team.jpg');
    expect(photo.querySelector('img')?.getAttribute('alt')).toContain('Two coaches on a gym floor');
    // The photograph comes first and the screen after it, lifted over its lower edge.
    const order = Array.from(shot.children).map((child) => child.className.split(' ')[0]);
    expect(order).toEqual(['half__photo', 'half__window']);
  });
});
