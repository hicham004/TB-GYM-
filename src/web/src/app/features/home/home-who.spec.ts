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
  it('gives each audience a real screen and its own button, with no stand-in on the public build', async () => {
    const { host } = await render(null);

    const stories = host.querySelectorAll('.story');
    expect(stories).toHaveLength(2);
    expect(stories[0].querySelector('.story__button')?.getAttribute('href')).toBe('/auth/register');
    expect(stories[1].querySelector('.story__button')?.getAttribute('href')).toBe('/#talk');
    expect(stories[1].querySelector('.story__shot img')?.getAttribute('src')).toBe(
      '/images/home/team-window-1x.webp',
    );
    expect(host.querySelector('.story__photo')).toBeNull();
  });

  it('on the private build puts the gym floor’s stand-in above the Team screen, and only there', async () => {
    const { host } = await render(TEST_PLACEHOLDERS);

    const stories = host.querySelectorAll('.story');
    expect(stories[0].querySelector('.story__photo')).toBeNull();
    const photo = query(stories[1], '.story__photo');
    expect(photo.getAttribute('data-placeholder')).toBe('team');
    expect(photo.querySelector('img')?.getAttribute('src')).toBe('/placeholders/team.jpg');
    expect(photo.querySelector('img')?.getAttribute('alt')).toContain('Two coaches on a gym floor');
    // The photograph sits between the button and the screen.
    const order = Array.from(stories[1].children).map((child) => child.className.split(' ')[0]);
    expect(order.indexOf('story__button')).toBeLessThan(order.indexOf('story__photo'));
    expect(order.indexOf('story__photo')).toBeLessThan(order.indexOf('story__shot'));
    expect(stories[1].querySelector('.story__shot img')).not.toBeNull();
  });
});
