import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserBar, DARK_BAR_COLOR, LIGHT_BAR_COLOR } from '../../core/theme/browser-bar';
import { settle } from '../../../testing/dom';
import { AuthFrame } from './auth-frame';

@Component({
  imports: [AuthFrame],
  template: `
    @if (shown()) {
      <app-auth-frame [embedded]="embedded()"><h1>Sign in</h1></app-auth-frame>
    }
  `,
})
class Host {
  readonly shown = signal(true);
  readonly embedded = signal(false);
}

/** index.html's two bar colours, one per device scheme. */
function addThemeColors(): void {
  for (const [media, color] of [
    ['(prefers-color-scheme: light)', LIGHT_BAR_COLOR],
    ['(prefers-color-scheme: dark)', DARK_BAR_COLOR],
  ]) {
    // Attributes, as index.html writes them: jsdom's meta element has no `media` property.
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('media', media);
    meta.setAttribute('content', color);
    document.head.append(meta);
  }
}

const darkSchemeBar = () =>
  document.querySelector('meta[name="theme-color"][media*="dark"]')?.getAttribute('content');

/**
 * Audit UIQ-9: the signed-out pages stay light whatever the device's scheme (the lead's call), while
 * the browser's bar went dark under a dark scheme above a cream page. The bar now takes their cream.
 */
describe('the browser bar over the signed-out pages', () => {
  beforeEach(addThemeColors);
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  });

  it('takes the page’s cream under a dark scheme while a signed-out page shows, and gives it back', async () => {
    await TestBed.configureTestingModule({ providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    expect(darkSchemeBar()).toBe(LIGHT_BAR_COLOR);

    fixture.componentInstance.shown.set(false);
    await settle(fixture);
    expect(darkSchemeBar()).toBe(DARK_BAR_COLOR);
  });

  it('follows the app’s shell when the frame is embedded in it', async () => {
    await TestBed.configureTestingModule({ providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.embedded.set(true);
    await settle(fixture);
    expect(darkSchemeBar()).toBe(DARK_BAR_COLOR);

    fixture.componentInstance.embedded.set(false);
    await settle(fixture);
    expect(darkSchemeBar()).toBe(LIGHT_BAR_COLOR);
  });

  it('stays light while one light page hands over to the next, and lets go only once each', () => {
    const bar = TestBed.inject(BrowserBar);
    const signIn = bar.holdLight();
    const register = bar.holdLight();
    signIn();
    signIn();
    expect(darkSchemeBar()).toBe(LIGHT_BAR_COLOR);
    register();
    expect(darkSchemeBar()).toBe(DARK_BAR_COLOR);
    // The light scheme's bar is cream all along.
    expect(
      document.querySelector('meta[name="theme-color"][media*="light"]')?.getAttribute('content'),
    ).toBe(LIGHT_BAR_COLOR);
  });
});
