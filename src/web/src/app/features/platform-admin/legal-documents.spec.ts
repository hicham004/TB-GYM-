import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { fill, press, query, settle, tick } from '../../../testing/dom';
import { type LegalVersion, toLegalVersion } from './legal-documents.models';
import { LegalDocuments } from './legal-documents';
import { PlatformAdminApi } from './platform-admin-api';

// Every text here is a placeholder for the tests, not legal wording.
function version(overrides: Partial<Parameters<typeof toLegalVersion>[0]> = {}): LegalVersion {
  return toLegalVersion({
    id: 'terms-2',
    kind: 'TermsOfService',
    version: '2026-11',
    culture: 'en',
    context: 'Platform',
    acceptanceStatement: 'Placeholder sentence to tick.',
    contentUri: '/legal/terms-2',
    contentSha256: 'ab'.repeat(32),
    characterCount: 40,
    publishedAtUtc: '2025-11-01T09:00:00Z',
    retiredAtUtc: null,
    acceptanceCount: 3,
    ...overrides,
  });
}

const CURRENT = version();
const REPLACED = version({
  id: 'terms-1',
  version: '2026-10',
  publishedAtUtc: '2025-10-01T09:00:00Z',
  retiredAtUtc: '2025-11-01T09:00:00Z',
  acceptanceCount: 1,
});

async function render(
  reads: (() => ReturnType<PlatformAdminApi['getLegalDocuments']>)[],
  withdraw: () => ReturnType<PlatformAdminApi['withdrawLegalDocument']> = () =>
    of({ ...CURRENT, retiredAtUtc: '2025-12-01T09:00:00Z', isCurrent: false }),
) {
  let call = 0;
  const api = {
    getLegalDocuments: vi.fn(() => reads[Math.min(call++, reads.length - 1)]()),
    publishLegalDocument: vi.fn(() => of(version({ id: 'terms-3', version: '2026-12' }))),
    withdrawLegalDocument: vi.fn(withdraw),
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PlatformAdminApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(LegalDocuments);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The sheet or dialog on top, which the CDK draws outside the page. */
const overlay = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  return open.length ? open[open.length - 1] : null;
};

describe('LegalDocuments', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  it('lists each document with the version in force, who is asked and what it replaced', async () => {
    const { host } = await render([() => of([REPLACED, CURRENT])]);

    expect(textOf(host.querySelector('h1'))).toBe('Legal documents');
    expect(host.textContent).toContain(
      'Anyone who joined before a version was published is not asked to accept it yet.',
    );
    const terms = query(host, '[data-legal-kind="TermsOfService"]');
    expect(textOf(terms.querySelector('h2'))).toBe('Terms of Service');
    const current = query(terms, '[data-version="terms-2"]');
    expect(textOf(current.querySelector('.quiet'))).toBe(
      'Once per person · In force since 1 Nov 2025 · Accepted 3 times',
    );
    expect(textOf(current.querySelector('.statement'))).toBe('“Placeholder sentence to tick.”');
    expect(current.querySelector('a')?.getAttribute('href')).toBe('/legal/terms-2');
    expect(textOf(terms.querySelector('details summary'))).toBe('Earlier versions (1)');
    expect(textOf(terms.querySelector('details li'))).toContain(
      'Version 2026-10 Once per person · In force 1 Oct 2025 to 1 Nov 2025 · Accepted once',
    );
    // A document never published says nobody is asked.
    expect(textOf(query(host, '[data-legal-kind="PrivacyPolicy"] [data-unpublished]'))).toBe(
      'Not published. Nobody is asked to accept it.',
    );
  });

  /** Until the list is in, the page cannot say what a new version would replace, so it offers none. */
  it('offers Try again, and no publishing, when the documents could not be read', async () => {
    const { fixture, host, api } = await render([
      () => throwError(() => new Error('offline')),
      () => of([CURRENT]),
    ]);

    expect(host.querySelector('.load-failed [role="alert"]')?.textContent).toContain(
      'The legal documents couldn’t be loaded.',
    );
    expect(host.querySelector('[data-publish]')).toBeNull();
    press(host, 'Try again');
    await settle(fixture);
    expect(api.getLegalDocuments).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-version="terms-2"]')).not.toBeNull();
    expect(host.querySelector('[data-publish]')).not.toBeNull();
  });

  it('publishes a new version from the one in force and reads the list again', async () => {
    const after = new Subject<LegalVersion[]>();
    const { fixture, host, api } = await render([() => of([CURRENT]), () => after]);

    press(query(host, '[data-version="terms-2"]'), 'Publish a new version of the Terms of Service');
    await settle(fixture);
    const sheet = overlay()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Publish a legal document version');
    fill(sheet, 'Version name', '2026-12');
    fill(sheet, 'The document’s text', 'Placeholder text.');
    fill(sheet, 'The sentence people tick', 'Placeholder sentence.');
    tick(sheet, 'A qualified reviewer approved this exact text and sentence.');
    await settle(fixture);
    press(sheet, 'Publish this version');
    await settle(fixture);
    press(sheet, 'Publish now');
    await settle(fixture);
    await settle(fixture);

    expect(api.publishLegalDocument).toHaveBeenCalledWith(
      expect.objectContaining({ version: '2026-12', replacesVersionId: 'terms-2' }),
    );
    expect(document.body.textContent).toContain(
      'Terms of Service version 2026-12 is published. People who join from now on are asked to accept it.',
    );
    expect(api.getLegalDocuments).toHaveBeenCalledTimes(2);
    after.next([version({ id: 'terms-3', version: '2026-12' })]);
    await settle(fixture);
    expect(host.querySelector('[data-version="terms-3"]')).not.toBeNull();
  });

  /** A version published by mistake stops being asked for, after a question; nothing goes out on Keep it. */
  it('stops asking for a version after asking first', async () => {
    const { fixture, host, api, csrf } = await render([
      () => of([CURRENT]),
      () => of([{ ...CURRENT, retiredAtUtc: '2025-12-01T09:00:00Z', isCurrent: false }]),
    ]);

    press(
      query(host, '[data-version="terms-2"]'),
      'Stop asking for version 2026-11 of the Terms of Service',
    );
    await settle(fixture);
    let question = overlay()!;
    expect(textOf(question)).toContain(
      'Stop asking for the Terms of Service version 2026-11? People who join from now on are no longer asked to accept it. Those who accepted it keep their acceptance, and the version stays readable.',
    );
    press(question, 'Keep it');
    await settle(fixture);
    expect(api.withdrawLegalDocument).not.toHaveBeenCalled();

    press(
      query(host, '[data-version="terms-2"]'),
      'Stop asking for version 2026-11 of the Terms of Service',
    );
    await settle(fixture);
    question = overlay()!;
    press(question, 'Stop asking');
    await settle(fixture);
    await settle(fixture);

    expect(csrf.refresh).toHaveBeenCalled();
    expect(api.withdrawLegalDocument).toHaveBeenCalledWith('terms-2');
    expect(document.body.textContent).toContain(
      'Nobody is asked for the Terms of Service version 2026-11 any more.',
    );
    expect(host.querySelector('[data-version="terms-2"] [data-withdraw]')).toBeNull();
    expect(textOf(query(host, '[data-legal-kind="TermsOfService"] [data-unpublished]'))).toBe(
      'Not published. Nobody is asked to accept it.',
    );
  });

  it('says why a withdrawal was refused, in the server’s words', async () => {
    const changed = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'legal_document_changed',
        message: 'Another version of this document was published or withdrawn meanwhile.',
      },
    });
    const { fixture, host } = await render([() => of([CURRENT])], () => throwError(() => changed));

    press(
      query(host, '[data-version="terms-2"]'),
      'Stop asking for version 2026-11 of the Terms of Service',
    );
    await settle(fixture);
    press(overlay()!, 'Stop asking');
    await settle(fixture);
    await settle(fixture);

    expect(document.body.textContent).toContain(
      'Another version of this document was published or withdrawn meanwhile.',
    );
  });

  /** Typed work is not lost to a stray close: the sheet asks first. */
  it('asks before closing a sheet that holds typed text', async () => {
    const { fixture, host, api } = await render([() => of([CURRENT])]);

    press(host, 'Publish a version');
    await settle(fixture);
    fill(overlay()!, 'Version name', '2026-12');
    await settle(fixture);
    press(overlay()!, 'Not now');
    await settle(fixture);

    const question = overlay()!;
    expect(question.textContent).toContain(
      'Close without publishing? What you typed will be lost.',
    );
    press(question, 'Keep editing');
    await settle(fixture);
    expect(textOf(overlay()?.querySelector('h2'))).toBe('Publish a legal document version');
    expect(api.publishLegalDocument).not.toHaveBeenCalled();
  });
});
