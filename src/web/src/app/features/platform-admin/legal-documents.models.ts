import type { LegalDocumentAdminView } from '../../core/api/generated';
import { toNumber } from '../../core/api/api-client';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';
import {
  LEGAL_KINDS,
  legalAudienceLine,
  legalContextName,
  legalKindName,
  legalLanguageName,
  type LegalContext,
  type LegalKind,
  type LegalLanguage,
} from '../legal/legal.models';

/** The longest text and sentence the server keeps (LegalDocumentVersion's limits). */
export const LEGAL_MAX_CONTENT = 200_000;
export const LEGAL_MAX_STATEMENT = 300;
export const LEGAL_MAX_VERSION = 40;

/** One version as the platform admin's page lists it. */
export interface LegalVersion {
  readonly id: string;
  readonly kind: LegalKind;
  readonly name: string;
  readonly version: string;
  readonly culture: string;
  readonly language: string;
  readonly context: LegalContext;
  readonly contextName: string;
  readonly statement: string;
  readonly characters: number;
  readonly acceptances: number;
  readonly publishedAtUtc: string | null;
  readonly retiredAtUtc: string | null;
  readonly isCurrent: boolean;
  readonly link: string;
}

export function toLegalVersion(view: LegalDocumentAdminView): LegalVersion {
  return {
    id: view.id,
    kind: view.kind,
    name: legalKindName(view.kind),
    version: view.version,
    culture: view.culture,
    language: legalLanguageName(view.culture),
    context: view.context,
    contextName: legalContextName(view.context),
    statement: view.acceptanceStatement,
    characters: toNumber(view.characterCount),
    acceptances: toNumber(view.acceptanceCount),
    publishedAtUtc: view.publishedAtUtc ?? null,
    retiredAtUtc: view.retiredAtUtc ?? null,
    isCurrent: !!view.publishedAtUtc && !view.retiredAtUtc,
    link: `/legal/${encodeURIComponent(view.id)}`,
  };
}

/** A document with its version in force, if any, and the versions replaced or withdrawn. */
export interface LegalKindGroup {
  readonly kind: LegalKind;
  readonly name: string;
  readonly audience: string;
  readonly current: readonly LegalVersion[];
  readonly earlier: readonly LegalVersion[];
}

export function legalGroups(versions: readonly LegalVersion[]): LegalKindGroup[] {
  const byPublished = (a: LegalVersion, b: LegalVersion) =>
    (b.publishedAtUtc ?? '').localeCompare(a.publishedAtUtc ?? '');
  return LEGAL_KINDS.map((kind) => {
    const mine = versions.filter((version) => version.kind === kind);
    return {
      kind,
      name: legalKindName(kind),
      audience: legalAudienceLine(kind),
      current: mine.filter((version) => version.isCurrent),
      earlier: mine.filter((version) => !version.isCurrent).sort(byPublished),
    };
  });
}

/** "Accepted 3 times", or not yet. */
export function acceptanceLine(count: number): string {
  if (count === 0) return $localize`Not accepted by anyone yet`;
  return count === 1 ? $localize`Accepted once` : $localize`Accepted ${count}:count: times`;
}

/** The same count inside a sentence: "accepted 3 times", or "not accepted by anyone yet". */
export function acceptanceClause(count: number): string {
  if (count === 0) return $localize`not accepted by anyone yet`;
  return count === 1 ? $localize`accepted once` : $localize`accepted ${count}:count: times`;
}

/** When a version was in force, on the reader's own clock: a platform document has no workspace. */
export function inForceLine(version: LegalVersion, locale: string): string {
  const today = dayInZone(new Date(), null);
  const day = (instant: string) => houseDay(dayInZone(instant, null), locale, today);
  if (!version.publishedAtUtc) return $localize`Not published`;
  return version.retiredAtUtc
    ? $localize`In force ${day(version.publishedAtUtc)}:from: to ${day(version.retiredAtUtc)}:to:`
    : $localize`In force since ${day(version.publishedAtUtc)}:since:`;
}

/** What the publish sheet starts from: blank, or a new version of one in force. */
export interface LegalPublishStart {
  readonly kind: LegalKind;
  readonly culture: LegalLanguage;
  readonly context: LegalContext;
}

/** Terms and Privacy are accepted once per person; a health consent in each coaching space. */
export function defaultContext(kind: LegalKind): LegalContext {
  return kind === 'HealthIntakeConsent' ? 'Workspace' : 'Platform';
}

export function blankStart(): LegalPublishStart {
  return { kind: 'TermsOfService', culture: 'en', context: 'Platform' };
}

export function startFrom(version: LegalVersion): LegalPublishStart {
  return { kind: version.kind, culture: 'en', context: version.context };
}

/**
 * The version in force a new one would replace, or null when none is: one per document and language,
 * whoever accepts it, so moving a document to the other people replaces it too.
 */
export function currentFor(
  versions: readonly LegalVersion[],
  kind: LegalKind,
  culture: string,
): LegalVersion | null {
  return (
    versions.find(
      (version) => version.isCurrent && version.kind === kind && version.culture === culture,
    ) ?? null
  );
}

/** What the admin is publishing, as typed. */
export interface LegalEntry {
  kind: LegalKind;
  culture: LegalLanguage;
  context: LegalContext;
  version: string;
  content: string;
  statement: string;
  reviewed: boolean;
}

export type LegalField = 'version' | 'content' | 'statement' | 'reviewed';

export function entryFrom(start: LegalPublishStart): LegalEntry {
  return { ...start, version: '', content: '', statement: '', reviewed: false };
}

/** The text as the server stores and hashes it: line endings made \n and the ends trimmed. */
export function normalizedContent(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim();
}

/** Each field's reasons, worked out from what is typed; the server checks them all again. */
export function legalEntryErrors(
  entry: LegalEntry,
  versions: readonly LegalVersion[],
  locale: string,
): Partial<Record<LegalField, string[]>> {
  const errors: Partial<Record<LegalField, string[]>> = {};
  const version = entry.version.trim();
  if (version === '') errors.version = [$localize`Give the version a name, such as 2026-11.`];
  else if (version.length > LEGAL_MAX_VERSION)
    errors.version = [$localize`Use ${LEGAL_MAX_VERSION}:max: characters or fewer.`];
  else if (
    versions.some(
      (item) =>
        item.kind === entry.kind && item.culture === entry.culture && item.version === version,
    )
  )
    errors.version = [
      $localize`This document already has a version called ${version}:version:. Give this one a name of its own.`,
    ];
  const content = normalizedContent(entry.content);
  if (content === '') errors.content = [$localize`Paste the document’s text.`];
  else if (content.length > LEGAL_MAX_CONTENT)
    errors.content = [
      $localize`The text can be at most ${LEGAL_MAX_CONTENT.toLocaleString(locale)}:max: characters.`,
    ];
  const statement = entry.statement.trim();
  if (statement === '')
    errors.statement = [
      $localize`Enter the sentence people tick to accept, in your reviewer’s words.`,
    ];
  else if (statement.length > LEGAL_MAX_STATEMENT)
    errors.statement = [$localize`Use ${LEGAL_MAX_STATEMENT}:max: characters or fewer.`];
  if (!entry.reviewed)
    errors.reviewed = [
      $localize`Confirm that a qualified reviewer approved this exact text and sentence.`,
    ];
  return errors;
}

/** "12,345 of 200,000 characters". */
export function characterLine(content: string, locale: string): string {
  const count = normalizedContent(content).length;
  return $localize`${count.toLocaleString(locale)}:count: of ${LEGAL_MAX_CONTENT.toLocaleString(locale)}:max: characters`;
}

/** Whether the sheet holds something typed that closing would lose. */
export function entryDirty(entry: LegalEntry): boolean {
  return (
    entry.version.trim() !== '' ||
    entry.content.trim() !== '' ||
    entry.statement.trim() !== '' ||
    entry.reviewed
  );
}

export interface PublishLegalRequest {
  kind: LegalKind;
  culture: string;
  context: LegalContext;
  version: string;
  content: string;
  acceptanceStatement: string;
  reviewed: boolean;
  replacesVersionId: string | null;
}

export function toPublishLegalRequest(
  entry: LegalEntry,
  replaces: LegalVersion | null,
): PublishLegalRequest {
  return {
    kind: entry.kind,
    culture: entry.culture,
    context: entry.context,
    version: entry.version.trim(),
    content: entry.content,
    acceptanceStatement: entry.statement.trim(),
    reviewed: entry.reviewed,
    replacesVersionId: replaces?.id ?? null,
  };
}
