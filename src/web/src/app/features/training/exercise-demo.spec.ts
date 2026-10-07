import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { MediaAccessView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { settle } from '../../../testing/dom';
import { ExerciseDemo } from './exercise-demo';

function access(assetId: string, overrides: Partial<MediaAccessView> = {}): MediaAccessView {
  return {
    assetId,
    kind: 'Video',
    source: 'Upload',
    contentType: 'video/mp4',
    url: `/api/media/${assetId}/content`,
    expiresAtUtc: '2026-10-07T12:00:00Z',
    downloadAllowed: false,
    ...overrides,
  };
}

async function render(
  assetIds: string[],
  compact = false,
  grant = vi.fn((id: string) => of(access(id))),
) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  await TestBed.configureTestingModule({
    imports: [ExerciseDemo],
    providers: [
      { provide: ApiClient, useValue: { createMediaAccess: grant } },
      { provide: CsrfService, useValue: { refresh } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ExerciseDemo);
  fixture.componentRef.setInput('assetIds', assetIds);
  fixture.componentRef.setInput('exerciseName', 'Back squat');
  fixture.componentRef.setInput('compact', compact);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, grant, refresh };
}

function sheet(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!found) throw new Error('No sheet is open.');
  return found;
}

describe('ExerciseDemo', () => {
  afterEach(() => {
    document.body
      .querySelectorAll('.cdk-overlay-container')
      .forEach((node) => node.replaceChildren());
    TestBed.resetTestingModule();
  });

  it('shows nothing for an exercise without a demo', async () => {
    const { host } = await render([]);
    expect(host.querySelector('button')).toBeNull();
  });

  it('names an icon-only button, then plays the demo the server grants', async () => {
    const { fixture, host, grant, refresh } = await render(['squat-video'], true);
    const button = host.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Watch the Back squat demo');
    expect(button.textContent?.trim()).toBe('');

    button.click();
    await settle(fixture);

    expect(refresh).toHaveBeenCalled();
    expect(grant).toHaveBeenCalledWith('squat-video');
    expect(sheet().querySelector('h2')?.textContent?.trim()).toBe('Back squat');
    const video = sheet().querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/api/media/squat-video/content');
    expect(video.getAttribute('controlsList')).toBe('nodownload');
    expect(video.getAttribute('aria-label')).toBe('How to do Back squat');
  });

  it('switches between several demos, a picture among them', async () => {
    const grant = vi.fn((id: string) =>
      of(access(id, id === 'squat-photo' ? { kind: 'Image', contentType: 'image/jpeg' } : {})),
    );
    const { fixture, host } = await render(['squat-video', 'squat-photo'], false, grant);
    expect(host.querySelector('button')?.textContent?.trim()).toBe('Watch demo');

    host.querySelector('button')!.click();
    await settle(fixture);
    const picks = Array.from(sheet().querySelectorAll<HTMLButtonElement>('.pick-one'));
    expect(picks.map((item) => item.textContent?.trim())).toEqual(['Demo 1', 'Demo 2']);
    expect(picks[0].getAttribute('aria-pressed')).toBe('true');

    picks[1].click();
    await settle(fixture);
    expect(grant).toHaveBeenLastCalledWith('squat-photo');
    expect(sheet().querySelector('img')?.getAttribute('alt')).toBe('How to do Back squat');
    expect(sheet().querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });

  it('says a demo hosted elsewhere cannot be played here', async () => {
    const grant = vi.fn((id: string) => of(access(id, { source: 'ExternalEmbed' })));
    const { fixture, host } = await render(['youtube'], false, grant);

    host.querySelector('button')!.click();
    await settle(fixture);

    expect(sheet().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'This demo is a video hosted elsewhere, which can’t be played here yet.',
    );
    expect(sheet().querySelector('video')).toBeNull();
  });
});
