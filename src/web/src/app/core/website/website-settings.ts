import { isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import type { WebsiteSettingsView } from '../api/generated';
import { AuthStore } from '../auth/auth.store';
import { WebsiteAnalytics } from './website-analytics';

/** What the homepage may know of the deployment: a WhatsApp number and the analytics script, or neither. */
export interface WebsiteSettings {
  readonly whatsAppNumber: string | null;
  readonly analyticsScript: string | null;
}

export function mapWebsiteSettings(view: WebsiteSettingsView): WebsiteSettings {
  return {
    whatsAppNumber: view.whatsAppNumber?.trim() || null,
    analyticsScript: view.analytics?.script?.trim() || null,
  };
}

/** The wa.me address of an international number: its digits alone. */
export function whatsAppLink(number: string | null): string | null {
  const digits = (number ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? `https://wa.me/${digits}` : null;
}

/**
 * The public website's settings (UI plan R6.2g), asked for once per visit in the browser. The
 * build-time render asks for nothing, so the page arrives without the WhatsApp link and without
 * analytics, and gains them once it is live. A failed request leaves both off: the page works
 * without them.
 *
 * Analytics is a visitor's alone. The homepage inside the app (`/about`, notes plan N2) reads these
 * settings for someone signed in too, for the WhatsApp link, and loads nothing of analytics for them.
 */
@Injectable({ providedIn: 'root' })
export class WebsiteSettingsStore {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly analytics = inject(WebsiteAnalytics);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly state = signal<WebsiteSettings | null>(null);
  private request: Promise<void> | null = null;

  readonly settings = this.state.asReadonly();
  readonly whatsAppLink = computed(() => whatsAppLink(this.state()?.whatsAppNumber ?? null));
  readonly whatsAppNumber = computed(() => this.state()?.whatsAppNumber ?? null);

  load(): Promise<void> {
    if (!this.browser) return Promise.resolve();
    this.request ??= firstValueFrom(this.api.getWebsiteSettings()).then(
      (view) => {
        this.state.set(mapWebsiteSettings(view));
      },
      () => {
        this.state.set({ whatsAppNumber: null, analyticsScript: null });
      },
    );
    // Decided at each call, by who is there once the settings are in: a page a visitor opens after
    // someone signed out in this tab still starts the script, which starts once.
    return this.request.then(() => {
      const script = this.state()?.analyticsScript;
      if (script && this.auth.user() === null) this.analytics.start(script);
    });
  }
}
