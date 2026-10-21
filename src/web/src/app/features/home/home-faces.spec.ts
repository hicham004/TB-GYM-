import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { HOME_FACES, preloadHomeFaces } from './home-faces';

const REGULAR = '/fonts/ibm-plex/IBMPlexSans-Regular.woff2';

/** The fonts the document asks for with itself, in order. */
function fontRequests(): string[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]'),
  ).map((link) => link.getAttribute('href') ?? '');
}

/** index.html's own request for the regular face, which every document carries. */
function regularFace(): void {
  const link = document.createElement('link');
  link.setAttribute('rel', 'preload');
  link.setAttribute('href', REGULAR);
  link.setAttribute('as', 'font');
  document.head.append(link);
}

describe('preloadHomeFaces', () => {
  afterEach(() => {
    document.head.querySelectorAll('link[rel="preload"]').forEach((link) => link.remove());
    TestBed.resetTestingModule();
  });

  it('writes the homepage’s two faces into the document the build renders, ahead of the regular one', () => {
    regularFace();
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    TestBed.runInInjectionContext(() => preloadHomeFaces());
    // A second page of the same render (what changed after the homepage) asks for nothing twice.
    TestBed.runInInjectionContext(() => preloadHomeFaces());

    expect(fontRequests()).toEqual([...HOME_FACES, REGULAR]);
    const medium = document.head.querySelector(`link[href="${HOME_FACES[0]}"]`)!;
    expect(medium.getAttribute('type')).toBe('font/woff2');
    expect(medium.hasAttribute('crossorigin')).toBe(true);
  });

  it('asks for nothing in the browser, where the faces load as the page draws them', () => {
    regularFace();
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
    TestBed.runInInjectionContext(() => preloadHomeFaces());

    expect(fontRequests()).toEqual([REGULAR]);
  });
});
