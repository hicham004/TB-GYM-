import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalDocumentText } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { press, query, settle } from '../../../testing/dom';
import { LegalApi } from './legal-api';
import { LegalDocument } from './legal-document';

// The text here is a placeholder for the tests, not legal wording.
const PUBLISHED: LegalDocumentText = {
  id: 'terms-1',
  kind: 'TermsOfService',
  version: '2026-11',
  culture: 'en',
  context: 'Platform',
  content: 'Section 1\n\nFirst line\nsecond line',
  acceptanceStatement: 'Placeholder sentence to tick.',
  contentSha256: '04b63ff45596250d105ac72aeff8ab5758b24d11645d99ab07dad8d88b9dab78',
  publishedAtUtc: '2025-10-01T09:00:00Z',
  retiredAtUtc: null,
};

async function render(
  document: () => ReturnType<LegalApi['document']>,
  user: object | null = null,
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthStore, useValue: { user: signal(user) } },
      { provide: LegalApi, useValue: { document: vi.fn(document) } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ documentId: 'terms-1' }) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(LegalDocument);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    legal: TestBed.inject(LegalApi),
    title: TestBed.inject(Title),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('LegalDocument', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a published version as it was published, with its sentence and fingerprint', async () => {
    const { host, legal, title } = await render(() => of(PUBLISHED));

    expect(legal.document).toHaveBeenCalledWith('terms-1');
    expect(textOf(host.querySelector('h1'))).toBe('Terms of Service');
    expect(textOf(host.querySelector('.legal-page__eyebrow'))).toBe('Version 2026-11');
    expect(textOf(host.querySelector('[data-legal-when]'))).toBe('In force since 1 Oct 2025.');
    const text = query(host, '[data-legal-text]');
    expect(text.getAttribute('lang')).toBe('en');
    expect(Array.from(text.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'Section 1',
      'First line\nsecond line',
    ]);
    expect(host.textContent).toContain('“Placeholder sentence to tick.”');
    expect(textOf(host.querySelector('.legal-page__hash'))).toBe(PUBLISHED.contentSha256);
    expect(title.getTitle()).toBe('Terms of Service | TB Gym');
    // A visitor reads it in the website's frame.
    expect(host.querySelector('app-home-header')).not.toBeNull();
    expect(host.querySelector('.legal-page__foot')).not.toBeNull();
  });

  /** A replaced version stays readable, as people accepted it; it says it was replaced. */
  it('says when a replaced version was in force', async () => {
    const { host } = await render(
      () => of({ ...PUBLISHED, retiredAtUtc: '2025-11-03T09:00:00Z' }),
      { id: 'me' },
    );

    expect(textOf(host.querySelector('[data-legal-when]'))).toBe(
      'In force from 1 Oct 2025 to 3 Nov 2025. A newer version has replaced it.',
    );
    // Inside the app of a signed-in person, only the document.
    expect(host.querySelector('app-home-header')).toBeNull();
    expect(query(host, '.legal-page').classList).toContain('legal-page--embedded');
  });

  it('says a document that is not published is not available, without the server’s words', async () => {
    const { host } = await render(() =>
      throwError(() => new HttpErrorResponse({ status: 404, error: { title: 'Not Found' } })),
    );

    expect(textOf(host.querySelector('h1'))).toBe('This document isn’t available');
    expect(host.textContent).not.toContain('Not Found');
    expect(host.querySelector('[data-legal-text]')).toBeNull();
  });

  it('offers Try again when the document could not be read', async () => {
    let fails = true;
    const { fixture, host, legal } = await render(() =>
      fails ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(PUBLISHED),
    );

    expect(textOf(host.querySelector('h1'))).toBe('The document couldn’t be loaded');
    fails = false;
    press(host, 'Try again');
    await settle(fixture);
    expect(legal.document).toHaveBeenCalledTimes(2);
    expect(textOf(host.querySelector('h1'))).toBe('Terms of Service');
  });
  /** A fragment link would load the homepage under the base href; the skip link moves focus itself. */
  it('moves focus to the document from its skip link without leaving the page', async () => {
    const { host } = await render(() => of(PUBLISHED));

    const skip = query<HTMLAnchorElement>(host, '.skip-link');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    skip.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(query(host, '#legal-content'));
  });

  it('leaves the tab title alone when the person left before the document arrived', async () => {
    const arrives = new Subject<LegalDocumentText>();
    const { fixture, title } = await render(() => arrives);
    title.setTitle('Somewhere else | TB Gym');

    fixture.destroy();
    arrives.next(PUBLISHED);
    await new Promise((resolve) => setTimeout(resolve));

    expect(title.getTitle()).toBe('Somewhere else | TB Gym');
  });
});
