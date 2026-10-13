import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { TEST_PLACEHOLDERS } from '../../../testing/placeholder-fixtures';
import { HomePlaceholder, type PlaceholderPicture, stagePlaceholder } from './home-placeholder';

@Component({
  imports: [HomePlaceholder],
  template: `<app-home-placeholder [picture]="picture" [alt]="alt" [eager]="eager" />`,
})
class Host {
  picture: PlaceholderPicture = TEST_PLACEHOLDERS.hero;
  alt = '';
  eager = false;
}

async function render(picture: PlaceholderPicture, alt = '', eager = false) {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.picture = picture;
  fixture.componentInstance.alt = alt;
  fixture.componentInstance.eager = eager;
  await settle(fixture);
  return { fixture, host: query<HTMLElement>(fixture.nativeElement, 'app-home-placeholder') };
}

describe('HomePlaceholder', () => {
  it('draws the photograph the folder holds, lazily, with its mark naming the file', async () => {
    const { host } = await render(TEST_PLACEHOLDERS.team, 'Two coaches on a gym floor');

    expect(host.getAttribute('data-placeholder')).toBe('team');
    const img = query<HTMLImageElement>(host, 'img');
    expect(img.getAttribute('src')).toBe('/placeholders/team.jpg');
    expect(img.getAttribute('alt')).toBe('Two coaches on a gym floor');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('fetchpriority')).toBeNull();
    expect(host.querySelectorAll('.mark')).toHaveLength(1);
    expect(query(host, '.mark').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Placeholder · team.jpg',
    );
    expect(host.querySelector('.missing')).toBeNull();
  });

  it('fetches the hero’s photograph with the document when asked to', async () => {
    const { host } = await render(TEST_PLACEHOLDERS.hero, '', true);

    const img = query<HTMLImageElement>(host, 'img');
    expect(img.getAttribute('loading')).toBeNull();
    expect(img.getAttribute('fetchpriority')).toBe('high');
  });

  it('draws a grey stand-in for a file the folder lacks, marked as such', async () => {
    const { host } = await render(TEST_PLACEHOLDERS.talk, 'The coach and the client at the bar');

    expect(host.querySelector('img')).toBeNull();
    const missing = query(host, '.missing');
    expect(missing.getAttribute('role')).toBe('img');
    expect(missing.getAttribute('aria-label')).toBe('The coach and the client at the bar');
    const marks = Array.from(host.querySelectorAll('.mark')).map((mark) =>
      mark.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(marks).toEqual(['Placeholder · talk.jpg', 'Not in the placeholders folder yet']);
  });

  it('keeps a decorative grey stand-in out of the accessibility tree', async () => {
    const { host } = await render(TEST_PLACEHOLDERS.talk);

    const missing = query(host, '.missing');
    expect(missing.getAttribute('role')).toBeNull();
    expect(missing.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives Monday evening and Sunday a photograph, and the other stages none', () => {
    expect(stagePlaceholder('train', TEST_PLACEHOLDERS)).toBe(TEST_PLACEHOLDERS.train);
    expect(stagePlaceholder('see', TEST_PLACEHOLDERS)).toBe(TEST_PLACEHOLDERS.talk);
    expect(stagePlaceholder('plan', TEST_PLACEHOLDERS)).toBeNull();
    expect(stagePlaceholder('checkin', TEST_PLACEHOLDERS)).toBeNull();
    expect(stagePlaceholder('train', null)).toBeNull();
  });
});
