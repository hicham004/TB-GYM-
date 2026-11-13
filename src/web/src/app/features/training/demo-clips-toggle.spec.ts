import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fakeMotion, provideFakeMotion } from '../../../testing/motion-fake';
import { button, press, settle } from '../../../testing/dom';
import { DemoClips } from './demo-clips';
import { DemoClipsToggle } from './demo-clips-toggle';

async function render(allowed: boolean) {
  await TestBed.configureTestingModule({
    imports: [DemoClipsToggle],
    providers: [
      { provide: ApiClient, useValue: {} },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('house') } },
      provideFakeMotion(fakeMotion({ allowed })),
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(DemoClipsToggle);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, clips: TestBed.inject(DemoClips) };
}

describe('DemoClipsToggle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('reads “Pause demos” while the demos play, and a press pauses every one, then plays them again', async () => {
    const { fixture, host, clips } = await render(true);
    expect(clips.paused()).toBe(false);
    const toggle = button(host, 'Pause demos');
    expect(toggle.hasAttribute('data-clips-toggle')).toBe(true);
    expect(toggle.getAttribute('type')).toBe('button');
    // The kit's outlined button at a client screen's touch size.
    expect(toggle.classList).toContain('tb-button--outlined');
    expect(toggle.classList).toContain('tb-button--touch');

    press(host, 'Pause demos');
    await settle(fixture);

    expect(clips.paused()).toBe(true);
    expect(button(host, 'Play demos')).toBe(toggle);

    press(host, 'Play demos');
    await settle(fixture);

    expect(clips.paused()).toBe(false);
    expect(button(host, 'Pause demos')).toBe(toggle);
  });

  it('reads “Play demos” where the demos start paused, for a person who asked for reduced motion', async () => {
    const { host, clips } = await render(false);

    expect(clips.paused()).toBe(true);
    expect(button(host, 'Play demos')).toBeTruthy();
  });

  it('follows a pause chosen on a clip of its own', async () => {
    const { fixture, host, clips } = await render(true);

    clips.pause();
    await settle(fixture);

    expect(button(host, 'Play demos')).toBeTruthy();
  });
});
