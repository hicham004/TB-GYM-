import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { MediaAccessView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { query, settle } from '../../../testing/dom';
import { fakeMotion, type FakeMotion, provideFakeMotion } from '../../../testing/motion-fake';
import { DemoClips } from './demo-clips';
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

/**
 * The demo button for `assetIds`. Motion is the fake's when given; without one jsdom reads as reduced
 * motion, so the demo clips start paused (notes plan N9b4).
 */
async function render(
  assetIds: string[],
  compact = false,
  grant = vi.fn((id: string) => of(access(id))),
  motion?: FakeMotion,
) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  await TestBed.configureTestingModule({
    imports: [ExerciseDemo],
    providers: [
      { provide: ApiClient, useValue: { createMediaAccess: grant } },
      { provide: CsrfService, useValue: { refresh } },
      ...(motion ? [provideFakeMotion(motion)] : []),
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

  it('is a whole tile when asked, what the page drew in it named by the exercise', async () => {
    const { fixture, host, grant } = await render(['media-1']);
    fixture.componentRef.setInput('tile', true);
    await settle(fixture);
    const button = host.querySelector<HTMLButtonElement>('.demo.tile')!;
    expect(button.getAttribute('aria-label')).toBe('Watch demo: Back squat');

    await fixture.componentInstance.open();
    await settle(fixture);
    expect(grant).toHaveBeenCalledExactlyOnceWith('media-1');
    expect(sheet().querySelector('video')).not.toBeNull();
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

  it('plays an uploaded video like a GIF while the clips play: muted, looping, inline, its controls kept (notes plan N9b4)', async () => {
    const { fixture, host } = await render(
      ['squat-video'],
      true,
      undefined,
      fakeMotion({ allowed: true }),
    );

    host.querySelector('button')!.click();
    await settle(fixture);

    const video = query<HTMLVideoElement>(sheet(), 'video');
    // The property, which mutes it; the attribute alone, written after the element is made, does not.
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('muted')).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.autoplay).toBe(true);
    // A coach may still turn the sound on, pause or go full screen.
    expect(video.controls).toBe(true);
    expect(video.getAttribute('controlsList')).toBe('nodownload');
    expect(video.getAttribute('aria-label')).toBe('How to do Back squat');

    // The clips paused elsewhere (a list's Pause demos): the sheet's video waits for its play control.
    TestBed.inject(DemoClips).pause();
    await settle(fixture);
    expect(video.autoplay).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.controls).toBe(true);
  });

  it('waits for its play control under reduced motion, still muted and looping', async () => {
    const { fixture, host } = await render(['squat-video'], true);

    host.querySelector('button')!.click();
    await settle(fixture);

    const video = query<HTMLVideoElement>(sheet(), 'video');
    expect(video.autoplay).toBe(false);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.controls).toBe(true);
  });

  it('takes a thumb’s size when asked, as on the trainee’s picker (notes plan N9b3)', async () => {
    const { fixture, host } = await render(['squat-video'], true);
    const button = host.querySelector<HTMLButtonElement>('button.demo')!;
    expect(button.classList.contains('touch')).toBe(false);

    // Written as a bare attribute, as the picker writes it: `compact touch`.
    fixture.componentRef.setInput('touch', '');
    await settle(fixture);
    expect(button.classList.contains('touch')).toBe(true);
    expect(button.classList.contains('compact')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Watch the Back squat demo');
  });

  /** "See all {n} demos" on a pool exercise's page opens this sheet on a phone (notes plan N9b4). */
  it('gives its sheet’s controls a thumb’s size when asked, and keeps a coach’s sheet as it was', async () => {
    const grant = vi.fn((id: string) =>
      of(
        id === 'squat-link'
          ? access(id, {
              source: 'ExternalEmbed',
              contentType: null,
              url: 'https://www.youtube-nocookie.com/embed/aclHkVaku9U',
              externalProvider: 'YouTube',
              watchUrl: 'https://www.youtube.com/watch?v=aclHkVaku9U',
            })
          : access(id),
      ),
    );
    const sizes = async (touch: boolean) => {
      const { fixture, host } = await render(['squat-video', 'squat-link'], false, grant);
      fixture.componentRef.setInput('touch', touch ? '' : false);
      await settle(fixture);
      host.querySelector<HTMLButtonElement>('button.demo')!.click();
      await settle(fixture);
      const picks = Array.from(sheet().querySelectorAll<HTMLButtonElement>('.pick-one'));
      const heights = picks.map((pick) => getComputedStyle(pick).minBlockSize);
      picks[1].click();
      await settle(fixture);
      const link = query<HTMLAnchorElement>(sheet(), 'a[data-watch-external]');
      const touchLink = link.classList.contains('tb-button--touch');
      document.body
        .querySelectorAll('.cdk-overlay-container')
        .forEach((node) => node.replaceChildren());
      TestBed.resetTestingModule();
      return { heights, touchLink };
    };

    // Demo 1 and Demo 2 at 44 px, and Watch on YouTube at the kit's touch size.
    expect(await sizes(true)).toEqual({ heights: ['2.75rem', '2.75rem'], touchLink: true });
    // A coach's screens leave touch unset: the sheet keeps its pointer sizes.
    expect(await sizes(false)).toEqual({ heights: ['2.25rem', '2.25rem'], touchLink: false });
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

  it('opens a YouTube or Vimeo demo on its own site, in a new tab, and loads nothing from it', async () => {
    const grant = vi.fn((id: string) =>
      of(
        access(id, {
          source: 'ExternalEmbed',
          contentType: null,
          url: 'https://player.vimeo.com/video/76979871',
          externalProvider: 'Vimeo',
          watchUrl: 'https://vimeo.com/76979871',
        }),
      ),
    );
    const { fixture, host } = await render(['vimeo'], false, grant);

    host.querySelector('button')!.click();
    await settle(fixture);

    // C18 (audit WEA-2): a link to the video's page, not a player and not an error.
    const link = sheet().querySelector<HTMLAnchorElement>('[data-watch-external]')!;
    expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Watch on Vimeo (opens in a new tab)',
    );
    expect(link.getAttribute('href')).toBe('https://vimeo.com/76979871');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(sheet().textContent).toContain(
      'This demo is a video on Vimeo. It opens there, in a new tab.',
    );
    expect(sheet().querySelector('video, iframe, img')).toBeNull();
    expect(sheet().querySelector('[role="alert"]')).toBeNull();
  });

  it('opens nothing when a demo link is not a YouTube or Vimeo page', async () => {
    const grant = vi.fn((id: string) =>
      of(access(id, { source: 'ExternalEmbed', watchUrl: 'https://example.test/watch' })),
    );
    const { fixture, host } = await render(['odd'], false, grant);

    host.querySelector('button')!.click();
    await settle(fixture);

    expect(sheet().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'This demo can’t be opened.',
    );
    expect(sheet().querySelector('a')).toBeNull();
  });
});
