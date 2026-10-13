import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import { WebsiteAnalytics } from './website-analytics';
import { mapWebsiteSettings, WebsiteSettingsStore, whatsAppLink } from './website-settings';

function setUp(api: Partial<ApiClient>) {
  const analytics = { start: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: WebsiteAnalytics, useValue: analytics },
    ],
  });
  return { store: TestBed.inject(WebsiteSettingsStore), analytics };
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

  it('leaves both off when nothing is configured or the request fails', async () => {
    const quiet = setUp({
      getWebsiteSettings: vi.fn(() => of({ whatsAppNumber: null, analytics: { script: null } })),
    });
    await quiet.store.load();
    expect(quiet.store.whatsAppLink()).toBeNull();
    expect(quiet.analytics.start).toHaveBeenCalledWith(null);
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
