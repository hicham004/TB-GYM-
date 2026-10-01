import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallPrompt, isInstalledApp, isIosBrowser } from './install-prompt';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DAY = 86_400_000;

/** jsdom's navigator is its own; these are what a device would report. */
function userAgent(value: string, platform = 'iPhone', maxTouchPoints = 5): void {
  const report = { userAgent: value, platform, maxTouchPoints };
  for (const [name, reported] of Object.entries(report)) {
    Object.defineProperty(window.navigator, name, { configurable: true, get: () => reported });
  }
}

function forgetDevice(): void {
  for (const name of ['userAgent', 'platform', 'maxTouchPoints', 'standalone']) {
    Reflect.deleteProperty(window.navigator, name);
  }
}

/** jsdom has no `matchMedia`; an installed app is one where the display-mode query matches. */
function displayMode(standalone: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({ matches: standalone })),
  });
}

/** What Chrome fires; `outcome` is what the person then chooses in its dialog. */
function chromeOffers(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn(() => Promise.resolve());
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  window.dispatchEvent(event);
  return { event, prompt };
}

function service(): InstallPrompt {
  return TestBed.inject(InstallPrompt);
}

describe('InstallPrompt', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
    Reflect.deleteProperty(window, 'matchMedia');
    forgetDevice();
  });

  it('offers nothing in a browser that has not said the app can be installed', () => {
    userAgent(ANDROID, 'Linux armv8l');
    const install = service();

    expect(install.offer()).toBeNull();
    expect(install.bannerOffer()).toBeNull();
  });

  it('keeps Chrome’s event and offers an Install button, without Chrome’s own bar', () => {
    userAgent(ANDROID, 'Linux armv8l');
    const install = service();

    const { event } = chromeOffers();

    expect(event.defaultPrevented).toBe(true);
    expect(install.offer()).toBe('prompt');
    expect(install.bannerOffer()).toBe('prompt');
  });

  it('asks Chrome to install, and an accepted install ends the offer', async () => {
    userAgent(ANDROID, 'Linux armv8l');
    const install = service();
    const { prompt } = chromeOffers('accepted');

    await expect(install.install()).resolves.toBe('accepted');

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(install.offer()).toBeNull();
  });

  it('ends the offer after a refusal too, because Chrome lets an event be used once', async () => {
    userAgent(ANDROID, 'Linux armv8l');
    const install = service();
    chromeOffers('dismissed');

    await expect(install.install()).resolves.toBe('dismissed');

    expect(install.offer()).toBeNull();
    await expect(install.install()).resolves.toBe('unavailable');
  });

  it('has nothing to install with before the browser has spoken', async () => {
    userAgent(ANDROID, 'Linux armv8l');

    await expect(service().install()).resolves.toBe('unavailable');
  });

  it('stops offering once the browser reports the app installed', () => {
    userAgent(ANDROID, 'Linux armv8l');
    const install = service();
    chromeOffers();

    window.dispatchEvent(new Event('appinstalled'));

    expect(install.offer()).toBeNull();
  });

  it('gives an iPhone the Share-menu steps, since Safari offers no install button', () => {
    userAgent(IPHONE);

    expect(service().offer()).toBe('ios');
  });

  it('gives an iPad that calls itself a Mac the same steps', () => {
    userAgent(IPHONE.replace('iPhone; CPU iPhone OS', 'Macintosh; Intel Mac OS X'), 'MacIntel', 5);

    expect(service().offer()).toBe('ios');
  });

  it('gives a Mac without a touch screen nothing', () => {
    userAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
      'MacIntel',
      0,
    );

    expect(service().offer()).toBeNull();
  });

  it.each(['Instagram 330.0.0.34.108', 'FBAN/FBIOS;FBAV/450.0', 'MicroMessenger/8.0'])(
    'tells nobody in a browser built into another app (%s) to use a Share menu it does not have',
    (app) => {
      userAgent(`${IPHONE} ${app}`);

      expect(service().offer()).toBeNull();
    },
  );

  it('offers nothing to an app that is already installed', () => {
    displayMode(true);
    userAgent(IPHONE);
    const install = service();
    chromeOffers();

    expect(install.offer()).toBeNull();
  });

  it('knows an iPhone home-screen app by its own flag', () => {
    userAgent(IPHONE);
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });

    expect(service().offer()).toBeNull();
  });

  it('keeps the banner quiet for a month after "Not now", and always offers the card', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    userAgent(IPHONE);
    const install = service();

    install.dismissBanner();

    expect(install.bannerOffer()).toBeNull();
    expect(install.offer()).toBe('ios');
    expect(window.localStorage.getItem('tb.install-banner.dismissed-at')).toBe(
      String(new Date('2026-10-01T09:00:00Z').getTime()),
    );
  });

  it('remembers the dismissal on this device, and asks again after 30 days', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    window.localStorage.setItem('tb.install-banner.dismissed-at', String(Date.now() - 29 * DAY));
    userAgent(IPHONE);

    expect(service().bannerOffer()).toBeNull();

    TestBed.resetTestingModule();
    window.localStorage.setItem('tb.install-banner.dismissed-at', String(Date.now() - 31 * DAY));
    expect(service().bannerOffer()).toBe('ios');
  });

  it('survives storage that is blocked or holds nonsense', () => {
    userAgent(IPHONE);
    window.localStorage.setItem('tb.install-banner.dismissed-at', 'yesterday');
    const install = service();
    expect(install.bannerOffer()).toBe('ios');

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(() => install.dismissBanner()).not.toThrow();
    expect(install.bannerOffer()).toBeNull();
  });

  it('stops listening when the app is destroyed', () => {
    userAgent(ANDROID, 'Linux armv8l');
    const install = service();
    TestBed.resetTestingModule();

    const { event } = chromeOffers();

    expect(event.defaultPrevented).toBe(false);
    expect(install.offer()).toBeNull();
  });
});

describe('where the app is running', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
    forgetDevice();
  });

  it('tells a browser tab from an installed app', () => {
    expect(isInstalledApp(window)).toBe(false);
    displayMode(false);
    expect(isInstalledApp(window)).toBe(false);
    displayMode(true);
    expect(isInstalledApp(window)).toBe(true);
  });

  it('tells an iPhone or iPad browser from every other', () => {
    userAgent(ANDROID, 'Linux armv8l');
    expect(isIosBrowser(window)).toBe(false);
    userAgent(IPHONE);
    expect(isIosBrowser(window)).toBe(true);
  });
});
