import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  acceptedIds,
  keptTicks,
  LegalChoices,
  legalAudienceLine,
  legalContextClause,
  legalContextName,
  legalKindName,
  legalParagraphs,
  legalReasons,
  toLegalDocumentPage,
  toLegalToAccept,
  type LegalToAccept,
} from './legal.models';

// The words of every document here are placeholders for the tests, not legal text.

const TERMS: LegalToAccept = toLegalToAccept({
  id: 'terms/1',
  kind: 'TermsOfService',
  version: '2026-11',
  culture: 'en',
  context: 'Platform',
  acceptanceStatement: 'Placeholder sentence to tick.',
  contentUri: '/legal/terms-1',
  publishedAtUtc: '2026-10-22T09:00:00Z',
});

const HEALTH: LegalToAccept = {
  ...TERMS,
  id: 'health-1',
  kind: 'HealthIntakeConsent',
  name: 'Health intake consent',
};

describe('legal documents on screen', () => {
  it('names each document and who accepts it in the app’s own words', () => {
    expect(legalKindName('TermsOfService')).toBe('Terms of Service');
    expect(legalKindName('PrivacyPolicy')).toBe('Privacy Policy');
    expect(legalKindName('HealthIntakeConsent')).toBe('Health intake consent');
    expect(legalContextName('Platform')).toBe('Once per person');
    expect(legalContextName('Workspace')).toBe('In each coaching space they join');
    expect(legalContextClause('Platform')).toBe('once per person');
    expect(legalContextClause('Workspace')).toBe('in each coaching space they join');
    expect(legalAudienceLine('TermsOfService')).toBe(
      'Asked of everyone who creates a coaching space or accepts an invitation.',
    );
    expect(legalAudienceLine('HealthIntakeConsent')).toBe(
      'Asked of clients when they accept an invitation.',
    );
  });

  it('reads the version the server sent, linking the app’s own page for it', () => {
    expect(TERMS).toEqual({
      id: 'terms/1',
      kind: 'TermsOfService',
      name: 'Terms of Service',
      version: '2026-11',
      statement: 'Placeholder sentence to tick.',
      culture: 'en',
      // Built from the id, never from an address the answer carries.
      link: '/legal/terms%2F1',
    });
  });

  /** A blank line starts a paragraph; a single break stays inside one; no word is added or lost. */
  it('splits the text into paragraphs as it was published', () => {
    expect(legalParagraphs('Section 1\r\n\r\nFirst line\nsecond line\n \nLast\n\n\n')).toEqual([
      'Section 1',
      'First line\nsecond line',
      'Last',
    ]);
    expect(legalParagraphs('   ')).toEqual([]);
  });

  /** A paragraph keeps its lines' indents and spaces; only whole blank lines between them go. */
  it('keeps the indent of a line and drops the blank lines around a paragraph', () => {
    expect(
      legalParagraphs(
        'You may not:\n- share your account, except:\n    - with your coach\n\n \n\t\nNext',
      ),
    ).toEqual(['You may not:\n- share your account, except:\n    - with your coach', 'Next']);
    expect(legalParagraphs('One\n\n  \n  Indented first line\n\t')).toEqual([
      'One',
      '  Indented first line',
    ]);
  });

  it('says which box is still to tick, and sends only ticks of documents still shown', () => {
    const accepted = new Set(['terms/1', 'replaced-1']);

    expect(legalReasons([TERMS, HEALTH], accepted)).toEqual([
      'Tick the box for the Health intake consent.',
    ]);
    expect(acceptedIds([TERMS, HEALTH], accepted)).toEqual(['terms/1']);
    expect([...keptTicks([HEALTH], accepted)]).toEqual([]);
    expect([...keptTicks([TERMS, HEALTH], accepted)]).toEqual(['terms/1']);
  });

  it('reads a published version for its page', () => {
    expect(
      toLegalDocumentPage({
        id: 'terms-1',
        kind: 'PrivacyPolicy',
        version: '3',
        culture: 'ar',
        context: 'Workspace',
        content: 'نص\n\nتجريبي',
        acceptanceStatement: 'جملة',
        contentSha256: 'ab'.repeat(32),
        publishedAtUtc: '2026-10-01T09:00:00Z',
        retiredAtUtc: null,
      }),
    ).toEqual({
      id: 'terms-1',
      name: 'Privacy Policy',
      version: '3',
      culture: 'ar',
      paragraphs: ['نص', 'تجريبي'],
      statement: 'جملة',
      fingerprint: 'ab'.repeat(32),
      publishedAtUtc: '2026-10-01T09:00:00Z',
      retiredAtUtc: null,
    });
  });
  /** The documents a page asks for and what was ticked, for registration and an invitation alike. */
  it('reads the documents, keeps ticks of those still shown and says why a refusal came', async () => {
    const replaced = { ...TERMS, id: 'terms-2' };
    let read = 0;
    const answers = [
      () => of([TERMS, HEALTH]),
      () => of([replaced, HEALTH]),
      () => throwError(() => new Error('offline')),
    ];
    const reader = vi.fn(() => answers[Math.min(read++, answers.length - 1)]());
    const choices = new LegalChoices(reader);

    expect(choices.documents()).toEqual([]);
    expect(await choices.load()).toBe(true);
    expect(choices.missing()).toEqual([
      'Tick the box for the Terms of Service.',
      'Tick the box for the Health intake consent.',
    ]);
    choices.toggle({ id: TERMS.id, checked: true });
    choices.toggle({ id: HEALTH.id, checked: true });
    expect(choices.missing()).toEqual([]);
    expect(choices.ids()).toEqual([TERMS.id, HEALTH.id]);
    choices.toggle({ id: HEALTH.id, checked: false });
    expect(choices.ids()).toEqual([TERMS.id]);
    choices.toggle({ id: HEALTH.id, checked: true });

    // The server asked again: the replaced version comes unticked, the one still shown stays ticked.
    expect(await choices.refused()).toBe(
      'The documents to accept changed while this page was open. Read them again below and tick each box.',
    );
    expect(choices.ids()).toEqual([HEALTH.id]);
    expect(choices.missing()).toEqual(['Tick the box for the Terms of Service.']);
    // A read that fails keeps what is shown and says the documents could not be loaded.
    expect(await choices.refused()).toBe(
      'The documents to accept couldn’t be loaded. Check your connection, then try again.',
    );
    expect(choices.documents()).toEqual([replaced, HEALTH]);
    expect(reader).toHaveBeenCalledTimes(3);
  });
});
