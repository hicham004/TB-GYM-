import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { settle } from '../../testing/dom';
import { Icon } from './icon';

@Component({
  imports: [Icon],
  template: `
    <app-icon id="plus" name="plus" />
    <app-icon id="check" name="check-circle" />
    <app-icon id="info" name="info" />
    <app-icon id="play" name="play" />
  `,
})
class Host {}

async function render(): Promise<HTMLElement> {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  return fixture.nativeElement as HTMLElement;
}

describe('app-icon', () => {
  it('draws the Figma glyph at its master size in the current text colour', async () => {
    const host = await render();
    const plus = host.querySelector('#plus svg');
    const check = host.querySelector('#check svg');

    expect(plus?.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(plus?.getAttribute('width')).toBe('20');
    expect(plus?.getAttribute('stroke')).toBe('currentColor');
    expect(plus?.querySelector('path')?.getAttribute('d')).toBe('M10 4V16M4 10H16');
    expect(check?.getAttribute('viewBox')).toBe('0 0 16 16');
  });

  it('draws the info glyph as an "i" in play’s ring on the 20px grid (notes plan N5)', async () => {
    const host = await render();
    const info = host.querySelector('#info svg');
    const path = info?.querySelector('path')?.getAttribute('d') ?? '';
    const ring = (host.querySelector('#play path')?.getAttribute('d') ?? '').replace(/^.*?Z/, '');

    expect(info?.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(info?.getAttribute('stroke-width')).toBe('1.5');
    expect(info?.getAttribute('stroke-linecap')).toBe('round');
    // The same ring as play, then the stem, then the dot: a round cap on a 0.01 stroke above it.
    expect(ring).toMatch(/^M17\.25 10C/);
    expect(path.startsWith(ring)).toBe(true);
    expect(path.slice(ring.length)).toBe('M10 9.75V13.25M10 6.75V6.76');
  });

  it('is always decorative: hidden from assistive technology and never focusable', async () => {
    const host = await render();

    for (const icon of Array.from(host.querySelectorAll('app-icon'))) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(icon.querySelector('svg')?.getAttribute('focusable')).toBe('false');
    }
  });
});
