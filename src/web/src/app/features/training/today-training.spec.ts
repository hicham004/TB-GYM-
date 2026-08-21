import { signal } from '@angular/core';
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
        {
          provide: ApiClient,
          useValue: { createMediaAccess: vi.fn(() => of(access)) },
        },
        {
          provide: CsrfService,
          useValue: { refresh: vi.fn(() => csrfReady) },
        },
        {
          provide: TenantStore,
          useValue: { selectedTenantId: signal(null) },
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
});
