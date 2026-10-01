import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstallOffer } from '../../core/pwa/install-prompt';
import { InstallPrompt } from '../../core/pwa/install-prompt';
import { press, settle } from '../../../testing/dom';
import { InstallCard } from './install-card';

async function render(
  offers: { offer?: InstallOffer; bannerOffer?: InstallOffer },
  variant: 'card' | 'banner' = 'card',
  install: () => Promise<unknown> = () => Promise.resolve('accepted'),
) {
  const prompt = {
    offer: signal<InstallOffer>(offers.offer ?? null),
    // An explicit null is a dismissed banner; only an omitted one follows the card's offer.
    bannerOffer: signal<InstallOffer>(
      'bannerOffer' in offers ? (offers.bannerOffer ?? null) : (offers.offer ?? null),
    ),
    install: vi.fn(install),
    dismissBanner: vi.fn(),
  };
  await TestBed.configureTestingModule({
    imports: [InstallCard],
    providers: [{ provide: InstallPrompt, useValue: prompt }],
  }).compileComponents();
  const fixture = TestBed.createComponent(InstallCard);
  fixture.componentRef.setInput('variant', variant);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, prompt };
}

describe('InstallCard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('draws nothing where the app cannot be installed, or already is', async () => {
    const { host } = await render({ offer: null });

    expect(host.querySelector('section')).toBeNull();
    expect(host.textContent?.trim()).toBe('');
  });

  it('offers Install where the browser installs on request, named for the app and its icon', async () => {
    const { host } = await render({ offer: 'prompt' });

    const region = host.querySelector('section');
    expect(region?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
    expect(host.querySelector('h2')?.textContent).toBe('Add TB Gym to your home screen');
    expect(host.textContent).toContain('Open it like any app');
    expect(host.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('icons/icon-192.png');
    expect(host.querySelectorAll('button')).toHaveLength(1);
  });

  it('asks the browser when Install is pressed, and shows it is working until it answers', async () => {
    let answer!: () => void;
    const { fixture, host, prompt } = await render(
      { offer: 'prompt' },
      'card',
      () => new Promise((resolve) => (answer = () => resolve('accepted'))),
    );

    press(host, 'Install app');
    await settle(fixture);

    expect(prompt.install).toHaveBeenCalledTimes(1);
    expect(host.querySelector('button')?.getAttribute('aria-disabled')).toBe('true');
    // A second press while the browser's dialog is open does nothing.
    host.querySelector('button')?.click();
    expect(prompt.install).toHaveBeenCalledTimes(1);

    answer();
    await settle(fixture);
    expect(host.querySelector('button')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('gives an iPhone the steps, with the Share symbol, and no button to press', async () => {
    const { host } = await render({ offer: 'ios' });

    const steps = [...host.querySelectorAll('li')].map((step) => step.textContent?.trim());
    expect(steps).toEqual(['Tap Share', 'Choose Add to Home Screen', 'Tap Add']);
    expect(host.querySelector('li app-icon')).not.toBeNull();
    expect(host.querySelector('button')).toBeNull();
  });

  it('is a card on Me: it offers even after the banner was dismissed, and cannot be dismissed', async () => {
    const { host } = await render({ offer: 'prompt', bannerOffer: null }, 'card');

    expect(host.querySelector('section')).not.toBeNull();
    expect(host.textContent).not.toContain('Not now');
  });

  it('is a banner on Today: gone once dismissed, and "Not now" dismisses it', async () => {
    const hidden = await render({ offer: 'prompt', bannerOffer: null }, 'banner');
    expect(hidden.host.querySelector('section')).toBeNull();
    TestBed.resetTestingModule();

    const { fixture, host, prompt } = await render({ offer: 'ios', bannerOffer: 'ios' }, 'banner');
    expect(host.querySelector('section')?.classList.contains('is-banner')).toBe(true);
    press(host, 'Not now');
    await settle(fixture);

    expect(prompt.dismissBanner).toHaveBeenCalledTimes(1);
  });

  it('puts Install and Not now together on the banner', async () => {
    const { host } = await render({ offer: 'prompt' }, 'banner');

    expect([...host.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Install app',
      'Not now',
    ]);
  });
});
