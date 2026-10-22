import { describe, expect, it } from 'vitest';
import type { LegalDocumentAdminView } from '../../core/api/generated';
import {
  acceptanceClause,
  acceptanceLine,
  characterLine,
  currentFor,
  defaultContext,
  entryDirty,
  entryFrom,
  inForceLine,
  legalEntryErrors,
  legalGroups,
  startFrom,
  toLegalVersion,
  toPublishLegalRequest,
} from './legal-documents.models';

// The words here are placeholders for the tests, not legal text.
function view(overrides: Partial<LegalDocumentAdminView> = {}): LegalDocumentAdminView {
  return {
    id: 'terms-2',
    kind: 'TermsOfService',
    version: '2026-11',
    culture: 'en',
    context: 'Platform',
    acceptanceStatement: 'Placeholder sentence to tick.',
    contentUri: '/legal/terms-2',
    contentSha256: 'ab'.repeat(32),
    characterCount: '1234',
    publishedAtUtc: '2025-11-01T09:00:00Z',
    retiredAtUtc: null,
    acceptanceCount: 3,
    ...overrides,
  };
}

const CURRENT = toLegalVersion(view());
const REPLACED = toLegalVersion(
  view({
    id: 'terms-1',
    version: '2026-10',
    publishedAtUtc: '2025-10-01T09:00:00Z',
    retiredAtUtc: '2025-11-01T09:00:00Z',
    acceptanceCount: 1,
  }),
);
const HEALTH = toLegalVersion(
  view({ id: 'health-1', kind: 'HealthIntakeConsent', context: 'Workspace', version: '1' }),
);

describe('the platform admin’s legal documents', () => {
  it('reads a version, its counts as numbers and its page as the app’s own', () => {
    expect(CURRENT).toEqual({
      id: 'terms-2',
      kind: 'TermsOfService',
      name: 'Terms of Service',
      version: '2026-11',
      culture: 'en',
      language: 'English',
      context: 'Platform',
      contextName: 'Once per person',
      statement: 'Placeholder sentence to tick.',
      characters: 1234,
      acceptances: 3,
      publishedAtUtc: '2025-11-01T09:00:00Z',
      retiredAtUtc: null,
      isCurrent: true,
      link: '/legal/terms-2',
    });
    expect(REPLACED.isCurrent).toBe(false);
  });

  it('groups every document with its version in force and what that replaced', () => {
    const groups = legalGroups([REPLACED, HEALTH, CURRENT]);

    expect(groups.map((group) => group.name)).toEqual([
      'Terms of Service',
      'Privacy Policy',
      'Health intake consent',
    ]);
    expect(groups[0].current.map((version) => version.id)).toEqual(['terms-2']);
    expect(groups[0].earlier.map((version) => version.id)).toEqual(['terms-1']);
    expect(groups[1].current).toEqual([]);
    expect(groups[2].audience).toBe('Asked of clients when they accept an invitation.');
  });

  it('says when a version was in force and how often it was accepted', () => {
    expect(inForceLine(CURRENT, 'en-US')).toBe('In force since 1 Nov 2025');
    expect(inForceLine(REPLACED, 'en-US')).toBe('In force 1 Oct 2025 to 1 Nov 2025');
    expect(acceptanceLine(0)).toBe('Not accepted by anyone yet');
    expect(acceptanceLine(1)).toBe('Accepted once');
    expect(acceptanceLine(3)).toBe('Accepted 3 times');
    // Inside a sentence the clause has words of its own, never a lowered sentence.
    expect(acceptanceClause(0)).toBe('not accepted by anyone yet');
    expect(acceptanceClause(1)).toBe('accepted once');
    expect(acceptanceClause(3)).toBe('accepted 3 times');
  });

  /** One version of a document is in force, whoever accepts it: a new one replaces it either way. */
  it('finds the version a new one would replace, whoever accepts either', () => {
    expect(currentFor([REPLACED, CURRENT], 'TermsOfService', 'en')).toBe(CURRENT);
    expect(currentFor([REPLACED, HEALTH], 'TermsOfService', 'en')).toBeNull();
    expect(currentFor([CURRENT, HEALTH], 'HealthIntakeConsent', 'en')).toBe(HEALTH);
    expect(startFrom(HEALTH)).toEqual({
      kind: 'HealthIntakeConsent',
      culture: 'en',
      context: 'Workspace',
    });
    expect(defaultContext('PrivacyPolicy')).toBe('Platform');
    expect(defaultContext('HealthIntakeConsent')).toBe('Workspace');
  });

  it('refuses each field the server would, and a name this document already has', () => {
    const blank = entryFrom({ kind: 'TermsOfService', culture: 'en', context: 'Platform' });
    expect(entryDirty(blank)).toBe(false);
    expect(legalEntryErrors(blank, [], 'en-US')).toEqual({
      version: ['Give the version a name, such as 2026-11.'],
      content: ['Paste the document’s text.'],
      statement: ['Enter the sentence people tick to accept, in your reviewer’s words.'],
      reviewed: ['Confirm that a qualified reviewer approved this exact text and sentence.'],
    });

    const typed = {
      ...blank,
      version: ' 2026-11 ',
      content: 'x'.repeat(200_001),
      statement: 's'.repeat(301),
      reviewed: true,
    };
    expect(entryDirty(typed)).toBe(true);
    expect(legalEntryErrors(typed, [CURRENT], 'en-US')).toEqual({
      version: [
        'This document already has a version called 2026-11. Give this one a name of its own.',
      ],
      content: ['The text can be at most 200,000 characters.'],
      statement: ['Use 300 characters or fewer.'],
    });
    // A name is the document's, whoever accepts the version; another document may use it.
    expect(
      legalEntryErrors({ ...typed, context: 'Workspace' }, [CURRENT], 'en-US').version,
    ).toEqual([
      'This document already has a version called 2026-11. Give this one a name of its own.',
    ]);
    expect(
      legalEntryErrors({ ...typed, kind: 'PrivacyPolicy' }, [CURRENT], 'en-US').version,
    ).toBeUndefined();
    expect(legalEntryErrors({ ...typed, version: 'v'.repeat(41) }, [], 'en-US').version).toEqual([
      'Use 40 characters or fewer.',
    ]);
  });

  it('counts the text as the server stores it, and sends what was typed with the version it replaces', () => {
    expect(characterLine('\r\n  ab\r\ncd  \n', 'en-US')).toBe('5 of 200,000 characters');
    const entry = {
      kind: 'TermsOfService' as const,
      culture: 'en' as const,
      context: 'Platform' as const,
      version: ' 2026-12 ',
      content: 'Text\r\n',
      statement: ' Placeholder sentence. ',
      reviewed: true,
    };
    expect(toPublishLegalRequest(entry, CURRENT)).toEqual({
      kind: 'TermsOfService',
      culture: 'en',
      context: 'Platform',
      version: '2026-12',
      content: 'Text\r\n',
      acceptanceStatement: 'Placeholder sentence.',
      reviewed: true,
      replacesVersionId: 'terms-2',
    });
    expect(toPublishLegalRequest(entry, null).replacesVersionId).toBeNull();
  });
});
