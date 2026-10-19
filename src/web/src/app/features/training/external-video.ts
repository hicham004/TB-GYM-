import type { MediaAccessView } from '../../core/api/generated';

/** A YouTube or Vimeo demo, and the page where it plays. */
export interface ExternalVideo {
  readonly provider: 'YouTube' | 'Vimeo';
  readonly url: string;
}

/** The only places a demo link may open: the providers' own video pages, as the server builds them. */
const WATCH_PAGES = ['https://www.youtube.com/watch?v=', 'https://vimeo.com/'];

/**
 * A demo hosted on YouTube or Vimeo opens on that site, in a new tab (C18, audit WEA-2): nothing from
 * either provider loads inside TB Gym, so the page's content policy stays as it is, and playing it
 * inside the app comes later. Null for an upload, which plays here, or for an address that is not one
 * of the two video pages.
 */
export function externalVideo(media: MediaAccessView): ExternalVideo | null {
  const url = media.watchUrl ?? '';
  if (media.source !== 'ExternalEmbed' || !WATCH_PAGES.some((page) => url.startsWith(page))) {
    return null;
  }
  return { provider: url.startsWith('https://vimeo.com/') ? 'Vimeo' : 'YouTube', url };
}
