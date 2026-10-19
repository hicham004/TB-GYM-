import { describe, expect, it } from 'vitest';
import type { MediaAccessView } from '../../core/api/generated';
import { externalVideo } from './external-video';

function grant(overrides: Partial<MediaAccessView>): MediaAccessView {
  return {
    assetId: 'asset-1',
    kind: 'Video',
    source: 'ExternalEmbed',
    contentType: null,
    url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    expiresAtUtc: '2026-10-20T12:00:00Z',
    downloadAllowed: false,
    ...overrides,
  };
}

describe('externalVideo', () => {
  it('opens a YouTube or Vimeo demo on the provider’s own video page', () => {
    expect(
      externalVideo(grant({ watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })),
    ).toEqual({ provider: 'YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect(externalVideo(grant({ watchUrl: 'https://vimeo.com/76979871' }))).toEqual({
      provider: 'Vimeo',
      url: 'https://vimeo.com/76979871',
    });
  });

  it('opens nothing for an upload, a missing page or any other address', () => {
    expect(
      externalVideo(grant({ source: 'Upload', watchUrl: 'https://vimeo.com/76979871' })),
    ).toBeNull();
    expect(externalVideo(grant({ watchUrl: null }))).toBeNull();
    // The embed address is not a page to open, and no other site may be.
    expect(
      externalVideo(grant({ watchUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' })),
    ).toBeNull();
    expect(externalVideo(grant({ watchUrl: 'https://vimeo.com.example.test/1' }))).toBeNull();
    expect(externalVideo(grant({ watchUrl: 'javascript:alert(1)' }))).toBeNull();
  });
});
