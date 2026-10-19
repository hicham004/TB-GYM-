import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { MediaAccessView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { TodayTraining } from './today-training';

interface TodayTrainingMediaHarness {
  showMedia(assetId: string, event: Event): Promise<void>;
}

describe('TodayTraining media dialog', () => {
  afterEach(() => {
    document.body.replaceChildren();
    TestBed.resetTestingModule();
  });

  it('moves focus into the rendered dialog, closes on Escape, and restores focus', async () => {
    let releaseCsrf!: () => void;
    const csrfReady = new Promise<void>((resolve) => {
      releaseCsrf = resolve;
    });
    const access: MediaAccessView = {
      assetId: 'asset-1',
      kind: 'Image',
      source: 'Upload',
      contentType: 'image/png',
      url: '/api/media/asset-1/content',
      expiresAtUtc: '2026-08-21T18:00:00Z',
      downloadAllowed: false,
    };

    await TestBed.configureTestingModule({
      imports: [TodayTraining],
      providers: [
        provideRouter([]),
        {
          provide: ApiClient,
          useValue: {
            createMediaAccess: vi.fn(() => of(access)),
            getMyTrainingToday: () =>
              of({ isAllowed: false, workouts: [], accessReason: 'NoEntitlement' }),
            getMyUpcomingTraining: () =>
              of({ isAllowed: false, unfinishedWorkouts: [], accessReason: 'NoEntitlement' }),
          },
        },
        {
          provide: CsrfService,
          useValue: { refresh: vi.fn(() => csrfReady) },
        },
        {
          provide: TenantStore,
          useValue: { selectedTenantId: signal('tenant-1') },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayTraining);
    fixture.detectChanges();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    let eventTarget: EventTarget | null = trigger;
    const open = (fixture.componentInstance as unknown as TodayTrainingMediaHarness).showMedia(
      access.assetId,
      {
        get currentTarget() {
          return eventTarget;
        },
      } as unknown as Event,
    );
    eventTarget = null;
    releaseCsrf();
    await open;
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Close media"]');
    expect(close).not.toBeNull();
    expect(document.activeElement).toBe(close);

    close!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens a YouTube demo on YouTube in a new tab, from the same dialog, and plays nothing here', async () => {
    const access: MediaAccessView = {
      assetId: 'asset-yt',
      kind: 'Video',
      source: 'ExternalEmbed',
      contentType: null,
      url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      expiresAtUtc: '2026-08-21T18:00:00Z',
      downloadAllowed: false,
      externalProvider: 'YouTube',
      watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    };
    await TestBed.configureTestingModule({
      imports: [TodayTraining],
      providers: [
        provideRouter([]),
        {
          provide: ApiClient,
          useValue: {
            createMediaAccess: vi.fn(() => of(access)),
            getMyTrainingToday: () =>
              of({ isAllowed: false, workouts: [], accessReason: 'NoEntitlement' }),
            getMyUpcomingTraining: () =>
              of({ isAllowed: false, unfinishedWorkouts: [], accessReason: 'NoEntitlement' }),
          },
        },
        { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
        { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TodayTraining);
    fixture.detectChanges();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    await (fixture.componentInstance as unknown as TodayTrainingMediaHarness).showMedia(
      access.assetId,
      { currentTarget: trigger } as unknown as Event,
    );
    fixture.detectChanges();
    await fixture.whenStable();

    // C18 (audit WEA-2): the old 'not enabled for this beta' refusal is gone; the video's page opens.
    const host = fixture.nativeElement as HTMLElement;
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(
      'This demo is a video on YouTube. It opens there, in a new tab.',
    );
    const link = dialog.querySelector<HTMLAnchorElement>('[data-watch-external]')!;
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(dialog.querySelector('video, iframe, img')).toBeNull();
    expect(host.textContent).not.toContain('not enabled for this beta');
  });
});
