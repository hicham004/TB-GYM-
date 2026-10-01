import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

/** Chrome's install event, which TypeScript's DOM types do not describe. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * What can be offered here: `prompt` where the browser installs on request (Chrome and Edge, on
 * Android and desktop), `ios` where it only installs from the Share menu, nothing where an app
 * cannot be installed or already is.
 */
export type InstallOffer = 'prompt' | 'ios' | null;

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

const DISMISSED_KEY = 'tb.install-banner.dismissed-at';
const DISMISSED_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Whether TB Gym can be put on the home screen from this browser, and doing it (R2.5c). There is no
 * service worker: Chromium installs from the manifest and icons alone, and nothing is cached.
 *
 * Chrome announces an installable page once, soon after it loads, and only to a listener that is
 * already there, so this service is created at start-up (see `app.config.ts`), before any screen.
 * The event is kept and used when the person asks; Chrome's own mini bar is suppressed so the offer
 * comes at a calm moment on our screens.
 */
@Injectable({ providedIn: 'root' })
export class InstallPrompt {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly deferred = signal<BeforeInstallPromptEvent | null>(null);
  private readonly installed = signal(this.window !== null && isInstalledApp(this.window));
  private readonly dismissedAt = signal<number | null>(readDismissedAt(this.window));
  private readonly ios = this.window !== null && isIosBrowser(this.window);

  /** The offer for a place that is always open to it, such as the Me page. */
  readonly offer = computed<InstallOffer>(() => {
    if (this.installed()) return null;
    if (this.deferred() !== null) return 'prompt';
    return this.ios ? 'ios' : null;
  });

  /** The offer for a place that nags, such as Today: gone for a month once it was dismissed. */
  readonly bannerOffer = computed<InstallOffer>(() => {
    const dismissed = this.dismissedAt();
    return dismissed !== null && Date.now() - dismissed < DISMISSED_DAYS * DAY_MS
      ? null
      : this.offer();
  });

  constructor() {
    const target = this.window;
    if (target === null) return;
    const onOffered = (event: Event) => {
      event.preventDefault();
      this.deferred.set(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      this.installed.set(true);
      this.deferred.set(null);
    };
    target.addEventListener('beforeinstallprompt', onOffered);
    target.addEventListener('appinstalled', onInstalled);
    inject(DestroyRef).onDestroy(() => {
      target.removeEventListener('beforeinstallprompt', onOffered);
      target.removeEventListener('appinstalled', onInstalled);
    });
  }

  /** Asks the browser to install. Each event can be used once, so a refusal ends the offer. */
  async install(): Promise<InstallOutcome> {
    const event = this.deferred();
    if (event === null) return 'unavailable';
    this.deferred.set(null);
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') this.installed.set(true);
    return outcome;
  }

  /** "Not now" on the banner: it stays away for a month. Only a preference of this device. */
  dismissBanner(): void {
    const now = Date.now();
    this.dismissedAt.set(now);
    try {
      this.window?.localStorage.setItem(DISMISSED_KEY, String(now));
    } catch {
      // Storage can be blocked or full; the banner is then only quiet for this visit.
    }
  }
}

/** Running as an installed app, not in a browser tab (the media query, and iOS's own flag). */
export function isInstalledApp(window: Window): boolean {
  const standalone = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    standalone.standalone === true
  );
}

/**
 * An iPhone or iPad browser, where "Add to Home Screen" is in the Share menu. A browser built into
 * another app (Instagram, Facebook and the like) has no such menu, so it gets no instructions.
 * iPadOS reports itself as a Mac, with a touch screen.
 */
export function isIosBrowser(window: Window): boolean {
  const { userAgent, platform, maxTouchPoints } = window.navigator;
  const apple =
    /iPhone|iPod|iPad/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  return apple && !/FBAN|FBAV|Instagram|Line\/|MicroMessenger|TikTok|Snapchat/i.test(userAgent);
}

function readDismissedAt(window: Window | null): number | null {
  try {
    const stored = window?.localStorage.getItem(DISMISSED_KEY) ?? null;
    const value = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
