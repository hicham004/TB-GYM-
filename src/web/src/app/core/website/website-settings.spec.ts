import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { AuthStore } from '../auth/auth.store';
import { WebsiteAnalytics } from './website-analytics';
import { mapWebsiteSettings, WebsiteSettingsStore, whatsAppLink } from './website-settings';

/** A visitor unless `signedIn`: analytics is theirs alone. */
function setUp(api: Partial<ApiClient>, signedIn = false) {
  const analytics = { start: vi.fn() };
  const user = signal<{ id: string } | null>(signedIn ? { id: 'user-1' } : null);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: AuthStore, useValue: { user } },
      { provide: WebsiteAnalytics, useValue: analytics },
    ],
  });
  return { store: TestBed.inject(WebsiteSettingsStore), analytics, user };
}

describe('WebsiteSettingsStore', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('asks once, keeps what the deployment configured, and starts analytics with its script', async () => {
    const getWebsiteSettings = vi.fn(() =>
      of({ whatsAppNumber: '+96170123456', analytics: { script: 'pa-AbC123.js' } }),
    );
    const { store, analytics } = setUp({ getWebsiteSettings });

    await Promise.all([store.load(), store.load()]);

    expect(getWebsiteSettings).toHaveBeenCalledTimes(1);
    expect(store.whatsAppNumber()).toBe('+96170123456');
    expect(store.whatsAppLink()).toBe('https://wa.me/96170123456');
    expect(analytics.start).toHaveBeenCalledWith('pa-AbC123.js');
  });

  // Notes plan N2: the homepage opens inside the app, at /about, for someone signed in.
  it('gives someone signed in the WhatsApp link and nothing of analytics', async () => {
    const getWebsiteSettings = vi.fn(() =>
      of({ whatsAppNumber: '+96170123456', analytics: { script: 'pa-AbC123.js' } }),
    );
    const { store, analytics } = setUp({ getWebsiteSettings }, true);

    await store.load();

    expect(getWebsiteSettings).toHaveBeenCalledTimes(1);
    expect(store.whatsAppLink()).toBe('https://wa.me/96170123456');
    expect(analytics.start).not.toHaveBeenCalled();
  });

  it('starts analytics for a visitor who opens a page after someone signed out in the same tab', async () => {
    const getWebsiteSettings = vi.fn(() =>
      of({ whatsAppNumber: null, analytics: { script: 'pa-AbC123.js' } }),
    );
    const { store, analytics, user } = setUp({ getWebsiteSettings }, true);
    await store.load();
    expect(analytics.start).not.toHaveBeenCalled();

    user.set(null);
    await store.load();

    // The settings are not asked for again; the script the first answer named is started now.
    expect(getWebsiteSettings).toHaveBeenCalledTimes(1);
    expect(analytics.start).toHaveBeenCalledTimes(1);
    expect(analytics.start).toHaveBeenCalledWith('pa-AbC123.js');
  });

  it('does not start analytics for someone who signed in while the settings were on their way', async () => {
    let answer!: (view: { whatsAppNumber: null; analytics: { script: string } }) => void;
    const getWebsiteSettings = vi.fn(
      () =>
        new Observable<{ whatsAppNumber: null; analytics: { script: string } }>((subscriber) => {
          answer = (view) => {
            subscriber.next(view);
            subscriber.complete();
          };
        }),
    );
    const { store, analytics, user } = setUp({ getWebsiteSettings });
    const loaded = store.load();

    user.set({ id: 'user-1' });
    answer({ whatsAppNumber: null, analytics: { script: 'pa-AbC123.js' } });
    await loaded;

    expect(analytics.start).not.toHaveBeenCalled();
  });

  it('leaves both off when nothing is configured or the request fails', async () => {
    const quiet = setUp({
      getWebsiteSettings: vi.fn(() => of({ whatsAppNumber: null, analytics: { script: null } })),
    });
    await quiet.store.load();
    expect(quiet.store.whatsAppLink()).toBeNull();
    // No script is named, so there is nothing to start.
    expect(quiet.analytics.start).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const failing = setUp({
      getWebsiteSettings: vi.fn(() => throwError(() => new Error('offline'))),
    });
    await failing.store.load();
    expect(failing.store.settings()).toEqual({ whatsAppNumber: null, analyticsScript: null });
    expect(failing.store.whatsAppLink()).toBeNull();
    expect(failing.analytics.start).not.toHaveBeenCalled();
  });

  it('maps blanks to nothing and builds the wa.me address from the digits alone', () => {
    expect(mapWebsiteSettings({ whatsAppNumber: '  ', analytics: { script: '' } })).toEqual({
      whatsAppNumber: null,
      analyticsScript: null,
    });
    expect(whatsAppLink('+961 70 123 456')).toBe('https://wa.me/96170123456');
    expect(whatsAppLink('123')).toBeNull();
    expect(whatsAppLink(null)).toBeNull();
  });
});
