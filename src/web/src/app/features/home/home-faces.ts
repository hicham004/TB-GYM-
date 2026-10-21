import { DOCUMENT, isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';

/**
 * The homepage's own faces, which `home.scss` and `changelog.scss` declare (`brand.home-faces`):
 * Plex Medium for the headlines and Plex Mono Medium for the eyebrows, captions and day strip.
 */
export const HOME_FACES = [
  '/fonts/ibm-plex/IBMPlexSans-Medium.woff2',
  '/fonts/ibm-plex/IBMPlexMono-Medium.woff2',
];

/**
 * Asks for the homepage's own faces with the document, so its headline does not reflow when they
 * arrive (UI plan R6.2f). Only the build-time render writes the requests, into the two documents
 * that draw these faces (the homepage and what changed); the shell every other page starts from
 * names only the regular face, where every app page used to fetch these two and Chrome warned they
 * went unused (audit UIQ-7). Call it from the page's constructor.
 */
export function preloadHomeFaces(): void {
  if (!isPlatformServer(inject(PLATFORM_ID))) return;
  const document = inject(DOCUMENT);
  const head = document.head;
  // Beside the regular face's request in index.html, ahead of the styles.
  const before = head.querySelector('link[rel="preload"][as="font"]');
  for (const href of HOME_FACES) {
    if (head.querySelector(`link[rel="preload"][href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.setAttribute('rel', 'preload');
    link.setAttribute('href', href);
    link.setAttribute('as', 'font');
    link.setAttribute('type', 'font/woff2');
    link.setAttribute('crossorigin', '');
    head.insertBefore(link, before);
  }
}
