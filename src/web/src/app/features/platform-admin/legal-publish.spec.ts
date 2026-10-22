import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import {
  chooseOption,
  field,
  fill,
  formSummary,
  press,
  query,
  selectShows,
  settle,
  tick,
} from '../../../testing/dom';
import { blankStart, type LegalVersion, toLegalVersion } from './legal-documents.models';
import { LegalPublish } from './legal-publish';
import { PlatformAdminApi } from './platform-admin-api';

// Every text here is a placeholder for the tests, not legal wording.
const CURRENT: LegalVersion = toLegalVersion({
  id: 'terms-1',
  kind: 'TermsOfService',
  version: '2026-10',
  culture: 'en',
  context: 'Platform',
  acceptanceStatement: 'Placeholder sentence to tick.',
  contentUri: '/legal/terms-1',
  contentSha256: 'ab'.repeat(32),
  characterCount: 40,
  publishedAtUtc: '2025-10-01T09:00:00Z',
  retiredAtUtc: null,
  acceptanceCount: 2,
});

const PUBLISHED: LegalVersion = { ...CURRENT, id: 'terms-2', version: '2026-11', acceptances: 0 };

async function render(
  options: {
    versions?: LegalVersion[];
    publish?: () => ReturnType<PlatformAdminApi['publishLegalDocument']>;
  } = {},
) {
  const api = { publishLegalDocument: vi.fn(options.publish ?? (() => of(PUBLISHED))) };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformAdminApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(LegalPublish);
  fixture.componentRef.setInput('start', blankStart());
  fixture.componentRef.setInput('versions', options.versions ?? [CURRENT]);
  const closed: unknown[] = [];
  const dirty: boolean[] = [];
  let changed = 0;
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  fixture.componentInstance.changedMeanwhile.subscribe(() => changed++);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api,
    csrf,
    closed,
    dirty,
    changed: () => changed,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** What a control's description says: its reason once one is due, otherwise its help. */
function description(control: Element): string {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((id) => id.length > 0)
    .map((id) => textOf(document.getElementById(id)))
    .join(' ');
}

type Rendered = Awaited<ReturnType<typeof render>>;

/** Types a whole valid version, the review ticked. */
async function fillVersion({ fixture, host }: Rendered) {
  fill(host, 'Version name', '2026-11');
  fill(host, 'The document’s text', 'Section 1\n\nPlaceholder text written for a test.');
  fill(host, 'The sentence people tick', 'Placeholder sentence to tick.');
  tick(host, 'A qualified reviewer approved this exact text and sentence.');
  await settle(fixture);
}

/** Publish this version, then the sheet's last question, answered Publish now. */
async function publish({ fixture, host }: Rendered) {
  press(host, 'Publish this version');
  await settle(fixture);
  press(host, 'Publish now');
  await settle(fixture);
  await settle(fixture);
}

describe('LegalPublish', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says what a version replaces and who is asked, and sends it with the version it replaces', async () => {
    const sheet = await render();
    const { fixture, host, api, csrf, closed, dirty } = sheet;

    expect(selectShows(host, 'Document')).toBe('Terms of Service');
    // English only for now: no language to choose.
    expect(host.textContent).not.toContain('Arabic');
    expect(host.querySelectorAll('app-segmented-control')).toHaveLength(1);
    expect(textOf(host.querySelector('[data-audience]'))).toBe(
      'Asked of everyone who creates a coaching space or accepts an invitation.',
    );
    expect(textOf(host.querySelector('[data-replaces]'))).toBe(
      'This replaces version 2026-10 (In force since 1 Oct 2025, accepted 2 times). People who join from now on are asked to accept this version; nobody who joined before is asked again yet.',
    );
    expect(dirty.at(-1)).toBe(false);

    await fillVersion(sheet);
    expect(dirty.at(-1)).toBe(true);
    // The text as people will read it: a blank line starts a paragraph.
    expect(Array.from(host.querySelectorAll('[data-preview] p')).map((p) => p.textContent)).toEqual(
      ['Section 1', 'Placeholder text written for a test.'],
    );
    expect(description(field(host, 'The document’s text'))).toContain('47 of 200,000 characters');

    // Publishing asks once more first, the question taking focus; nothing is sent yet.
    press(host, 'Publish this version');
    await settle(fixture);
    await settle(fixture);
    const question = query(host, '[data-confirm]');
    expect(textOf(question)).toBe(
      'Publish the Terms of Service version 2026-11, accepted once per person? It can’t be changed or deleted afterwards; you can only replace it or stop asking for it.',
    );
    expect(document.activeElement).toBe(question);
    expect(api.publishLegalDocument).not.toHaveBeenCalled();

    press(host, 'Publish now');
    await settle(fixture);
    expect(csrf.refresh).toHaveBeenCalled();
    expect(api.publishLegalDocument).toHaveBeenCalledWith({
      kind: 'TermsOfService',
      culture: 'en',
      context: 'Platform',
      version: '2026-11',
      // A text box hands over its line breaks as \n, as a browser's does.
      content: 'Section 1\n\nPlaceholder text written for a test.',
      acceptanceStatement: 'Placeholder sentence to tick.',
      reviewed: true,
      replacesVersionId: 'terms-1',
    });
    expect(closed).toEqual([PUBLISHED]);
  });

  it('goes back to editing, and any change takes it back from its question', async () => {
    const sheet = await render();
    const { fixture, host, api } = sheet;

    await fillVersion(sheet);
    press(host, 'Publish this version');
    await settle(fixture);
    press(host, 'Back to editing');
    await settle(fixture);
    expect(host.querySelector('[data-confirm]')).toBeNull();

    press(host, 'Publish this version');
    await settle(fixture);
    fill(host, 'Version name', '2026-12');
    await settle(fixture);
    expect(host.querySelector('[data-confirm]')).toBeNull();
    expect(api.publishLegalDocument).not.toHaveBeenCalled();
  });

  it('takes a document’s own way of being accepted; moving one to other people replaces it', async () => {
    const sheet = await render();
    const { fixture, host, api } = sheet;

    await chooseOption(fixture, host, 'Document', 'Health intake consent');
    expect(field(host, 'In each coaching space').checked).toBe(true);
    expect(textOf(host.querySelector('[data-audience]'))).toBe(
      'Asked of clients when they accept an invitation.',
    );
    expect(textOf(host.querySelector('[data-replaces]'))).toBe(
      'Nothing of this kind is in force yet. People who join from now on are asked to accept this version.',
    );
    await fillVersion(sheet);
    await publish(sheet);
    expect(api.publishLegalDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'HealthIntakeConsent',
        context: 'Workspace',
        replacesVersionId: null,
      }),
    );

    // The Terms in force once per person are what a version for each coaching space replaces.
    TestBed.resetTestingModule();
    const terms = await render();
    tick(terms.host, 'In each coaching space');
    await settle(terms.fixture);
    expect(textOf(terms.host.querySelector('[data-replaces]'))).toContain(
      'This replaces version 2026-10',
    );
  });

  it('refuses an empty version itself: the first box marked takes focus and nothing is sent', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Publish this version');
    await settle(fixture);
    await settle(fixture);

    expect(api.publishLegalDocument).not.toHaveBeenCalled();
    expect(host.querySelector('[data-confirm]')).toBeNull();
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
    const version = field(host, 'Version name');
    expect(document.activeElement).toBe(version);
    expect(version.getAttribute('aria-invalid')).toBe('true');
    const reviewed = field(host, 'A qualified reviewer approved this exact text and sentence.');
    expect(reviewed.getAttribute('aria-invalid')).toBe('true');
    expect(description(reviewed)).toBe(
      'Confirm that a qualified reviewer approved this exact text and sentence.',
    );

    // With everything typed but the review, the review's box is the one to fix.
    fill(host, 'Version name', '2026-11');
    fill(host, 'The document’s text', 'Text');
    fill(host, 'The sentence people tick', 'Sentence');
    await settle(fixture);
    press(host, 'Publish this version');
    await settle(fixture);
    await settle(fixture);
    expect(document.activeElement).toBe(reviewed);
    expect(api.publishLegalDocument).not.toHaveBeenCalled();
  });

  /** A sentence pasted longer than the server keeps is refused out loud, never cut by the box. */
  it('keeps every character pasted and says when the sentence or name is too long', async () => {
    const sheet = await render();
    const { fixture, host, api } = sheet;

    await fillVersion(sheet);
    const statement = field(host, 'The sentence people tick');
    const version = field(host, 'Version name');
    expect(statement.hasAttribute('maxlength')).toBe(false);
    expect(version.hasAttribute('maxlength')).toBe(false);
    fill(host, 'The sentence people tick', 's'.repeat(301));
    fill(host, 'Version name', 'v'.repeat(41));
    await settle(fixture);
    press(host, 'Publish this version');
    await settle(fixture);

    expect(statement.value).toHaveLength(301);
    expect(description(statement)).toBe('Use 300 characters or fewer.');
    expect(description(version)).toBe('Use 40 characters or fewer.');
    expect(api.publishLegalDocument).not.toHaveBeenCalled();
  });

  it('refuses a version name this document already has before asking the server', async () => {
    const sheet = await render();
    const { fixture, host, api } = sheet;

    await fillVersion(sheet);
    fill(host, 'Version name', '2026-10');
    await settle(fixture);
    press(host, 'Publish this version');
    await settle(fixture);

    expect(api.publishLegalDocument).not.toHaveBeenCalled();
    expect(description(field(host, 'Version name'))).toBe(
      'This document already has a version called 2026-10. Give this one a name of its own.',
    );
  });

  /** Another admin published meanwhile: the page reads the versions again and the sheet says so. */
  it('tells the page to read the versions again when another was published meanwhile', async () => {
    const changed = new HttpErrorResponse({
      status: 409,
      error: { code: 'legal_document_changed', message: 'Server wording' },
    });
    const sheet = await render({ publish: () => throwError(() => changed) });
    const { host, closed, changed: changes } = sheet;

    await fillVersion(sheet);
    await publish(sheet);

    expect(changes()).toBe(1);
    expect(closed).toEqual([]);
    expect(textOf(formSummary(host))).toBe(
      'Another version of this document was published or withdrawn while this sheet was open. The line above says what yours would replace now; publish again to replace it.',
    );
    expect(document.activeElement).toBe(formSummary(host));
    expect(host.querySelector('[data-confirm]')).toBeNull();
    // What was typed stays.
    expect(field(host, 'Version name').value).toBe('2026-11');
  });

  it('keeps a refusal in the server’s own words', async () => {
    const taken = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'legal_version_taken',
        message: 'This document already has a version called 2026-11.',
      },
    });
    const sheet = await render({ publish: () => throwError(() => taken) });

    await fillVersion(sheet);
    await publish(sheet);

    expect(sheet.changed()).toBe(0);
    expect(textOf(formSummary(sheet.host))).toBe(
      'This document already has a version called 2026-11.',
    );
  });
});
