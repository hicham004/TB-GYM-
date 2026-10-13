import { isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import type { WebsiteSettingsView } from '../api/generated';
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
 */
@Injectable({ providedIn: 'root' })
export class WebsiteSettingsStore {
  private readonly api = inject(ApiClient);
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
        const settings = mapWebsiteSettings(view);
        this.state.set(settings);
        this.analytics.start(settings.analyticsScript);
      },
      () => {
        this.state.set({ whatsAppNumber: null, analyticsScript: null });
      },
    );
    return this.request;
  }
}
